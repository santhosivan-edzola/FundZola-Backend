require('dotenv').config();
const express = require('express');
const cors = require('cors');

const pool = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

const organizationsRouter = require('./routes/organizations');
const donorsRouter = require('./routes/donors');
const donationsRouter = require('./routes/donations');
const expensesRouter = require('./routes/expenses');
const dealsRouter = require('./routes/deals');
const summaryRouter = require('./routes/summary');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const programsRouter = require('./routes/programs');
const programCategoriesRouter = require('./routes/programCategories');
const zohoRouter               = require('./routes/zoho');
const { startScheduler }       = require('./utils/zohoSync');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5175', 'http://127.0.0.1:5175'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/donors', donorsRouter);
app.use('/api/donations', donationsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/deals', dealsRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/programs', programsRouter);
app.use('/api/program-categories', programCategoriesRouter);
app.use('/api/zoho', zohoRouter);

// ── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found.` });
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`Fundzola API server listening on http://localhost:${PORT}`);
  try {
    await pool.query('SELECT 1');
    console.log('Database connection successful.');
    startScheduler();
  } catch (err) {
    console.error('Database connection FAILED:', err.message);
  }
});

module.exports = app;
