'use strict';

const argon2 = require('argon2');
const v = require('../utils/validate');
const { AppError, badRequest, conflict, forbidden } = require('../utils/errors');
const { RateLimiter } = require('../utils/rateLimiter');

// Parâmetros Argon2id (recomendação OWASP: m=19 MiB, t=2, p=1 como mínimo).
const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

module.exports = function createAuthService({ models, settings, config }) {
  const windowMs = config.loginWindowMinutes * 60 * 1000;
  // Por conta: N falhas na janela bloqueiam a conta temporariamente.
  // Por IP: limite mais largo (vários utilizadores podem partilhar o mesmo IP).
  const limiter = new RateLimiter({ max: config.loginMaxAttempts, windowMs });
  const ipLimiter = new RateLimiter({ max: config.loginMaxAttempts * 4, windowMs });
  // Hash fictício para que o tempo de resposta não revele se o utilizador existe.
  const dummyHashPromise = argon2.hash('dummy-password-for-timing', HASH_OPTIONS);

  const hashPassword = (password) => argon2.hash(password, HASH_OPTIONS);

  function tooMany(lim, key) {
    const seconds = lim.retryAfterSeconds(key);
    const err = new AppError(
      429,
      'TOO_MANY_ATTEMPTS',
      `Demasiadas tentativas falhadas. Tente novamente dentro de ${Math.ceil(seconds / 60)} minuto(s).`
    );
    err.retryAfter = seconds;
    return err;
  }

  async function login({ username, password }, ip) {
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || password.length > 200) {
      throw badRequest('Indique o nome de utilizador e a password.');
    }
    const uname = username.trim().toLowerCase().slice(0, 64);
    const ipKey = `ip:${ip}`;
    const userKey = `user:${uname}`;
    if (ipLimiter.isBlocked(ipKey)) throw tooMany(ipLimiter, ipKey);
    if (limiter.isBlocked(userKey)) throw tooMany(limiter, userKey);

    const user = models.users.findAuthByUsername(uname);
    const ok = user
      ? await argon2.verify(user.password_hash, password)
      : (await argon2.verify(await dummyHashPromise, password), false);

    if (!ok || user.status !== 'active') {
      ipLimiter.hit(ipKey);
      limiter.hit(userKey);
      // Mensagem genérica: não revela se o utilizador existe ou está bloqueado.
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas ou conta inativa.');
    }
    limiter.reset(userKey);
    models.users.touchLogin(user.id);
    if (argon2.needsRehash(user.password_hash, HASH_OPTIONS)) {
      models.users.setPassword(user.id, await hashPassword(password));
    }
    return models.users.findById(user.id);
  }

  async function createUser({ username, displayName, password, role = 'user' }) {
    const data = {
      username: v.username(username),
      displayName: v.displayName(displayName),
      password: v.password(password),
      role: v.oneOf(role, 'role', ['user', 'admin']),
    };
    if (data.password.toLowerCase().includes(data.username)) {
      throw badRequest('A password não pode conter o nome de utilizador.');
    }
    if (models.users.findAuthByUsername(data.username)) throw conflict('Esse nome de utilizador já existe.', 'USERNAME_TAKEN');
    const passwordHash = await hashPassword(data.password);
    try {
      return models.users.findById(models.users.create({ ...data, passwordHash }));
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) throw conflict('Esse nome de utilizador já existe.', 'USERNAME_TAKEN');
      throw err;
    }
  }

  async function register(body) {
    if (!settings.getAll().registration_enabled) throw forbidden('O registo de novas contas está desativado.');
    v.object(body);
    const user = await createUser({ username: body.username, displayName: body.displayName, password: body.password, role: 'user' });
    models.audit.log(user.id, 'user.register', user.username);
    return user;
  }

  async function changePassword(userId, { currentPassword, newPassword }) {
    const user = models.users.findAuthById(userId);
    if (typeof currentPassword !== 'string' || !(await argon2.verify(user.password_hash, currentPassword))) {
      throw badRequest('A password atual está incorreta.', 'WRONG_PASSWORD');
    }
    const pw = v.password(newPassword);
    if (pw.toLowerCase().includes(user.username)) throw badRequest('A password não pode conter o nome de utilizador.');
    models.users.setPassword(userId, await hashPassword(pw));
    models.audit.log(userId, 'user.change_password', user.username);
  }

  /**
   * Cria o primeiro administrador a partir de ADMIN_USERNAME/ADMIN_PASSWORD,
   * apenas se ainda não existir nenhum administrador ativo.
   */
  async function bootstrapAdmin(log = console.log) {
    const { username, password, displayName } = config.bootstrapAdmin;
    if (models.users.countActiveAdmins() > 0) {
      if (password) log('[aviso] ADMIN_PASSWORD continua definido mas já existe um administrador. Remova-o do ambiente.');
      return null;
    }
    if (!username || !password) {
      log('[aviso] Não existe nenhum administrador. Defina ADMIN_USERNAME e ADMIN_PASSWORD ou execute "npm run create-admin".');
      return null;
    }
    const user = await createUser({ username, password, displayName: displayName || username, role: 'admin' });
    models.audit.log(null, 'admin.bootstrap', user.username);
    log(`Administrador inicial "${user.username}" criado. Remova ADMIN_PASSWORD do ambiente.`);
    return user;
  }

  function close() {
    limiter.close();
    ipLimiter.close();
  }

  return { login, register, createUser, changePassword, hashPassword, bootstrapAdmin, close };
};
