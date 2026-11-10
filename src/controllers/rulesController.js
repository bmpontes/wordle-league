'use strict';

/**
 * Regras do jogo tal como estão configuradas no painel (só os parâmetros que
 * interessam aos jogadores). Usado pela página /regras.
 */
module.exports = ({ services, config }) => ({
  get(req, res) {
    const s = services.settings.getAll();
    res.json({
      timezone: config.timezone,
      wordLength: s.word_length,
      maxAttempts: s.max_attempts,
      accentMode: s.accent_mode,
      playStart: s.play_start,
      playEnd: s.play_end,
      pointsByAttempt: s.points_by_attempt,
      pointsLoss: s.points_loss,
      podiumBonus: s.podium_bonus_points,
      streakBonusDays: s.streak_bonus_days,
      streakBonusPoints: s.streak_bonus_points,
      streakMode: s.streak_mode,
    });
  },
});
