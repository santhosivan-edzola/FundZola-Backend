const express  = require('express');
const router   = express.Router();
const pool     = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { runFullSync, accountsBase } = require('../utils/zohoSync');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// All routes require auth
router.use(requireAuth);

const getOrgId = () => 1; // single-org app

// ── GET /api/zoho/status ──────────────────────────────────────────────────────
router.get('/status', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const [rows] = await pool.query(
      'SELECT id, is_connected, sync_enabled, zoho_org_id, dc_region, last_sync_at, client_id FROM zoho_config WHERE org_id=?',
      [orgId]
    );
    const config = rows[0] || null;

    let recentLogs = [];
    if (config) {
      const [logs] = await pool.query(
        'SELECT id, sync_type, module, direction, status, records_pushed, records_pulled, error_message, started_at, finished_at FROM zoho_sync_log WHERE org_id=? ORDER BY started_at DESC LIMIT 10',
        [orgId]
      );
      recentLogs = logs;
    }

    res.json({ success: true, data: { config, recentLogs } });
  } catch (err) { next(err); }
});

// ── POST /api/zoho/credentials ────────────────────────────────────────────────
router.post('/credentials', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { client_id, client_secret, dc_region = 'IN' } = req.body;
    if (!client_id || !client_secret) {
      return res.status(400).json({ success: false, message: 'client_id and client_secret are required.' });
    }
    await pool.query(
      `INSERT INTO zoho_config (org_id, client_id, client_secret, dc_region)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE client_id=VALUES(client_id), client_secret=VALUES(client_secret), dc_region=VALUES(dc_region), is_connected=0, access_token=NULL, refresh_token=NULL, token_expires_at=NULL`,
      [orgId, client_id, client_secret, dc_region]
    );
    res.json({ success: true, message: 'Credentials saved.' });
  } catch (err) { next(err); }
});

// ── GET /api/zoho/auth-url ────────────────────────────────────────────────────
router.get('/auth-url', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const [rows] = await pool.query('SELECT client_id, dc_region FROM zoho_config WHERE org_id=?', [orgId]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'No credentials saved yet.' });

    const { client_id, dc_region } = rows[0];
    const redirectUri = `${process.env.API_URL || 'http://localhost:5000'}/api/zoho/callback`;
    const scopes = [
      'ZohoBooks.contacts.CREATE', 'ZohoBooks.contacts.READ', 'ZohoBooks.contacts.UPDATE',
      'ZohoBooks.customerpayments.CREATE', 'ZohoBooks.customerpayments.READ',
      'ZohoBooks.expenses.CREATE', 'ZohoBooks.expenses.READ',
      'ZohoBooks.invoices.CREATE', 'ZohoBooks.invoices.READ',
    ].join(',');

    const base = accountsBase(dc_region);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id,
      scope:         scopes,
      redirect_uri:  redirectUri,
      access_type:   'offline',
      prompt:        'consent',
      state:         String(orgId),
    });
    const authUrl = `${base}/oauth/v2/auth?${params}`;
    res.json({ success: true, data: { authUrl } });
  } catch (err) { next(err); }
});

// ── POST /api/zoho/exchange-code ─────────────────────────────────────────────
// Used with Zoho Self Client: user pastes the code from the API console
router.post('/exchange-code', async (req, res, next) => {
  try {
    const orgId = getOrgId();
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Authorization code is required.' });

    const [rows] = await pool.query('SELECT * FROM zoho_config WHERE org_id=?', [orgId]);
    const cfg = rows[0];
    if (!cfg) return res.status(404).json({ success: false, message: 'Save credentials first.' });

    const https = require('https');
    const base  = accountsBase(cfg.dc_region);

    // Self Client: NO redirect_uri in the token exchange request
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     cfg.client_id,
      client_secret: cfg.client_secret,
      code,
    }).toString();

    const tokenRes = await new Promise((resolve, reject) => {
      const urlObj = new URL(`${base}/oauth/v2/token`);
      const rq = https.request({
        hostname: urlObj.hostname, port: 443, path: urlObj.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      }, (r) => { let d = ''; r.on('data', c => { d += c; }); r.on('end', () => resolve(JSON.parse(d))); });
      rq.on('error', reject); rq.write(body); rq.end();
    });

    console.log('[ZohoExchange] token response:', JSON.stringify(tokenRes));

    if (!tokenRes.access_token) {
      return res.status(400).json({ success: false, message: 'Token exchange failed: ' + (tokenRes.error_description || tokenRes.error || JSON.stringify(tokenRes)) });
    }

    const expiresAt = Date.now() + (tokenRes.expires_in || 3600) * 1000;

    // Save tokens first so connection is established even if org fetch fails
    await pool.query(
      'UPDATE zoho_config SET access_token=?, refresh_token=?, token_expires_at=?, is_connected=1 WHERE org_id=?',
      [tokenRes.access_token, tokenRes.refresh_token, expiresAt, orgId]
    );

    // Fetch Zoho Books org list
    let zohoOrgId = null;
    let fetchOrgError = null;
    try {
      const apiBases = { IN: 'www.zohoapis.in', EU: 'www.zohoapis.eu', AU: 'www.zohoapis.com.au', COM: 'www.zohoapis.com' };
      const apiHost  = apiBases[cfg.dc_region] || apiBases.IN;
      const orgRes   = await new Promise((resolve, reject) => {
        const r = https.request({
          hostname: apiHost, port: 443, path: '/books/v3/organizations',
          method: 'GET',
          headers: { Authorization: `Zoho-oauthtoken ${tokenRes.access_token}` },
        }, (resp) => { let d = ''; resp.on('data', c => { d += c; }); resp.on('end', () => resolve(JSON.parse(d))); });
        r.on('error', reject); r.end();
      });
      console.log('[ZohoExchange] orgs response:', JSON.stringify(orgRes));
      if (orgRes.organizations?.length > 0) {
        zohoOrgId = orgRes.organizations[0].organization_id;
        await pool.query('UPDATE zoho_config SET zoho_org_id=? WHERE org_id=?', [zohoOrgId, orgId]);
      } else {
        fetchOrgError = orgRes.message || 'No organizations found in Zoho Books account.';
      }
    } catch (err) {
      fetchOrgError = err.message;
      console.error('[ZohoExchange] org fetch error:', err.message);
    }

    res.json({
      success: true,
      message: zohoOrgId
        ? 'Connected to Zoho Books successfully.'
        : `Connected but could not auto-fetch Org ID${fetchOrgError ? ': ' + fetchOrgError : ''}. Enter it manually below.`,
      data: { zohoOrgId, needsOrgId: !zohoOrgId },
    });
  } catch (err) { next(err); }
});

// ── GET /api/zoho/callback ────────────────────────────────────────────────────
// NOTE: This route is public (no verifyToken) — Zoho redirects here after OAuth
router.get('/callback', async (req, res) => {
  const { code, state: orgId, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/settings?zoho=error&msg=${encodeURIComponent(error)}`);
  }
  if (!code || !orgId) {
    return res.redirect(`${FRONTEND_URL}/settings?zoho=error&msg=missing_params`);
  }

  try {
    const [rows] = await pool.query('SELECT * FROM zoho_config WHERE org_id=?', [orgId]);
    const cfg = rows[0];
    if (!cfg) return res.redirect(`${FRONTEND_URL}/settings?zoho=error&msg=config_not_found`);

    const base        = accountsBase(cfg.dc_region);
    const redirectUri = `${process.env.API_URL || 'http://localhost:5000'}/api/zoho/callback`;
    const body        = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     cfg.client_id,
      client_secret: cfg.client_secret,
      redirect_uri:  redirectUri,
      code,
    }).toString();

    // Exchange code for tokens (using native https)
    const https    = require('https');
    const urlObj   = new URL(`${base}/oauth/v2/token`);
    const tokenRes = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: urlObj.hostname,
        port:     443,
        path:     urlObj.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      }, (r) => {
        let d = '';
        r.on('data', c => { d += c; });
        r.on('end', () => resolve(JSON.parse(d)));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (!tokenRes.access_token) {
      return res.redirect(`${FRONTEND_URL}/settings?zoho=error&msg=${encodeURIComponent(tokenRes.error || 'token_exchange_failed')}`);
    }

    const expiresAt = Date.now() + (tokenRes.expires_in || 3600) * 1000;

    // Fetch Zoho org list to get the books org ID
    let zohoOrgId = cfg.zoho_org_id;
    try {
      const apiBases = { IN: 'www.zohoapis.in', EU: 'www.zohoapis.eu', AU: 'www.zohoapis.com.au', COM: 'www.zohoapis.com' };
      const apiHost  = apiBases[cfg.dc_region] || apiBases.IN;
      const orgRes   = await new Promise((resolve, reject) => {
        const r = https.request({
          hostname: apiHost, port: 443,
          path:    '/books/v3/organizations',
          headers: { Authorization: `Zoho-oauthtoken ${tokenRes.access_token}` },
        }, (resp) => {
          let d = ''; resp.on('data', c => { d += c; }); resp.on('end', () => resolve(JSON.parse(d)));
        });
        r.on('error', reject); r.end();
      });
      if (orgRes.organizations?.length > 0) {
        zohoOrgId = orgRes.organizations[0].organization_id;
      }
    } catch (_) { /* non-fatal */ }

    await pool.query(
      'UPDATE zoho_config SET access_token=?, refresh_token=?, token_expires_at=?, is_connected=1, zoho_org_id=? WHERE org_id=?',
      [tokenRes.access_token, tokenRes.refresh_token, expiresAt, zohoOrgId, orgId]
    );

    res.redirect(`${FRONTEND_URL}/settings?zoho=connected`);
  } catch (err) {
    console.error('[ZohoCallback] error:', err);
    res.redirect(`${FRONTEND_URL}/settings?zoho=error&msg=${encodeURIComponent(err.message)}`);
  }
});

// ── GET /api/zoho/organizations ───────────────────────────────────────────────
router.get('/organizations', async (req, res, next) => {
  try {
    const orgId = getOrgId();
    const [rows] = await pool.query('SELECT * FROM zoho_config WHERE org_id=?', [orgId]);
    const cfg = rows[0];
    if (!cfg?.access_token) return res.status(400).json({ success: false, message: 'Not connected.' });

    const https    = require('https');
    const apiBases = { IN: 'www.zohoapis.in', EU: 'www.zohoapis.eu', AU: 'www.zohoapis.com.au', COM: 'www.zohoapis.com' };
    const apiHost  = apiBases[cfg.dc_region] || apiBases.IN;

    const orgRes = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: apiHost, port: 443, path: '/books/v3/organizations',
        method: 'GET',
        headers: { Authorization: `Zoho-oauthtoken ${cfg.access_token}` },
      }, (resp) => { let d = ''; resp.on('data', c => { d += c; }); resp.on('end', () => resolve(JSON.parse(d))); });
      r.on('error', reject); r.end();
    });

    res.json({ success: true, data: orgRes.organizations || [] });
  } catch (err) { next(err); }
});

// ── PATCH /api/zoho/org-id ────────────────────────────────────────────────────
router.patch('/org-id', async (req, res, next) => {
  try {
    const orgId = getOrgId();
    const { zoho_org_id } = req.body;
    if (!zoho_org_id) return res.status(400).json({ success: false, message: 'zoho_org_id is required.' });
    await pool.query('UPDATE zoho_config SET zoho_org_id=? WHERE org_id=?', [zoho_org_id, orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/zoho/logs/:logId/details ────────────────────────────────────────
router.get('/logs/:logId/details', async (req, res, next) => {
  try {
    const { logId } = req.params;
    const [rows] = await pool.query(
      `SELECT id, module, direction, action, status, local_id, zoho_id, record_name, note, created_at
       FROM zoho_sync_detail WHERE log_id=? ORDER BY created_at ASC`,
      [logId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/zoho/sync ───────────────────────────────────────────────────────
router.post('/sync', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await runFullSync(orgId, 'manual');
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ── PATCH /api/zoho/toggle-sync ───────────────────────────────────────────────
router.patch('/toggle-sync', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { sync_enabled } = req.body;
    await pool.query('UPDATE zoho_config SET sync_enabled=? WHERE org_id=?', [sync_enabled ? 1 : 0, orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/zoho/disconnect ───────────────────────────────────────────────
router.delete('/disconnect', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    await pool.query(
      'UPDATE zoho_config SET is_connected=0, access_token=NULL, refresh_token=NULL, token_expires_at=NULL WHERE org_id=?',
      [orgId]
    );
    res.json({ success: true, message: 'Disconnected from Zoho Books.' });
  } catch (err) { next(err); }
});

module.exports = router;
