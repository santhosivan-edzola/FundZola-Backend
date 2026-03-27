const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const JWT_SECRET = process.env.JWT_SECRET || 'fundzola_jwt_secret_key';

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
}

/**
 * Middleware factory that checks a specific module permission for non-admin users.
 * action: 'can_create' | 'can_edit' | 'can_delete'
 */
function checkPermission(module, action) {
  return async (req, res, next) => {
    if (req.user.role === 'admin') return next(); // admins always pass
    try {
      const [rows] = await pool.query(
        'SELECT can_view, can_create, can_edit, can_delete FROM user_permissions WHERE user_id = ? AND module = ?',
        [req.user.id, module]
      );
      const perm = rows[0];
      if (!perm || !perm[action]) {
        const verb = action.replace('can_', '');
        return res.status(403).json({ success: false, message: `You do not have ${verb} permission for ${module}.` });
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { requireAuth, requireAdmin, checkPermission };
