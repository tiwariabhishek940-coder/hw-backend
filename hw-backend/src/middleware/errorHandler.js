const { serverError } = require('../utils/response');

const notFoundHandler = (req, res) => {
  res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.path} not found`, status: 404 } });
};

const errorHandler = (err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);

  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, error: { code: 'UPLOAD_ERROR', message: err.message, status: 400 } });
  }
  if (err.message?.includes('Only JPG')) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: err.message, status: 400 } });
  }
  serverError(res);
};

module.exports = { notFoundHandler, errorHandler };
