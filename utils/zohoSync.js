const https = require('https');
const http  = require('http');
const pool  = require('../config/db');

// ── Low-level HTTP helper ─────────────────────────────────────────────────────
function request(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url     = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const reqOptions = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Region helpers ────────────────────────────────────────────────────────────
function accountsBase(region) {
  const map = { IN: 'accounts.zoho.in', EU: 'accounts.zoho.eu', AU: 'accounts.zoho.com.au', COM: 'accounts.zoho.com' };
  return `https://${map[region] || map.IN}`;
}
function apiBase(region) {
  const map = { IN: 'www.zohoapis.in', EU: 'www.zohoapis.eu', AU: 'www.zohoapis.com.au', COM: 'www.zohoapis.com' };
  return `https://${map[region] || map.IN}`;
}

// ── Token management ──────────────────────────────────────────────────────────
async function getConfig(orgId) {
  const [rows] = await pool.query('SELECT * FROM zoho_config WHERE org_id = ?', [orgId]);
  return rows[0] || null;
}

async function refreshAccessToken(cfg) {
  const base = accountsBase(cfg.dc_region);
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     cfg.client_id,
    client_secret: cfg.client_secret,
    refresh_token: cfg.refresh_token,
  }).toString();

  const res = await request(`${base}/oauth/v2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body);

  if (res.data.access_token) {
    const expiresAt = Date.now() + (res.data.expires_in || 3600) * 1000;
    await pool.query(
      'UPDATE zoho_config SET access_token=?, token_expires_at=? WHERE org_id=?',
      [res.data.access_token, expiresAt, cfg.org_id]
    );
    return { ...cfg, access_token: res.data.access_token, token_expires_at: expiresAt };
  }
  throw new Error('Token refresh failed: ' + JSON.stringify(res.data));
}

async function getValidToken(cfg) {
  const buffer = 5 * 60 * 1000; // refresh 5 min before expiry
  if (!cfg.token_expires_at || Date.now() > (cfg.token_expires_at - buffer)) {
    return refreshAccessToken(cfg);
  }
  return cfg;
}

// ── Zoho API wrapper ──────────────────────────────────────────────────────────
async function zohoGet(cfg, path) {
  cfg = await getValidToken(cfg);
  const url = `${apiBase(cfg.dc_region)}/books/v3${path}${path.includes('?') ? '&' : '?'}organization_id=${cfg.zoho_org_id}`;
  const res = await request(url, { headers: { Authorization: `Zoho-oauthtoken ${cfg.access_token}` } });
  return res.data;
}

async function zohoPost(cfg, path, payload) {
  cfg = await getValidToken(cfg);
  const url  = `${apiBase(cfg.dc_region)}/books/v3${path}?organization_id=${cfg.zoho_org_id}`;
  const body = JSON.stringify(payload);
  const res  = await request(url, {
    method:  'POST',
    headers: { Authorization: `Zoho-oauthtoken ${cfg.access_token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  return res.data;
}

async function zohoPut(cfg, path, payload) {
  cfg = await getValidToken(cfg);
  const url  = `${apiBase(cfg.dc_region)}/books/v3${path}?organization_id=${cfg.zoho_org_id}`;
  const body = JSON.stringify(payload);
  const res  = await request(url, {
    method:  'PUT',
    headers: { Authorization: `Zoho-oauthtoken ${cfg.access_token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  return res.data;
}

// ── Record mapping helpers ────────────────────────────────────────────────────
async function getZohoId(orgId, module, localId) {
  const [rows] = await pool.query(
    'SELECT zoho_id FROM zoho_record_map WHERE org_id=? AND module=? AND local_id=?',
    [orgId, module, localId]
  );
  return rows[0]?.zoho_id || null;
}

async function saveMapping(orgId, module, localId, zohoId) {
  await pool.query(
    'INSERT INTO zoho_record_map (org_id,module,local_id,zoho_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE zoho_id=?, last_synced_at=NOW()',
    [orgId, module, localId, zohoId, zohoId]
  );
}

async function getLocalIdByZohoId(orgId, module, zohoId) {
  const [rows] = await pool.query(
    'SELECT local_id FROM zoho_record_map WHERE org_id=? AND module=? AND zoho_id=?',
    [orgId, module, zohoId]
  );
  return rows[0]?.local_id || null;
}

// ── Audit detail logger ───────────────────────────────────────────────────────
async function logDetail(logId, orgId, module, direction, localId, zohoId, recordName, action, status, note = null) {
  await pool.query(
    'INSERT INTO zoho_sync_detail (log_id,org_id,module,direction,local_id,zoho_id,record_name,action,status,note) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [logId, orgId, module, direction, localId || null, zohoId || null, recordName || null, action, status, note]
  );
}

// ── Module: Donors ↔ Zoho Contacts ────────────────────────────────────────────
async function syncDonors(orgId, cfg, logId) {
  let pushed = 0, pulled = 0;

  const [donors] = await pool.query('SELECT * FROM donors WHERE is_active=1');
  for (const donor of donors) {
    const existingZohoId = await getZohoId(orgId, 'donor', donor.id);
    const contactPerson = { is_primary_contact: true };
    if (donor.email) contactPerson.email = donor.email;
    if (donor.phone) contactPerson.phone = donor.phone;
    const payload = {
      contact_name:    donor.name,
      contact_type:    'customer',
      contact_persons: [contactPerson],
      notes:           donor.donor_type ? `Type: ${donor.donor_type}` : undefined,
    };
    try {
      if (!existingZohoId) {
        const res = await zohoPost(cfg, '/contacts', payload);
        if (res.contact?.contact_id) {
          await saveMapping(orgId, 'donor', donor.id, res.contact.contact_id);
          await logDetail(logId, orgId, 'donor', 'push', donor.id, res.contact.contact_id, donor.name, 'created', 'success');
          pushed++;
        } else {
          const sent = `name=${donor.name}; email=${donor.email || '—'}; phone=${donor.phone || '—'}; type=${donor.donor_type || '—'}`;
          await logDetail(logId, orgId, 'donor', 'push', donor.id, null, donor.name, 'created', 'error', `${res.message || 'API error'} | Sent: ${sent}`);
        }
      } else {
        await zohoPut(cfg, `/contacts/${existingZohoId}`, payload);
        await logDetail(logId, orgId, 'donor', 'push', donor.id, existingZohoId, donor.name, 'updated', 'success');
        pushed++;
      }
    } catch (err) {
      const sent = `name=${donor.name}; email=${donor.email || '—'}; phone=${donor.phone || '—'}`;
      await logDetail(logId, orgId, 'donor', 'push', donor.id, existingZohoId, donor.name, existingZohoId ? 'updated' : 'created', 'error', `${err.message} | Sent: ${sent}`);
    }
  }

  const res = await zohoGet(cfg, '/contacts?contact_type=customer&page=1&per_page=200');
  for (const contact of (res.contacts || [])) {
    const localId = await getLocalIdByZohoId(orgId, 'donor', contact.contact_id);
    if (!localId) {
      try {
        const [result] = await pool.query(
          'INSERT IGNORE INTO donors (name, email, phone, is_active) VALUES (?,?,?,1)',
          [contact.contact_name, contact.email || null, contact.phone || null]
        );
        if (result.insertId) {
          await saveMapping(orgId, 'donor', result.insertId, contact.contact_id);
          await logDetail(logId, orgId, 'donor', 'pull', result.insertId, contact.contact_id, contact.contact_name, 'created', 'success');
          pulled++;
        } else {
          await logDetail(logId, orgId, 'donor', 'pull', null, contact.contact_id, contact.contact_name, 'skipped', 'success', 'Already exists locally');
        }
      } catch (err) {
        await logDetail(logId, orgId, 'donor', 'pull', null, contact.contact_id, contact.contact_name, 'created', 'error', err.message);
      }
    }
  }
  return { pushed, pulled };
}

// ── Module: Donations ↔ Zoho Customer Payments ───────────────────────────────
async function syncDonations(orgId, cfg, logId) {
  let pushed = 0, pulled = 0;

  const [donations] = await pool.query(
    'SELECT d.*, dn.name as donor_name FROM donations d LEFT JOIN donors dn ON d.donor_id=dn.id'
  );
  for (const donation of donations) {
    const existingZohoId = await getZohoId(orgId, 'donation', donation.id);
    const contactId = donation.donor_id ? await getZohoId(orgId, 'donor', donation.donor_id) : null;
    const rawDate   = (donation.donation_date || donation.date || '').toString().trim();
    const parsedDate = rawDate ? new Date(rawDate) : null;
    const dateStr   = parsedDate && !isNaN(parsedDate)
      ? parsedDate.toISOString().slice(0, 10)
      : rawDate.slice(0, 10);
    const modeMap   = { Cash: 'cash', Cheque: 'check', 'Bank Transfer': 'banktransfer', UPI: 'banktransfer', Online: 'banktransfer', 'NEFT/RTGS': 'banktransfer' };
    const label     = donation.receipt_number || `Donation #${donation.id}`;

    // Find mapped deal invoices for this donor to apply payment against
    let invoiceLinks = [];
    if (donation.donor_id) {
      const [donorDeals] = await pool.query(
        'SELECT id FROM deals WHERE donor_id = ?',
        [donation.donor_id]
      );
      const donationAmt = parseFloat(donation.amount) || 0;
      let remaining = donationAmt;
      for (const deal of donorDeals) {
        if (remaining <= 0) break;
        const invoiceId = await getZohoId(orgId, 'deal', deal.id);
        if (invoiceId) {
          invoiceLinks.push({ invoice_id: invoiceId, amount_applied: remaining });
          remaining = 0;
        }
      }
    }

    // POST payload includes customer_id and invoices (only on create)
    const createPayload = {
      customer_id:      contactId || undefined,
      amount:           parseFloat(donation.amount) || 0,
      date:             dateStr,
      payment_mode:     modeMap[donation.payment_mode] || 'cash',
      reference_number: donation.receipt_number || undefined,
      description:      `Fundzola ${label}`,
      invoices:         invoiceLinks.length > 0 ? invoiceLinks : undefined,
    };
    // PUT payload: customer_id cannot be changed, but invoices can be re-applied
    const updatePayload = {
      amount:           parseFloat(donation.amount) || 0,
      date:             dateStr,
      payment_mode:     modeMap[donation.payment_mode] || 'cash',
      reference_number: donation.receipt_number || undefined,
      description:      `Fundzola ${label}`,
      invoices:         invoiceLinks.length > 0 ? invoiceLinks : undefined,
    };
    try {
      if (existingZohoId) {
        await zohoPut(cfg, `/customerpayments/${existingZohoId}`, updatePayload);
        await logDetail(logId, orgId, 'donation', 'push', donation.id, existingZohoId, label, 'updated', 'success');
        pushed++;
      } else {
        const res = await zohoPost(cfg, '/customerpayments', createPayload);
        if (res.payment?.payment_id) {
          await saveMapping(orgId, 'donation', donation.id, res.payment.payment_id);
          await logDetail(logId, orgId, 'donation', 'push', donation.id, res.payment.payment_id, label, 'created', 'success');
          pushed++;
        } else {
          const sent = `amount=${createPayload.amount}; date=${createPayload.date}; mode=${createPayload.payment_mode}; ref=${createPayload.reference_number || '—'}`;
          await logDetail(logId, orgId, 'donation', 'push', donation.id, null, label, 'created', 'error', `${res.message || 'API error'} | Sent: ${sent}`);
        }
      }
    } catch (err) {
      const p = existingZohoId ? updatePayload : createPayload;
      const sent = `amount=${p.amount}; date=${p.date}; mode=${p.payment_mode}`;
      await logDetail(logId, orgId, 'donation', 'push', donation.id, existingZohoId, label, existingZohoId ? 'updated' : 'created', 'error', `${err.message} | Sent: ${sent}`);
    }
  }

  const res = await zohoGet(cfg, '/customerpayments?page=1&per_page=200');
  for (const payment of (res.customerpayments || [])) {
    const localId = await getLocalIdByZohoId(orgId, 'donation', payment.payment_id);
    const label   = payment.reference_number || `Payment #${payment.payment_id}`;
    if (!localId) {
      try {
        const donorLocalId = await getLocalIdByZohoId(orgId, 'donor', payment.customer_id);
        const [result] = await pool.query(
          'INSERT IGNORE INTO donations (donor_id, amount, donation_date, payment_mode, notes) VALUES (?,?,?,?,?)',
          [donorLocalId || null, payment.amount, payment.date || null, payment.payment_mode || 'Cash', 'Synced from Zoho Books']
        );
        if (result.insertId) {
          await saveMapping(orgId, 'donation', result.insertId, payment.payment_id);
          await logDetail(logId, orgId, 'donation', 'pull', result.insertId, payment.payment_id, label, 'created', 'success');
          pulled++;
        }
      } catch (err) {
        await logDetail(logId, orgId, 'donation', 'pull', null, payment.payment_id, label, 'created', 'error', err.message);
      }
    }
  }
  return { pushed, pulled };
}

// ── Chart-of-accounts resolver ────────────────────────────────────────────────
// Returns a name→id map for all expense accounts + the cash/bank account id
async function fetchAccountMap(cfg) {
  const res = await zohoGet(cfg, '/chartofaccounts?account_type=expense');
  const map = {};
  for (const acct of (res.chartofaccounts || [])) {
    map[acct.account_name.toLowerCase()] = acct.account_id;
  }
  // Also fetch asset accounts to find petty cash / cash in hand
  const assetRes = await zohoGet(cfg, '/chartofaccounts?account_type=cash');
  let cashId = null;
  for (const acct of (assetRes.chartofaccounts || [])) {
    map[acct.account_name.toLowerCase()] = acct.account_id;
    if (!cashId) cashId = acct.account_id; // use first cash account
  }
  return { map, cashId };
}

// ── Module: Expenses ↔ Zoho Expenses ─────────────────────────────────────────
async function syncExpenses(orgId, cfg, logId) {
  let pushed = 0, pulled = 0;

  // Resolve account IDs from chart of accounts
  let accountMap = {}, cashAccountId = null;
  try {
    const result = await fetchAccountMap(cfg);
    accountMap   = result.map;
    cashAccountId = result.cashId;
  } catch (err) {
    console.error('[ZohoSync] Could not fetch chart of accounts:', err.message);
  }

  const [expenses] = await pool.query('SELECT * FROM expenses');
  for (const expense of expenses) {
    const existingZohoId = await getZohoId(orgId, 'expense', expense.id);
    const label   = expense.description || expense.vendor || `Expense #${expense.id}`;
    const dateStr   = (expense.expense_date || expense.date || '').toString().slice(0, 10);
    const catLower  = (expense.category || '').toLowerCase();
    const accountId = accountMap[catLower]
      || accountMap['other expenses']
      || accountMap['general expenses']
      || Object.values(accountMap)[0]; // fallback to first available expense account

    if (!accountId) {
      const sent = `category=${expense.category || '—'}; amount=${expense.amount}; date=${dateStr}`;
      await logDetail(logId, orgId, 'expense', 'push', expense.id, null, label, 'created', 'error', `No matching expense account in Zoho chart of accounts | Sent: ${sent}`);
      continue;
    }

    // Resolve vendor to a Zoho contact if one exists with the same name
    let vendorContactId = null;
    if (expense.vendor) {
      const [vendorRows] = await pool.query(
        'SELECT id FROM donors WHERE name = ? LIMIT 1',
        [expense.vendor]
      );
      if (vendorRows[0]) {
        vendorContactId = await getZohoId(orgId, 'donor', vendorRows[0].id);
      }
    }

    const payload = {
      account_id:              accountId,
      paid_through_account_id: cashAccountId || undefined,
      date:                    dateStr,
      amount:                  parseFloat(expense.amount) || 0,
      description:             label,
      vendor_id:               vendorContactId || undefined,
      vendor_name:             !vendorContactId && expense.vendor ? expense.vendor : undefined,
    };
    try {
      if (existingZohoId) {
        await zohoPut(cfg, `/expenses/${existingZohoId}`, payload);
        await logDetail(logId, orgId, 'expense', 'push', expense.id, existingZohoId, label, 'updated', 'success');
        pushed++;
      } else {
        const res = await zohoPost(cfg, '/expenses', payload);
        if (res.expense?.expense_id) {
          await saveMapping(orgId, 'expense', expense.id, res.expense.expense_id);
          await logDetail(logId, orgId, 'expense', 'push', expense.id, res.expense.expense_id, label, 'created', 'success');
          pushed++;
        } else {
          const sent = `account_id=${accountId}; amount=${payload.amount}; date=${payload.date}; vendor=${expense.vendor || '—'}`;
          await logDetail(logId, orgId, 'expense', 'push', expense.id, null, label, 'created', 'error', `${res.message || 'API error'} | Sent: ${sent}`);
        }
      }
    } catch (err) {
      const sent = `account_id=${accountId}; amount=${payload.amount}; date=${payload.date}`;
      await logDetail(logId, orgId, 'expense', 'push', expense.id, existingZohoId, label, existingZohoId ? 'updated' : 'created', 'error', `${err.message} | Sent: ${sent}`);
    }
  }

  const res = await zohoGet(cfg, '/expenses?page=1&per_page=200');
  for (const ze of (res.expenses || [])) {
    const localId = await getLocalIdByZohoId(orgId, 'expense', ze.expense_id);
    const label   = ze.description || ze.account_name || `Expense #${ze.expense_id}`;
    if (!localId) {
      try {
        const [result] = await pool.query(
          'INSERT IGNORE INTO expenses (amount, expense_date, description, category) VALUES (?,?,?,?)',
          [ze.total, ze.date || null, ze.description || '', ze.account_name || 'Other']
        );
        if (result.insertId) {
          await saveMapping(orgId, 'expense', result.insertId, ze.expense_id);
          await logDetail(logId, orgId, 'expense', 'pull', result.insertId, ze.expense_id, label, 'created', 'success');
          pulled++;
        }
      } catch (err) {
        await logDetail(logId, orgId, 'expense', 'pull', null, ze.expense_id, label, 'created', 'error', err.message);
      }
    }
  }
  return { pushed, pulled };
}

// ── Module: Deals → Zoho Invoices ────────────────────────────────────────────
async function syncDeals(orgId, cfg, logId) {
  let pushed = 0;

  // Only sync deals that have been received
  const [deals] = await pool.query(
    `SELECT d.*, dn.name AS donor_name
     FROM deals d
     LEFT JOIN donors dn ON d.donor_id = dn.id
     WHERE d.stage = 'Received'`
  );

  for (const deal of deals) {
    const existingZohoId = await getZohoId(orgId, 'deal', deal.id);
    const label = deal.title || `Deal #${deal.id}`;

    const contactId = deal.donor_id ? await getZohoId(orgId, 'donor', deal.donor_id) : null;

    // Use allocations as line items if available, else one line item for the full amount
    const [allocations] = await pool.query(
      `SELECT da.amount, pc.name AS category_name, da.notes
       FROM deal_allocations da
       LEFT JOIN program_categories pc ON da.category_id = pc.id
       WHERE da.deal_id = ?`,
      [deal.id]
    );

    const lineItems = allocations.length > 0
      ? allocations.map(a => ({
          name:        a.category_name || 'Donation',
          description: a.notes || label,
          rate:        parseFloat(a.amount) || 0,
          quantity:    1,
        }))
      : [{ name: 'Donation', description: label, rate: parseFloat(deal.amount) || 0, quantity: 1 }];

    const rawDate = (deal.actual_date || deal.expected_date || '').toString().trim();
    const parsed  = rawDate ? new Date(rawDate) : new Date();
    const dateStr = !isNaN(parsed) ? parsed.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    const payload = {
      customer_id:      contactId || undefined,
      date:             dateStr,
      due_date:         dateStr,
      reference_number: `DEAL-${deal.id}`,
      notes:            deal.notes || undefined,
      line_items:       lineItems,
    };

    try {
      if (existingZohoId) {
        await zohoPut(cfg, `/invoices/${existingZohoId}`, payload);
        await logDetail(logId, orgId, 'deal', 'push', deal.id, existingZohoId, label, 'updated', 'success');
        pushed++;
      } else {
        const res = await zohoPost(cfg, '/invoices', payload);
        if (res.invoice?.invoice_id) {
          const invoiceId = res.invoice.invoice_id;
          await saveMapping(orgId, 'deal', deal.id, invoiceId);
          // Approve the invoice so it's not left as draft
          try {
            await zohoPost(cfg, `/invoices/${invoiceId}/status/approved`, {});
          } catch (_) { /* non-fatal — invoice still created */ }
          await logDetail(logId, orgId, 'deal', 'push', deal.id, invoiceId, label, 'created', 'success');
          pushed++;
        } else {
          const sent = `amount=${deal.amount}; date=${dateStr}; donor=${deal.donor_name || '—'}; lines=${lineItems.length}`;
          await logDetail(logId, orgId, 'deal', 'push', deal.id, null, label, 'created', 'error', `${res.message || 'API error'} | Sent: ${sent}`);
        }
      }
    } catch (err) {
      const sent = `amount=${deal.amount}; date=${dateStr}; donor=${deal.donor_name || '—'}`;
      await logDetail(logId, orgId, 'deal', 'push', deal.id, existingZohoId, label, existingZohoId ? 'updated' : 'created', 'error', `${err.message} | Sent: ${sent}`);
    }
  }

  return { pushed, pulled: 0 };
}

// ── Full sync orchestrator ────────────────────────────────────────────────────
async function runFullSync(orgId, syncType = 'scheduled') {
  const cfg = await getConfig(orgId);
  if (!cfg || !cfg.is_connected || !cfg.sync_enabled) return;

  const [logResult] = await pool.query(
    'INSERT INTO zoho_sync_log (org_id, sync_type, module, direction, status) VALUES (?,?,?,?,?)',
    [orgId, syncType, 'all', 'both', 'running']
  );
  const logId = logResult.insertId;

  let totalPushed = 0, totalPulled = 0, errorMsg = null;
  try {
    const validCfg = await getValidToken(cfg);

    const donorResult     = await syncDonors(orgId, validCfg, logId);
    const donationResult  = await syncDonations(orgId, validCfg, logId);
    const expenseResult   = await syncExpenses(orgId, validCfg, logId);
    const dealResult      = await syncDeals(orgId, validCfg, logId);

    totalPushed = donorResult.pushed + donationResult.pushed + expenseResult.pushed + dealResult.pushed;
    totalPulled = donorResult.pulled + donationResult.pulled + expenseResult.pulled;

    await pool.query(
      'UPDATE zoho_config SET last_sync_at=NOW() WHERE org_id=?', [orgId]
    );
    await pool.query(
      'UPDATE zoho_sync_log SET status=?, records_pushed=?, records_pulled=?, finished_at=NOW() WHERE id=?',
      ['success', totalPushed, totalPulled, logId]
    );
    console.log(`[ZohoSync] org=${orgId} pushed=${totalPushed} pulled=${totalPulled}`);
  } catch (err) {
    errorMsg = err.message;
    await pool.query(
      'UPDATE zoho_sync_log SET status=?, error_message=?, finished_at=NOW() WHERE id=?',
      ['error', errorMsg, logId]
    );
    console.error(`[ZohoSync] org=${orgId} error:`, err.message);
  }
  return { pushed: totalPushed, pulled: totalPulled, error: errorMsg };
}

// ── Hourly scheduler ──────────────────────────────────────────────────────────
function startScheduler() {
  const HOUR = 60 * 60 * 1000;
  setInterval(async () => {
    console.log('[ZohoSync] Running scheduled hourly sync...');
    try {
      const [orgs] = await pool.query(
        'SELECT org_id FROM zoho_config WHERE is_connected=1 AND sync_enabled=1'
      );
      for (const { org_id } of orgs) {
        await runFullSync(org_id, 'scheduled');
      }
    } catch (err) {
      console.error('[ZohoSync] Scheduler error:', err.message);
    }
  }, HOUR);
  console.log('[ZohoSync] Hourly scheduler started.');
}

module.exports = { runFullSync, startScheduler, accountsBase };
