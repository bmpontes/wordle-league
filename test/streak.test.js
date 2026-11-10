'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/services/streakService');

const r = (date, status) => ({ challenge_date: date, status });

test('qualifica conforme o modo', () => {
  assert.ok(S.qualifies('won', 'wins'));
  assert.ok(!S.qualifies('lost', 'wins'));
  assert.ok(S.qualifies('lost', 'participation'));
  assert.ok(S.qualifies('expired', 'participation'));
  assert.ok(!S.qualifies('in_progress', 'participation'));
});

test('streak termina numa data e é interrompida por falhas', () => {
  const results = [r('2026-10-01', 'won'), r('2026-10-02', 'won'), r('2026-10-03', 'lost'), r('2026-10-04', 'won'), r('2026-10-05', 'won')];
  const wins = S.qualifyingDates(results, 'wins');
  assert.equal(S.streakEndingAt(wins, '2026-10-05'), 2);
  assert.equal(S.streakEndingAt(wins, '2026-10-02'), 2);
  assert.equal(S.streakEndingAt(wins, '2026-10-03'), 0);
  const part = S.qualifyingDates(results, 'participation');
  assert.equal(S.streakEndingAt(part, '2026-10-05'), 5);
});

test('dia sem jogar interrompe a streak', () => {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-04'];
  assert.equal(S.streakEndingAt(dates, '2026-10-04'), 1);
  assert.equal(S.bestStreak(dates), 2);
});

test('streak atual mantém-se viva até ao fim do dia seguinte', () => {
  const dates = ['2026-10-17', '2026-10-18'];
  assert.equal(S.currentStreak(dates, '2026-10-19'), 2); // ainda não jogou hoje
  assert.equal(S.currentStreak(dates, '2026-10-20'), 0); // falhou o dia 19
  assert.equal(S.currentStreak([...dates, '2026-10-19'], '2026-10-19'), 3);
});

test('melhor streak atravessa meses e anos', () => {
  const dates = ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-10'];
  assert.equal(S.bestStreak(dates), 4);
  assert.equal(S.bestStreak([]), 0);
});
