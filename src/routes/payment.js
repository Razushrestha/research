const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { verifyKhaltiPayment } = require('../services/khalti');

const router = express.Router();
const PLATFORM_ADMIN_EMAIL = String(process.env.PLATFORM_ADMIN_EMAIL || 'admin@platform.local').trim().toLowerCase();

function generatePidx() {
  return crypto.randomBytes(16).toString('hex');
}

async function ensureWallet(client, userEmail) {
  const walletResult = await client.query(
    `INSERT INTO wallets (user_email, balance)
     VALUES ($1, 0)
     ON CONFLICT (user_email) DO UPDATE SET user_email = EXCLUDED.user_email
     RETURNING id, user_email, balance`,
    [String(userEmail).trim().toLowerCase()]
  );
  return walletResult.rows[0];
}

async function creditWallet({
  client,
  userEmail,
  amount,
  source,
  paperId = null,
  paymentId = null,
  note = null,
}) {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('Wallet credit amount must be a non-negative integer.');
  }
  const wallet = await ensureWallet(client, userEmail);
  await client.query(
    `UPDATE wallets
     SET balance = balance + $1, updated_at = NOW()
     WHERE id = $2`,
    [amount, wallet.id]
  );
  await client.query(
    `INSERT INTO wallet_transactions (wallet_id, user_email, amount, direction, source, paper_id, payment_id, note)
     VALUES ($1, $2, $3, 'credit', $4, $5, $6, $7)`,
    [wallet.id, wallet.user_email, amount, source, paperId, paymentId, note]
  );
}

async function settleCompletedPayment({ client, payment, pidx, txnId }) {
  await client.query('UPDATE payments SET status = $1, khalti_txn_id = $2, updated_at = NOW() WHERE id = $3', [
    'completed',
    txnId,
    payment.id,
  ]);
  await client.query(
    'UPDATE research_papers SET payment_status = $1, status = $2, khalti_pidx = $3, updated_at = NOW() WHERE id = $4',
    ['completed', 'active', pidx, payment.paper_id]
  );

  const paperOwnerResult = await client.query('SELECT email, title FROM research_papers WHERE id = $1', [payment.paper_id]);
  const paperOwner = paperOwnerResult.rows[0];
  const innovatorEmail = String(paperOwner?.email || '').trim().toLowerCase();
  if (!innovatorEmail) {
    throw new Error('Paper uploader email is required for innovator wallet split.');
  }

  const innovatorShare = Math.floor(Number(payment.amount) * 0.4);
  const adminShare = Number(payment.amount) - innovatorShare;

  await creditWallet({
    client,
    userEmail: innovatorEmail,
    amount: innovatorShare,
    source: 'paper_purchase',
    paperId: payment.paper_id,
    paymentId: payment.id,
    note: `40% innovator share for paper "${paperOwner.title || payment.paper_id}".`,
  });

  await creditWallet({
    client,
    userEmail: PLATFORM_ADMIN_EMAIL,
    amount: adminShare,
    source: 'admin_share',
    paperId: payment.paper_id,
    paymentId: payment.id,
    note: `60% platform share for paid paper ${payment.paper_id}.`,
  });

  await client.query(
    `INSERT INTO paper_access (paper_id, user_email, access_type, last_read_at, progress_pct, updated_at)
     VALUES ($1, $2, 'purchase', NOW(), 0, NOW())
     ON CONFLICT (paper_id, user_email)
     DO UPDATE SET access_type = EXCLUDED.access_type, last_read_at = NOW(), updated_at = NOW()`,
    [payment.paper_id, String(payment.buyer_email).trim().toLowerCase()]
  );

  return {
    innovator_email: innovatorEmail,
    innovator_share: innovatorShare,
    platform_admin_email: PLATFORM_ADMIN_EMAIL,
    platform_share: adminShare,
  };
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
  let client;
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

    client = await db.pool.connect();
    await client.query('BEGIN');

    const txnId = body.transaction?.idx || null;
    const settlement = await settleCompletedPayment({ client, payment, pidx, txnId });

    await client.query('COMMIT');

    return res.json({
      message: 'Payment verified and paper activated.',
      payment: { ...payment, status: 'completed', khalti_txn_id: txnId },
      settlement,
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error(error);
    return res.status(500).json({ error: 'Failed to verify payment.' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.post('/mock-success/:paperId', async (req, res) => {
  let client;
  try {
    const paperId = Number(req.params.paperId);
    const buyerEmail = String(req.body.buyer_email || '').trim().toLowerCase();
    if (!buyerEmail) {
      return res.status(400).json({ error: 'buyer_email is required.' });
    }

    const paymentResult = await db.query(
      `SELECT p.*, r.type, r.price, r.payment_status, r.status AS paper_status
       FROM payments p
       JOIN research_papers r ON p.paper_id = r.id
       WHERE p.paper_id = $1 AND p.buyer_email = $2
       ORDER BY p.created_at DESC LIMIT 1`,
      [paperId, buyerEmail]
    );
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No payment found for this buyer and paper. Initiate payment first.',
      });
    }

    const payment = paymentResult.rows[0];
    if (payment.type !== 'paid') {
      return res.status(400).json({ error: 'Mock success is only valid for paid papers.' });
    }
    if (payment.status === 'completed') {
      return res.json({ message: 'Payment already completed.', payment });
    }

    const pidx = payment.khalti_pidx || generatePidx();
    const txnId = `mock-${generatePidx().slice(0, 12)}`;

    client = await db.pool.connect();
    await client.query('BEGIN');
    const settlement = await settleCompletedPayment({ client, payment, pidx, txnId });
    await client.query('COMMIT');

    return res.json({
      message: 'Mock payment completed and settlement applied.',
      payment: { ...payment, status: 'completed', khalti_txn_id: txnId, khalti_pidx: pidx },
      settlement,
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error(error);
    return res.status(500).json({ error: 'Failed to complete mock payment.' });
  } finally {
    if (client) {
      client.release();
    }
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

router.get('/wallet/:email', async (req, res) => {
  try {
    const email = String(req.params.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'email is required.' });
    }

    const walletResult = await db.query(
      `SELECT id, user_email, balance, created_at, updated_at
       FROM wallets
       WHERE user_email = $1`,
      [email]
    );

    if (walletResult.rows.length === 0) {
      return res.json({
        wallet: { user_email: email, balance: 0 },
        transactions: [],
      });
    }

    const wallet = walletResult.rows[0];
    const transactionsResult = await db.query(
      `SELECT id, amount, direction, source, paper_id, payment_id, note, created_at
       FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at DESC`,
      [wallet.id]
    );

    return res.json({
      wallet,
      transactions: transactionsResult.rows,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch wallet.' });
  }
});

module.exports = router;
