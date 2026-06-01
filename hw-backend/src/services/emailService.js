const nodemailer = require('nodemailer');
const { query }  = require('../config/db');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const send = (to, subject, html) =>
  transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, html });

exports.sendOrderConfirmation = async (order) => {
  const [buyer, seller, listing] = await Promise.all([
    query('SELECT name,email FROM users WHERE id=$1', [order.buyer_id]),
    query('SELECT name,email FROM users WHERE id=$1', [order.seller_id]),
    query('SELECT name,price FROM listings WHERE id=$1', [order.listing_id]),
  ]);
  const b = buyer.rows[0]; const s = seller.rows[0]; const l = listing.rows[0];
  const amount = (order.amount_paise / 100).toLocaleString('en-IN');

  await Promise.all([
    send(b.email, `Order Confirmed — ${l.name}`,
      `<h2>Hi ${b.name},</h2><p>Your order for <strong>${l.name}</strong> has been confirmed.</p><p>Amount: ₹${amount}</p><p>Order ID: ${order.id}</p>`),
    send(s.email, `New Sale — ${l.name}`,
      `<h2>Hi ${s.name},</h2><p>You have a new order for <strong>${l.name}</strong>.</p><p>Amount: ₹${amount}</p><p>Please ship within 2 business days.</p>`),
  ]);
};

exports.sendOtpEmail = (email, otp) =>
  send(email, 'Your Hot Wheels Shop India OTP',
    `<h2>Your OTP is <strong>${otp}</strong></h2><p>Valid for 10 minutes.</p>`);
