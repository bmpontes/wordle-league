'use strict';

const { AppError } = require('../utils/errors');

function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Recurso não encontrado.'));
}

/**
 * Tratamento centralizado de erros. Erros não controlados nunca expõem
 * detalhes internos (stack, SQL, palavra secreta) ao cliente.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Pedido com JSON inválido.' } });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Pedido demasiado grande.' } });
  }
  console.error('[erro]', req.method, req.originalUrl, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Ocorreu um erro interno. Tente novamente.' } });
}

module.exports = { notFoundHandler, errorHandler };
