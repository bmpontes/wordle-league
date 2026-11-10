'use strict';

/** Erro controlado: a mensagem é segura para ser mostrada ao utilizador. */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const badRequest = (msg, code = 'INVALID_INPUT', details) => new AppError(400, code, msg, details);
const unauthorized = (msg = 'Sessão inválida ou expirada.') => new AppError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg = 'Sem permissão para esta operação.') => new AppError(403, 'FORBIDDEN', msg);
const notFound = (msg = 'Recurso não encontrado.') => new AppError(404, 'NOT_FOUND', msg);
const conflict = (msg, code = 'CONFLICT') => new AppError(409, code, msg);
const unprocessable = (msg, code) => new AppError(422, code, msg);
const unavailable = (msg, code = 'UNAVAILABLE') => new AppError(503, code, msg);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable, unavailable };
