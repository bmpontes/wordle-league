'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/utils/time');

const TZ = 'Europe/Lisbon';

test('verão (UTC+1): a meia-noite de Lisboa é às 23:00 UTC', () => {
  assert.equal(T.localDate(new Date('2026-07-14T22:59:59Z'), TZ), '2026-07-14');
  assert.equal(T.localDate(new Date('2026-07-14T23:00:00Z'), TZ), '2026-07-15');
  assert.equal(T.nextMidnight(new Date('2026-07-14T12:00:00Z'), TZ).toISOString(), '2026-07-14T23:00:00.000Z');
});

test('inverno (UTC+0): a meia-noite de Lisboa é às 00:00 UTC', () => {
  assert.equal(T.localDate(new Date('2026-01-14T23:59:59Z'), TZ), '2026-01-14');
  assert.equal(T.localDate(new Date('2026-01-15T00:00:00Z'), TZ), '2026-01-15');
  assert.equal(T.nextMidnight(new Date('2026-01-14T12:00:00Z'), TZ).toISOString(), '2026-01-15T00:00:00.000Z');
});

test('dias de mudança de hora', () => {
  // 2026-03-29: passa a UTC+1 à 01:00 UTC. A meia-noite de 30/03 é 29/03 23:00 UTC.
  assert.equal(T.nextMidnight(new Date('2026-03-29T12:00:00Z'), TZ).toISOString(), '2026-03-29T23:00:00.000Z');
  // 2026-10-25: volta a UTC+0. A meia-noite de 26/10 é 26/10 00:00 UTC.
  assert.equal(T.nextMidnight(new Date('2026-10-25T12:00:00Z'), TZ).toISOString(), '2026-10-26T00:00:00.000Z');
  // Na véspera, a meia-noite de 25/10 ainda é em UTC+1.
  assert.equal(T.nextMidnight(new Date('2026-10-24T12:00:00Z'), TZ).toISOString(), '2026-10-24T23:00:00.000Z');
});

test('aritmética de datas e épocas', () => {
  assert.equal(T.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(T.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(T.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(T.seasonCode('2026-10-19'), '2026-10');
  assert.deepEqual(T.monthBounds('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.ok(T.isValidDateString('2026-10-19'));
  assert.ok(!T.isValidDateString('2026-02-30'));
  assert.ok(!T.isValidDateString("2026-01-01' OR 1=1"));
});
