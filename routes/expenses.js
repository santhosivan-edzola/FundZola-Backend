const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/expenses/open-donations?program_id=X&category_id=Y
// Returns donations with remaining category budget > 0
router.get('/open-donations', async (req, res, next) => {
  try {
    const { program_id, category_id } = req.query;
    if (!program_id || !category_id) {
      return res.status(400).json({ success: false, message: 'program_id and category_id are required.' });
    }

    const [rows] = await pool.query(`
      SELECT
        d.id,
        d.receipt_number,
        d.amount AS donation_amount,
        d.donation_date,
        dn.name  AS donor_name,
        ROUND(da.amount * d.amount / NULLIF(dl.amount, 0), 2) AS category_allocation,
        ROUND(
          d.amount
          - IFNULL((SELECT SUM(e.amount) FROM expenses e WHERE e.donation_id = d.id), 0),
          2
        ) AS remaining
      FROM donations d
      JOIN deals dl            ON dl.id = d.deal_id AND dl.program_id = ?
      JOIN deal_allocations da ON da.deal_id = dl.id AND da.category_id = ?
      JOIN donors dn           ON dn.id = d.donor_id
      WHERE d.amount > 0
      HAVING remaining > 0
      ORDER BY d.donation_date ASC
    `, [program_id, category_id]);

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/expenses
router.get('/', async (req, res, next) => {
  try {
    const { fund, category, from, to, donationId } = req.query;
    let sql = `SELECT e.*, dn.receipt_number,
                      p.title AS program_title,
                      pc.name AS category_name, pc.color AS category_color
               FROM expenses e
               LEFT JOIN donations dn ON dn.id = e.donation_id
               LEFT JOIN programs p   ON p.id  = e.program_id
               LEFT JOIN program_categories pc ON pc.id = e.category_id
               WHERE 1=1`;
    const params = [];

    if (req.user.role !== 'admin') { sql += ' AND e.created_by = ?'; params.push(req.user.id); }
    if (fund)       { sql += ' AND e.fund_category = ?'; params.push(fund); }
    if (category)   { sql += ' AND e.category = ?';      params.push(category); }
    if (from)       { sql += ' AND e.expense_date >= ?'; params.push(from); }
    if (to)         { sql += ' AND e.expense_date <= ?'; params.push(to); }
    if (donationId) { sql += ' AND e.donation_id = ?';   params.push(donationId); }
    sql += ' ORDER BY e.expense_date DESC';

    const [rows] = await pool.query(sql, params);

    // Attach allocations for Split expenses
    const splitIds = rows.filter(r => r.expense_type === 'Split').map(r => r.id);
    let allocMap = {};
    if (splitIds.length) {
      const [allocs] = await pool.query(
        `SELECT ea.*, dn2.receipt_number, don.name AS donor_name
         FROM expense_allocations ea
         JOIN donations dn2 ON dn2.id = ea.donation_id
         JOIN donors don    ON don.id = dn2.donor_id
         WHERE ea.expense_id IN (?)`,
        [splitIds]
      );
      allocs.forEach(a => {
        if (!allocMap[a.expense_id]) allocMap[a.expense_id] = [];
        allocMap[a.expense_id].push(a);
      });
    }

    const data = rows.map(r => ({ ...r, allocations: allocMap[r.id] || [] }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/expenses/:id
router.get('/:id', async (req, res, next) => {
  try {
    let sql = `SELECT e.*, dn.receipt_number,
                      p.title AS program_title,
                      pc.name AS category_name, pc.color AS category_color
               FROM expenses e
               LEFT JOIN donations dn ON dn.id = e.donation_id
               LEFT JOIN programs p   ON p.id  = e.program_id
               LEFT JOIN program_categories pc ON pc.id = e.category_id
               WHERE e.id = ?`;
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND e.created_by = ?'; params.push(req.user.id); }
    const [rows] = await pool.query(sql, params);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Expense not found.' });

    const [allocs] = await pool.query(
      `SELECT ea.*, dn2.receipt_number, don.name AS donor_name
       FROM expense_allocations ea
       JOIN donations dn2 ON dn2.id = ea.donation_id
       JOIN donors don    ON don.id = dn2.donor_id
       WHERE ea.expense_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], allocations: allocs } });
  } catch (err) { next(err); }
});

// POST /api/expenses
router.post('/', checkPermission('expenses', 'can_create'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { donation_id, fund_category, description, amount, expense_date, category,
            vendor, invoice_number, payment_mode, approved_by, notes,
            program_id, category_id, expense_type, allocations } = req.body;

    if (!amount || !expense_date || !description) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'amount, expense_date, and description are required.' });
    }

    const type = expense_type || 'Full';
    const [result] = await conn.query(
      `INSERT INTO expenses
        (donation_id, fund_category, description, amount, expense_date, category,
         vendor, invoice_number, payment_mode, approved_by, notes,
         program_id, category_id, expense_type, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        type === 'Full' ? (donation_id || null) : null,
        fund_category || 'General', description, amount, expense_date,
        category || 'Other', vendor || null, invoice_number || null,
        payment_mode || null, approved_by || null, notes || null,
        program_id || null, category_id || null, type, req.user.id
      ]
    );

    const expenseId = result.insertId;

    // For Split, save per-donation allocations
    if (type === 'Split' && Array.isArray(allocations) && allocations.length) {
      for (const a of allocations) {
        if (!a.donation_id || Number(a.amount) <= 0) continue;
        await conn.query(
          `INSERT INTO expense_allocations (expense_id, donation_id, amount) VALUES (?, ?, ?)`,
          [expenseId, a.donation_id, a.amount]
        );
      }
    }

    await conn.commit();

    const [rows] = await pool.query(
      `SELECT e.*, dn.receipt_number, p.title AS program_title,
              pc.name AS category_name, pc.color AS category_color
       FROM expenses e
       LEFT JOIN donations dn ON dn.id = e.donation_id
       LEFT JOIN programs p   ON p.id  = e.program_id
       LEFT JOIN program_categories pc ON pc.id = e.category_id
       WHERE e.id = ?`,
      [expenseId]
    );
    const [allocs] = await pool.query(
      `SELECT ea.*, dn2.receipt_number, don.name AS donor_name
       FROM expense_allocations ea
       JOIN donations dn2 ON dn2.id = ea.donation_id
       JOIN donors don    ON don.id = dn2.donor_id
       WHERE ea.expense_id = ?`,
      [expenseId]
    );
    res.status(201).json({ success: true, data: { ...rows[0], allocations: allocs } });
  } catch (err) { await conn.rollback(); next(err); }
  finally { conn.release(); }
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
