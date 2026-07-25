-- ============================================================
--  BORSA PRO ANALİTİK — PostgreSQL Şeması
--  Versiyon : 1.0.0
--  Tablolar : users, portfolios, positions, transactions,
--             stocks, price_history, watchlists,
--             watchlist_items, alerts, news, economic_calendar
-- ============================================================

-- Uzantılar
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- hisse arama için

-- ============================================================
-- 1. KULLANICI & HESAP
-- ============================================================

CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100),
  plan          VARCHAR(20)  NOT NULL DEFAULT 'free'   -- free | pro | enterprise
                             CHECK (plan IN ('free','pro','enterprise')),
  avatar_url    TEXT,
  timezone      VARCHAR(50)  NOT NULL DEFAULT 'Europe/Istanbul',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE user_sessions (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255) NOT NULL UNIQUE,
  ip_address    INET,
  user_agent    TEXT,
  expires_at    TIMESTAMPTZ  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user   ON user_sessions(user_id);
CREATE INDEX idx_sessions_token  ON user_sessions(token_hash);

-- ============================================================
-- 2. HİSSE SENETLERİ
-- ============================================================

CREATE TABLE stocks (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol        VARCHAR(20)  NOT NULL UNIQUE,   -- THYAO, GARAN …
  name          VARCHAR(255) NOT NULL,
  exchange      VARCHAR(20)  NOT NULL DEFAULT 'BIST',  -- BIST | NASDAQ | NYSE …
  sector        VARCHAR(100),
  industry      VARCHAR(100),
  currency      CHAR(3)      NOT NULL DEFAULT 'TRY',
  market_cap    NUMERIC(20,2),
  shares_out    BIGINT,                          -- dolaşımdaki hisse
  isin          CHAR(12) UNIQUE,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stocks_symbol   ON stocks(symbol);
CREATE INDEX idx_stocks_exchange ON stocks(exchange);
CREATE INDEX idx_stocks_name_trgm ON stocks USING GIN (name gin_trgm_ops);

-- Günlük ve anlık fiyat geçmişi
CREATE TABLE price_history (
  id            BIGSERIAL    PRIMARY KEY,
  stock_id      UUID         NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  price_date    DATE         NOT NULL,
  open          NUMERIC(14,4) NOT NULL,
  high          NUMERIC(14,4) NOT NULL,
  low           NUMERIC(14,4) NOT NULL,
  close         NUMERIC(14,4) NOT NULL,
  adj_close     NUMERIC(14,4),
  volume        BIGINT,
  UNIQUE (stock_id, price_date)
);

CREATE INDEX idx_price_stock_date ON price_history(stock_id, price_date DESC);

-- Anlık fiyat (en son tick)
CREATE TABLE stock_quotes (
  stock_id      UUID         PRIMARY KEY REFERENCES stocks(id) ON DELETE CASCADE,
  price         NUMERIC(14,4) NOT NULL,
  change_abs    NUMERIC(14,4),
  change_pct    NUMERIC(8,4),
  bid           NUMERIC(14,4),
  ask           NUMERIC(14,4),
  day_high      NUMERIC(14,4),
  day_low       NUMERIC(14,4),
  volume        BIGINT,
  quoted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. PORTFÖY & POZİSYONLAR
-- ============================================================

CREATE TABLE portfolios (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  currency      CHAR(3)      NOT NULL DEFAULT 'TRY',
  is_default    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portfolios_user ON portfolios(user_id);

-- Her portföyde en fazla 1 varsayılan
CREATE UNIQUE INDEX idx_portfolio_default
  ON portfolios(user_id)
  WHERE is_default = TRUE;

CREATE TABLE positions (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  portfolio_id    UUID          NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  stock_id        UUID          NOT NULL REFERENCES stocks(id),
  quantity        NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  avg_cost        NUMERIC(14,4) NOT NULL,      -- ortalama maliyet
  current_price   NUMERIC(14,4),               -- son fiyat (cache)
  realized_pnl    NUMERIC(14,4) NOT NULL DEFAULT 0,
  opened_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, stock_id)
);

CREATE INDEX idx_positions_portfolio ON positions(portfolio_id);
CREATE INDEX idx_positions_stock     ON positions(stock_id);

-- ============================================================
-- 4. İŞLEM GEÇMİŞİ
-- ============================================================

CREATE TABLE transactions (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  portfolio_id    UUID          NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  stock_id        UUID          NOT NULL REFERENCES stocks(id),
  type            VARCHAR(10)   NOT NULL CHECK (type IN ('buy','sell','dividend','split')),
  quantity        NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  price           NUMERIC(14,4) NOT NULL,
  commission      NUMERIC(10,4) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(16,4) GENERATED ALWAYS AS (quantity * price + commission) STORED,
  notes           TEXT,
  executed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_portfolio   ON transactions(portfolio_id);
CREATE INDEX idx_tx_stock       ON transactions(stock_id);
CREATE INDEX idx_tx_executed    ON transactions(executed_at DESC);

-- ============================================================
-- 5. İZLEME LİSTESİ
-- ============================================================

CREATE TABLE watchlists (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_watchlists_user ON watchlists(user_id);

CREATE TABLE watchlist_items (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  watchlist_id UUID        NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  stock_id     UUID        NOT NULL REFERENCES stocks(id),
  sort_order   INT         NOT NULL DEFAULT 0,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (watchlist_id, stock_id)
);

CREATE INDEX idx_wl_items_list  ON watchlist_items(watchlist_id);

-- ============================================================
-- 6. FİYAT UYARILARI
-- ============================================================

CREATE TABLE alerts (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_id      UUID         NOT NULL REFERENCES stocks(id),
  condition     VARCHAR(20)  NOT NULL CHECK (condition IN ('above','below','pct_change')),
  threshold     NUMERIC(14,4) NOT NULL,
  is_triggered  BOOLEAN      NOT NULL DEFAULT FALSE,
  triggered_at  TIMESTAMPTZ,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_user    ON alerts(user_id);
CREATE INDEX idx_alerts_stock   ON alerts(stock_id) WHERE is_active = TRUE;

-- ============================================================
-- 7. HABERLER
-- ============================================================

CREATE TABLE news (
  id            BIGSERIAL    PRIMARY KEY,
  title         TEXT         NOT NULL,
  summary       TEXT,
  source        VARCHAR(100),
  url           TEXT,
  published_at  TIMESTAMPTZ  NOT NULL,
  sentiment     VARCHAR(10)  CHECK (sentiment IN ('positive','negative','neutral')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_news_published ON news(published_at DESC);

-- Haber ↔ hisse ilişkisi (bir haber birden fazla hisseyle ilişkili olabilir)
CREATE TABLE news_stocks (
  news_id   BIGINT NOT NULL REFERENCES news(id)    ON DELETE CASCADE,
  stock_id  UUID   NOT NULL REFERENCES stocks(id)  ON DELETE CASCADE,
  PRIMARY KEY (news_id, stock_id)
);

-- ============================================================
-- 8. EKONOMİK TAKVİM
-- ============================================================

CREATE TABLE economic_calendar (
  id            BIGSERIAL    PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  country       CHAR(2)      NOT NULL DEFAULT 'TR',
  category      VARCHAR(50),                       -- inflation, gdp, interest_rate …
  event_at      TIMESTAMPTZ  NOT NULL,
  actual        NUMERIC(12,4),
  forecast      NUMERIC(12,4),
  previous      NUMERIC(12,4),
  impact        VARCHAR(10)  CHECK (impact IN ('low','medium','high')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_econ_event_at ON economic_calendar(event_at DESC);

-- ============================================================
-- 9. OTOMATİK updated_at TETİKLEYİCİ
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated      BEFORE UPDATE ON users      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_stocks_updated     BEFORE UPDATE ON stocks     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_portfolios_updated BEFORE UPDATE ON portfolios FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_positions_updated  BEFORE UPDATE ON positions  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 10. ÖRNEK SEED VERİSİ (opsiyonel)
-- ============================================================

INSERT INTO stocks (symbol, name, exchange, sector, currency) VALUES
  ('THYAO', 'Türk Hava Yolları',         'BIST', 'Ulaşım',   'TRY'),
  ('GARAN', 'Garanti Bankası',            'BIST', 'Finans',   'TRY'),
  ('ASELS', 'Aselsan',                    'BIST', 'Savunma',  'TRY'),
  ('EREGL', 'Ereğli Demir Çelik',         'BIST', 'Metal',    'TRY'),
  ('KCHOL', 'Koç Holding',                'BIST', 'Holding',  'TRY'),
  ('SISE',  'Şişe Cam',                   'BIST', 'Cam',      'TRY'),
  ('AKBNK', 'Akbank',                     'BIST', 'Finans',   'TRY'),
  ('BIMAS', 'BİM Mağazaları',             'BIST', 'Perakende','TRY'),
  ('TCELL', 'Turkcell',                   'BIST', 'Telekom',  'TRY'),
  ('FROTO', 'Ford Otosan',                'BIST', 'Otomotiv', 'TRY')
ON CONFLICT (symbol) DO NOTHING;
