// ── auth.routes.js ───────────────────────────────────────────────────
const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const auth = require('../controllers/authController');

const router = express.Router();

router.post('/register',
  [body('name').trim().notEmpty(), body('email').isEmail(), body('password').isLength({ min: 8 })],
  validate, auth.register
);
router.post('/login',
  [body('email').isEmail(), body('password').notEmpty()],
  validate, auth.login
);
router.post('/refresh', auth.refresh);
router.post('/logout',  auth.logout);
router.post('/otp/send',   [body('phone').isMobilePhone()], validate, auth.sendOtp);
router.post('/otp/verify', [body('phone').isMobilePhone(), body('code').isLength({min:4,max:8})], validate, auth.verifyOtp);
router.get('/me', authenticate, auth.me);

module.exports = router;
