const express        = require('express');
const router         = express.Router();
const https          = require('https');
const pool           = require('../config/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── Call Claude API ───────────────────────────────────────────────────────────
function callClaude(systemPrompt, messages) {
  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    system:     systemPrompt,
    messages,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      port:     443,
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'content-length':    Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse Claude response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Build DB context for the given FY ────────────────────────────────────────
async function buildDBContext(fy) {
  let donWhere = '', expWhere = '', params = [];

  if (fy && /^\d{4}-\d{2}$/.test(fy)) {
    const startYear = parseInt(fy.split('-')[0]);
    const start = `${startYear}-04-01`;
    const end   = `${startYear + 1}-03-31`;
    donWhere = 'WHERE donation_date BETWEEN ? AND ?';
    expWhere = 'WHERE expense_date  BETWEEN ? AND ?';
    params   = [start, end];
  }

  const [[org]]           = await pool.query('SELECT org_name, city, registration_number, pan_80g FROM organizations LIMIT 1');
  const [[donorStats]]    = await pool.query('SELECT COUNT(*) AS total, SUM(is_active) AS active FROM donors');
  const [[donTotal]]      = await pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total FROM donations ${donWhere}`, params);
  const [[expTotal]]      = await pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total FROM expenses ${expWhere}`, params);
  const [donByCat]        = await pool.query(`SELECT fund_category, COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM donations ${donWhere} GROUP BY fund_category ORDER BY total DESC`, params);
  const [expByCat]        = await pool.query(`SELECT category, COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM expenses ${expWhere} GROUP BY category ORDER BY total DESC`, params);
  const [topDonors]       = await pool.query(
    `SELECT dn.name, dn.donor_type, COALESCE(SUM(d.amount),0) AS total, COUNT(*) AS cnt
     FROM donations d JOIN donors dn ON d.donor_id = dn.id ${donWhere}
     GROUP BY d.donor_id ORDER BY total DESC LIMIT 8`, params);
  const [dealPipeline]    = await pool.query('SELECT stage, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total FROM deals GROUP BY stage ORDER BY total DESC');
  const [programs]        = await pool.query("SELECT title AS name, status, COALESCE(estimated_budget,0) AS budget FROM programs WHERE status='Active' LIMIT 8");
  const [[noReceipt]]     = await pool.query(`SELECT COUNT(*) AS cnt FROM donations d LEFT JOIN receipt_log r ON r.donation_id=d.id WHERE r.id IS NULL ${donWhere ? 'AND donation_date BETWEEN ? AND ?' : ''}`, donWhere ? params : []);

  return { org, donorStats, donTotal, expTotal, donByCat, expByCat, topDonors, dealPipeline, programs, noReceipt, fy: fy || 'All time' };
}

// ── Build system prompt ───────────────────────────────────────────────────────
function buildSystemPrompt(ctx) {
  const fmt = n => `₹${Number(n).toLocaleString('en-IN')}`;

  return `You are FundZola Copilot, an AI assistant for ${ctx.org?.org_name || 'an NGO'} (${ctx.org?.city || ''}).
You help staff understand their donor data, donation utilisation, expenses, and deal pipeline.
Always answer in clear, concise language. When showing numbers use Indian number formatting (₹ with lakhs/crores).
When relevant, format data as markdown tables. Keep responses focused and actionable.

=== LIVE DATA (FY: ${ctx.fy}) ===

ORGANISATION: ${ctx.org?.org_name}, PAN: ${ctx.org?.pan_80g || 'N/A'}

DONORS: ${ctx.donorStats?.total} total, ${ctx.donorStats?.active} active

DONATIONS: ${ctx.donTotal?.cnt} donations totalling ${fmt(ctx.donTotal?.total)}
By category:
${ctx.donByCat?.map(r => `  - ${r.fund_category}: ${fmt(r.total)} (${r.cnt} donations)`).join('\n') || '  None'}

EXPENSES: ${ctx.expTotal?.cnt} expenses totalling ${fmt(ctx.expTotal?.total)}
By category:
${ctx.expByCat?.map(r => `  - ${r.category}: ${fmt(r.total)} (${r.cnt} expenses)`).join('\n') || '  None'}

NET SURPLUS: ${fmt((ctx.donTotal?.total || 0) - (ctx.expTotal?.total || 0))}

TOP DONORS:
${ctx.topDonors?.map(d => `  - ${d.name} (${d.donor_type}): ${fmt(d.total)} across ${d.cnt} donations`).join('\n') || '  None'}

DEAL PIPELINE:
${ctx.dealPipeline?.map(d => `  - ${d.stage}: ${d.cnt} deals worth ${fmt(d.total)}`).join('\n') || '  None'}

ACTIVE PROGRAMS:
${ctx.programs?.map(p => `  - ${p.name} (budget: ${fmt(p.budget)})`).join('\n') || '  None'}

DONATIONS WITHOUT RECEIPTS: ${ctx.noReceipt?.cnt || 0}

Answer questions about this data. If asked about something not in the data, say so honestly.

=== CHART INSTRUCTION ===
Whenever your answer contains 2 or more numerical data points (rankings, breakdowns, comparisons), append a CHART_JSON block at the very end of your reply. Use this exact format on its own line (no code fences):

CHART_JSON:{"type":"bar","title":"Short chart title","data":[{"name":"Label","value":123}],"keys":["value"]}

Rules:
- type "bar" for rankings or comparisons (top donors, fund totals, deal stages, etc.)
- type "pie" for distributions or breakdowns (category splits, percentages, fund allocation)
- type "grouped_bar" when comparing two metrics side-by-side (e.g. donated vs expended); use keys with multiple entries and include both keys in each data object
- "name" values must be short (≤20 chars)
- "value" must be a plain number (no ₹ symbol, no commas)
- Only include CHART_JSON when you have at least 2 data points
- Do NOT include CHART_JSON for simple single-number answers or yes/no answers
- CHART_JSON must always be the last line of your reply`;
}

// ── GET /api/copilot/conversations ────────────────────────────────────────────
router.get('/conversations', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, fy, created_at, updated_at FROM copilot_conversations ORDER BY updated_at DESC LIMIT 50'
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── GET /api/copilot/conversations/:id/messages ───────────────────────────────
router.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, role, content, created_at FROM copilot_messages WHERE conversation_id=? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── DELETE /api/copilot/conversations/:id ─────────────────────────────────────
router.delete('/conversations/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM copilot_messages      WHERE conversation_id=?', [req.params.id]);
    await pool.query('DELETE FROM copilot_conversations WHERE id=?',              [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/copilot/chat ────────────────────────────────────────────────────
router.post('/chat', async (req, res, next) => {
  try {
    const { message, conversation_id, fy } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, message: 'Message is required.' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ success: false, message: 'ANTHROPIC_API_KEY is not configured.' });
    }

    // Get or create conversation
    let convId = conversation_id;
    if (!convId) {
      const title = message.trim().slice(0, 60);
      const [result] = await pool.query(
        'INSERT INTO copilot_conversations (title, fy) VALUES (?,?)',
        [title, fy || null]
      );
      convId = result.insertId;
    }

    // Save user message
    await pool.query('INSERT INTO copilot_messages (conversation_id,role,content) VALUES (?,?,?)', [convId, 'user', message]);

    // Load conversation history (last 10 exchanges)
    const [history] = await pool.query(
      'SELECT role, content FROM copilot_messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT 20',
      [convId]
    );
    const messages = history.map(h => ({ role: h.role, content: h.content }));

    // Build context and call Claude
    const ctx          = await buildDBContext(fy);
    const systemPrompt = buildSystemPrompt(ctx);
    const claudeRes    = await callClaude(systemPrompt, messages);

    if (claudeRes.error) {
      return res.status(502).json({ success: false, message: claudeRes.error.message || 'Claude API error' });
    }

    const reply = claudeRes.content?.[0]?.text || 'Sorry, I could not generate a response.';

    // Save assistant reply
    await pool.query('INSERT INTO copilot_messages (conversation_id,role,content) VALUES (?,?,?)', [convId, 'assistant', reply]);

    // Update conversation timestamp and title if first exchange
    await pool.query('UPDATE copilot_conversations SET updated_at=NOW() WHERE id=?', [convId]);

    // Update title from zoho sync status
    const [[zoho]] = await pool.query("SELECT is_connected, last_sync_at FROM zoho_config WHERE org_id=1 LIMIT 1").catch(() => [[null]]);

    res.json({
      success: true,
      data: {
        conversation_id: convId,
        reply,
        zoho_synced: zoho?.is_connected ? true : false,
        zoho_sync_at: zoho?.last_sync_at || null,
        fy: fy || null,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
