-- ============================================================
--  Migration: Sinyal sistemi için yeni kolonlar ve tablo
--  schema.sql'e ek olarak çalıştırılır
-- ============================================================

-- Sinyal geçmişi tablosu
CREATE TABLE IF NOT EXISTS signals (
  id            BIGSERIAL    PRIMARY KEY,
  stock_id      UUID         NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  signal_types  TEXT         NOT NULL,   -- "RSI_OVERSOLD,IFT_OVERSOLD"
  direction     VARCHAR(10)  NOT NULL CHECK (direction IN ('bullish','bearish','neutral')),
  score         INT          NOT NULL DEFAULT 0,
  comment       TEXT,
  scanned_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- scanned_at::date yerine düz bir kolon kullanıyoruz —
  -- Postgres, zaman dilimine bağlı ifadeleri index'e almıyor (IMMUTABLE hatası).
  scan_date     DATE         NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (stock_id, scan_date)
);

CREATE INDEX IF NOT EXISTS idx_signals_stock    ON signals(stock_id);
CREATE INDEX IF NOT EXISTS idx_signals_scanned  ON signals(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_score    ON signals(score DESC);

-- watchlist_items tablosuna sinyal alanları ekle
ALTER TABLE watchlist_items
  ADD COLUMN IF NOT EXISTS auto_comment TEXT,
  ADD COLUMN IF NOT EXISTS signal_id    BIGINT REFERENCES signals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

-- Güncelleme trigger'ı
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wl_items_updated ON watchlist_items;
CREATE TRIGGER trg_wl_items_updated
  BEFORE UPDATE ON watchlist_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();