const { verifyAccess }  = require('../utils/jwt');
const { unauthorized, forbidden } = require('../utils/response');

const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return unauthorized(res);
  try {
    req.user = verifyAccess(auth.split(' ')[1]);
    next();
  } catch {
    unauthorized(res, 'Token expired or invalid');
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return unauthorized(res);
  if (!roles.includes(req.user.role)) return forbidden(res);
  next();
};

const optionalAuth = (req, _res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try { req.user = verifyAccess(auth.split(' ')[1]); } catch {}
  }
  next();
};

module.exports = { authenticate, requireRole, optionalAuth };
