'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Obtém o segredo das sessões. Se não for definido em SESSION_SECRET, é gerado
 * um segredo aleatório e guardado no diretório de dados (persistente), para que
 * as sessões sobrevivam a reinícios sem nunca existir um segredo no código.
 */
function resolveSessionSecret(dataDir, explicit) {
  if (explicit && explicit.length >= 32) return explicit;
  if (explicit) {
    throw new Error('SESSION_SECRET tem de ter pelo menos 32 caracteres.');
  }
  const file = path.join(dataDir, '.session_secret');
  if (fs.existsSync(file)) {
    const stored = fs.readFileSync(file, 'utf8').trim();
    if (stored.length >= 32) return stored;
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));
  fs.mkdirSync(dataDir, { recursive: true });

  const nodeEnv = env.NODE_ENV || 'development';
  return {
    env: nodeEnv,
    isProduction: nodeEnv === 'production',
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: path.resolve(env.DB_FILE || path.join(dataDir, 'wordle.sqlite')),
    timezone: env.APP_TIMEZONE || 'Europe/Lisbon',
    sessionSecret: resolveSessionSecret(dataDir, env.SESSION_SECRET),
    sessionMaxAgeHours: int(env.SESSION_MAX_AGE_HOURS, 12),
    // Secure só deve ser ativado quando a aplicação é servida por HTTPS
    // (diretamente ou atrás de um reverse proxy com TRUST_PROXY=1).
    cookieSecure: bool(env.COOKIE_SECURE, false),
    trustProxy: int(env.TRUST_PROXY, 0),
    loginMaxAttempts: int(env.LOGIN_MAX_ATTEMPTS, 5),
    loginWindowMinutes: int(env.LOGIN_WINDOW_MINUTES, 15),
    bootstrapAdmin: {
      username: env.ADMIN_USERNAME || '',
      password: env.ADMIN_PASSWORD || '',
      displayName: env.ADMIN_DISPLAY_NAME || '',
    },
    logRequests: bool(env.LOG_REQUESTS, nodeEnv !== 'test'),
  };
}

module.exports = { loadConfig };
