const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /api/summary/funds — fund utilization from view
router.get('/funds', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM vw_fund_utilization
       WHERE total_donated > 0 OR total_expended > 0
       ORDER BY total_donated DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/summary/donors — donor summary from view
router.get('/donors', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM vw_donor_summary ORDER BY total_donated DESC'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/summary/totals — aggregate totals
router.get('/totals', async (req, res, next) => {
  try {
    const [[donorRow]] = await pool.query(
      'SELECT COUNT(*) AS totalDonors FROM donors WHERE is_active = 1'
    );
    const [[donationRow]] = await pool.query(
      'SELECT COUNT(*) AS totalDonations, COALESCE(SUM(amount), 0) AS totalDonated FROM donations'
    );
    const [[expenseRow]] = await pool.query(
      'SELECT COUNT(*) AS totalExpenses, COALESCE(SUM(amount), 0) AS totalExpended FROM expenses'
    );

    const totalDonated = parseFloat(donationRow.totalDonated) || 0;
    const totalExpended = parseFloat(expenseRow.totalExpended) || 0;

    res.json({
      success: true,
      data: {
        totalDonors: donorRow.totalDonors,
        totalDonated,
        totalExpended,
        balance: totalDonated - totalExpended,
        totalDonations: donationRow.totalDonations,
        totalExpenses: expenseRow.totalExpenses,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
