const Razorpay = require('razorpay');
const crypto   = require('crypto');
const { query, getClient } = require('../config/db');
const { ok, created, err, notFound, forbidden, serverError } = require('../utils/response');
const { sendOrderConfirmation } = require('../services/emailService');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── POST /orders ──────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { listing_id, quantity = 1, address_id } = req.body;

    // Lock the listing row to prevent race conditions
    const { rows: [listing] } = await client.query(
      'SELECT * FROM listings WHERE id=$1 AND status=$2 FOR UPDATE',
      [listing_id, 'active']
    );
    if (!listing) return notFound(res, 'Listing not found or no longer available');
    if (listing.stock < quantity) return err(res, 'Insufficient stock', 'STOCK_UNAVAILABLE', 409);

    // Get delivery address
    const { rows: [address] } = await client.query(
      'SELECT * FROM addresses WHERE id=$1 AND user_id=$2', [address_id, req.user.id]
    );
    if (!address) return notFound(res, 'Address not found');

    const amount_paise = listing.price * quantity;

    // Create Razorpay order
    const rzpOrder = await razorpay.orders.create({
      amount:   amount_paise,
      currency: 'INR',
      receipt:  `hw_${Date.now()}`,
    });

    // Reserve stock
    await client.query('UPDATE listings SET stock = stock - $1 WHERE id = $2', [quantity, listing_id]);

    // Create DB order
    const { rows: [order] } = await client.query(
      `INSERT INTO orders(buyer_id,seller_id,listing_id,quantity,amount_paise,razorpay_order_id,delivery_address)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, listing.seller_id, listing_id, quantity, amount_paise, rzpOrder.id, JSON.stringify(address)]
    );

    await client.query('COMMIT');
    created(res, { order, razorpay_order_id: rzpOrder.id, amount_paise, key_id: process.env.RAZORPAY_KEY_ID });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); serverError(res);
  } finally {
    client.release();
  }
};

// ── POST /orders/verify-payment ───────────────────────────────────────
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature)
      return err(res, 'Invalid payment signature', 'PAYMENT_FAILED', 402);

    const { rows: [order] } = await query(
      `UPDATE orders SET payment_status='paid', razorpay_payment_id=$1, paid_at=now()
       WHERE razorpay_order_id=$2 AND payment_status='pending' RETURNING *`,
      [razorpay_payment_id, razorpay_order_id]
    );
    if (!order) return notFound(res, 'Order not found');

    // Mark listing as sold if stock is now 0
    await query(
      "UPDATE listings SET status='sold' WHERE id=$1 AND stock=0", [order.listing_id]
    );

    // Create payout record for seller
    await query(
      'INSERT INTO payouts(seller_id, order_id, amount_paise) VALUES($1,$2,$3)',
      [order.seller_id, order.id, Math.floor(order.amount_paise * 0.95)]   // 5% platform fee
    );

    // Send confirmation emails async
    sendOrderConfirmation(order).catch(console.error);

    ok(res, { order, message: 'Payment verified successfully' });
  } catch (e) { console.error(e); serverError(res); }
};

// ── POST /webhooks/razorpay ───────────────────────────────────────────
exports.razorpayWebhook = (req, res) => {
  const sig  = req.headers['x-razorpay-signature'];
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  if (sig !== expected) return res.status(400).json({ error: 'Invalid signature' });

  const { event, payload } = req.body;
  // Handle async — respond 200 immediately
  res.json({ received: true });

  if (event === 'payment.captured') {
    // Already handled in verifyPayment; here as fallback
    console.log('payment.captured webhook:', payload.payment?.entity?.id);
  }
  if (event === 'refund.created') {
    const pid = payload.refund?.entity?.payment_id;
    query("UPDATE orders SET payment_status='refunded' WHERE razorpay_payment_id=$1", [pid]).catch(console.error);
  }
};

// ── GET /orders/:id ───────────────────────────────────────────────────
exports.getOrder = async (req, res) => {
  try {
    const { rows: [order] } = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!order) return notFound(res, 'Order not found');
    if (order.buyer_id !== req.user.id && order.seller_id !== req.user.id && req.user.role !== 'admin')
      return forbidden(res);
    ok(res, { order });
  } catch (e) { console.error(e); serverError(res); }
};

// ── GET /orders/me ────────────────────────────────────────────────────
exports.getMyOrders = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT o.*, l.name AS listing_name, l.images[1] AS listing_image
       FROM orders o JOIN listings l ON l.id = o.listing_id
       WHERE o.buyer_id = $1 ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    ok(res, { orders: rows });
  } catch (e) { console.error(e); serverError(res); }
};

// ── GET /seller/orders ────────────────────────────────────────────────
exports.getSellerOrders = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT o.*, l.name AS listing_name, l.images[1] AS listing_image,
              u.name AS buyer_name, u.phone AS buyer_phone
       FROM orders o
       JOIN listings l ON l.id = o.listing_id
       JOIN users u    ON u.id = o.buyer_id
       WHERE o.seller_id = $1 ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    ok(res, { orders: rows });
  } catch (e) { console.error(e); serverError(res); }
};

// ── PATCH /orders/:id/ship ────────────────────────────────────────────
exports.markShipped = async (req, res) => {
  try {
    const { tracking_id } = req.body;
    const { rows: [order] } = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!order) return notFound(res, 'Order not found');
    if (order.seller_id !== req.user.id) return forbidden(res);
    if (order.payment_status !== 'paid') return err(res, 'Payment not confirmed yet', 'PAYMENT_PENDING');

    const { rows: [updated] } = await query(
      `UPDATE orders SET shipping_status='dispatched', tracking_id=$1, dispatched_at=now()
       WHERE id=$2 RETURNING *`,
      [tracking_id || null, req.params.id]
    );
    ok(res, { order: updated });
  } catch (e) { console.error(e); serverError(res); }
};
