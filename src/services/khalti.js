const KHALTI_VERIFY_URL = 'https://khalti.com/api/v2/payment/verify/';

async function verifyKhaltiPayment({ token, amount, secretKey }) {
  if (!token || amount == null || !secretKey) {
    throw new Error('Khalti token, amount, and secret key are required for verification.');
  }

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available. Node 18+ is required.');
  }

  const response = await fetch(KHALTI_VERIFY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Key ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, amount }),
  });

  const body = await response.json();
  return { ok: response.ok, body };
}

module.exports = { verifyKhaltiPayment };
