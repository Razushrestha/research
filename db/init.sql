CREATE TABLE IF NOT EXISTS research_papers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('free', 'paid')),
  price INTEGER DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  khalti_pidx VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS researchers (
  id SERIAL PRIMARY KEY,
  paper_id INTEGER NOT NULL REFERENCES research_papers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  profile_pdf_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  paper_id INTEGER NOT NULL REFERENCES research_papers(id) ON DELETE CASCADE,
  buyer_email VARCHAR(255) NOT NULL,
  amount INTEGER NOT NULL,
  khalti_pidx VARCHAR(255) UNIQUE NOT NULL,
  khalti_txn_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) UNIQUE NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL,
  amount INTEGER NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
  source VARCHAR(30) NOT NULL CHECK (source IN ('paper_purchase', 'admin_share', 'manual_adjustment')),
  paper_id INTEGER REFERENCES research_papers(id) ON DELETE SET NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_access (
  id SERIAL PRIMARY KEY,
  paper_id INTEGER NOT NULL REFERENCES research_papers(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL,
  access_type VARCHAR(20) NOT NULL CHECK (access_type IN ('download', 'purchase')),
  last_read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (paper_id, user_email)
);
