/**
 * In-memory DB for local / Vercel API testing without PostgreSQL.
 * Data is lost on process restart and on each serverless instance (not for production).
 */

function now() {
  return new Date().toISOString();
}

function normalizeSql(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function createMemoryDb() {
  const state = {
    papers: [],
    researchers: [],
    payments: [],
    wallets: [],
    walletTransactions: [],
    paperAccess: [],
    nextPaperId: 1,
    nextResearcherId: 1,
    nextPaymentId: 1,
    nextWalletId: 1,
    nextWalletTransactionId: 1,
    nextPaperAccessId: 1,
  };

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  function restore(snap) {
    const s = JSON.parse(JSON.stringify(snap));
    state.papers = s.papers;
    state.researchers = s.researchers;
    state.payments = s.payments;
    state.wallets = s.wallets;
    state.walletTransactions = s.walletTransactions;
    state.paperAccess = s.paperAccess;
    state.nextPaperId = s.nextPaperId;
    state.nextResearcherId = s.nextResearcherId;
    state.nextPaymentId = s.nextPaymentId;
    state.nextWalletId = s.nextWalletId;
    state.nextWalletTransactionId = s.nextWalletTransactionId;
    state.nextPaperAccessId = s.nextPaperAccessId;
  }

  function query(text, params = []) {
    const sql = normalizeSql(text);

    if (sql === 'SELECT 1') {
      return Promise.resolve({ rows: [{ '?column?': 1 }] });
    }

    if (sql.startsWith('INSERT INTO research_papers')) {
      const [email, title, description, file_url, type, price, st, paySt] = params;
      const p = {
        id: state.nextPaperId++,
        email,
        title,
        description,
        file_url,
        type,
        price: Number(price),
        status: st,
        payment_status: paySt,
        khalti_pidx: null,
        created_at: now(),
        updated_at: now(),
      };
      state.papers.push(p);
      return Promise.resolve({ rows: [{ ...p }] });
    }

    if (sql.startsWith('INSERT INTO researchers')) {
      const [paper_id, name, profile_pdf_url] = params;
      const r = {
        id: state.nextResearcherId++,
        paper_id: Number(paper_id),
        name,
        profile_pdf_url,
        created_at: now(),
      };
      state.researchers.push(r);
      return Promise.resolve({ rows: [{ ...r }] });
    }

    if (sql.includes('SELECT id, type, price, payment_status FROM research_papers WHERE id = $1')) {
      const id = Number(params[0]);
      const rows = state.papers
        .filter((p) => p.id === id)
        .map((p) => ({
          id: p.id,
          type: p.type,
          price: p.price,
          payment_status: p.payment_status,
        }));
      return Promise.resolve({ rows });
    }

    if (
      sql.startsWith('SELECT * FROM research_papers WHERE id = $1') ||
      (sql.includes('SELECT * FROM research_papers WHERE id = $1') && !sql.includes('JOIN'))
    ) {
      const id = Number(params[0]);
      const rows = state.papers.filter((p) => p.id === id).map((p) => ({ ...p }));
      return Promise.resolve({ rows });
    }

    if (sql.includes('FROM researchers WHERE paper_id = $1')) {
      const pid = Number(params[0]);
      const rows = state.researchers
        .filter((r) => r.paper_id === pid)
        .sort((a, b) => a.id - b.id)
        .map((r) => ({ ...r }));
      return Promise.resolve({ rows });
    }

    if (sql.includes('FROM research_papers') && sql.includes('ORDER BY created_at DESC')) {
      const limit = Number(params[params.length - 2]);
      const offset = Number(params[params.length - 1]);
      const rest = params.slice(0, params.length - 2);
      let rows = [...state.papers].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      let i = 0;
      if (sql.includes('ILIKE')) {
        const pat = rest[i++];
        const needle = String(pat).replace(/%/g, '').toLowerCase();
        rows = rows.filter((p) =>
          [p.title, p.description, p.email].some((f) =>
            String(f || '').toLowerCase().includes(needle)
          )
        );
      }
      if (/type = \$\d+/.test(sql)) {
        rows = rows.filter((p) => p.type === rest[i++]);
      }
      if (/status = \$\d+/.test(sql)) {
        rows = rows.filter((p) => p.status === rest[i++]);
      }
      return Promise.resolve({ rows: rows.slice(offset, offset + limit).map((p) => ({ ...p })) });
    }

    if (sql.includes('SELECT * FROM research_papers WHERE email = $1')) {
      const email = params[0];
      const rows = state.papers
        .filter((p) => p.email === email)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((p) => ({ ...p }));
      return Promise.resolve({ rows });
    }

    if (sql.includes('SELECT id, type, title, file_url, status FROM research_papers WHERE id = $1')) {
      const id = Number(params[0]);
      const rows = state.papers
        .filter((p) => p.id === id)
        .map((p) => ({ id: p.id, type: p.type, title: p.title, file_url: p.file_url, status: p.status }));
      return Promise.resolve({ rows });
    }

    if (sql.startsWith('INSERT INTO payments')) {
      const [paper_id, buyer_email, amount, khalti_pidx] = params;
      const pay = {
        id: state.nextPaymentId++,
        paper_id: Number(paper_id),
        buyer_email,
        amount: Number(amount),
        khalti_pidx,
        khalti_txn_id: null,
        status: 'pending',
        created_at: now(),
        updated_at: now(),
      };
      state.payments.push(pay);
      return Promise.resolve({ rows: [{ ...pay }] });
    }

    if (sql.includes("SELECT id FROM payments") && sql.includes("status = 'completed'")) {
      const paperId = Number(params[0]);
      const buyerEmail = String(params[1] || '').toLowerCase();
      const rows = state.payments
        .filter((p) => p.paper_id === paperId && String(p.buyer_email || '').toLowerCase() === buyerEmail && p.status === 'completed')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 1)
        .map((p) => ({ id: p.id }));
      return Promise.resolve({ rows });
    }

    if (sql.includes('FROM payments p') && sql.includes('JOIN research_papers r')) {
      if (sql.includes('WHERE p.paper_id = $1 AND p.buyer_email = $2')) {
        const paperId = Number(params[0]);
        const buyerEmail = String(params[1] || '').toLowerCase();
        const rows = [];
        for (const pay of state.payments) {
          if (pay.paper_id !== paperId || String(pay.buyer_email || '').toLowerCase() !== buyerEmail) continue;
          const paper = state.papers.find((p) => p.id === pay.paper_id);
          if (!paper) continue;
          rows.push({
            ...pay,
            type: paper.type,
            price: paper.price,
            payment_status: paper.payment_status,
            paper_status: paper.status,
          });
        }
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return Promise.resolve({ rows: rows.slice(0, 1) });
      }

      const pidx = params[0];
      const rows = [];
      for (const pay of state.payments) {
        if (pay.khalti_pidx !== pidx) continue;
        const paper = state.papers.find((p) => p.id === pay.paper_id);
        if (!paper) continue;
        rows.push({
          ...pay,
          type: paper.type,
          price: paper.price,
          payment_status: paper.payment_status,
          paper_status: paper.status,
        });
      }
      return Promise.resolve({ rows });
    }

    if (sql.includes('UPDATE research_papers SET payment_status')) {
      if (params.length === 4) {
        const [paySt, st, kidx, paperId] = params;
        const paper = state.papers.find((p) => p.id === Number(paperId));
        if (paper) {
          paper.payment_status = paySt;
          paper.status = st;
          paper.khalti_pidx = kidx;
          paper.updated_at = now();
        }
      } else if (params.length === 3) {
        const [paySt, st, paperId] = params;
        const paper = state.papers.find((p) => p.id === Number(paperId));
        if (paper) {
          paper.payment_status = paySt;
          paper.status = st;
          paper.updated_at = now();
        }
      }
      return Promise.resolve({ rows: [] });
    }

    if (sql.includes('UPDATE payments SET status') && params.length === 3) {
      const [status, txnId, id] = params;
      const pay = state.payments.find((p) => p.id === Number(id));
      if (pay) {
        pay.status = status;
        pay.khalti_txn_id = txnId;
        pay.updated_at = now();
      }
      return Promise.resolve({ rows: [] });
    }

    if (sql.includes('UPDATE payments SET status') && params.length === 2) {
      const [status, id] = params;
      const pay = state.payments.find((p) => p.id === Number(id));
      if (pay) {
        pay.status = status;
        pay.updated_at = now();
      }
      return Promise.resolve({ rows: [] });
    }

    if (sql.startsWith('INSERT INTO wallets')) {
      const userEmail = String(params[0] || '').toLowerCase();
      let wallet = state.wallets.find((w) => w.user_email === userEmail);
      if (!wallet) {
        wallet = {
          id: state.nextWalletId++,
          user_email: userEmail,
          balance: 0,
          created_at: now(),
          updated_at: now(),
        };
        state.wallets.push(wallet);
      }
      return Promise.resolve({
        rows: [{ id: wallet.id, user_email: wallet.user_email, balance: wallet.balance }],
      });
    }

    if (sql.startsWith('UPDATE wallets') && sql.includes('SET balance = balance + $1')) {
      const amount = Number(params[0]);
      const walletId = Number(params[1]);
      const wallet = state.wallets.find((w) => w.id === walletId);
      if (wallet) {
        wallet.balance += amount;
        wallet.updated_at = now();
      }
      return Promise.resolve({ rows: [] });
    }

    if (sql.startsWith('INSERT INTO wallet_transactions')) {
      const [walletId, userEmail, amount, source, paperId, paymentId, note] = params;
      const tx = {
        id: state.nextWalletTransactionId++,
        wallet_id: Number(walletId),
        user_email: String(userEmail || '').toLowerCase(),
        amount: Number(amount),
        direction: 'credit',
        source,
        paper_id: paperId == null ? null : Number(paperId),
        payment_id: paymentId == null ? null : Number(paymentId),
        note: note || null,
        created_at: now(),
      };
      state.walletTransactions.push(tx);
      return Promise.resolve({ rows: [{ ...tx }] });
    }

    if (sql.includes('SELECT id, user_email, balance, created_at, updated_at') && sql.includes('FROM wallets')) {
      const userEmail = String(params[0] || '').toLowerCase();
      const rows = state.wallets
        .filter((w) => w.user_email === userEmail)
        .map((w) => ({ ...w }));
      return Promise.resolve({ rows });
    }

    if (sql.includes('SELECT id, amount, direction, source, paper_id, payment_id, note, created_at') && sql.includes('FROM wallet_transactions')) {
      const walletId = Number(params[0]);
      const rows = state.walletTransactions
        .filter((tx) => tx.wallet_id === walletId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((tx) => ({ ...tx }));
      return Promise.resolve({ rows });
    }

    if (sql.startsWith('INSERT INTO paper_access')) {
      const [paperId, userEmail, accessType] = params;
      const pid = Number(paperId);
      const normalizedEmail = String(userEmail || '').toLowerCase();
      let access = state.paperAccess.find((a) => a.paper_id === pid && a.user_email === normalizedEmail);
      if (!access) {
        access = {
          id: state.nextPaperAccessId++,
          paper_id: pid,
          user_email: normalizedEmail,
          access_type: accessType || 'download',
          last_read_at: now(),
          progress_pct: 0,
          created_at: now(),
          updated_at: now(),
        };
        state.paperAccess.push(access);
      } else {
        access.access_type = accessType || access.access_type;
        access.last_read_at = now();
        access.updated_at = now();
      }
      return Promise.resolve({ rows: [{ ...access }] });
    }

    if (sql.includes('FROM paper_access pa') && sql.includes('JOIN research_papers rp')) {
      const email = String(params[0] || '').toLowerCase();
      const rows = state.paperAccess
        .filter((a) => a.user_email === email)
        .map((a) => {
          const paper = state.papers.find((p) => p.id === a.paper_id);
          if (!paper) return null;
          return {
            paper_id: a.paper_id,
            user_email: a.user_email,
            access_type: a.access_type,
            last_read_at: a.last_read_at,
            progress_pct: a.progress_pct,
            title: paper.title,
            description: paper.description,
            file_url: paper.file_url,
            type: paper.type,
            price: paper.price,
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.last_read_at) - new Date(a.last_read_at));
      return Promise.resolve({ rows });
    }

    if (sql.startsWith('UPDATE paper_access') && sql.includes('RETURNING *')) {
      const [progress, paperId, userEmail] = params;
      const pid = Number(paperId);
      const normalizedEmail = String(userEmail || '').toLowerCase();
      const access = state.paperAccess.find((a) => a.paper_id === pid && a.user_email === normalizedEmail);
      if (!access) {
        return Promise.resolve({ rows: [] });
      }
      access.progress_pct = Number(progress);
      access.last_read_at = now();
      access.updated_at = now();
      return Promise.resolve({ rows: [{ ...access }] });
    }

    if (sql.includes('SELECT email, title FROM research_papers WHERE id = $1')) {
      const paperId = Number(params[0]);
      const rows = state.papers
        .filter((p) => p.id === paperId)
        .map((p) => ({ email: p.email, title: p.title }));
      return Promise.resolve({ rows });
    }

    return Promise.reject(new Error(`Memory DB: unsupported query: ${sql.slice(0, 120)}`));
  }

  function createClient() {
    let tx = null;
    return {
      query(t, p) {
        const s = String(t).trim();
        if (s === 'BEGIN') {
          tx = snapshot();
          return Promise.resolve({ rows: [] });
        }
        if (s === 'ROLLBACK') {
          if (tx) restore(tx);
          tx = null;
          return Promise.resolve({ rows: [] });
        }
        if (s === 'COMMIT') {
          tx = null;
          return Promise.resolve({ rows: [] });
        }
        return query(t, p);
      },
      release() {},
    };
  }

  return {
    query,
    pool: {
      connect() {
        return Promise.resolve(createClient());
      },
    },
  };
}

module.exports = { createMemoryDb };
