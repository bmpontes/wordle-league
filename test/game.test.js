'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, createUser, importWords, secretOf, clock, SECRET_WORDS, ACCEPTED_WORDS } = require('./helpers');

async function prepared() {
  const t = setup();
  const admin = await createUser(t.ctx, 'admin', 'admin');
  importWords(t.ctx, admin.id, 'secret', SECRET_WORDS);
  importWords(t.ctx, admin.id, 'accepted', ACCEPTED_WORDS);
  const user = await createUser(t.ctx, 'ana');
  return { t, admin, user, game: t.ctx.services.game };
}

const wrongWords = ['ARROZ', 'BOLSA', 'CHAVE', 'DENTE', 'FESTA', 'GRUPO', 'HORTA'];

test('palavra inválida é rejeitada sem consumir tentativa', async () => {
  const { t, user, game } = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    for (const bad of ['XXXXX', 'ABC', 'CASASS', 'AB1CD', '', 'NU EM']) {
      assert.throws(() => game.submitGuess(user.id, bad), (e) => e.status === 422, bad);
    }
    assert.throws(() => game.submitGuess(user.id, 42), (e) => e.status === 400);
    const s = game.getState(user.id);
    assert.equal(s.status, 'not_started');
    assert.equal(s.attemptsUsed, 0);
    assert.equal(s.attemptsLeft, 6);
  } finally {
    clock.reset();
    t.close();
  }
});

test('palavras aceites com e sem acentos (modo "strip") e forma original preservada', async () => {
  const { t, user, game } = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    const s = game.submitGuess(user.id, 'macas'); // existe como MAÇÃS
    assert.equal(s.guesses[0].word, 'MAÇÃS');
    assert.equal(s.attemptsUsed, 1);
  } finally {
    clock.reset();
    t.close();
  }
});

test('vitória: pontos conforme o número de tentativas e jogo bloqueado depois', async () => {
  const { t, user, game } = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    game.getState(user.id);
    const secret = secretOf(t.ctx);
    game.submitGuess(user.id, wrongWords[0]);
    game.submitGuess(user.id, wrongWords[1]);
    const s = game.submitGuess(user.id, secret.toLowerCase());
    assert.equal(s.status, 'won');
    assert.equal(s.attemptsUsed, 3);
    assert.equal(s.points, 65);
    assert.equal(s.solution, secret);
    assert.deepEqual(s.lastPattern, Array(5).fill('correct'));
    assert.throws(() => game.submitGuess(user.id, wrongWords[2]), (e) => e.code === 'GAME_OVER');
    assert.equal(t.ctx.models.points.totalForUser(user.id), 65);
  } finally {
    clock.reset();
    t.close();
  }
});

test('derrota: limite de seis tentativas e pontos de participação', async () => {
  const { t, user, game } = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    let s;
    for (let i = 0; i < 6; i++) {
      s = game.submitGuess(user.id, wrongWords[i]);
      if (i < 5) {
        assert.equal(s.status, 'in_progress');
        assert.equal(s.solution, undefined, 'a solução não é revelada durante o jogo');
      }
    }
    assert.equal(s.status, 'lost');
    assert.equal(s.attemptsLeft, 0);
    assert.equal(s.points, 5);
    assert.equal(s.solution, secretOf(t.ctx));
    assert.throws(() => game.submitGuess(user.id, wrongWords[6]), (e) => e.code === 'GAME_OVER');
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM guesses').pluck().get(), 6);
  } finally {
    clock.reset();
    t.close();
  }
});

test('pontuação por número de tentativas (100/80/65/50/35/25)', async () => {
  const expected = [100, 80, 65, 50, 35, 25];
  for (let attempts = 1; attempts <= 6; attempts++) {
    const { t, user, game } = await prepared();
    try {
      clock.set('2026-07-14T10:00:00Z');
      game.getState(user.id);
      for (let i = 0; i < attempts - 1; i++) game.submitGuess(user.id, wrongWords[i]);
      const s = game.submitGuess(user.id, secretOf(t.ctx));
      assert.equal(s.points, expected[attempts - 1], `vitória em ${attempts}`);
    } finally {
      clock.reset();
      t.close();
    }
  }
});

test('pontuação configurável pelo administrador', async () => {
  const { t, admin, user, game } = await prepared();
  try {
    t.ctx.services.settings.update({ points_by_attempt: [10, 9, 8, 7, 6, 5], points_loss: 1 }, admin.id);
    clock.set('2026-07-14T10:00:00Z');
    game.getState(user.id);
    assert.equal(game.submitGuess(user.id, secretOf(t.ctx)).points, 10);
    assert.throws(() => t.ctx.services.settings.update({ points_by_attempt: [1, 2] }, admin.id), /um valor por cada tentativa/);
  } finally {
    clock.reset();
    t.close();
  }
});

test('streak: bónus de 15 pontos ao 7.º dia consecutivo, atribuído uma única vez', async () => {
  const { t, user, game } = await prepared();
  try {
    let total = 0;
    for (let day = 1; day <= 8; day++) {
      clock.set(`2026-07-${String(day).padStart(2, '0')}T10:00:00Z`);
      game.getState(user.id);
      const s = game.submitGuess(user.id, secretOf(t.ctx));
      total += s.points;
      assert.equal(s.bonus, day === 7 ? 15 : 0, `dia ${day}`);
    }
    assert.equal(total, 8 * 100 + 15);
    assert.equal(t.ctx.models.points.totalForUser(user.id), total);
    const profile = t.ctx.services.stats.profile(user.id);
    assert.equal(profile.currentStreak, 8);
    assert.equal(profile.bestStreak, 8);
  } finally {
    clock.reset();
    t.close();
  }
});

test('prevenção de pontuação duplicada (serviço e restrições da BD)', async () => {
  const { t, user, game } = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    game.getState(user.id);
    game.submitGuess(user.id, secretOf(t.ctx));
    const challenge = t.ctx.models.challenges.findByDate('2026-07-14');
    const result = t.ctx.models.results.find(challenge.id, user.id);

    // Repetir a atribuição (ex.: pedido duplicado) não gera pontos.
    const again = t.ctx.services.scoring.award({ result, challenge, status: 'won', attempts: 1 });
    assert.equal(again.duplicate, true);
    assert.equal(t.ctx.models.points.totalForUser(user.id), 100);

    // Inserção direta duplicada é rejeitada pela BD.
    assert.throws(() =>
      t.db.prepare(
        "INSERT INTO point_transactions (user_id, season_id, challenge_id, result_id, type, points, reason) VALUES (?, ?, ?, ?, 'game_result', 100, 'x')"
      ).run(user.id, challenge.season_id, challenge.id, result.id)
    );
    // Um segundo resultado para o mesmo desafio/utilizador é impossível.
    assert.throws(() => t.db.prepare('INSERT INTO daily_results (challenge_id, user_id) VALUES (?, ?)').run(challenge.id, user.id));
    // Resultados concluídos e pontos não podem ser alterados nem apagados.
    assert.throws(() => t.db.prepare("UPDATE daily_results SET points = 999 WHERE id = ?").run(result.id), /não pode ser alterado/);
    assert.throws(() => t.db.prepare('UPDATE point_transactions SET points = 999').run(), /não podem ser alterados/);
    assert.throws(() => t.db.prepare('DELETE FROM point_transactions').run(), /não podem ser apagados/);
  } finally {
    clock.reset();
    t.close();
  }
});

test('jogo não concluído num dia anterior expira com pontos de participação', async () => {
  const { t, user, game } = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    game.submitGuess(user.id, wrongWords[0]);
    clock.set('2026-07-15T10:00:00Z');
    const s = game.getState(user.id);
    assert.equal(s.status, 'not_started');
    const hist = t.ctx.services.stats.profile(user.id).history;
    assert.equal(hist.length, 1);
    assert.equal(hist[0].status, 'expired');
    assert.equal(hist[0].points, 5);
    assert.equal(game.finalizeExpired(), 0, 'idempotente');
  } finally {
    clock.reset();
    t.close();
  }
});

test('ajustes administrativos ficam registados e não alteram resultados', async () => {
  const { t, admin, user } = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    assert.throws(() => t.ctx.services.admin.adjustPoints({ userId: user.id, points: 10, reason: '' }, admin.id), /Motivo/);
    t.ctx.services.admin.adjustPoints({ userId: user.id, points: -10, reason: 'Correção de teste' }, admin.id);
    assert.equal(t.ctx.models.points.totalForUser(user.id), -10);
    assert.ok(t.ctx.models.audit.recent().some((a) => a.action === 'points.adjust'));
    assert.ok(t.ctx.services.stats.profile(user.id).pointEvents.some((e) => e.type === 'admin_adjustment'));
  } finally {
    clock.reset();
    t.close();
  }
});
