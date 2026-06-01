const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, ...data });

const created = (res, data) => ok(res, data, 201);

const err = (res, message, code = 'ERROR', status = 400) =>
  res.status(status).json({ success: false, error: { code, message, status } });

const notFound    = (res, msg = 'Resource not found')        => err(res, msg, 'NOT_FOUND', 404);
const unauthorized = (res, msg = 'Authentication required')  => err(res, msg, 'UNAUTHORIZED', 401);
const forbidden   = (res, msg = 'Insufficient permissions')  => err(res, msg, 'FORBIDDEN', 403);
const conflict    = (res, msg = 'Resource already exists')   => err(res, msg, 'CONFLICT', 409);
const serverError = (res, msg = 'Internal server error')     => err(res, msg, 'INTERNAL_ERROR', 500);

module.exports = { ok, created, err, notFound, unauthorized, forbidden, conflict, serverError };
