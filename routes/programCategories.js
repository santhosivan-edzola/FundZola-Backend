const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);

// ── GET /api/program-categories ───────────────────────────────────────────────
// All users can read categories (for dropdowns in program forms)
router.get('/', async (req, res, next) => {
  try {
    const { all } = req.query; // ?all=1 to include inactive (admin)
    let sql = 'SELECT * FROM program_categories';
    if (!all) sql += ' WHERE is_active = 1';
    sql += ' ORDER BY name ASC';
    const [rows] = await pool.query(sql);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/program-categories ─────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, description, color } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required.' });

    const [result] = await pool.query(
      `INSERT INTO program_categories (name, description, color, created_by)
       VALUES (?, ?, ?, ?)`,
      [name.trim(), description || null, color || '#6366F1', req.user.id]
    );
    const [rows] = await pool.query('SELECT * FROM program_categories WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, message: 'A category with this name already exists.' });
    next(err);
  }
});

// ── PUT /api/program-categories/:id ──────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, description, color } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required.' });

    await pool.query(
      `UPDATE program_categories SET name=?, description=?, color=? WHERE id=?`,
      [name.trim(), description || null, color || '#6366F1', req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM program_categories WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Category not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, message: 'A category with this name already exists.' });
    next(err);
  }
});

// ── PATCH /api/program-categories/:id/toggle ─────────────────────────────────
router.patch('/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE program_categories SET is_active = NOT is_active WHERE id = ?',
      [req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM program_categories WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Category not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// ── DELETE /api/program-categories/:id ───────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    // Check if any allocations use this category
    const [used] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM program_budget_allocations WHERE category_id = ?',
      [req.params.id]
    );
    if (used[0].cnt > 0)
      return res.status(409).json({
        success: false,
        message: 'Cannot delete: this category has existing budget allocations. Deactivate it instead.',
      });

    await pool.query('DELETE FROM program_categories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
