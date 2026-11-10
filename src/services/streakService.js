'use strict';

const { addDays } = require('../utils/time');

/**
 * Cálculo de streaks (funções puras). Uma streak é uma sequência de dias de
 * calendário consecutivos (fuso Europe/Lisbon) em que o resultado "conta":
 *  - modo "wins": dias com vitória;
 *  - modo "participation": dias com jogo concluído (vitória, derrota ou expirado).
 */

function qualifies(status, mode) {
  if (mode === 'participation') return status === 'won' || status === 'lost' || status === 'expired';
  return status === 'won';
}

/** Datas (ordenadas, sem repetição) dos resultados que contam para a streak. */
function qualifyingDates(results, mode) {
  return [...new Set(results.filter((r) => qualifies(r.status, mode)).map((r) => r.challenge_date))].sort();
}

/** Comprimento da streak que termina exatamente em "date" (0 se esse dia não conta). */
function streakEndingAt(dates, date) {
  const set = new Set(dates);
  let n = 0;
  let d = date;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

function bestStreak(dates) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of dates) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/**
 * Streak atual: termina hoje, ou ontem se o jogo de hoje ainda não contou
 * (o utilizador ainda pode jogar hoje sem perder a streak).
 */
function currentStreak(dates, today) {
  const t = streakEndingAt(dates, today);
  return t > 0 ? t : streakEndingAt(dates, addDays(today, -1));
}

module.exports = { qualifies, qualifyingDates, streakEndingAt, bestStreak, currentStreak };
