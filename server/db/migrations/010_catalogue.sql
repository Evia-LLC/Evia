-- The shelf: products she can actually point to.
--
-- Separate from `products`, which is the user's own routine (things they
-- typed in or scanned a label from). This is the operator's catalogue - the
-- shop behind the app - read from the storefront or imported, with prices and
-- links, so a recommendation can end in something to buy rather than in an
-- ingredient to go and look for.
CREATE TABLE catalogue_products (
  id               TEXT PRIMARY KEY,
  source           TEXT NOT NULL,            -- shopify | woocommerce | import | manual
  external_id      TEXT,
  sku              TEXT,
  name             TEXT NOT NULL,
  brand            TEXT,
  category         TEXT,
  description      TEXT NOT NULL DEFAULT '',
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  tags_json        TEXT NOT NULL DEFAULT '[]',
  price_cents      INTEGER,
  currency         TEXT NOT NULL DEFAULT 'USD',
  url              TEXT NOT NULL,
  image_url        TEXT,
  in_stock         INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX idx_catalogue_name ON catalogue_products(name);

-- One row per sync, so "when did the shelf last change" has an answer.
CREATE TABLE catalogue_syncs (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  store_url   TEXT,
  imported    INTEGER NOT NULL DEFAULT 0,
  removed     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
