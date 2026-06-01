const { query }  = require('../config/db');
const { ok, created, notFound, forbidden, conflict, serverError } = require('../utils/response');

// ════════════════════════════════════════
//  USERS
// ════════════════════════════════════════
exports.getMe = async (req, res) => {
  try {
    const { rows: [user] } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const { password_hash, ...safe } = user;
    ok(res, { user: safe });
  } catch (e) { console.error(e); serverError(res); }
};

exports.updateMe = async (req, res) => {
  try {
    const { name, avatar_url } = req.body;
    const updates = []; const values = []; let i = 1;
    if (name)       { updates.push(`name=$${i++}`);       values.push(name); }
    if (avatar_url) { updates.push(`avatar_url=$${i++}`); values.push(avatar_url); }
    if (!updates.length) return ok(res, { message: 'Nothing to update' });
    values.push(req.user.id);
    const { rows: [user] } = await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${i} RETURNING *`, values);
    const { password_hash, ...safe } = user;
    ok(res, { user: safe });
  } catch (e) { console.error(e); serverError(res); }
};

exports.getSellerProfile = async (req, res) => {
  try {
    const { rows: [seller] } = await query(
      `SELECT id,name,avatar_url,avg_rating,review_count,seller_badge,created_at,
              (SELECT COUNT(*) FROM listings WHERE seller_id=users.id AND status='active') AS active_listings,
              (SELECT COUNT(*) FROM orders WHERE seller_id=users.id AND payment_status='paid')   AS total_sales
       FROM users WHERE id=$1 AND role IN ('seller','admin') AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!seller) return notFound(res, 'Seller not found');
    ok(res, { seller });
  } catch (e) { console.error(e); serverError(res); }
};

// ── ADDRESSES ─────────────────────────────────────────────────────────
exports.getAddresses = async (req, res) => {
  const { rows } = await query('SELECT * FROM addresses WHERE user_id=$1 ORDER BY is_default DESC', [req.user.id]);
  ok(res, { addresses: rows });
};

exports.createAddress = async (req, res) => {
  try {
    const { label, line1, line2, city, state, pincode, is_default } = req.body;
    if (is_default) await query('UPDATE addresses SET is_default=false WHERE user_id=$1', [req.user.id]);
    const { rows: [address] } = await query(
      'INSERT INTO addresses(user_id,label,line1,line2,city,state,pincode,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user.id, label||'Home', line1, line2||null, city, state, pincode, is_default||false]
    );
    created(res, { address });
  } catch (e) { console.error(e); serverError(res); }
};

// ════════════════════════════════════════
//  CART
// ════════════════════════════════════════
exports.getCart = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.*, l.name, l.price, l.images[1] AS image, l.stock, l.status, l.seller_id,
              u.name AS seller_name
       FROM cart_items c
       JOIN listings l ON l.id = c.listing_id
       JOIN users    u ON u.id = l.seller_id
       WHERE c.user_id = $1`,
      [req.user.id]
    );
    const total = rows.reduce((s, i) => s + (i.price * i.quantity), 0);
    ok(res, { items: rows, total, count: rows.length });
  } catch (e) { console.error(e); serverError(res); }
};

exports.addToCart = async (req, res) => {
  try {
    const { listing_id, quantity = 1 } = req.body;
    const { rows: [listing] } = await query("SELECT * FROM listings WHERE id=$1 AND status='active'", [listing_id]);
    if (!listing) return notFound(res, 'Listing not found or unavailable');
    if (listing.seller_id === req.user.id) return forbidden(res, 'You cannot buy your own listing');

    const existing = await query('SELECT * FROM cart_items WHERE user_id=$1 AND listing_id=$2', [req.user.id, listing_id]);
    if (existing.rowCount > 0) {
      await query('UPDATE cart_items SET quantity=quantity+$1 WHERE user_id=$2 AND listing_id=$3', [quantity, req.user.id, listing_id]);
    } else {
      await query('INSERT INTO cart_items(user_id,listing_id,quantity) VALUES($1,$2,$3)', [req.user.id, listing_id, quantity]);
    }
    ok(res, { message: 'Added to cart' });
  } catch (e) { console.error(e); serverError(res); }
};

exports.removeFromCart = async (req, res) => {
  try {
    await query('DELETE FROM cart_items WHERE user_id=$1 AND listing_id=$2', [req.user.id, req.params.listing_id]);
    ok(res, { message: 'Removed from cart' });
  } catch (e) { console.error(e); serverError(res); }
};

exports.clearCart = async (req, res) => {
  try {
    await query('DELETE FROM cart_items WHERE user_id=$1', [req.user.id]);
    ok(res, { message: 'Cart cleared' });
  } catch (e) { console.error(e); serverError(res); }
};

// ════════════════════════════════════════
//  WISHLIST
// ════════════════════════════════════════
exports.getWishlist = async (req, res) => {
  const { rows } = await query(
    `SELECT w.*, l.name, l.price, l.images[1] AS image, l.status, l.rarity
     FROM wishlists w JOIN listings l ON l.id = w.listing_id
     WHERE w.user_id = $1 ORDER BY w.created_at DESC`,
    [req.user.id]
  );
  ok(res, { items: rows });
};

exports.toggleWishlist = async (req, res) => {
  try {
    const { listing_id } = req.body;
    const { rowCount } = await query('SELECT 1 FROM wishlists WHERE user_id=$1 AND listing_id=$2', [req.user.id, listing_id]);
    if (rowCount > 0) {
      await query('DELETE FROM wishlists WHERE user_id=$1 AND listing_id=$2', [req.user.id, listing_id]);
      ok(res, { saved: false });
    } else {
      await query('INSERT INTO wishlists(user_id,listing_id) VALUES($1,$2)', [req.user.id, listing_id]);
      ok(res, { saved: true });
    }
  } catch (e) { console.error(e); serverError(res); }
};

// ════════════════════════════════════════
//  REVIEWS
// ════════════════════════════════════════
exports.createReview = async (req, res) => {
  try {
    const { order_id, rating, comment } = req.body;
    const { rows: [order] } = await query('SELECT * FROM orders WHERE id=$1', [order_id]);
    if (!order) return notFound(res, 'Order not found');

    const isBuyer  = order.buyer_id  === req.user.id;
    const isSeller = order.seller_id === req.user.id;
    if (!isBuyer && !isSeller) return forbidden(res);
    if (order.payment_status !== 'paid') return forbidden(res, 'Cannot review unpaid order');

    const role      = isBuyer ? 'buyer_to_seller' : 'seller_to_buyer';
    const target_id = isBuyer ? order.seller_id    : order.buyer_id;

    const { rows: [review] } = await query(
      'INSERT INTO reviews(order_id,author_id,target_id,role,rating,comment) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [order_id, req.user.id, target_id, role, rating, comment || null]
    );

    // Update target avg_rating
    await query(
      `UPDATE users SET
         avg_rating   = (SELECT AVG(rating)::NUMERIC(3,2) FROM reviews WHERE target_id=$1),
         review_count = (SELECT COUNT(*)                  FROM reviews WHERE target_id=$1)
       WHERE id=$1`,
      [target_id]
    );
    created(res, { review });
  } catch (e) {
    if (e.code === '23505') return conflict(res, 'You have already reviewed this order');
    console.error(e); serverError(res);
  }
};

exports.getSellerReviews = async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, u.name AS author_name, u.avatar_url AS author_avatar
     FROM reviews r JOIN users u ON u.id = r.author_id
     WHERE r.target_id=$1 AND r.role='buyer_to_seller' ORDER BY r.created_at DESC`,
    [req.params.id]
  );
  ok(res, { reviews: rows });
};

// ════════════════════════════════════════
//  ADMIN
// ════════════════════════════════════════
exports.adminDashboard = async (req, res) => {
  try {
    const [gmv, listings, users, pending] = await Promise.all([
      query("SELECT COALESCE(SUM(amount_paise),0) AS total FROM orders WHERE payment_status='paid'"),
      query("SELECT COUNT(*) FROM listings WHERE status='active'"),
      query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL"),
      query("SELECT COUNT(*) FROM listings WHERE status='pending'"),
    ]);
    ok(res, {
      gmv_paise:        Number(gmv.rows[0].total),
      active_listings:  Number(listings.rows[0].count),
      total_users:      Number(users.rows[0].count),
      pending_listings: Number(pending.rows[0].count),
    });
  } catch (e) { console.error(e); serverError(res); }
};

exports.adminGetListings = async (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const { rows } = await query(
    `SELECT l.*, u.name AS seller_name, u.email AS seller_email
     FROM listings l JOIN users u ON u.id=l.seller_id
     WHERE l.status=$1 ORDER BY l.created_at ASC LIMIT $2 OFFSET $3`,
    [status, Number(limit), offset]
  );
  ok(res, { listings: rows });
};

exports.adminModerateListing = async (req, res) => {
  try {
    const { action, reason } = req.body; // action: 'approve' | 'reject'
    if (!['approve','reject'].includes(action)) return serverError(res);
    const newStatus = action === 'approve' ? 'active' : 'rejected';
    const { rows: [listing] } = await query(
      "UPDATE listings SET status=$1 WHERE id=$2 AND status='pending' RETURNING *",
      [newStatus, req.params.id]
    );
    if (!listing) return notFound(res, 'Listing not found or already moderated');
    ok(res, { listing, message: `Listing ${newStatus}` });
  } catch (e) { console.error(e); serverError(res); }
};

exports.adminGetUsers = async (req, res) => {
  const { role, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const whereRole = role ? `WHERE role='${role}'` : '';
  const { rows } = await query(
    `SELECT id,name,email,phone,role,is_verified,seller_badge,avg_rating,created_at
     FROM users ${whereRole} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [Number(limit), offset]
  );
  ok(res, { users: rows });
};

exports.adminToggleSeller = async (req, res) => {
  try {
    const { rows: [user] } = await query(
      'UPDATE users SET seller_badge = NOT seller_badge WHERE id=$1 RETURNING id,seller_badge',
      [req.params.id]
    );
    if (!user) return notFound(res, 'User not found');
    ok(res, { user });
  } catch (e) { console.error(e); serverError(res); }
};
