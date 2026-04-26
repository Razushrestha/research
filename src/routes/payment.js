const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { verifyKhaltiPayment } = require('../services/khalti');

const router = express.Router();

function generatePidx() {
  return crypto.randomBytes(16).toString('hex');
}

router.post('/initiate/:paperId', async (req, res) => {
  try {
    const { paperId } = req.params;
    const buyerEmail = String(req.body.buyer_email || '').trim();

    if (!buyerEmail) {
      return res.status(400).json({ error: 'buyer_email is required.' });
    }

    const paperResult = await db.query(
      'SELECT id, type, price, payment_status FROM research_papers WHERE id = $1',
      [paperId]
    );

    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found.' });
    }

    const paper = paperResult.rows[0];
    if (paper.type !== 'paid') {
      return res.status(400).json({ error: 'Payment is only required for paid papers.' });
    }

    if (paper.payment_status === 'completed') {
      return res.status(409).json({ error: 'Payment is already completed for this paper.' });
    }

    const pidx = generatePidx();
    const paymentResult = await db.query(
      `INSERT INTO payments (paper_id, buyer_email, amount, khalti_pidx, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [paper.id, buyerEmail, paper.price, pidx]
    );

    const returnUrl = process.env.KHALTI_RETURN_URL || 'http://localhost:4000/payment/verify';
    const paymentUrl = `${returnUrl}?pidx=${encodeURIComponent(pidx)}`;

    return res.status(201).json({
      message: 'Payment initiated.',
      payment: paymentResult.rows[0],
      payment_url: paymentUrl,
      pidx,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to initiate payment.' });
  }
});

router.get('/verify', async (req, res) => {
  try {
    const { pidx, token } = req.query;
    if (!pidx) {
      return res.status(400).json({ error: 'pidx is required.' });
    }

    const paymentResult = await db.query(
      `SELECT p.*, r.type, r.price, r.payment_status, r.status AS paper_status
       FROM payments p
       JOIN research_papers r ON p.paper_id = r.id
       WHERE p.khalti_pidx = $1`,
      [pidx]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment record not found.' });
    }

    const payment = paymentResult.rows[0];
    if (payment.status === 'completed') {
      return res.json({ message: 'Payment already completed.', payment });
    }

    if (!token) {
      return res.json({ message: 'Payment status retrieved.', payment });
    }

    if (!process.env.KHALTI_SECRET_KEY) {
      return res.status(500).json({ error: 'KHALTI_SECRET_KEY is not configured.' });
    }

    const { ok, body } = await verifyKhaltiPayment({
      token: String(token),
      amount: payment.amount,
      secretKey: process.env.KHALTI_SECRET_KEY,
    });

    if (!ok) {
      await db.query('UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', payment.id]);
      await db.query(
        'UPDATE research_papers SET payment_status = $1, status = $2, updated_at = NOW() WHERE id = $3',
        ['failed', 'pending', payment.paper_id]
      );
      return res.status(402).json({ error: 'Khalti payment verification failed.', details: body });
    }

    const txnId = body.transaction?.idx || null;
    await db.query('UPDATE payments SET status = $1, khalti_txn_id = $2, updated_at = NOW() WHERE id = $3', [
      'completed',
      txnId,
      payment.id,
    ]);
    await db.query(
      'UPDATE research_papers SET payment_status = $1, status = $2, khalti_pidx = $3, updated_at = NOW() WHERE id = $4',
      ['completed', 'active', pidx, payment.paper_id]
    );

    return res.json({
      message: 'Payment verified and paper activated.',
      payment: { ...payment, status: 'completed', khalti_txn_id: txnId },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to verify payment.' });
  }
});

router.get('/status/:paperId', async (req, res) => {
  try {
    const { paperId } = req.params;
    const paperResult = await db.query('SELECT * FROM research_papers WHERE id = $1', [paperId]);
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found.' });
    }

    return res.json({ paper: paperResult.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch payment status.' });
  }
});

module.exports = router;
