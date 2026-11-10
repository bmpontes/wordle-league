'use strict';

module.exports = (db) => {
  const s = {
    insert: db.prepare(
      `INSERT OR IGNORE INTO point_transactions
         (user_id, season_id, challenge_id, result_id, type, points, streak_length, win_rank, reason, created_by)
       VALUES (@userId, @seasonId, @challengeId, @resultId, @type, @points, @streakLength, @winRank, @reason, @createdBy)`
    ),
    forUser: db.prepare(
      `SELECT p.id, p.type, p.points, p.streak_length, p.win_rank, p.reason, p.created_at,
              c.challenge_date, s.code AS season, u.username AS created_by_username
         FROM point_transactions p
         JOIN seasons s ON s.id = p.season_id
         LEFT JOIN daily_challenges c ON c.id = p.challenge_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.user_id = ? ORDER BY p.id DESC LIMIT ?`
    ),
    totalForUser: db.prepare('SELECT COALESCE(SUM(points), 0) FROM point_transactions WHERE user_id = ?').pluck(),
    adjustments: db.prepare(
      `SELECT p.id, p.points, p.reason, p.created_at, s.code AS season,
              u.username, u.display_name, a.username AS created_by_username
         FROM point_transactions p
         JOIN users u ON u.id = p.user_id
         JOIN users a ON a.id = p.created_by
         JOIN seasons s ON s.id = p.season_id
        WHERE p.type = 'admin_adjustment' ORDER BY p.id DESC LIMIT ?`
    ),
  };

  return {
    /** Devolve true se a linha foi inserida (false se já existia — duplicado). */
    insert: (data) =>
      s.insert.run({ challengeId: null, resultId: null, streakLength: null, winRank: null, createdBy: null, ...data }).changes === 1,
    forUser: (userId, limit = 500) => s.forUser.all(userId, limit),
    totalForUser: (userId) => s.totalForUser.get(userId),
    adjustments: (limit = 50) => s.adjustments.all(limit),
  };
};
