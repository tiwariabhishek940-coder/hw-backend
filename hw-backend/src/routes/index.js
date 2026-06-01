const express = require('express');
const { body } = require('express-validator');
const { validate }        = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const orderCtrl   = require('../controllers/orderController');
const userCtrl    = require('../controllers/userController');

// ── ORDER ROUTES ─────────────────────────────────────────────────────
const orderRouter = express.Router();
orderRouter.post('/',               authenticate, requireRole('buyer'), orderCtrl.createOrder);
orderRouter.post('/verify-payment', authenticate, requireRole('buyer'), orderCtrl.verifyPayment);
orderRouter.get('/me',              authenticate, requireRole('buyer'), orderCtrl.getMyOrders);
orderRouter.get('/seller',          authenticate, requireRole('seller','admin'), orderCtrl.getSellerOrders);
orderRouter.get('/:id',             authenticate, orderCtrl.getOrder);
orderRouter.patch('/:id/ship',      authenticate, requireRole('seller','admin'), orderCtrl.markShipped);
module.exports.orderRouter = orderRouter;

// ── USER ROUTES ──────────────────────────────────────────────────────
const userRouter = express.Router();
userRouter.get('/me',              authenticate, userCtrl.getMe);
userRouter.patch('/me',            authenticate, userCtrl.updateMe);
userRouter.get('/me/addresses',    authenticate, userCtrl.getAddresses);
userRouter.post('/me/addresses',   authenticate, userCtrl.createAddress);
userRouter.get('/:id',             userCtrl.getSellerProfile);
userRouter.get('/:id/listings',    require('../controllers/listingController').getSellerListings);
userRouter.get('/:id/reviews',     userCtrl.getSellerReviews);
module.exports.userRouter = userRouter;

// ── CART ROUTES ──────────────────────────────────────────────────────
const cartRouter = express.Router();
cartRouter.get('/',                    authenticate, userCtrl.getCart);
cartRouter.post('/',                   authenticate, userCtrl.addToCart);
cartRouter.delete('/:listing_id',      authenticate, userCtrl.removeFromCart);
cartRouter.delete('/',                 authenticate, userCtrl.clearCart);
module.exports.cartRouter = cartRouter;

// ── WISHLIST ROUTES ───────────────────────────────────────────────────
const wishRouter = express.Router();
wishRouter.get('/',    authenticate, userCtrl.getWishlist);
wishRouter.post('/',   authenticate, userCtrl.toggleWishlist);
module.exports.wishRouter = wishRouter;

// ── REVIEW ROUTES ─────────────────────────────────────────────────────
const reviewRouter = express.Router();
reviewRouter.post('/', authenticate,
  [body('order_id').isUUID(), body('rating').isInt({min:1,max:5})],
  validate, userCtrl.createReview
);
module.exports.reviewRouter = reviewRouter;

// ── ADMIN ROUTES ──────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(authenticate, requireRole('admin'));
adminRouter.get('/dashboard',                  userCtrl.adminDashboard);
adminRouter.get('/listings',                   userCtrl.adminGetListings);
adminRouter.patch('/listings/:id/moderate',    userCtrl.adminModerateListing);
adminRouter.get('/users',                      userCtrl.adminGetUsers);
adminRouter.patch('/users/:id/seller-badge',   userCtrl.adminToggleSeller);
module.exports.adminRouter = adminRouter;

// ── WEBHOOK ROUTES ────────────────────────────────────────────────────
const webhookRouter = express.Router();
webhookRouter.post('/razorpay',
  express.raw({ type: 'application/json' }),
  orderCtrl.razorpayWebhook
);
module.exports.webhookRouter = webhookRouter;
