'use strict';

module.exports = (db) => {
  const s = {
    byDate: db.prepare('SELECT * FROM daily_challenges WHERE challenge_date = ?'),
    byId: db.prepare('SELECT * FROM daily_challenges WHERE id = ?'),
    insert: db.prepare(
      `INSERT INTO daily_challenges
         (challenge_date, season_id, word_bank_id, word, word_plain, word_length, max_attempts, accent_mode, cycle)
       VALUES (@date, @seasonId, @wordBankId, @word, @plain, @length, @maxAttempts, @accentMode, @cycle)`
    ),
    usageByPlain: db.prepare('SELECT word_plain, COUNT(*) AS n FROM daily_challenges GROUP BY word_plain'),
    usageByWord: db.prepare('SELECT word, COUNT(*) AS n FROM daily_challenges GROUP BY word'),
    maxCycle: db.prepare('SELECT COALESCE(MAX(cycle), 0) FROM daily_challenges').pluck(),
    count: db.prepare('SELECT COUNT(*) FROM daily_challenges').pluck(),
    pastWithStats: db.prepare(
      `SELECT c.id, c.challenge_date, c.word, c.word_length, c.max_attempts,
              COUNT(r.id) AS players,
              SUM(r.status = 'won') AS wins,
              ROUND(AVG(CASE WHEN r.status = 'won' THEN r.attempts_used END), 2) AS avg_attempts
         FROM daily_challenges c
         LEFT JOIN daily_results r ON r.challenge_id = c.id
        WHERE c.challenge_date < ?
        GROUP BY c.id ORDER BY c.challenge_date DESC LIMIT ?`
    ),
  };

  return {
    findByDate: (date) => s.byDate.get(date),
    findById: (id) => s.byId.get(id),
    insert: (data) => Number(s.insert.run(data).lastInsertRowid),
    usage(accentMode) {
      const rows = accentMode === 'strict' ? s.usageByWord.all() : s.usageByPlain.all();
      const map = new Map();
      for (const r of rows) map.set(accentMode === 'strict' ? r.word : r.word_plain, r.n);
      return map;
    },
    maxCycle: () => s.maxCycle.get(),
    count: () => s.count.get(),
    pastWithStats: (beforeDate, limit = 60) => s.pastWithStats.all(beforeDate, limit),
  };
};
