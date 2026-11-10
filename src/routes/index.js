'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

/** Envolve handlers async para que os erros cheguem ao errorHandler. */
const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (err) {
    next(err);
  }
};

module.exports = function createApiRouter(ctx) {
  const auth = require('../controllers/authController')(ctx);
  const game = require('../controllers/gameController')(ctx);
  const board = require('../controllers/leaderboardController')(ctx);
  const profile = require('../controllers/profileController')(ctx);
  const admin = require('../controllers/adminController')(ctx);
  const rules = require('../controllers/rulesController')(ctx);

  const api = express.Router();

  api.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Autenticação
  const authLimiter = rateLimit({ max: 30, windowMs: 60 * 1000 });
  api.get('/auth/session', wrap(auth.session));
  api.post('/auth/login', authLimiter, wrap(auth.login));
  api.post('/auth/register', authLimiter, wrap(auth.register));
  api.post('/auth/logout', wrap(auth.logout));
  api.post('/auth/password', requireAuth, authLimiter, wrap(auth.changePassword));

  // Jogo
  const guessLimiter = rateLimit({ max: 30, windowMs: 60 * 1000, key: (req) => `u:${req.user.id}` });
  api.get('/game/today', requireAuth, wrap(game.today));
  api.post('/game/guess', requireAuth, guessLimiter, wrap(game.guess));

  // Classificações e perfil
  api.get('/leaderboard/daily', requireAuth, wrap(board.daily));
  api.get('/leaderboard/monthly', requireAuth, wrap(board.monthly));
  api.get('/leaderboard/alltime', requireAuth, wrap(board.allTime));
  api.get('/leaderboard/seasons', requireAuth, wrap(board.seasons));
  api.get('/profile/me', requireAuth, wrap(profile.me));
  api.get('/rules', requireAuth, wrap(rules.get));

  // Classificação pública do mês em curso (só leitura, sem autenticação; desativável no painel)
  api.get('/public/leaderboard', wrap(board.publicEnabled), wrap(board.publicMonthly));

  // Administração
  const a = express.Router();
  a.use(requireAdmin);
  a.get('/status', wrap(admin.status));
  a.get('/stats', wrap(admin.stats));
  a.get('/users', wrap(admin.users));
  a.post('/users', wrap(admin.createUser));
  a.post('/users/:id/block', wrap(admin.block));
  a.post('/users/:id/unblock', wrap(admin.unblock));
  a.post('/users/:id/password', wrap(admin.resetPassword));
  a.post('/users/:id/display-name', wrap(admin.rename));
  a.get('/settings', wrap(admin.getSettings));
  a.put('/settings', wrap(admin.updateSettings));
  a.get('/words', wrap(admin.words));
  a.post('/words/preview', wrap(admin.previewWords));
  a.post('/words/import', wrap(admin.importWords));
  a.get('/words/:type/export', wrap(admin.exportWords));
  a.get('/points/adjustments', wrap(admin.adjustments));
  a.post('/points/adjust', wrap(admin.adjustPoints));
  a.get('/audit', wrap(admin.audit));
  api.use('/admin', a);

  return api;
};
