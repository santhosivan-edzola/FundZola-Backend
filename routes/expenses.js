const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/expenses
router.get('/', async (req, res, next) => {
  try {
    const { fund, category, from, to, donationId } = req.query;
    let sql = `SELECT e.*, dn.receipt_number
               FROM expenses e
               LEFT JOIN donations dn ON dn.id = e.donation_id
               WHERE 1=1`;
    const params = [];

    if (req.user.role !== 'admin') { sql += ' AND e.created_by = ?'; params.push(req.user.id); }
    if (fund) { sql += ' AND e.fund_category = ?'; params.push(fund); }
    if (category) { sql += ' AND e.category = ?'; params.push(category); }
    if (from) { sql += ' AND e.expense_date >= ?'; params.push(from); }
    if (to) { sql += ' AND e.expense_date <= ?'; params.push(to); }
    if (donationId) { sql += ' AND e.donation_id = ?'; params.push(donationId); }
    sql += ' ORDER BY e.expense_date DESC';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/expenses/:id
router.get('/:id', async (req, res, next) => {
  try {
    let sql = `SELECT e.*, dn.receipt_number FROM expenses e LEFT JOIN donations dn ON dn.id = e.donation_id WHERE e.id = ?`;
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND e.created_by = ?'; params.push(req.user.id); }
    const [rows] = await pool.query(sql, params);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Expense not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/expenses
router.post('/', checkPermission('expenses', 'can_create'), async (req, res, next) => {
  try {
    const { donation_id, fund_category, description, amount, expense_date, category,
            vendor, invoice_number, payment_mode, approved_by, notes } = req.body;

    if (!amount || !expense_date || !description) {
      return res.status(400).json({ success: false, message: 'amount, expense_date, and description are required.' });
    }

    const [result] = await pool.query(
      `INSERT INTO expenses
        (donation_id, fund_category, description, amount, expense_date, category,
         vendor, invoice_number, payment_mode, approved_by, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [donation_id || null, fund_category || 'General', description, amount, expense_date,
       category || 'Other', vendor || null, invoice_number || null, payment_mode || null,
       approved_by || null, notes || null, req.user.id]
    );

    const [rows] = await pool.query(
      `SELECT e.*, dn.receipt_number FROM expenses e LEFT JOIN donations dn ON dn.id = e.donation_id WHERE e.id = ?`,
      [result.insertId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/expenses/:id
router.put('/:id', checkPermission('expenses', 'can_edit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { donation_id, fund_category, description, amount, expense_date, category,
            vendor, invoice_number, payment_mode, approved_by, notes } = req.body;

    const [result] = await pool.query(
      `UPDATE expenses SET
        donation_id=COALESCE(?,donation_id), fund_category=COALESCE(?,fund_category),
        description=COALESCE(?,description), amount=COALESCE(?,amount),
        expense_date=COALESCE(?,expense_date), category=COALESCE(?,category),
        vendor=COALESCE(?,vendor), invoice_number=COALESCE(?,invoice_number),
        payment_mode=COALESCE(?,payment_mode), approved_by=COALESCE(?,approved_by),
        notes=COALESCE(?,notes), updated_at=NOW()
      WHERE id=?`,
      [donation_id, fund_category, description, amount, expense_date,
       category, vendor, invoice_number, payment_mode, approved_by, notes, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Expense not found.' });
    const [rows] = await pool.query(
      `SELECT e.*, dn.receipt_number FROM expenses e LEFT JOIN donations dn ON dn.id = e.donation_id WHERE e.id = ?`,
      [id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/expenses/:id
router.delete('/:id', checkPermission('expenses', 'can_delete'), async (req, res, next) => {
  try {
    let sql = 'DELETE FROM expenses WHERE id = ?';
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND created_by = ?'; params.push(req.user.id); }
    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Expense not found.' });
    res.json({ success: true, message: 'Expense deleted successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
