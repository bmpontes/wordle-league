'use strict';

const { notFound } = require('../utils/errors');
const { monthBounds } = require('../utils/time');

const str = (v) => (typeof v === 'string' && v ? v : undefined);

module.exports = ({ services }) => ({
  daily: (req, res) => res.json(services.leaderboard.daily(str(req.query.date), req.user.id)),
  monthly: (req, res) => res.json(services.leaderboard.monthly(str(req.query.season), { viewerId: req.user.id })),
  allTime: (req, res) => res.json(services.leaderboard.allTime(req.user.id)),
  seasons: (req, res) => res.json(services.leaderboard.seasons()),

  // Classificação pública (sem sessão).
  publicEnabled(req, res, next) {
    if (!services.settings.getAll().public_leaderboard) throw notFound('A classificação pública está desativada.');
    next();
  },

  /** Só o mês em curso (fuso Europe/Lisbon); não há forma de pedir outras épocas. */
  publicMonthly(req, res) {
    const board = services.leaderboard.monthly();
    res.json({
      season: board.season,
      endsOn: monthBounds(board.season).end,
      today: services.dailyWord.today(),
      rows: board.rows.map(({ isMe, ...row }) => (void isMe, row)),
    });
  },
});
