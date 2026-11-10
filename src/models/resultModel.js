'use strict';

module.exports = (db) => {
  const s = {
    find: db.prepare('SELECT * FROM daily_results WHERE challenge_id = ? AND user_id = ?'),
    insert: db.prepare('INSERT OR IGNORE INTO daily_results (challenge_id, user_id) VALUES (?, ?)'),
    recordAttempt: db.prepare(
      `UPDATE daily_results SET attempts_used = attempts_used + 1
        WHERE id = ? AND status = 'in_progress' AND attempts_used = ?`
    ),
    finish: db.prepare(
      `UPDATE daily_results
          SET status = @status, points = @points, finished_at = @finishedAt
        WHERE id = @id AND status = 'in_progress'`
    ),
    guesses: db.prepare('SELECT attempt_number, guess, pattern FROM guesses WHERE result_id = ? ORDER BY attempt_number'),
    insertGuess: db.prepare(
      `INSERT INTO guesses (result_id, challenge_id, user_id, attempt_number, guess, pattern)
       VALUES (@resultId, @challengeId, @userId, @attempt, @guess, @pattern)`
    ),
    expiredInProgress: db.prepare(
      `SELECT r.*, c.challenge_date, c.season_id FROM daily_results r
         JOIN daily_challenges c ON c.id = r.challenge_id
        WHERE r.status = 'in_progress' AND c.challenge_date < ?`
    ),
    finishedForUser: db.prepare(
      `SELECT c.challenge_date, r.status FROM daily_results r
         JOIN daily_challenges c ON c.id = r.challenge_id
        WHERE r.user_id = ? AND r.status <> 'in_progress'
        ORDER BY c.challenge_date`
    ),
    historyForUser: db.prepare(
      `SELECT c.challenge_date, c.word, c.max_attempts, r.status, r.attempts_used, r.finished_at,
              COALESCE((SELECT SUM(p.points) FROM point_transactions p
                         WHERE p.result_id = r.id AND p.type IN ('game_result', 'streak_bonus', 'first_win_bonus')), 0) AS points,
              COALESCE((SELECT SUM(p.points) FROM point_transactions p
                         WHERE p.result_id = r.id AND p.type IN ('streak_bonus', 'first_win_bonus')), 0) AS bonus
         FROM daily_results r JOIN daily_challenges c ON c.id = r.challenge_id
        WHERE r.user_id = ? AND r.status <> 'in_progress'
        ORDER BY c.challenge_date DESC LIMIT ?`
    ),
    allFinished: db.prepare(
      `SELECT r.user_id, c.challenge_date, r.status FROM daily_results r
         JOIN daily_challenges c ON c.id = r.challenge_id
        WHERE r.status <> 'in_progress' AND c.challenge_date BETWEEN ? AND ?
        ORDER BY r.user_id, c.challenge_date`
    ),
    globalStats: db.prepare(
      `SELECT COUNT(*) AS games,
              COALESCE(SUM(status = 'won'), 0) AS wins,
              COALESCE(SUM(status IN ('lost', 'expired')), 0) AS losses,
              COALESCE(SUM(status = 'in_progress'), 0) AS in_progress
         FROM daily_results`
    ),
    distribution: db.prepare(
      `SELECT attempts_used, COUNT(*) AS n FROM daily_results WHERE status = 'won' GROUP BY attempts_used`
    ),
    countForChallenge: db.prepare('SELECT COUNT(*) FROM daily_results WHERE challenge_id = ?').pluck(),
    winsForChallenge: db.prepare("SELECT COUNT(*) FROM daily_results WHERE challenge_id = ? AND status = 'won'").pluck(),
  };

  return {
    find: (challengeId, userId) => s.find.get(challengeId, userId),
    findOrCreate(challengeId, userId) {
      s.insert.run(challengeId, userId);
      return s.find.get(challengeId, userId);
    },
    /** Incrementa as tentativas só se o estado for o esperado (proteção contra corridas). */
    recordAttempt: (id, expectedAttempts) => s.recordAttempt.run(id, expectedAttempts).changes === 1,
    finish: (data) => s.finish.run(data).changes === 1,
    guesses: (resultId) => s.guesses.all(resultId),
    insertGuess: (data) => s.insertGuess.run(data),
    expiredInProgress: (today) => s.expiredInProgress.all(today),
    finishedForUser: (userId) => s.finishedForUser.all(userId),
    historyForUser: (userId, limit = 365) => s.historyForUser.all(userId, limit),
    allFinishedBetween: (from, to) => s.allFinished.all(from, to),
    globalStats: () => s.globalStats.get(),
    distribution: () => s.distribution.all(),
    countForChallenge: (id) => s.countForChallenge.get(id),
    winsForChallenge: (id) => s.winsForChallenge.get(id),
  };
};
