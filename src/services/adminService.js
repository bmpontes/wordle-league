'use strict';

const fs = require('fs');
const v = require('../utils/validate');
const clock = require('../utils/clock');
const { seasonCode } = require('../utils/time');
const { badRequest, notFound } = require('../utils/errors');

const STARTED_AT = new Date();

module.exports = function createAdminService({ db, models, config, auth, dailyWord, sessionStore }) {
  function publicUser(u) {
    return {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      role: u.role,
      status: u.status,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
    };
  }

  const listUsers = () => models.users.list().map(publicUser);

  async function createUser(body, actorId) {
    v.object(body);
    const user = await auth.createUser({
      username: body.username,
      displayName: body.displayName,
      password: body.password,
      role: body.role || 'user',
    });
    models.audit.log(actorId, 'user.create', user.username, { role: user.role });
    return publicUser(user);
  }

  function getTarget(id) {
    const user = models.users.findById(v.integer(id, 'id', { min: 1 }));
    if (!user) throw notFound('Utilizador não encontrado.');
    return user;
  }

  function setStatus(id, status, actorId) {
    const user = getTarget(id);
    if (user.id === actorId) throw badRequest('Não pode bloquear a sua própria conta.');
    if (status === 'blocked' && user.role === 'admin' && models.users.countActiveAdmins() <= 1) {
      throw badRequest('Não é possível bloquear o último administrador ativo.');
    }
    models.users.setStatus(user.id, status);
    if (status === 'blocked' && sessionStore) sessionStore.destroyUserSessions(user.id);
    models.audit.log(actorId, status === 'blocked' ? 'user.block' : 'user.unblock', user.username);
    return publicUser(models.users.findById(user.id));
  }

  async function resetPassword(id, password, actorId) {
    const user = getTarget(id);
    const pw = v.password(password);
    models.users.setPassword(user.id, await auth.hashPassword(pw));
    if (sessionStore) sessionStore.destroyUserSessions(user.id);
    models.audit.log(actorId, 'user.reset_password', user.username);
  }

  /** Altera o nome de apresentação (visível nas classificações). Fica registado na auditoria. */
  function renameUser(id, displayName, actorId) {
    const user = getTarget(id);
    const name = v.displayName(displayName);
    if (name !== user.display_name) {
      models.users.setDisplayName(user.id, name);
      models.audit.log(actorId, 'user.rename', user.username, { from: user.display_name, to: name });
    }
    return publicUser(models.users.findById(user.id));
  }

  /**
   * Ajuste manual de pontos. Nunca altera resultados existentes: cria um novo
   * movimento no livro de pontos, com motivo obrigatório e registo de auditoria.
   */
  function adjustPoints(body, actorId) {
    v.object(body);
    const user = getTarget(body.userId);
    const points = v.integer(body.points, 'points', { min: -1000, max: 1000, label: 'Pontos' });
    if (points === 0) throw badRequest('O ajuste não pode ser zero.');
    const reason = v.string(body.reason, 'reason', { min: 5, max: 200, label: 'Motivo' });
    db.transaction(() => {
      const season = models.seasons.ensure(seasonCode(dailyWord.today()));
      models.points.insert({
        userId: user.id,
        seasonId: season.id,
        type: 'admin_adjustment',
        points,
        reason: `Ajuste administrativo: ${reason}`,
        createdBy: actorId,
      });
      models.audit.log(actorId, 'points.adjust', user.username, { points, reason, season: season.code });
    })();
  }

  function status() {
    const pool = dailyWord.poolStatus();
    const today = dailyWord.today();
    const challenge = models.challenges.findByDate(today);
    const warnings = [];
    if (models.users.countActiveAdmins() === 0) warnings.push('Não existe nenhum administrador ativo.');
    if (pool.empty) warnings.push('Não existe lista de palavras secretas com o tamanho configurado. Importe uma lista para ativar o jogo.');
    else if (pool.exhausted && !pool.recycle) warnings.push('A lista de palavras secretas está esgotada. Importe novas palavras ou ative a reutilização.');
    else if (pool.unused <= 7) warnings.push(`Restam apenas ${pool.unused} palavras secretas por usar.`);
    if (models.words.count('accepted') === 0) {
      warnings.push('A lista de palavras aceites está vazia: só as palavras secretas serão aceites nas tentativas.');
    }

    let dbSize = null;
    try {
      dbSize = fs.statSync(config.dbFile).size;
    } catch {
      /* ignorar */
    }

    return {
      serverTime: clock.now().toISOString(),
      today,
      timezone: config.timezone,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT.getTime()) / 1000),
      nodeVersion: process.version,
      dbSizeBytes: dbSize,
      schemaVersion: db.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get(),
      todayChallenge: challenge
        ? { exists: true, players: models.results.countForChallenge(challenge.id), wordLength: challenge.word_length }
        : { exists: false },
      wordPool: pool,
      lists: { secret: models.words.count('secret'), accepted: models.words.count('accepted') },
      warnings,
    };
  }

  return {
    listUsers,
    createUser,
    blockUser: (id, actorId) => setStatus(id, 'blocked', actorId),
    unblockUser: (id, actorId) => setStatus(id, 'active', actorId),
    resetPassword,
    renameUser,
    adjustPoints,
    adjustments: () => models.points.adjustments(),
    status,
    audit: () => models.audit.recent(200),
  };
};
