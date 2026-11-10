'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { setup, createUser, importWords, login, tempDir, clock, SECRET_WORDS, ACCEPTED_WORDS } = require('./helpers');

test('persistência após reiniciar: desafio, tentativas, pontos, sessões e segredo', async () => {
  const dir = tempDir();
  const dbFile = path.join(dir, 'wordle.sqlite');
  const env = { SESSION_SECRET: '' }; // força a geração e persistência do segredo no diretório de dados
  clock.set('2026-07-14T10:00:00Z');
  try {
    // 1.º arranque
    let t = setup({ dbFile, dataDir: dir, env });
    const admin = await createUser(t.ctx, 'admin', 'admin');
    importWords(t.ctx, admin.id, 'secret', SECRET_WORDS);
    importWords(t.ctx, admin.id, 'accepted', ACCEPTED_WORDS);
    await createUser(t.ctx, 'ana');
    const seed = t.ctx.models.settings.get('selection_seed');
    const ana = await login(t.app, 'ana');
    await ana.postJson('/api/game/guess', { guess: 'ARROZ' }).expect(200);
    const word = t.ctx.models.challenges.findByDate('2026-07-14').word;
    const cookie = ana.sessionCookie;
    t.close();
    assert.ok(fs.existsSync(path.join(dir, '.session_secret')));

    // 2.º arranque (novo processo lógico sobre a mesma BD)
    t = setup({ dbFile, dataDir: dir, env });
    assert.equal(t.ctx.models.settings.get('selection_seed'), seed);
    assert.equal(t.ctx.services.dailyWord.ensureChallenge().word, word, 'a palavra não muda com o reinício');
    assert.equal(t.ctx.models.challenges.count(), 1);

    // A sessão anterior continua válida (sessões persistidas + segredo persistido).
    const res = await request(t.app).get('/api/game/today').set('Cookie', cookie).expect(200);
    assert.equal(res.body.attemptsUsed, 1);
    assert.equal(res.body.guesses[0].word, 'ARROZ');

    // Concluir o jogo e reiniciar outra vez: pontos mantêm-se e não são duplicados.
    const ana2 = await login(t.app, 'ana');
    await ana2.postJson('/api/game/guess', { guess: word }).expect(200);
    const userId = t.ctx.models.users.findAuthByUsername('ana').id;
    const total = t.ctx.models.points.totalForUser(userId);
    t.close();

    t = setup({ dbFile, dataDir: dir, env });
    assert.equal(t.ctx.models.points.totalForUser(userId), total);
    assert.equal(total, 80);
    t.ctx.services.game.finalizeExpired();
    assert.equal(t.ctx.models.points.totalForUser(userId), total);
    t.close();
  } finally {
    clock.reset();
  }
});
