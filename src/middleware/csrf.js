'use strict';

const crypto = require('crypto');
const { AppError } = require('../utils/errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Devolve (criando se necessário) o token CSRF associado à sessão. */
function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

/**
 * Proteção CSRF por "synchronizer token": os pedidos que alteram estado têm de
 * enviar o cabeçalho X-CSRF-Token igual ao token guardado na sessão.
 * Complementa o cookie SameSite=Strict.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session && req.session.csrfToken;
  const received = req.get('x-csrf-token');
  if (
    !expected ||
    typeof received !== 'string' ||
    received.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  ) {
    return next(new AppError(403, 'CSRF', 'Pedido inválido (token CSRF). Atualize a página e tente novamente.'));
  }
  next();
}

module.exports = { ensureCsrfToken, csrfProtection };
