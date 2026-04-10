const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/donations/donor/:donorId — MUST be before /:id to avoid conflict
router.get('/donor/:donorId', async (req, res, next) => {
  try {
    const { donorId } = req.params;
    let sql = `SELECT dn.*, d.name AS donor_name, d.donor_code, d.pan_number
               FROM donations dn
               INNER JOIN donors d ON d.id = dn.donor_id
               WHERE dn.donor_id = ?`;
    const params = [donorId];
    if (req.user.role !== 'admin') { sql += ' AND dn.created_by = ?'; params.push(req.user.id); }
    sql += ' ORDER BY dn.donation_date DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/donations
router.get('/', async (req, res, next) => {
  try {
    const { donorId, fund, mode, is80g, from, to } = req.query;
    let sql = `SELECT dn.*, d.name AS donor_name, d.donor_code, d.pan_number
               FROM donations dn
               INNER JOIN donors d ON d.id = dn.donor_id
               WHERE 1=1`;
    const params = [];

    if (req.user.role !== 'admin') { sql += ' AND dn.created_by = ?'; params.push(req.user.id); }
    if (donorId) { sql += ' AND dn.donor_id = ?'; params.push(donorId); }
    if (fund) { sql += ' AND dn.fund_category = ?'; params.push(fund); }
    if (mode) { sql += ' AND dn.payment_mode = ?'; params.push(mode); }
    if (is80g !== undefined && is80g !== '') {
      sql += ' AND dn.is_80g_eligible = ?';
      params.push(is80g === 'true' || is80g === '1' ? 1 : 0);
    }
    if (from) { sql += ' AND dn.donation_date >= ?'; params.push(from); }
    if (to) { sql += ' AND dn.donation_date <= ?'; params.push(to); }
    sql += ' ORDER BY dn.donation_date DESC';

    const [rows] = await pool.query(sql, params);

    // Attach category allocations for each donation
    const donationIds = rows.map(r => r.id);
    let allocMap = {};
    if (donationIds.length) {
      const [allocs] = await pool.query(
        `SELECT da.*, pc.name AS category_name, pc.color AS category_color
         FROM donation_allocations da
         JOIN program_categories pc ON pc.id = da.category_id
         WHERE da.donation_id IN (?)`,
        [donationIds]
      );
      allocs.forEach(a => {
        if (!allocMap[a.donation_id]) allocMap[a.donation_id] = [];
        allocMap[a.donation_id].push(a);
      });
    }
    const data = rows.map(r => ({ ...r, allocations: allocMap[r.id] || [] }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/donations/:id/category-breakdown
router.get('/:id/category-breakdown', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`
      SELECT
        pc.id,
        pc.name,
        pc.color,
        COALESCE(da.amount, 0)          AS allocated,
        COALESCE(SUM(e.amount), 0)      AS spent,
        COALESCE(da.amount, 0) - COALESCE(SUM(e.amount), 0) AS remaining
      FROM program_categories pc
      LEFT JOIN donation_allocations da ON da.category_id = pc.id AND da.donation_id = ?
      LEFT JOIN expenses e              ON e.category_id  = pc.id AND e.donation_id  = ?
      WHERE da.donation_id = ? OR e.donation_id = ?
      GROUP BY pc.id, pc.name, pc.color, da.amount
      ORDER BY allocated DESC
    `, [id, id, id, id]);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/donations/:id
router.get('/:id', async (req, res, next) => {
  try {
    let sql = 'SELECT * FROM vw_donation_detail WHERE id = ?';
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND created_by = ?'; params.push(req.user.id); }
    const [rows] = await pool.query(sql, params);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Donation not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/donations
router.post('/', checkPermission('donations', 'can_create'), async (req, res, next) => {
  try {
    const { donor_id, amount, donation_date, payment_mode, cheque_number, bank_name,
            transaction_ref, fund_category, purpose, is_80g_eligible, notes } = req.body;

    if (!donor_id || !amount || !donation_date) {
      return res.status(400).json({ success: false, message: 'donor_id, amount, and donation_date are required.' });
    }

    await pool.query('CALL sp_next_receipt_number(@receipt_number)');
    const [[receiptResult]] = await pool.query('SELECT @receipt_number AS receipt_number');
    const receipt_number = receiptResult.receipt_number;

    const [result] = await pool.query(
      `INSERT INTO donations
        (donor_id, receipt_number, amount, donation_date, payment_mode, cheque_number, bank_name,
         transaction_ref, fund_category, purpose, is_80g_eligible, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [donor_id, receipt_number, amount, donation_date, payment_mode || 'Cash',
       cheque_number || null, bank_name || null, transaction_ref || null,
       fund_category || 'General', purpose || null,
       is_80g_eligible !== undefined ? (is_80g_eligible ? 1 : 0) : 0,
       notes || null, req.user.id]
    );

    const [rows] = await pool.query(
      `SELECT dn.*, d.name AS donor_name, d.donor_code, d.pan_number
       FROM donations dn INNER JOIN donors d ON d.id = dn.donor_id WHERE dn.id = ?`,
      [result.insertId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/donations/:id
router.put('/:id', checkPermission('donations', 'can_edit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { donor_id, amount, donation_date, payment_mode, cheque_number, bank_name,
            transaction_ref, fund_category, purpose, is_80g_eligible, notes } = req.body;

    const [result] = await pool.query(
      `UPDATE donations SET
        donor_id=COALESCE(?,donor_id), amount=COALESCE(?,amount), donation_date=COALESCE(?,donation_date),
        payment_mode=COALESCE(?,payment_mode), cheque_number=COALESCE(?,cheque_number),
        bank_name=COALESCE(?,bank_name), transaction_ref=COALESCE(?,transaction_ref),
        fund_category=COALESCE(?,fund_category), purpose=COALESCE(?,purpose),
        is_80g_eligible=COALESCE(?,is_80g_eligible), notes=COALESCE(?,notes), updated_at=NOW()
      WHERE id=?`,
      [donor_id, amount, donation_date, payment_mode, cheque_number, bank_name,
       transaction_ref, fund_category, purpose,
       is_80g_eligible !== undefined ? (is_80g_eligible ? 1 : 0) : null,
       notes, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Donation not found.' });
    const [rows] = await pool.query(
      `SELECT dn.*, d.name AS donor_name, d.donor_code, d.pan_number
       FROM donations dn INNER JOIN donors d ON d.id = dn.donor_id WHERE dn.id = ?`,
      [id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/donations/:id
router.delete('/:id', checkPermission('donations', 'can_delete'), async (req, res, next) => {
  try {
    let sql = 'DELETE FROM donations WHERE id = ?';
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND created_by = ?'; params.push(req.user.id); }
    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Donation not found.' });
    res.json({ success: true, message: 'Donation deleted successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
