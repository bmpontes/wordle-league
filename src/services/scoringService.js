'use strict';

const streaks = require('./streakService');

/** Pontos do resultado de um jogo (função pura). */
function pointsFor(status, attempts, s) {
  if (status === 'won') {
    const table = s.points_by_attempt;
    return table[Math.min(attempts, table.length) - 1];
  }
  return s.points_loss;
}

/**
 * Atribuição de pontos. Deve ser chamada dentro da transação que conclui o
 * resultado. A unicidade é garantida pela BD (índices únicos parciais em
 * point_transactions), pelo que pedidos duplicados nunca geram pontos a dobrar.
 */
module.exports = function createScoringService({ models, settings }) {
  function award({ result, challenge, status, attempts }) {
    const s = settings.getAll();
    const points = pointsFor(status, attempts, s);
    const label = status === 'won' ? `Vitória em ${attempts} tentativa(s)` : status === 'expired' ? 'Participação (jogo não concluído)' : 'Participação sem vitória';

    const inserted = models.points.insert({
      userId: result.user_id,
      seasonId: challenge.season_id,
      challengeId: challenge.id,
      resultId: result.id,
      type: 'game_result',
      points,
      reason: `${label} — desafio de ${challenge.challenge_date}`,
    });

    let bonus = 0;
    let streakLength = 0;
    if (inserted && streaks.qualifies(status, s.streak_mode) && s.streak_bonus_points > 0) {
      const dates = streaks.qualifyingDates(models.results.finishedForUser(result.user_id), s.streak_mode);
      streakLength = streaks.streakEndingAt(dates, challenge.challenge_date);
      if (streakLength > 0 && streakLength % s.streak_bonus_days === 0) {
        const ok = models.points.insert({
          userId: result.user_id,
          seasonId: challenge.season_id,
          challengeId: challenge.id,
          resultId: result.id,
          type: 'streak_bonus',
          points: s.streak_bonus_points,
          streakLength,
          reason: `Bónus de streak: ${streakLength} dias consecutivos`,
        });
        if (ok) bonus = s.streak_bonus_points;
      }
    }
    // Bónus de pódio: o 1.º, 2.º, 3.º… a acertar no desafio do dia. A posição é o
    // número de vitórias já registadas neste desafio (incluindo esta, que acabou de
    // ser concluída na mesma transação). Os índices únicos uq_points_win_rank e
    // uq_points_win_bonus_user impedem posições ou bónus repetidos.
    let podiumBonus = 0;
    let winRank = null;
    if (inserted && status === 'won') {
      winRank = models.results.winsForChallenge(challenge.id);
      const value = s.podium_bonus_points[winRank - 1] || 0;
      if (value > 0 && winRank <= 10) {
        const ok = models.points.insert({
          userId: result.user_id,
          seasonId: challenge.season_id,
          challengeId: challenge.id,
          resultId: result.id,
          type: 'first_win_bonus',
          points: value,
          winRank,
          reason: `Bónus: ${winRank}.º a acertar no desafio de ${challenge.challenge_date}`,
        });
        if (ok) podiumBonus = value;
      }
    }
    return { points, bonus, podiumBonus, winRank, streakLength, duplicate: !inserted };
  }

  const currentPointsFor = (status, attempts) => pointsFor(status, attempts, settings.getAll());

  return { award, pointsFor, currentPointsFor };
};

module.exports.pointsFor = pointsFor;
