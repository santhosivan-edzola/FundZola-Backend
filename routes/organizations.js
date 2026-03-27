const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /api/organizations — fetch the first (and only) org record
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM organizations LIMIT 1');
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Organization not found.' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/organizations/:id — update org settings
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      org_name,
      address,
      city,
      state,
      pincode,
      phone,
      email,
      registration_number,
      pan_80g,
      signatory,
      signatory_designation,
    } = req.body;

    const [result] = await pool.query(
      `UPDATE organizations SET
        org_name = COALESCE(?, org_name),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        pincode = COALESCE(?, pincode),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        registration_number = COALESCE(?, registration_number),
        pan_80g = COALESCE(?, pan_80g),
        signatory = COALESCE(?, signatory),
        signatory_designation = COALESCE(?, signatory_designation),
        updated_at = NOW()
      WHERE id = ?`,
      [
        org_name, address, city, state, pincode, phone, email,
        registration_number, pan_80g, signatory, signatory_designation,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Organization not found.' });
    }

    const [rows] = await pool.query('SELECT * FROM organizations WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
