const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, requireAdmin, checkPermission } = require('../middleware/auth');

router.use(requireAuth);

// ── GET /api/programs ──────────────────────────────────────────────────────────
// List all programs with collected amount (sum of received deals)
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT
        p.*,
        IFNULL(SUM(CASE WHEN d.stage = 'Received' THEN d.amount ELSE 0 END), 0) AS collected_amount,
        COUNT(DISTINCT d.id) AS total_deals,
        COUNT(DISTINCT pba.id) AS allocation_count
      FROM programs p
      LEFT JOIN deals d ON d.program_id = p.id
      LEFT JOIN program_budget_allocations pba ON pba.program_id = p.id
      WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND p.status = ?'; params.push(status); }
    sql += ' GROUP BY p.id ORDER BY p.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── GET /api/programs/:id ──────────────────────────────────────────────────────
// Single program with allocations + linked deals
router.get('/:id', async (req, res, next) => {
  try {
    const [programs] = await pool.query(
      `SELECT p.*,
        IFNULL(SUM(CASE WHEN d.stage = 'Received' THEN d.amount ELSE 0 END), 0) AS collected_amount,
        COUNT(DISTINCT d.id) AS total_deals
       FROM programs p
       LEFT JOIN deals d ON d.program_id = p.id
       WHERE p.id = ?
       GROUP BY p.id`,
      [req.params.id]
    );
    if (!programs.length) return res.status(404).json({ success: false, message: 'Program not found' });

    const [allocations] = await pool.query(
      `SELECT pba.*, pc.name AS category_name, pc.color AS category_color
       FROM program_budget_allocations pba
       JOIN program_categories pc ON pc.id = pba.category_id
       WHERE pba.program_id = ?
       ORDER BY pba.allocated_amount DESC`,
      [req.params.id]
    );

    const [deals] = await pool.query(
      `SELECT d.id, d.title, d.amount, d.stage, d.priority, d.expected_date, d.actual_date,
              dn.name AS donor_name, dn.email AS donor_email
       FROM deals d
       LEFT JOIN donors dn ON dn.id = d.donor_id
       WHERE d.program_id = ?
       ORDER BY d.created_at DESC`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...programs[0], allocations, deals } });
  } catch (err) { next(err); }
});

// ── POST /api/programs ────────────────────────────────────────────────────────
router.post('/', checkPermission('programs', 'can_create'), async (req, res, next) => {
  try {
    const { title, description, estimated_budget, start_date, end_date, status } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Title is required.' });
    if (!estimated_budget || estimated_budget <= 0)
      return res.status(400).json({ success: false, message: 'Estimated budget must be greater than 0.' });

    const [result] = await pool.query(
      `INSERT INTO programs (program_code, title, description, estimated_budget, start_date, end_date, status, created_by)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?)`,
      [title, description || null, estimated_budget, start_date || null, end_date || null, status || 'Active', req.user.id]
    );
    const [rows] = await pool.query('SELECT * FROM programs WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// ── PUT /api/programs/:id ─────────────────────────────────────────────────────
router.put('/:id', checkPermission('programs', 'can_edit'), async (req, res, next) => {
  try {
    const { title, description, estimated_budget, start_date, end_date, status } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Title is required.' });

    await pool.query(
      `UPDATE programs SET title=?, description=?, estimated_budget=?, start_date=?, end_date=?, status=?
       WHERE id=?`,
      [title, description || null, estimated_budget, start_date || null, end_date || null, status || 'Active', req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM programs WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// ── DELETE /api/programs/:id ──────────────────────────────────────────────────
router.delete('/:id', checkPermission('programs', 'can_delete'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM programs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/programs/:id/allocations ────────────────────────────────────────
// Replace all budget allocations for a program (upsert approach)
router.put('/:id/allocations', checkPermission('programs', 'can_edit'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { allocations } = req.body; // [{category_id, allocated_amount, notes}]
    if (!Array.isArray(allocations))
      return res.status(400).json({ success: false, message: 'allocations must be an array.' });

    await conn.beginTransaction();

    // Validate total does not exceed program budget
    const [prog] = await conn.query('SELECT estimated_budget FROM programs WHERE id = ?', [req.params.id]);
    if (!prog.length) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Program not found.' }); }

    const total = allocations.reduce((s, a) => s + Number(a.allocated_amount || 0), 0);
    if (total > Number(prog[0].estimated_budget)) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: `Total allocation (${total}) exceeds estimated budget (${prog[0].estimated_budget}).` });
    }

    // Delete removed allocations (keep only those in the new set)
    const newCatIds = allocations.filter(a => a.allocated_amount > 0).map(a => a.category_id);
    if (newCatIds.length) {
      await conn.query(
        `DELETE FROM program_budget_allocations WHERE program_id = ? AND category_id NOT IN (?)`,
        [req.params.id, newCatIds]
      );
    } else {
      await conn.query('DELETE FROM program_budget_allocations WHERE program_id = ?', [req.params.id]);
    }

    // Upsert each allocation with amount > 0
    for (const a of allocations) {
      if (Number(a.allocated_amount) <= 0) continue;
      await conn.query(
        `INSERT INTO program_budget_allocations (program_id, category_id, allocated_amount, notes)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE allocated_amount = VALUES(allocated_amount), notes = VALUES(notes)`,
        [req.params.id, a.category_id, a.allocated_amount, a.notes || null]
      );
    }

    await conn.commit();

    const [rows] = await pool.query(
      `SELECT pba.*, pc.name AS category_name, pc.color AS category_color
       FROM program_budget_allocations pba
       JOIN program_categories pc ON pc.id = pba.category_id
       WHERE pba.program_id = ?
       ORDER BY pba.allocated_amount DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
