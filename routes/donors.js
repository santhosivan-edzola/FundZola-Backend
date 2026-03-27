const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/donors — get all active donors, optional ?search= and ?type= filters
router.get('/', async (req, res, next) => {
  try {
    const { search, type } = req.query;
    let sql = 'SELECT * FROM donors WHERE is_active = 1';
    const params = [];

    if (req.user.role !== 'admin') {
      sql += ' AND created_by = ?';
      params.push(req.user.id);
    }
    if (search) {
      sql += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR pan_number LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (type) {
      sql += ' AND donor_type = ?';
      params.push(type);
    }
    sql += ' ORDER BY name ASC';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/donors/:id
router.get('/:id', async (req, res, next) => {
  try {
    let sql = 'SELECT * FROM donors WHERE id = ?';
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND created_by = ?'; params.push(req.user.id); }
    const [rows] = await pool.query(sql, params);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Donor not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/donors — create new donor, auto-generate donor_code
router.post('/', checkPermission('donors', 'can_create'), async (req, res, next) => {
  try {
    const { name, email, phone, address, pan_number, donor_type } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Donor name is required.' });

    await pool.query('CALL sp_next_donor_code(@donor_code)');
    const [[codeResult]] = await pool.query('SELECT @donor_code AS donor_code');
    const donor_code = codeResult.donor_code;

    const [result] = await pool.query(
      `INSERT INTO donors (donor_code, name, email, phone, address, pan_number, donor_type, is_active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
      [donor_code, name, email || null, phone || null, address || null, pan_number || null, donor_type || 'Individual', req.user.id]
    );

    const [rows] = await pool.query('SELECT * FROM donors WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/donors/:id — update donor
router.put('/:id', checkPermission('donors', 'can_edit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, phone, address, pan_number, donor_type } = req.body;

    const [result] = await pool.query(
      `UPDATE donors SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        pan_number = COALESCE(?, pan_number),
        donor_type = COALESCE(?, donor_type),
        updated_at = NOW()
      WHERE id = ? AND is_active = 1`,
      [name, email, phone, address, pan_number, donor_type, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Donor not found.' });
    const [rows] = await pool.query('SELECT * FROM donors WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/donors/:id — soft delete
router.delete('/:id', checkPermission('donors', 'can_delete'), async (req, res, next) => {
  try {
    let sql = 'UPDATE donors SET is_active = 0, updated_at = NOW() WHERE id = ?';
    const params = [req.params.id];
    if (req.user.role !== 'admin') { sql += ' AND created_by = ?'; params.push(req.user.id); }
    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Donor not found.' });
    res.json({ success: true, message: 'Donor deactivated successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
