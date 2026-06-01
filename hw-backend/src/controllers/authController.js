const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query }  = require('../config/db');
const { signAccess, signRefresh, verifyRefresh, hashToken } = require('../utils/jwt');
const { ok, created, err, unauthorized, conflict, serverError } = require('../utils/response');

// ── helpers ──────────────────────────────────────────────────────────
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   7 * 24 * 60 * 60 * 1000,   // 7 days
  path:     '/v1/auth/refresh',
};

const issueTokens = async (user) => {
  const payload = { id: user.id, role: user.role, email: user.email };
  const accessToken  = signAccess(payload);
  const refreshToken = signRefresh(payload);

  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    'INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES($1,$2,$3)',
    [user.id, tokenHash, expiresAt]
  );
  return { accessToken, refreshToken };
};

const safeUser = (u) => ({ id:u.id, name:u.name, email:u.email, role:u.role, phone:u.phone, is_verified:u.is_verified, seller_badge:u.seller_badge, avatar_url:u.avatar_url, avg_rating:u.avg_rating });

// ── REGISTER ─────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, role = 'buyer' } = req.body;

    const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rowCount > 0) return conflict(res, 'Email already registered');

    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users(name,email,password_hash,phone,role) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [name, email.toLowerCase(), password_hash, phone || null, role === 'seller' ? 'seller' : 'buyer']
    );

    const { accessToken, refreshToken } = await issueTokens(rows[0]);
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTS);
    created(res, { user: safeUser(rows[0]), accessToken });
  } catch (e) {
    console.error(e); serverError(res);
  }
};

// ── LOGIN ─────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await query('SELECT * FROM users WHERE email=$1 AND deleted_at IS NULL', [email.toLowerCase()]);
    if (!rows[0]) return unauthorized(res, 'Invalid email or password');

    const valid = await bcrypt.compare(password, rows[0].password_hash || '');
    if (!valid) return unauthorized(res, 'Invalid email or password');

    const { accessToken, refreshToken } = await issueTokens(rows[0]);
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTS);
    ok(res, { user: safeUser(rows[0]), accessToken });
  } catch (e) {
    console.error(e); serverError(res);
  }
};

// ── REFRESH ──────────────────────────────────────────────────────────
exports.refresh = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return unauthorized(res, 'No refresh token');

    let payload;
    try { payload = verifyRefresh(token); }
    catch { return unauthorized(res, 'Refresh token expired'); }

    const tokenHash = hashToken(token);
    const { rows } = await query(
      'SELECT * FROM refresh_tokens WHERE token_hash=$1 AND revoked=false AND expires_at > now()',
      [tokenHash]
    );
    if (!rows[0]) return unauthorized(res, 'Refresh token revoked');

    // Rotate
    await query('UPDATE refresh_tokens SET revoked=true WHERE token_hash=$1', [tokenHash]);

    const userRes = await query('SELECT * FROM users WHERE id=$1', [payload.id]);
    if (!userRes.rows[0]) return unauthorized(res);

    const { accessToken, refreshToken } = await issueTokens(userRes.rows[0]);
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTS);
    ok(res, { accessToken });
  } catch (e) {
    console.error(e); serverError(res);
  }
};

// ── LOGOUT ───────────────────────────────────────────────────────────
exports.logout = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      await query('UPDATE refresh_tokens SET revoked=true WHERE token_hash=$1', [hashToken(token)]);
    }
    res.clearCookie('refreshToken', { path: '/v1/auth/refresh' });
    ok(res, { message: 'Logged out successfully' });
  } catch (e) {
    console.error(e); serverError(res);
  }
};

// ── SEND OTP ─────────────────────────────────────────────────────────
exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verifications.create({ to: `+91${phone}`, channel: 'sms' });
    ok(res, { message: 'OTP sent' });
  } catch (e) {
    console.error(e); err(res, 'Failed to send OTP', 'OTP_SEND_FAILED');
  }
};

// ── VERIFY OTP ───────────────────────────────────────────────────────
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, code } = req.body;
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const check = await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verificationChecks.create({ to: `+91${phone}`, code });

    if (check.status !== 'approved') return err(res, 'Invalid or expired OTP', 'OTP_INVALID');

    if (req.user) {
      await query('UPDATE users SET is_verified=true, phone=$1 WHERE id=$2', [phone, req.user.id]);
    }
    ok(res, { message: 'Phone verified' });
  } catch (e) {
    console.error(e); err(res, 'OTP verification failed', 'OTP_VERIFY_FAILED');
  }
};

// ── ME ───────────────────────────────────────────────────────────────
exports.me = async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]) return unauthorized(res);
    ok(res, { user: safeUser(rows[0]) });
  } catch (e) {
    console.error(e); serverError(res);
  }
};
