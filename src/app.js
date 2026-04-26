const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const researchRoutes = require('./routes/research');
const paymentRoutes = require('./routes/payment');

function createApp() {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  const corsOrigin = process.env.CORS_ORIGIN;
  app.use(
    cors({
      origin:
        corsOrigin === '*'
          ? true
          : corsOrigin
            ? corsOrigin.split(',').map((o) => o.trim())
            : true,
      credentials: true,
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      process.env.NODE_ENV === 'test' ||
      req.path === '/health' ||
      req.path === '/',
  });
  app.use(limiter);

  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  const uploadPath = path.resolve(__dirname, '..', uploadDir);
  fs.mkdirSync(uploadPath, { recursive: true });
  app.use(`/${uploadDir}`, express.static(uploadPath));

  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true, database: 'connected' });
    } catch {
      res.status(503).json({ ok: false, database: 'disconnected' });
    }
  });

  app.get('/', (req, res) => {
    res.json({ message: 'Research paper backend is running.' });
  });

  app.use('/research', researchRoutes);
  app.use('/payment', paymentRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

module.exports = createApp;
