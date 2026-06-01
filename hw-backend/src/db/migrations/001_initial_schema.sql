-- ============================================================
-- Hot Wheels Shop India — Full Schema Migration
-- Run: node src/db/migrate.js
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUMS ───────────────────────────────────────────────────
CREATE TYPE user_role       AS ENUM ('buyer','seller','admin');
CREATE TYPE rarity_tier     AS ENUM ('Common','Rare','Premium','Treasure Hunt','Super Treasure Hunt');
CREATE TYPE condition_type  AS ENUM ('New (MOC)','Used (Loose)','Damaged');
CREATE TYPE listing_status  AS ENUM ('pending','active','sold','rejected','deleted');
CREATE TYPE payment_status  AS ENUM ('pending','paid','failed','refunded');
CREATE TYPE shipping_status AS ENUM ('pending','dispatched','in_transit','delivered','returned');
CREATE TYPE review_role     AS ENUM ('buyer_to_seller','seller_to_buyer');
CREATE TYPE notif_type      AS ENUM ('order','offer','price_alert','system');

-- ── USERS ───────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(255)  NOT NULL UNIQUE,
  phone           VARCHAR(15)   UNIQUE,
  password_hash   TEXT,
  role            user_role     NOT NULL DEFAULT 'buyer',
  is_verified     BOOLEAN       NOT NULL DEFAULT false,
  seller_badge    BOOLEAN       NOT NULL DEFAULT false,
  avatar_url      TEXT,
  avg_rating      NUMERIC(3,2)  NOT NULL DEFAULT 0.00,
  review_count    INTEGER       NOT NULL DEFAULT 0,
  google_id       VARCHAR(100)  UNIQUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_users_role       ON users(role);
CREATE INDEX idx_users_verified   ON users(is_verified);
CREATE INDEX idx_users_deleted    ON users(deleted_at) WHERE deleted_at IS NULL;

-- ── REFRESH TOKENS ──────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT         NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked     BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash    ON refresh_tokens(token_hash);

-- ── ADDRESSES ───────────────────────────────────────────────
CREATE TABLE addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       VARCHAR(50)   NOT NULL DEFAULT 'Home',
  line1       VARCHAR(255)  NOT NULL,
  line2       VARCHAR(255),
  city        VARCHAR(100)  NOT NULL,
  state       VARCHAR(100)  NOT NULL,
  pincode     VARCHAR(10)   NOT NULL,
  is_default  BOOLEAN       NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_user ON addresses(user_id);

-- ── LISTINGS ────────────────────────────────────────────────
CREATE TABLE listings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(200)    NOT NULL,
  series       VARCHAR(100)    NOT NULL,
  rarity       rarity_tier     NOT NULL,
  scale        VARCHAR(10)     NOT NULL DEFAULT '1:64',
  condition    condition_type  NOT NULL,
  price        INTEGER         NOT NULL CHECK (price > 0),
  stock        SMALLINT        NOT NULL DEFAULT 1 CHECK (stock >= 0),
  images       TEXT[]          NOT NULL DEFAULT '{}',
  description  TEXT,
  year         SMALLINT,
  status       listing_status  NOT NULL DEFAULT 'pending',
  views        INTEGER         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX idx_listings_seller   ON listings(seller_id);
CREATE INDEX idx_listings_rarity   ON listings(rarity);
CREATE INDEX idx_listings_series   ON listings(series);
CREATE INDEX idx_listings_condition ON listings(condition);
CREATE INDEX idx_listings_status   ON listings(status);
CREATE INDEX idx_listings_price    ON listings(price);
CREATE INDEX idx_listings_created  ON listings(created_at DESC);
CREATE INDEX idx_listings_active   ON listings(status) WHERE status = 'active';
-- Full-text search index
CREATE INDEX idx_listings_fts ON listings
  USING GIN (to_tsvector('english', name || ' ' || series));

-- ── ORDERS ──────────────────────────────────────────────────
CREATE TABLE orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id           UUID             NOT NULL REFERENCES users(id),
  seller_id          UUID             NOT NULL REFERENCES users(id),
  listing_id         UUID             NOT NULL REFERENCES listings(id),
  quantity           SMALLINT         NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_paise       INTEGER          NOT NULL CHECK (amount_paise > 0),
  shipping_paise     INTEGER          NOT NULL DEFAULT 0,
  razorpay_order_id  VARCHAR(50)      UNIQUE,
  razorpay_payment_id VARCHAR(50)     UNIQUE,
  payment_status     payment_status   NOT NULL DEFAULT 'pending',
  shipping_status    shipping_status  NOT NULL DEFAULT 'pending',
  tracking_id        VARCHAR(100),
  delivery_address   JSONB            NOT NULL,
  paid_at            TIMESTAMPTZ,
  dispatched_at      TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_buyer        ON orders(buyer_id);
CREATE INDEX idx_orders_seller       ON orders(seller_id);
CREATE INDEX idx_orders_listing      ON orders(listing_id);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_created      ON orders(created_at DESC);

-- ── CART ITEMS ──────────────────────────────────────────────
CREATE TABLE cart_items (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  UUID      NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  quantity    SMALLINT  NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
CREATE INDEX idx_cart_user ON cart_items(user_id);

-- ── WISHLISTS ───────────────────────────────────────────────
CREATE TABLE wishlists (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  UUID        NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
CREATE INDEX idx_wishlist_user ON wishlists(user_id);

-- ── REVIEWS ─────────────────────────────────────────────────
CREATE TABLE reviews (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID        NOT NULL REFERENCES orders(id),
  author_id   UUID        NOT NULL REFERENCES users(id),
  target_id   UUID        NOT NULL REFERENCES users(id),
  role        review_role NOT NULL,
  rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, role)
);
CREATE INDEX idx_reviews_target ON reviews(target_id);
CREATE INDEX idx_reviews_author ON reviews(author_id);

-- ── NOTIFICATIONS ───────────────────────────────────────────
CREATE TABLE notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notif_type  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT         NOT NULL,
  is_read     BOOLEAN      NOT NULL DEFAULT false,
  meta        JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user     ON notifications(user_id);
CREATE INDEX idx_notif_unread   ON notifications(user_id, is_read) WHERE is_read = false;

-- ── PAYOUTS ─────────────────────────────────────────────────
CREATE TABLE payouts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id           UUID        NOT NULL REFERENCES users(id),
  order_id            UUID        NOT NULL REFERENCES orders(id) UNIQUE,
  amount_paise        INTEGER     NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  razorpay_payout_id  VARCHAR(50),
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payouts_seller ON payouts(seller_id);
CREATE INDEX idx_payouts_status ON payouts(status);

-- ── updated_at TRIGGERS ─────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated     BEFORE UPDATE ON users     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_listings_updated  BEFORE UPDATE ON listings  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated    BEFORE UPDATE ON orders    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
