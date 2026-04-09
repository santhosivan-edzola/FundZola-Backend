const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

router.use(requireAuth);

// Helper: save donation category allocations — uses custom allocations if provided, else proportional from deal
async function saveDonationAllocations(conn, donationId, dealId, donationAmount, customAllocations = null) {
  await conn.query('DELETE FROM donation_allocations WHERE donation_id = ?', [donationId]);

  if (customAllocations && customAllocations.length) {
    for (const a of customAllocations) {
      if (!a.category_id || Number(a.amount) <= 0) continue;
      await conn.query(
        'INSERT INTO donation_allocations (donation_id, category_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = VALUES(amount)',
        [donationId, a.category_id, a.amount]
      );
    }
    return;
  }

  // Proportional fallback
  const [[deal]] = await conn.query('SELECT amount FROM deals WHERE id = ?', [dealId]);
  if (!deal || !Number(deal.amount)) return;
  const [dealAllocs] = await conn.query(
    'SELECT category_id, amount FROM deal_allocations WHERE deal_id = ?', [dealId]
  );
  if (!dealAllocs.length) return;
  for (const da of dealAllocs) {
    const proportional = Math.round((Number(da.amount) * Number(donationAmount) / Number(deal.amount)) * 100) / 100;
    if (proportional <= 0) continue;
    await conn.query(
      'INSERT INTO donation_allocations (donation_id, category_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = VALUES(amount)',
      [donationId, da.category_id, proportional]
    );
  }
}

// Helper: save deal allocations inside a connection/pool
async function saveDealAllocations(conn, dealId, allocations) {
  await conn.query('DELETE FROM deal_allocations WHERE deal_id = ?', [dealId]);
  for (const a of allocations) {
    if (!a.category_id || Number(a.amount) <= 0) continue;
    await conn.query(
      `INSERT INTO deal_allocations (deal_id, category_id, amount, notes)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), notes = VALUES(notes)`,
      [dealId, a.category_id, a.amount, a.notes || null]
    );
  }
}

// GET /api/deals
router.get('/', async (req, res, next) => {
  try {
    let sql = `SELECT d.*, dn.name AS donor_name, dn.email AS donor_email, dn.phone AS donor_phone,
                      p.title AS program_title, p.program_code
               FROM deals d
               LEFT JOIN donors dn ON dn.id = d.donor_id
               LEFT JOIN programs p ON p.id = d.program_id
               WHERE 1=1`;
    const params = [];
    if (req.user.role !== 'admin') { sql += ' AND d.created_by = ?'; params.push(req.user.id); }
    sql += ' ORDER BY d.created_at DESC';
    const [rows] = await pool.query(sql, params);

    // Attach allocations for each deal
    const dealIds = rows.map(r => r.id);
    let allocMap = {};
    if (dealIds.length) {
      const [allocs] = await pool.query(
        `SELECT da.*, pc.name AS category_name, pc.color AS category_color
         FROM deal_allocations da
         JOIN program_categories pc ON pc.id = da.category_id
         WHERE da.deal_id IN (?)`,
        [dealIds]
      );
      allocs.forEach(a => {
        if (!allocMap[a.deal_id]) allocMap[a.deal_id] = [];
        allocMap[a.deal_id].push(a);
      });
    }
    const data = rows.map(r => ({ ...r, allocations: allocMap[r.id] || [] }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/deals/:id
router.get('/:id', async (req, res, next) => {
  try {
    let sql = `SELECT d.*, dn.name AS donor_name, dn.email AS donor_email, dn.phone AS donor_phone,
                      p.title AS program_title, p.program_code
               FROM deals d
               LEFT JOIN donors dn ON dn.id = d.donor_id
               LEFT JOIN programs p ON p.id = d.program_id
               WHERE d.id = ?`;
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND d.created_by = ?'; params.push(req.user.id); }
    const [rows] = await pool.query(sql, params);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Deal not found' });
    const [allocs] = await pool.query(
      `SELECT da.*, pc.name AS category_name, pc.color AS category_color
       FROM deal_allocations da
       JOIN program_categories pc ON pc.id = da.category_id
       WHERE da.deal_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], allocations: allocs } });
  } catch (err) { next(err); }
});

// POST /api/deals
router.post('/', checkPermission('deals', 'can_create'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { donor_id, title, amount, stage, priority, notes, expected_date, program_id, deal_type, allocations } = req.body;
    const [result] = await conn.query(
      `INSERT INTO deals (donor_id, program_id, deal_type, title, amount, stage, priority, notes, expected_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [donor_id, program_id || null, deal_type || 'Full', title, amount || 0, stage || 'Prospect', priority || 'Medium', notes || null, expected_date || null, req.user.id]
    );
    const dealId = result.insertId;
    if (Array.isArray(allocations) && allocations.length) {
      await saveDealAllocations(conn, dealId, allocations);
    }
    await conn.commit();
    const [rows] = await pool.query(
      `SELECT d.*, dn.name AS donor_name, p.title AS program_title
       FROM deals d
       LEFT JOIN donors dn ON dn.id = d.donor_id
       LEFT JOIN programs p ON p.id = d.program_id
       WHERE d.id = ?`,
      [dealId]
    );
    const [allocs] = await pool.query(
      `SELECT da.*, pc.name AS category_name, pc.color AS category_color
       FROM deal_allocations da JOIN program_categories pc ON pc.id = da.category_id
       WHERE da.deal_id = ?`, [dealId]
    );
    res.status(201).json({ success: true, data: { ...rows[0], allocations: allocs } });
  } catch (err) { await conn.rollback(); next(err); }
  finally { conn.release(); }
});

// PUT /api/deals/:id
router.put('/:id', checkPermission('deals', 'can_edit'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { donor_id, title, amount, stage, priority, notes, expected_date, actual_date, program_id, deal_type, allocations } = req.body;
    await conn.query(
      `UPDATE deals SET donor_id=?, program_id=?, deal_type=?, title=?, amount=?, stage=?, priority=?, notes=?, expected_date=?, actual_date=?
       WHERE id=?`,
      [donor_id, program_id || null, deal_type || 'Full', title, amount || 0, stage, priority || 'Medium', notes || null, expected_date || null, actual_date || null, req.params.id]
    );
    if (Array.isArray(allocations)) {
      await saveDealAllocations(conn, req.params.id, allocations);
    }
    await conn.commit();
    const [rows] = await pool.query(
      `SELECT d.*, dn.name AS donor_name, p.title AS program_title
       FROM deals d
       LEFT JOIN donors dn ON dn.id = d.donor_id
       LEFT JOIN programs p ON p.id = d.program_id
       WHERE d.id = ?`,
      [req.params.id]
    );
    const [allocs] = await pool.query(
      `SELECT da.*, pc.name AS category_name, pc.color AS category_color
       FROM deal_allocations da JOIN program_categories pc ON pc.id = da.category_id
       WHERE da.deal_id = ?`, [req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], allocations: allocs } });
  } catch (err) { await conn.rollback(); next(err); }
  finally { conn.release(); }
});

// PATCH /api/deals/:id/stage
router.patch('/:id/stage', checkPermission('deals', 'can_edit'), async (req, res, next) => {
  try {
    const { stage, actual_date } = req.body;
    await pool.query(`UPDATE deals SET stage=?, actual_date=? WHERE id=?`, [stage, actual_date || null, req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/receive — Full deal: auto-create donation + mark Received
router.post('/:id/receive', checkPermission('deals', 'can_edit'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[deal]] = await conn.query('SELECT * FROM deals WHERE id = ?', [req.params.id]);
    if (!deal) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Deal not found.' }); }
    if (deal.deal_type === 'Partial') { await conn.rollback(); return res.status(400).json({ success: false, message: 'Only Full deals support auto-receive.' }); }

    const today = req.body.donation_date || new Date().toISOString().slice(0, 10);
    const payment_mode = req.body.payment_mode || 'Cash';
    const notes = req.body.notes || null;
    const is_80g_eligible = req.body.is_80g_eligible ? 1 : 0;

    // Prevent duplicate: if a donation already exists for this deal, just update stage + 80G flag
    const [[existing]] = await conn.query('SELECT id FROM donations WHERE deal_id = ? LIMIT 1', [deal.id]);
    if (existing) {
      await conn.query('UPDATE donations SET is_80g_eligible = ? WHERE id = ?', [is_80g_eligible, existing.id]);
      await conn.query('UPDATE deals SET stage = ?, actual_date = ? WHERE id = ?', ['Received', deal.actual_date || today, deal.id]);
      await conn.commit();
      const [[donation]] = await pool.query(
        `SELECT dn.*, d.name AS donor_name FROM donations dn JOIN donors d ON d.id = dn.donor_id WHERE dn.id = ?`,
        [existing.id]
      );
      return res.status(200).json({ success: true, data: donation });
    }

    await conn.query('CALL sp_next_receipt_number(@rn)');
    const [[{ rn }]] = await conn.query('SELECT @rn AS rn');

    const [ins] = await conn.query(
      `INSERT INTO donations (donor_id, deal_id, receipt_number, amount, donation_date, payment_mode,
        fund_category, purpose, is_80g_eligible, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'General', ?, ?, ?, ?, NOW(), NOW())`,
      [deal.donor_id, deal.id, rn, deal.amount, today, payment_mode, deal.title, is_80g_eligible, notes, req.user.id]
    );

    await saveDonationAllocations(conn, ins.insertId, deal.id, deal.amount);
    await conn.query('UPDATE deals SET stage = ?, actual_date = ? WHERE id = ?', ['Received', today, deal.id]);
    await conn.commit();

    const [[donation]] = await pool.query(
      `SELECT dn.*, d.name AS donor_name FROM donations dn JOIN donors d ON d.id = dn.donor_id WHERE dn.id = ?`,
      [ins.insertId]
    );
    res.status(201).json({ success: true, data: donation });
  } catch (err) { await conn.rollback(); next(err); }
  finally { conn.release(); }
});

// GET /api/deals/:id/donations — all donations (tranches) for a deal
router.get('/:id/donations', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT dn.*, d.name AS donor_name
       FROM donations dn JOIN donors d ON d.id = dn.donor_id
       WHERE dn.deal_id = ? ORDER BY dn.donation_date ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/donations — add tranche donation for Partial deal
router.post('/:id/donations', checkPermission('donations', 'can_create'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[deal]] = await conn.query('SELECT * FROM deals WHERE id = ?', [req.params.id]);
    if (!deal) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Deal not found.' }); }

    const [[{ total_received }]] = await conn.query(
      'SELECT IFNULL(SUM(amount), 0) AS total_received FROM donations WHERE deal_id = ?',
      [req.params.id]
    );
    const newAmount = Number(req.body.amount);
    const remaining = Number(deal.amount) - Number(total_received);

    if (newAmount > remaining) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: `Amount exceeds remaining balance. Remaining: ₹${remaining.toFixed(2)}` });
    }

    await conn.query('CALL sp_next_receipt_number(@rn)');
    const [[{ rn }]] = await conn.query('SELECT @rn AS rn');

    const { donation_date, payment_mode, fund_category, purpose, cheque_number, bank_name, transaction_ref, is_80g_eligible, notes, allocations: customAllocations } = req.body;
    const [ins] = await conn.query(
      `INSERT INTO donations (donor_id, deal_id, receipt_number, amount, donation_date, payment_mode,
        cheque_number, bank_name, transaction_ref, fund_category, purpose, is_80g_eligible, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [deal.donor_id, deal.id, rn, newAmount, donation_date, payment_mode || 'Cash',
       cheque_number || null, bank_name || null, transaction_ref || null,
       fund_category || 'General', purpose || deal.title,
       is_80g_eligible ? 1 : 0, notes || null, req.user.id]
    );

    await saveDonationAllocations(conn, ins.insertId, deal.id, newAmount, customAllocations || null);

    // Auto-move to Received if fully collected
    if (Number(total_received) + newAmount >= Number(deal.amount)) {
      await conn.query('UPDATE deals SET stage = ?, actual_date = ? WHERE id = ?', ['Received', donation_date, deal.id]);
    }

    await conn.commit();
    const [[donation]] = await pool.query(
      `SELECT dn.*, d.name AS donor_name FROM donations dn JOIN donors d ON d.id = dn.donor_id WHERE dn.id = ?`,
      [ins.insertId]
    );
    res.status(201).json({ success: true, data: donation });
  } catch (err) { await conn.rollback(); next(err); }
  finally { conn.release(); }
});

// DELETE /api/deals/:id
router.delete('/:id', checkPermission('deals', 'can_delete'), async (req, res, next) => {
  try {
    let sql = 'DELETE FROM deals WHERE id = ?';
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND created_by = ?'; params.push(req.user.id); }
    await pool.query(sql, params);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
