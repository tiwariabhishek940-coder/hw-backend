const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: 'Invalid input', status: 400, fields: errors.array() },
  });
};

module.exports = { validate };
