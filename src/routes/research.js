const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { parseResearcherNames, toNonNegativeInteger } = require('../utils/validation');

const router = express.Router();
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
const uploadPath = path.join(__dirname, '..', '..', uploadDir);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadPath);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
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
