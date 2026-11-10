'use strict';

const streaks = require('./streakService');

/** Estatísticas pessoais e globais. Só revela palavras de jogos já concluídos. */
module.exports = function createStatsService({ models, settings, dailyWord, leaderboard }) {
  function bestMonthlyRank(userId) {
    let best = null;
    for (const { code } of models.seasons.list()) {
      const row = leaderboard.monthly(code, { includeUserIds: true }).rows.find((r) => r.userId === userId);
      if (row && (row.games > 0 || row.points !== 0) && (!best || row.position < best.position)) {
        best = { position: row.position, season: code };
      }
    }
    return best;
  }

  function profile(userId) {
    const s = settings.getAll();
    const user = models.users.findById(userId);
    const finished = models.results.finishedForUser(userId);
    const history = models.results.historyForUser(userId);
    const dates = streaks.qualifyingDates(finished, s.streak_mode);

    const maxAttempts = Math.max(s.max_attempts, ...history.map((h) => h.max_attempts));
    const distribution = Array.from({ length: maxAttempts }, (_, i) => ({ attempts: i + 1, count: 0 }));
    for (const h of history) if (h.status === 'won' && distribution[h.attempts_used - 1]) distribution[h.attempts_used - 1].count++;

    const games = finished.length;
    const wins = finished.filter((r) => r.status === 'won').length;

    return {
      user: { username: user.username, displayName: user.display_name, role: user.role, createdAt: user.created_at },
      streakMode: s.streak_mode,
      games,
      wins,
      winRate: games ? Math.round((wins / games) * 1000) / 10 : 0,
      distribution,
      totalPoints: models.points.totalForUser(userId),
      currentStreak: streaks.currentStreak(dates, dailyWord.today()),
      bestStreak: streaks.bestStreak(dates),
      bestMonthlyRank: bestMonthlyRank(userId),
      history: history.map((h) => ({
        date: h.challenge_date,
        word: h.word, // apenas desafios concluídos pelo próprio utilizador
        status: h.status,
        attempts: h.attempts_used,
        points: h.points,
        bonus: h.bonus,
      })),
      pointEvents: models.points.forUser(userId, 100).map((p) => ({
        type: p.type,
        points: p.points,
        reason: p.reason,
        date: p.challenge_date,
        season: p.season,
        createdAt: p.created_at,
      })),
    };
  }

  function global() {
    const g = models.results.globalStats();
    return {
      users: { total: models.users.count(), active: models.users.countActive() },
      games: g,
      winRate: g.wins + g.losses ? Math.round((g.wins / (g.wins + g.losses)) * 1000) / 10 : 0,
      distribution: models.results.distribution(),
      challenges: models.challenges.count(),
      // Só desafios de dias anteriores: a palavra de hoje nunca é mostrada.
      pastChallenges: models.challenges.pastWithStats(dailyWord.today(), 60),
    };
  }

  return { profile, global };
};
