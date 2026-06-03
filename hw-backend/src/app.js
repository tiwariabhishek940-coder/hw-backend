const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');

const authRoutes = require('./routes/auth.routes');
const listingRoutes = require('./routes/listing.routes');
const { orderRouter, userRouter, cartRouter, wishRouter, reviewRouter, adminRouter, webhookRouter } = require('./routes/index');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// ── Security ──────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:      process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: { error: { code:'RATE_LIMITED', message:'Too many requests' } } });
const apiLimiter  = rateLimit({ windowMs: 60 * 1000,      max: 200 });
app.use('/v1/auth', authLimiter);
app.use('/v1',      apiLimiter);

// ── Webhooks (raw body before JSON parser) ────────────────────────────
app.use('/v1/webhooks', webhookRouter);

// ── Body parsing ──────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Logging ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ── Health check ──────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── Routes ────────────────────────────────────────────────────────────
app.use('/v1/auth',      authRoutes);
app.use('/v1/listings',  listingRoutes);
app.use('/v1/orders',    orderRouter);
app.use('/v1/users',     userRouter);
app.use('/v1/cart',      cartRouter);
app.use('/v1/wishlist',  wishRouter);
app.use('/v1/reviews',   reviewRouter);
app.use('/v1/admin',     adminRouter);

// ── Error handlers ────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
