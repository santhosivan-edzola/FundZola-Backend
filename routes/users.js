const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendUserInvite } = require('../utils/mailer');

// All routes require auth + admin role
router.use(requireAuth, requireAdmin);

// GET /api/users
router.get('/', async (req, res, next) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM app_users ORDER BY created_at DESC'
    );
    const [perms] = await pool.query('SELECT * FROM user_permissions');
    const data = users.map(u => ({
      ...u,
      permissions: perms.filter(p => p.user_id === u.id),
    }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/users — create user + assign permissions + send email
router.post('/', async (req, res, next) => {
  try {
    const { name, email, permissions = [] } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'name and email are required.' });
    }

    // Generate temp password: 8 random chars + uppercase + digit
    const tempPassword = Math.random().toString(36).slice(-6).toUpperCase() + Math.floor(10 + Math.random() * 90);
    const hash = await bcrypt.hash(tempPassword, 10);

    const [result] = await pool.query(
      'INSERT INTO app_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, hash, 'user']
    );
    const userId = result.insertId;

    if (permissions.length > 0) {
      const values = permissions.map(p => [
        userId, p.module,
        p.can_view !== false,
        p.can_create === true,
        p.can_edit === true,
        p.can_delete === true,
      ]);
      await pool.query(
        'INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete) VALUES ?',
        [values]
      );
    }

    const accessibleModules = permissions.filter(p => p.can_view !== false).map(p => p.module);
    try {
      await sendUserInvite({ to: email, name, email, password: tempPassword, modules: accessibleModules });
    } catch (mailErr) {
      console.error('[Users] Email failed:', mailErr.message);
    }

    const [[newUser]] = await pool.query('SELECT id, name, email, role, is_active FROM app_users WHERE id = ?', [userId]);
    const [newPerms] = await pool.query('SELECT * FROM user_permissions WHERE user_id = ?', [userId]);
    res.status(201).json({ success: true, data: { ...newUser, permissions: newPerms }, tempPassword });
  } catch (err) { next(err); }
});

// PUT /api/users/:id — update name/email/status + replace permissions
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, is_active, permissions } = req.body;

    await pool.query(
      'UPDATE app_users SET name=?, email=?, is_active=?, updated_at=NOW() WHERE id=?',
      [name, email, is_active !== false ? 1 : 0, id]
    );

    if (Array.isArray(permissions)) {
      await pool.query('DELETE FROM user_permissions WHERE user_id = ?', [id]);
      if (permissions.length > 0) {
        const values = permissions.map(p => [
          id, p.module,
          p.can_view !== false,
          p.can_create === true,
          p.can_edit === true,
          p.can_delete === true,
        ]);
        await pool.query(
          'INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete) VALUES ?',
          [values]
        );
      }
    }

    const [[user]] = await pool.query('SELECT id, name, email, role, is_active FROM app_users WHERE id = ?', [id]);
    const [perms] = await pool.query('SELECT * FROM user_permissions WHERE user_id = ?', [id]);
    res.json({ success: true, data: { ...user, permissions: perms } });
  } catch (err) { next(err); }
});

// DELETE /api/users/:id — deactivate
router.delete('/:id', async (req, res, next) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate your own account.' });
    }
    await pool.query('UPDATE app_users SET is_active=0, updated_at=NOW() WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'User deactivated.' });
  } catch (err) { next(err); }
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const newPassword = Math.random().toString(36).slice(-6).toUpperCase() + Math.floor(10 + Math.random() * 90);
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE app_users SET password_hash=?, updated_at=NOW() WHERE id=?', [hash, req.params.id]);
    res.json({ success: true, newPassword });
  } catch (err) { next(err); }
});

module.exports = router;
