'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickWord } = require('../src/services/dailyWordService');
const { setup, createUser, importWords, clock, SECRET_WORDS } = require('./helpers');

const cands = (words) => words.map((w, i) => ({ id: i + 1, word: w, key: w }));

test('pickWord é determinístico para a mesma semente e lista', () => {
  const list = cands(SECRET_WORDS);
  const a = pickWord(list, new Map(), 'seed-1');
  const b = pickWord([...list].reverse(), new Map(), 'seed-1');
  assert.equal(a.candidate.word, b.candidate.word, 'a ordem do ficheiro não influencia a escolha');
  assert.equal(a.cycle, 1);
});

test('pickWord não repete palavras até esgotar a lista', () => {
  const list = cands(SECRET_WORDS);
  const usage = new Map();
  const picked = [];
  for (let i = 0; i < list.length; i++) {
    const p = pickWord(list, usage, 'seed-x');
    picked.push(p.candidate.word);
    usage.set(p.candidate.key, 1);
  }
  assert.equal(new Set(picked).size, list.length);
  assert.deepEqual(pickWord(list, usage, 'seed-x'), { exhausted: true });
  const recycled = pickWord(list, usage, 'seed-x', { recycle: true });
  assert.equal(recycled.cycle, 2);
  assert.deepEqual(pickWord([], new Map(), 's'), { empty: true });
});

test('desafio diário: sem lista importada → erro controlado', async () => {
  const t = setup();
  try {
    clock.set('2026-07-14T10:00:00Z');
    assert.throws(() => t.ctx.services.dailyWord.ensureChallenge(), (e) => e.status === 503 && e.code === 'NO_WORDS');
    const user = await createUser(t.ctx, 'ana');
    const state = t.ctx.services.game.getState(user.id);
    assert.equal(state.available, false);
    assert.equal(state.code, 'NO_WORDS');
    assert.equal(t.ctx.models.challenges.count(), 0);
  } finally {
    clock.reset();
    t.close();
  }
});

test('desafio diário: a mesma palavra durante todo o dia e mudança à meia-noite de Lisboa', async () => {
  const t = setup();
  try {
    const admin = await createUser(t.ctx, 'admin', 'admin');
    importWords(t.ctx, admin.id, 'secret', SECRET_WORDS);
    const dw = t.ctx.services.dailyWord;

    clock.set('2026-07-14T00:00:00Z'); // 01:00 em Lisboa (verão)
    const morning = dw.ensureChallenge();
    assert.equal(morning.challenge_date, '2026-07-14');

    clock.set('2026-07-14T22:59:59Z'); // 23:59:59 em Lisboa
    const late = dw.ensureChallenge();
    assert.equal(late.id, morning.id);
    assert.equal(late.word, morning.word);

    clock.set('2026-07-14T23:00:00Z'); // 00:00 de 15/07 em Lisboa
    const next = dw.ensureChallenge();
    assert.equal(next.challenge_date, '2026-07-15');
    assert.notEqual(next.word, morning.word, 'não repete palavras');

    // Inverno: meia-noite = 00:00 UTC
    clock.set('2026-12-01T23:59:59Z');
    assert.equal(dw.ensureChallenge().challenge_date, '2026-12-01');
    clock.set('2026-12-02T00:00:00Z');
    assert.equal(dw.ensureChallenge().challenge_date, '2026-12-02');
  } finally {
    clock.reset();
    t.close();
  }
});

test('lista esgotada: aviso e erro controlado, reutilização só com configuração explícita', async () => {
  const t = setup();
  try {
    const admin = await createUser(t.ctx, 'admin', 'admin');
    importWords(t.ctx, admin.id, 'secret', ['PEDRA', 'LIVRO']);
    const dw = t.ctx.services.dailyWord;
    clock.set('2026-07-01T10:00:00Z');
    const d1 = dw.ensureChallenge();
    clock.set('2026-07-02T10:00:00Z');
    const d2 = dw.ensureChallenge();
    assert.notEqual(d1.word, d2.word);

    clock.set('2026-07-03T10:00:00Z');
    assert.throws(() => dw.ensureChallenge(), (e) => e.code === 'WORDS_EXHAUSTED');
    assert.ok(dw.poolStatus().exhausted);
    assert.ok(t.ctx.services.admin.status().warnings.some((w) => /esgotada/.test(w)));

    t.ctx.services.settings.update({ recycle_words: true }, admin.id);
    const d3 = dw.ensureChallenge();
    assert.equal(d3.cycle, 2);
    assert.ok(['PEDRA', 'LIVRO'].includes(d3.word));
  } finally {
    clock.reset();
    t.close();
  }
});

test('substituir a lista não altera desafios já criados nem repete palavras usadas', async () => {
  const t = setup();
  try {
    const admin = await createUser(t.ctx, 'admin', 'admin');
    importWords(t.ctx, admin.id, 'secret', ['PEDRA']);
    clock.set('2026-07-01T10:00:00Z');
    const d1 = t.ctx.services.dailyWord.ensureChallenge();
    importWords(t.ctx, admin.id, 'secret', ['PEDRA', 'NUVEM']);
    assert.equal(t.ctx.models.challenges.findByDate('2026-07-01').word, d1.word);
    clock.set('2026-07-02T10:00:00Z');
    assert.equal(t.ctx.services.dailyWord.ensureChallenge().word, 'NUVEM');
  } finally {
    clock.reset();
    t.close();
  }
});
