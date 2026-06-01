const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const signAccess  = (payload) =>
  jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET,  { expiresIn: process.env.ACCESS_TOKEN_EXPIRY  || '15m' });

const signRefresh = (payload) =>
  jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d' });

const verifyAccess  = (token) => jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
const verifyRefresh = (token) => jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh, hashToken };
