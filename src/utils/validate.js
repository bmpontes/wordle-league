'use strict';

const { badRequest } = require('./errors');

/**
 * Validação simples e explícita dos dados recebidos. Cada função devolve o valor
 * normalizado ou lança um AppError 400 com uma mensagem em português.
 */

function string(value, field, { min = 0, max = 200, pattern, trim = true, label } = {}) {
  if (typeof value !== 'string') throw badRequest(`Campo "${label || field}" inválido.`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw badRequest(`"${label || field}" deve ter pelo menos ${min} caracteres.`);
  if (v.length > max) throw badRequest(`"${label || field}" deve ter no máximo ${max} caracteres.`);
  if (pattern && !pattern.test(v)) throw badRequest(`"${label || field}" contém caracteres inválidos.`);
  return v;
}

function integer(value, field, { min = -Infinity, max = Infinity, label } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`"${label || field}" deve ser um número inteiro entre ${min} e ${max}.`);
  }
  return n;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') throw badRequest(`"${field}" deve ser verdadeiro ou falso.`);
  return value;
}

function oneOf(value, field, options) {
  if (!options.includes(value)) throw badRequest(`"${field}" deve ser um de: ${options.join(', ')}.`);
  return value;
}

function object(value, field = 'pedido') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`Corpo do ${field} inválido.`);
  return value;
}

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

function username(value) {
  return string(typeof value === 'string' ? value.toLowerCase() : value, 'username', {
    min: 3,
    max: 32,
    pattern: USERNAME_PATTERN,
    label: 'Nome de utilizador',
  });
}

function displayName(value) {
  const v = string(value, 'displayName', { min: 2, max: 40, label: 'Nome de apresentação' });
  // Sem caracteres de controlo; o resto é escapado na apresentação.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(v)) throw badRequest('"Nome de apresentação" contém caracteres inválidos.');
  return v;
}

function password(value) {
  if (typeof value !== 'string') throw badRequest('Password inválida.');
  if (value.length < 10) throw badRequest('A password deve ter pelo menos 10 caracteres.');
  if (value.length > 200) throw badRequest('A password deve ter no máximo 200 caracteres.');
  return value;
}

module.exports = { string, integer, boolean, oneOf, object, username, displayName, password };
