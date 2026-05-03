const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { getUploadDirName, getUploadAbsolutePath } = require('../uploadPaths');
const { parseResearcherNames, toNonNegativeInteger } = require('../utils/validation');

const router = express.Router();
const uploadDir = getUploadDirName();
const uploadPath = getUploadAbsolutePath();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadPath);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({ storage });

router.post(
  '/upload',
  upload.fields([
    { name: 'paper_file', maxCount: 1 },
    { name: 'researcher_files', maxCount: 10 },
  ]),
  async (req, res) => {
    let client;

    try {
      client = await db.pool.connect();
      const {
        email,
        title,
        description = '',
        type = 'free',
        price = 0,
      } = req.body;

      if (!email || !title) {
        return res.status(400).json({ error: 'email and title are required.' });
      }

      const paperFile = req.files?.paper_file?.[0];
      if (!paperFile) {
        return res.status(400).json({ error: 'paper_file is required.' });
      }

      const numericPrice = toNonNegativeInteger(price);
      if (type === 'paid' && numericPrice === 0) {
        return res.status(400).json({ error: 'Paid papers require a positive price.' });
      }

      const paperUrl = `/${uploadDir}/${paperFile.filename}`;
      const status = type === 'paid' ? 'pending' : 'active';
      const paymentStatus = type === 'paid' ? 'pending' : 'completed';

      await client.query('BEGIN');

      const paperResult = await client.query(
        `INSERT INTO research_papers (email, title, description, file_url, type, price, status, payment_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [email, title, description, paperUrl, type, numericPrice, status, paymentStatus]
      );

      const paper = paperResult.rows[0];
      const researcherNames = parseResearcherNames(req.body);
      const researcherFiles = req.files?.researcher_files || [];

      const insertedResearchers = await Promise.all(
        researcherNames.map((name, index) => {
          const researcherFile = researcherFiles[index];
          const profilePdfUrl = researcherFile ? `/${uploadDir}/${researcherFile.filename}` : null;
          return client
            .query(
              `INSERT INTO researchers (paper_id, name, profile_pdf_url)
               VALUES ($1, $2, $3)
               RETURNING *`,
              [paper.id, name, profilePdfUrl]
            )
            .then((result) => result.rows[0]);
        })
      );

      await client.query('COMMIT');

      return res.status(201).json({
        paper,
        researchers: insertedResearchers,
        message: type === 'paid'
          ? 'Paper uploaded, payment required to activate.'
          : 'Paper uploaded and active.',
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error(error);
      return res.status(500).json({ error: 'Failed to upload research paper.' });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);

router.get('/', async (req, res) => {
  const { search, type, status, page = 1, limit = 20 } = req.query;
  const pageNumber = Math.max(Number(page), 1);
  const pageSize = Math.min(Math.max(Number(limit), 1), 100);
  const offset = (pageNumber - 1) * pageSize;

  const filters = [];
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    filters.push(`(title ILIKE $${values.length} OR description ILIKE $${values.length} OR email ILIKE $${values.length})`);
  }
  if (type) {
    values.push(type);
    filters.push(`type = $${values.length}`);
  }
  if (status) {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const query = `SELECT * FROM research_papers ${whereClause} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(pageSize, offset);
    const result = await db.query(query, values);
    return res.json({ data: result.rows, page: pageNumber, limit: pageSize });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to list research papers.' });
  }
});

router.get('/my/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const result = await db.query(
      'SELECT * FROM research_papers WHERE email = $1 ORDER BY created_at DESC',
      [email]
    );
    return res.json({ data: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch user papers.' });
  }
});

router.post('/:id/download', async (req, res) => {
  try {
    const paperId = Number(req.params.id);
    const userEmail = String(req.body.user_email || '').trim().toLowerCase();
    if (!userEmail) {
      return res.status(400).json({ error: 'user_email is required.' });
    }

    const paperResult = await db.query('SELECT id, type, title, file_url, status FROM research_papers WHERE id = $1', [paperId]);
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found.' });
    }
    const paper = paperResult.rows[0];

    if (paper.type === 'paid') {
      const paymentResult = await db.query(
        `SELECT id FROM payments
         WHERE paper_id = $1 AND buyer_email = $2 AND status = 'completed'
         ORDER BY created_at DESC LIMIT 1`,
        [paperId, userEmail]
      );
      if (paymentResult.rows.length === 0) {
        return res.status(403).json({ error: 'Complete payment before downloading this paid paper.' });
      }
    }

    await db.query(
      `INSERT INTO paper_access (paper_id, user_email, access_type, last_read_at, progress_pct, updated_at)
       VALUES ($1, $2, 'download', NOW(), 0, NOW())
       ON CONFLICT (paper_id, user_email)
       DO UPDATE SET access_type = EXCLUDED.access_type, last_read_at = NOW(), updated_at = NOW()`,
      [paperId, userEmail]
    );

    return res.json({
      message: 'Download access recorded.',
      paper: {
        id: paper.id,
        title: paper.title,
        type: paper.type,
        file_url: paper.file_url,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to record download access.' });
  }
});

router.get('/continue-reading/:email', async (req, res) => {
  try {
    const email = String(req.params.email || '').trim().toLowerCase();
    const result = await db.query(
      `SELECT pa.paper_id, pa.user_email, pa.access_type, pa.last_read_at, pa.progress_pct,
              rp.title, rp.description, rp.file_url, rp.type, rp.price
       FROM paper_access pa
       JOIN research_papers rp ON rp.id = pa.paper_id
       WHERE pa.user_email = $1
       ORDER BY pa.last_read_at DESC`,
      [email]
    );
    return res.json({ data: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch continue reading list.' });
  }
});

router.patch('/continue-reading/:paperId/progress', async (req, res) => {
  try {
    const paperId = Number(req.params.paperId);
    const userEmail = String(req.body.user_email || '').trim().toLowerCase();
    const progressPct = Number(req.body.progress_pct);
    if (!userEmail || Number.isNaN(progressPct) || progressPct < 0 || progressPct > 100) {
      return res.status(400).json({ error: 'user_email and progress_pct (0-100) are required.' });
    }

    const result = await db.query(
      `UPDATE paper_access
       SET progress_pct = $1, last_read_at = NOW(), updated_at = NOW()
       WHERE paper_id = $2 AND user_email = $3
       RETURNING *`,
      [Math.round(progressPct), paperId, userEmail]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reading record not found. Download or purchase first.' });
    }
    return res.json({ data: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update reading progress.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const paperResult = await db.query('SELECT * FROM research_papers WHERE id = $1', [id]);
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found.' });
    }

    const paper = paperResult.rows[0];
    const researchersResult = await db.query('SELECT * FROM researchers WHERE paper_id = $1 ORDER BY id', [id]);
    return res.json({ paper, researchers: researchersResult.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch research paper.' });
  }
});

module.exports = router;
