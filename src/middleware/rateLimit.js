'use strict';

const { AppError } = require('../utils/errors');
const { RateLimiter } = require('../utils/rateLimiter');

/** Middleware genérico de limitação de pedidos. */
function rateLimit({ max, windowMs, key = (req) => req.ip, message = 'Demasiados pedidos. Aguarde um momento.' }) {
  const limiter = new RateLimiter({ max, windowMs });
  const mw = (req, res, next) => {
    const k = key(req);
    if (limiter.hit(k) > max) {
      res.set('Retry-After', String(limiter.retryAfterSeconds(k)));
      return next(new AppError(429, 'RATE_LIMITED', message));
    }
    next();
  };
  mw.limiter = limiter;
  return mw;
}

module.exports = { rateLimit };
