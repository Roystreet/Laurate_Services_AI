'use strict';

const crypto = require('crypto');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');

// La validación se activa en producción o cuando API_KEY está definida (permite probarla en desarrollo)
function apiKeyMiddleware(req, res, next) {
  const enforced = config.nodeEnv === 'production' || Boolean(config.apiKey);
  if (!enforced) return next();

  const provided = req.headers['x-api-key'];
  if (typeof provided !== 'string' || provided.length === 0) {
    return next(new ApiError(401, 'INVALID_API_KEY', 'Falta el header x-api-key'));
  }

  const expected = Buffer.from(config.apiKey);
  const received = Buffer.from(provided);
  const valid = expected.length === received.length && crypto.timingSafeEqual(expected, received);

  if (!valid) {
    return next(new ApiError(401, 'INVALID_API_KEY', 'API key inválida'));
  }
  return next();
}

module.exports = { apiKeyMiddleware };
