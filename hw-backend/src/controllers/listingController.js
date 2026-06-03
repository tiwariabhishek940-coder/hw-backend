const { query }  = require('../config/db');
const redis      = require('../config/redis');
const { deleteImage } = require('../config/cloudinary');
const { ok, created, notFound, forbidden, serverError } = require('../utils/response');

const CACHE_TTL = 300;
const cacheKey = (params) => `listings:${JSON.stringify(params)}`;
const invalidateListingCache = async () => {
  const keys = await redis.keys('listings:*');
  if (keys.length) await redis.del(...keys);
};

// ── GET /listings ────────────────────────────────────────────────────
exports.getListings = async (req, res) => {
  try {
    const { series, rarity, condition, minPrice, maxPrice, q, featured,
            sort = 'newest', page = 1, limit = 20 } = req.query;

    const ck = cacheKey(req.query);
    const cached = await redis.get(ck);
    if (cached) return ok(res, JSON.parse(cached));

    const conditions = ["l.status = 'active'"];
    const values = [];
    let i = 1;

    if (series)   { conditions.push(`l.series = $${i++}`);    values.push(series); }
    if (rarity)   { conditions.push(`l.rarity = $${i++}`);    values.push(rarity); }
    if (condition){ conditions.push(`l.condition = $${i++}`); values.push(condition); }
    if (minPrice) { conditions.push(`l.price >= $${i++}`);    values.push(Number(minPrice)); }
    if (maxPrice) { conditions.push(`l.price <= $${i++}`);    values.push(Number(maxPrice)); }
    if (q)        { conditions.push(`to_tsvector('english', l.name || ' ' || l.series) @@ plainto_tsquery('english', $${i++})`); values.push(q); }
    if (featured === 'true') { conditions.push(`l.featured = true`); }

    const where   = conditions.join(' AND ');
    const orderBy = sort === 'price_asc' ? 'l.price ASC'
      : sort === 'price_desc' ? 'l.price DESC'
      : sort === 'rarity' ? "CASE l.rarity WHEN 'Super Treasure Hunt' THEN 1 WHEN 'Treasure Hunt' THEN 2 WHEN 'Premium' THEN 3 WHEN 'Rare' THEN 4 ELSE 5 END"
      : 'l.created_at DESC';
    const offset = (Number(page) - 1) * Number(limit);

    const [listRes, countRes] = await Promise.all([
      query(`SELECT l.*, u.name AS seller_name, u.avg_rating AS seller_rating, u.seller_badge
             FROM listings l JOIN users u ON u.id = l.seller_id
             WHERE ${where} ORDER BY ${orderBy} LIMIT $${i++} OFFSET $${i++}`,
            [...values, Number(limit), offset]),
      query(`SELECT COUNT(*) FROM listings l WHERE ${where}`, values),
    ]);

    const result = {
      listings:   listRes.rows,
      total:      Number(countRes.rows[0].count),
      page:       Number(page),
      totalPages: Math.ceil(Number(countRes.rows[0].count) / Number(limit)),
    };
    await redis.setex(ck, CACHE_TTL, JSON.stringify(result));
    ok(res, result);
  } catch (e) { console.error(e); serverError(res); }
};

// ── GET /listings/:id ────────────────────────────────────────────────
exports.getListing = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT l.*, u.name AS seller_name, u.avg_rating AS seller_rating,
              u.seller_badge, u.review_count AS seller_review_count
       FROM listings l JOIN users u ON u.id = l.seller_id
       WHERE l.id = $1 AND l.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows[0]) return notFound(res, 'Listing not found');
    query('UPDATE listings SET views = views + 1 WHERE id = $1', [req.params.id]).catch(() => {});
    ok(res, { listing: rows[0] });
  } catch (e) { console.error(e); serverError(res); }
};

// ── POST /listings ────────────────────────────────────────────────────
exports.createListing = async (req, res) => {
  try {
    const { name, series, rarity, scale, condition, price, stock, description, year } = req.body;
    const images = req.files?.map(f => f.path) || [];

    const { rows } = await query(
      `INSERT INTO listings(seller_id,name,series,rarity,scale,condition,price,stock,images,description,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, name, series, rarity, scale || '1:64', condition,
       Number(price), Number(stock) || 1, images, description || null, year ? Number(year) : null]
    );
    await invalidateListingCache();
    created(res, { listing: rows[0] });
  } catch (e) { console.error(e); serverError(res); }
};

// ── PATCH /listings/:id ───────────────────────────────────────────────
exports.updateListing = async (req, res) => {
  try {
    const { rows: existing } = await query('SELECT * FROM listings WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!existing[0]) return notFound(res, 'Listing not found');
    if (existing[0].seller_id !== req.user.id && req.user.role !== 'admin') return forbidden(res);

    const fields = ['name','series','rarity','scale','condition','price','stock','description','year','status','featured'];
    const updates = []; const values = [];
    let i = 1;
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = $${i++}`); values.push(req.body[f]); }
    });
    if (!updates.length) return ok(res, { listing: existing[0] });
    values.push(req.params.id);

    const { rows } = await query(
      `UPDATE listings SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    await invalidateListingCache();
    ok(res, { listing: rows[0] });
  } catch (e) { console.error(e); serverError(res); }
};

// ── PATCH /admin/listings/:id/feature ─────────────────────────────────
// Sets this listing as the featured one for its rarity (unfeatures others)
exports.featureListing = async (req, res) => {
  try {
    const { rows: [listing] } = await query(
      "SELECT * FROM listings WHERE id=$1 AND status='active' AND deleted_at IS NULL",
      [req.params.id]
    );
    if (!listing) return notFound(res, 'Listing not found or not active');

    // Unfeature all other listings of the same rarity
    await query(
      "UPDATE listings SET featured=false WHERE rarity=$1 AND id != $2",
      [listing.rarity, req.params.id]
    );
    // Toggle featured on this one
    const newFeatured = !listing.featured;
    const { rows: [updated] } = await query(
      "UPDATE listings SET featured=$1 WHERE id=$2 RETURNING *",
      [newFeatured, req.params.id]
    );
    await invalidateListingCache();
    ok(res, { listing: updated, featured: newFeatured });
  } catch (e) { console.error(e); serverError(res); }
};

// ── DELETE /listings/:id ──────────────────────────────────────────────
exports.deleteListing = async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM listings WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) return notFound(res, 'Listing not found');
    if (rows[0].seller_id !== req.user.id && rows[0].seller_id !== req.user.id && req.user.role !== 'admin') return forbidden(res);

    await query("UPDATE listings SET status='deleted', deleted_at=now() WHERE id=$1", [req.params.id]);
    rows[0].images.forEach(url => {
      const pid = url.split('/').slice(-1)[0].split('.')[0];
      deleteImage(`hw-shop/listings/${rows[0].seller_id}/${pid}`).catch(() => {});
    });
    await invalidateListingCache();
    ok(res, { message: 'Listing deleted' });
  } catch (e) { console.error(e); serverError(res); }
};

// ── GET /sellers/:id/listings ─────────────────────────────────────────
exports.getSellerListings = async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM listings WHERE seller_id=$1 AND status='active' AND deleted_at IS NULL ORDER BY created_at DESC",
      [req.params.id]
    );
    ok(res, { listings: rows });
  } catch (e) { console.error(e); serverError(res); }
};
