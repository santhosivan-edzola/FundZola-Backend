const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'fundzola_jwt_secret_key';

// GET /api/auth/setup-needed — check if first-time setup is required (public)
router.get('/setup-needed', async (req, res, next) => {
  try {
    const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin'");
    res.json({ success: true, setupNeeded: parseInt(count) === 0 });
  } catch (err) { next(err); }
});

// POST /api/auth/setup — create first admin (only if no admin exists)
router.post('/setup', async (req, res, next) => {
  try {
    const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin'");
    if (parseInt(count) > 0) {
      return res.status(403).json({ success: false, message: 'Admin already exists.' });
    }
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'name, email, and password are required.' });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO app_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [name, email, hash, 'admin']);
    res.json({ success: true, message: 'Admin account created. You can now log in.' });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    const [[user]] = await pool.query('SELECT * FROM app_users WHERE email = ? AND is_active = 1', [email]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    const valid = await bcrypt.compare(password, user.password_hash || '');
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    const [perms] = await pool.query('SELECT * FROM user_permissions WHERE user_id = ?', [user.id]);
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        permissions: perms,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/auth/me (requires auth)
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [[user]] = await pool.query('SELECT id, name, email, role FROM app_users WHERE id = ?', [req.user.id]);
    const [perms] = await pool.query('SELECT * FROM user_permissions WHERE user_id = ?', [req.user.id]);
    res.json({ success: true, data: { user, permissions: perms } });
  } catch (err) { next(err); }
});

// POST /api/auth/change-password (requires auth)
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'currentPassword and newPassword are required.' });
    }
    const [[user]] = await pool.query('SELECT * FROM app_users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const valid = await bcrypt.compare(currentPassword, user.password_hash || '');
    if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE app_users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hash, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
