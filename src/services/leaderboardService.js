'use strict';

const streaks = require('./streakService');
const { monthBounds, seasonCode, isValidDateString } = require('../utils/time');
const { badRequest } = require('../utils/errors');

/**
 * Classificações calculadas sempre a partir dos dados persistidos
 * (livro de pontos + resultados), nunca de valores enviados pelo cliente.
 * Utilizadores bloqueados não aparecem nas classificações.
 */
module.exports = function createLeaderboardService({ db, models, settings, dailyWord }) {
  const s = {
    daily: db.prepare(
      `SELECT u.id AS user_id, u.display_name, r.status, r.attempts_used, r.finished_at,
              COALESCE((SELECT SUM(p.points) FROM point_transactions p
                         WHERE p.result_id = r.id AND p.type IN ('game_result', 'streak_bonus', 'first_win_bonus')), 0) AS points
         FROM daily_results r
         JOIN users u ON u.id = r.user_id
         JOIN daily_challenges c ON c.id = r.challenge_id
        WHERE c.challenge_date = ? AND r.status <> 'in_progress' AND u.status = 'active'`
    ),
    pointsAll: db.prepare(
      `SELECT p.user_id, SUM(p.points) AS points FROM point_transactions p GROUP BY p.user_id`
    ),
    pointsSeason: db.prepare(
      `SELECT p.user_id, SUM(p.points) AS points FROM point_transactions p
         JOIN seasons s ON s.id = p.season_id WHERE s.code = ? GROUP BY p.user_id`
    ),
    activeUsers: db.prepare("SELECT id, display_name FROM users WHERE status = 'active'"),
  };

  function streakMaps(from, to) {
    const mode = settings.getAll().streak_mode;
    const byUser = new Map();
    for (const r of models.results.allFinishedBetween(from, to)) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(r);
    }
    const out = new Map();
    for (const [uid, rows] of byUser) {
      out.set(uid, {
        games: rows.length,
        wins: rows.filter((r) => r.status === 'won').length,
        bestStreak: streaks.bestStreak(streaks.qualifyingDates(rows, mode)),
      });
    }
    return out;
  }

  const rate = (wins, games) => (games ? Math.round((wins / games) * 1000) / 10 : 0);

  function daily(date, viewerId = null) {
    const d = date || dailyWord.today();
    if (!isValidDateString(d)) throw badRequest('Data inválida.');
    if (d > dailyWord.today()) throw badRequest('Não existem classificações para datas futuras.');
    const allTime = streakMaps('0000-01-01', '9999-12-31');
    const rows = s.daily.all(d).sort(
      (a, b) =>
        b.points - a.points ||
        (b.status === 'won') - (a.status === 'won') ||
        a.attempts_used - b.attempts_used ||
        String(a.finished_at).localeCompare(String(b.finished_at))
    );
    return {
      type: 'daily',
      date: d,
      rows: rows.map((r, i) => ({
        position: i + 1,
        displayName: r.display_name,
        points: r.points,
        wins: r.status === 'won' ? 1 : 0,
        successRate: r.status === 'won' ? 100 : 0,
        bestStreak: (allTime.get(r.user_id) || {}).bestStreak || 0,
        attempts: r.attempts_used,
        status: r.status,
        isMe: r.user_id === viewerId,
      })),
    };
  }

  function aggregate(pointRows, from, to, viewerId) {
    const users = new Map(s.activeUsers.all().map((u) => [u.id, u.display_name]));
    const stats = streakMaps(from, to);
    const points = new Map(pointRows.map((r) => [r.user_id, r.points]));
    const ids = new Set([...points.keys(), ...stats.keys()]);
    const rows = [];
    for (const id of ids) {
      if (!users.has(id)) continue;
      const st = stats.get(id) || { games: 0, wins: 0, bestStreak: 0 };
      rows.push({
        displayName: users.get(id),
        points: points.get(id) || 0,
        games: st.games,
        wins: st.wins,
        successRate: rate(st.wins, st.games),
        bestStreak: st.bestStreak,
        isMe: id === viewerId,
        userId: id,
      });
    }
    rows.sort(
      (a, b) =>
        b.points - a.points || b.wins - a.wins || b.successRate - a.successRate || a.displayName.localeCompare(b.displayName, 'pt')
    );
    return rows.map((r, i) => ({ position: i + 1, ...r }));
  }

  /** Classificação mensal. Por omissão, o mês em curso (fuso Europe/Lisbon). */
  function monthly(code, { includeUserIds = false, viewerId = null } = {}) {
    const season = code || seasonCode(dailyWord.today());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(season)) throw badRequest('Época inválida (formato AAAA-MM).');
    const { start, end } = monthBounds(season);
    const rows = aggregate(s.pointsSeason.all(season), start, end, viewerId);
    return { type: 'monthly', season, rows: includeUserIds ? rows : rows.map(stripId) };
  }

  function allTime(viewerId = null) {
    return { type: 'alltime', rows: aggregate(s.pointsAll.all(), '0000-01-01', '9999-12-31', viewerId).map(stripId) };
  }

  function stripId({ userId, ...rest }) {
    void userId;
    return rest;
  }

  function seasons() {
    const current = seasonCode(dailyWord.today());
    const list = models.seasons.list().map((x) => x.code);
    if (!list.includes(current)) list.unshift(current);
    return { current, seasons: list };
  }

  return { daily, monthly, allTime, seasons };
};
