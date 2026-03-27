const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

router.use(requireAuth);

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
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/deals/:id
router.get('/:id', async (req, res, next) => {
  try {
    let sql = `SELECT d.*, dn.name AS donor_name, dn.email AS donor_email, dn.phone AS donor_phone
               FROM deals d LEFT JOIN donors dn ON dn.id = d.donor_id WHERE d.id = ?`;
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND d.created_by = ?'; params.push(req.user.id); }
    const [rows] = await pool.query(sql, params);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Deal not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/deals
router.post('/', checkPermission('deals', 'can_create'), async (req, res, next) => {
  try {
    const { donor_id, title, amount, stage, priority, notes, expected_date, program_id } = req.body;
    const [result] = await pool.query(
      `INSERT INTO deals (donor_id, program_id, title, amount, stage, priority, notes, expected_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [donor_id, program_id || null, title, amount || 0, stage || 'Prospect', priority || 'Medium', notes || null, expected_date || null, req.user.id]
    );
    const [rows] = await pool.query(
      `SELECT d.*, dn.name AS donor_name, p.title AS program_title
       FROM deals d
       LEFT JOIN donors dn ON dn.id = d.donor_id
       LEFT JOIN programs p ON p.id = d.program_id
       WHERE d.id = ?`,
      [result.insertId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/deals/:id
router.put('/:id', checkPermission('deals', 'can_edit'), async (req, res, next) => {
  try {
    const { donor_id, title, amount, stage, priority, notes, expected_date, actual_date, program_id } = req.body;
    await pool.query(
      `UPDATE deals SET donor_id=?, program_id=?, title=?, amount=?, stage=?, priority=?, notes=?, expected_date=?, actual_date=?
       WHERE id=?`,
      [donor_id, program_id || null, title, amount || 0, stage, priority || 'Medium', notes || null, expected_date || null, actual_date || null, req.params.id]
    );
    const [rows] = await pool.query(
      `SELECT d.*, dn.name AS donor_name, p.title AS program_title
       FROM deals d
       LEFT JOIN donors dn ON dn.id = d.donor_id
       LEFT JOIN programs p ON p.id = d.program_id
       WHERE d.id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/deals/:id/stage
router.patch('/:id/stage', checkPermission('deals', 'can_edit'), async (req, res, next) => {
  try {
    const { stage, actual_date } = req.body;
    await pool.query(`UPDATE deals SET stage=?, actual_date=? WHERE id=?`, [stage, actual_date || null, req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
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
