'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { setup, createUser, importWords, login, secretOf, clock, PASSWORD, SECRET_WORDS, ACCEPTED_WORDS } = require('./helpers');

async function prepared() {
  const t = setup();
  const admin = await createUser(t.ctx, 'admin', 'admin');
  importWords(t.ctx, admin.id, 'secret', SECRET_WORDS);
  importWords(t.ctx, admin.id, 'accepted', ACCEPTED_WORDS);
  await createUser(t.ctx, 'ana', 'user', 'Ana');
  await createUser(t.ctx, 'rui', 'user', 'Rui');
  return t;
}

test('endpoints protegidos exigem autenticação e CSRF', async () => {
  const t = await prepared();
  try {
    await request(t.app).get('/api/game/today').expect(401);
    await request(t.app).get('/api/leaderboard/alltime').expect(401);
    await request(t.app).get('/api/admin/status').expect(401);
    await request(t.app).get('/api/health').expect(200);

    // Sem token CSRF o login é recusado.
    const agent = request.agent(t.app);
    await agent.get('/api/auth/session');
    const r = await agent.post('/api/auth/login').send({ username: 'ana', password: PASSWORD });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'CSRF');

    const ana = await login(t.app, 'ana');
    const noToken = await ana.post('/api/game/guess').send({ guess: 'ARROZ' });
    assert.equal(noToken.status, 403);
    const badToken = await ana.post('/api/game/guess').set('X-CSRF-Token', 'x'.repeat(64)).send({ guess: 'ARROZ' });
    assert.equal(badToken.status, 403);
  } finally {
    t.close();
  }
});

test('cookie de sessão HttpOnly e SameSite=Strict; cabeçalhos de segurança', async () => {
  const t = await prepared();
  try {
    const agent = request.agent(t.app);
    const s = await agent.get('/api/auth/session');
    const res = await agent.post('/api/auth/login').set('X-CSRF-Token', s.body.csrfToken).send({ username: 'ana', password: PASSWORD });
    const cookie = res.headers['set-cookie'].join(';');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.ok(res.headers['content-security-policy'].includes("script-src 'self'"));
    assert.equal(res.headers['x-powered-by'], undefined);
  } finally {
    t.close();
  }
});

test('limitação de tentativas de login', async () => {
  const t = await prepared();
  try {
    const agent = request.agent(t.app);
    const s = await agent.get('/api/auth/session');
    for (let i = 0; i < 5; i++) {
      const r = await agent.post('/api/auth/login').set('X-CSRF-Token', s.body.csrfToken).send({ username: 'ana', password: 'errada-123456' });
      assert.equal(r.status, 401);
      assert.equal(r.body.error.message, 'Credenciais inválidas ou conta inativa.');
    }
    const blocked = await agent.post('/api/auth/login').set('X-CSRF-Token', s.body.csrfToken).send({ username: 'ana', password: PASSWORD });
    assert.equal(blocked.status, 429);
    // Outra conta não é afetada.
    await login(t.app, 'rui');
  } finally {
    t.close();
  }
});

test('registo de utilizadores (e desativação pelo administrador)', async () => {
  const t = await prepared();
  try {
    const agent = request.agent(t.app);
    const s = await agent.get('/api/auth/session');
    const bad = await agent.post('/api/auth/register').set('X-CSRF-Token', s.body.csrfToken).send({ username: 'Ma ria', displayName: 'Maria', password: 'curta' });
    assert.equal(bad.status, 400);
    const ok = await agent.post('/api/auth/register').set('X-CSRF-Token', s.body.csrfToken).send({ username: 'maria', displayName: 'Maria', password: 'uma-password-longa' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.role, 'user');
    const dup = await agent.post('/api/auth/register').set('X-CSRF-Token', ok.body.csrfToken).send({ username: 'MARIA', displayName: 'Outra', password: 'uma-password-longa' });
    assert.equal(dup.status, 409);

    const admin = await login(t.app, 'admin');
    await admin.putJson('/api/admin/settings', { registration_enabled: false }).expect(200);
    const s2 = await request.agent(t.app).get('/api/auth/session');
    assert.equal(s2.body.registrationEnabled, false);
  } finally {
    t.close();
  }
});

test('proteção da palavra secreta: nunca enviada antes do fim do jogo', async () => {
  const t = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    const ana = await login(t.app, 'ana');
    const rui = await login(t.app, 'rui');
    const bodies = [];
    const capture = (res) => {
      bodies.push(res.text);
      return res;
    };

    capture(await ana.get('/api/game/today').expect(200));
    const secret = secretOf(t.ctx);
    const plain = t.ctx.models.challenges.findByDate('2026-07-14').word_plain;

    capture(await ana.postJson('/api/game/guess', { guess: 'ARROZ' }).expect(200));
    capture(await ana.postJson('/api/game/guess', { guess: 'QQQQQ' }).expect(422));
    capture(await ana.postJson('/api/game/guess', { guess: 'X' }).expect(422));
    capture(await ana.get('/api/game/today'));
    capture(await ana.get('/api/profile/me'));
    capture(await ana.get('/api/leaderboard/daily'));
    capture(await ana.get('/api/leaderboard/monthly'));
    capture(await ana.get('/api/leaderboard/alltime'));
    capture(await ana.get('/api/admin/stats'));
    capture(await ana.get('/api/admin/status'));
    capture(await ana.get('/api/leaderboard/daily?date=2026-07-15'));
    for (const f of ['index.html', 'js/game.js', 'js/api.js', 'js/common.js']) {
      capture(await request(t.app).get(`/${f}`));
    }
    for (const b of bodies) {
      assert.ok(!b.includes(secret) && !b.includes(plain), `fuga da palavra secreta em: ${b.slice(0, 120)}`);
    }

    // O administrador também não vê a palavra do dia corrente.
    const admin = await login(t.app, 'admin');
    const adminStats = await admin.get('/api/admin/stats');
    assert.ok(!adminStats.text.includes(secret));

    // Depois de terminar, a solução é revelada a quem terminou — e só a quem terminou.
    const done = await ana.postJson('/api/game/guess', { guess: secret });
    assert.equal(done.body.status, 'won');
    assert.equal(done.body.solution, secret);
    const other = await rui.get('/api/game/today');
    assert.ok(!other.text.includes(secret), 'outro utilizador que não terminou não recebe a solução');
  } finally {
    clock.reset();
    t.close();
  }
});

test('isolamento dos dados entre utilizadores e controlo de acessos', async () => {
  const t = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    const ana = await login(t.app, 'ana');
    const rui = await login(t.app, 'rui');
    await ana.postJson('/api/game/guess', { guess: 'ARROZ' }).expect(200);
    await ana.postJson('/api/game/guess', { guess: 'BOLSA' }).expect(200);

    const ruiState = (await rui.get('/api/game/today')).body;
    assert.equal(ruiState.status, 'not_started');
    assert.equal(ruiState.guesses.length, 0);
    const anaState = (await ana.get('/api/game/today')).body;
    assert.equal(anaState.guesses.length, 2);

    // Campos extra no pedido são ignorados (não é possível jogar por outro utilizador).
    await rui.postJson('/api/game/guess', { guess: 'CHAVE', userId: 1 }).expect(200);
    assert.equal((await ana.get('/api/game/today')).body.guesses.length, 2);

    await rui.get('/api/admin/users').expect(403);
    await rui.postJson('/api/admin/points/adjust', { userId: 2, points: 100, reason: 'tentativa' }).expect(403);
    await rui.postJson('/api/admin/words/preview', { listType: 'secret', content: 'AAAAA' }).expect(403);
  } finally {
    clock.reset();
    t.close();
  }
});

test('utilizador bloqueado perde a sessão e não consegue entrar', async () => {
  const t = await prepared();
  try {
    const rui = await login(t.app, 'rui');
    const admin = await login(t.app, 'admin');
    const ruiId = t.ctx.models.users.findAuthByUsername('rui').id;
    await admin.postJson(`/api/admin/users/${ruiId}/block`, {}).expect(200);
    await rui.get('/api/game/today').expect(401);
    await assert.rejects(login(t.app, 'rui'), /401/);
    await admin.postJson(`/api/admin/users/${ruiId}/unblock`, {}).expect(200);
    await login(t.app, 'rui');
    // O administrador não se pode bloquear a si próprio.
    const adminId = t.ctx.models.users.findAuthByUsername('admin').id;
    await admin.postJson(`/api/admin/users/${adminId}/block`, {}).expect(400);
  } finally {
    t.close();
  }
});

test('regras refletem os parâmetros definidos pelo administrador', async () => {
  const t = await prepared();
  try {
    await request(t.app).get('/api/rules').expect(401);
    const page = await request(t.app).get('/regras').expect(200);
    assert.match(page.text, /Regras/);

    const ana = await login(t.app, 'ana');
    let r = (await ana.get('/api/rules').expect(200)).body;
    assert.equal(r.maxAttempts, 6);
    assert.deepEqual(r.pointsByAttempt, [100, 80, 65, 50, 35, 25]);

    const admin = await login(t.app, 'admin');
    await admin.putJson('/api/admin/settings', {
      play_start: '10:00', play_end: '18:30', podium_bonus_points: [20, 5], streak_bonus_days: 5,
      max_attempts: 5, points_by_attempt: [90, 70, 50, 30, 10],
    }).expect(200);
    r = (await ana.get('/api/rules').expect(200)).body;
    assert.equal(r.playStart, '10:00');
    assert.equal(r.playEnd, '18:30');
    assert.deepEqual(r.podiumBonus, [20, 5]);
    assert.equal(r.streakBonusDays, 5);
    assert.equal(r.maxAttempts, 5);
    assert.deepEqual(r.pointsByAttempt, [90, 70, 50, 30, 10]);
    for (const k of ['selection_seed', 'recycle_words', 'registration_enabled']) assert.ok(!(k in r), k);
  } finally {
    t.close();
  }
});

test('administrador altera o nome de apresentação (validado, auditado, refletido nas classificações)', async () => {
  const t = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    const ana = await login(t.app, 'ana');
    await ana.get('/api/game/today');
    await ana.postJson('/api/game/guess', { guess: secretOf(t.ctx) }).expect(200);
    const anaId = t.ctx.models.users.findAuthByUsername('ana').id;

    const admin = await login(t.app, 'admin');
    const r = await admin.postJson(`/api/admin/users/${anaId}/display-name`, { displayName: '  2SAR Ana Silva ' }).expect(200);
    assert.equal(r.body.user.displayName, '2SAR Ana Silva');
    assert.equal(r.body.user.username, 'ana', 'o nome de utilizador não muda');

    const board = (await request(t.app).get('/api/public/leaderboard')).body;
    assert.equal(board.rows[0].displayName, '2SAR Ana Silva');
    const entry = t.ctx.models.audit.recent().find((a) => a.action === 'user.rename');
    assert.deepEqual(entry.details, { from: 'Ana', to: '2SAR Ana Silva' });

    await admin.postJson(`/api/admin/users/${anaId}/display-name`, { displayName: 'X' }).expect(400);
    await admin.postJson(`/api/admin/users/${anaId}/display-name`, { displayName: '<b>Ana</b>' }).expect(400);
    await admin.postJson('/api/admin/users/9999/display-name', { displayName: 'Ninguém' }).expect(404);
    await ana.postJson(`/api/admin/users/${anaId}/display-name`, { displayName: 'Eu Própria' }).expect(403);
    await login(t.app, 'ana'); // a sessão e a password não são afetadas
  } finally {
    clock.reset();
    t.close();
  }
});

test('leaderboard diária: desempate por tentativas e por hora de conclusão; mensal e geral', async () => {
  const t = await prepared();
  try {
    clock.set('2026-07-14T10:00:00Z');
    const ana = await login(t.app, 'ana');
    const rui = await login(t.app, 'rui');
    await ana.get('/api/game/today');
    const secret = secretOf(t.ctx);

    clock.set('2026-07-14T11:00:00Z');
    await rui.postJson('/api/game/guess', { guess: secret }).expect(200);
    clock.set('2026-07-14T12:00:00Z');
    await ana.postJson('/api/game/guess', { guess: secret }).expect(200);

    const daily = (await ana.get('/api/leaderboard/daily')).body;
    assert.deepEqual(daily.rows.map((r) => r.displayName), ['Rui', 'Ana'], 'quem terminou primeiro fica à frente');
    assert.equal(daily.rows[1].isMe, true);
    assert.equal(daily.rows[0].points, 100);

    const monthly = (await ana.get('/api/leaderboard/monthly')).body;
    assert.equal(monthly.season, '2026-07');
    assert.equal(monthly.rows.length, 2);
    assert.equal(monthly.rows[0].successRate, 100);
    for (const key of ['position', 'displayName', 'points', 'wins', 'successRate', 'bestStreak']) {
      assert.ok(key in monthly.rows[0], key);
    }
    assert.ok(!('userId' in monthly.rows[0]));

    // Novo mês: a mensal reinicia, a geral mantém.
    clock.set('2026-07-31T23:30:00Z'); // 00:30 de 1 de agosto em Lisboa
    const aug = (await ana.get('/api/leaderboard/monthly')).body;
    assert.equal(aug.season, '2026-08');
    assert.equal(aug.rows.length, 0);
    const all = (await ana.get('/api/leaderboard/alltime')).body;
    assert.equal(all.rows.length, 2);
    const julHistory = (await ana.get('/api/leaderboard/monthly?season=2026-07')).body;
    assert.equal(julHistory.rows.length, 2, 'histórico das épocas anteriores');

    await ana.get('/api/leaderboard/monthly?season=2026-13').expect(400);
    await ana.get("/api/leaderboard/daily?date=2026-01-01'--").expect(400);
  } finally {
    clock.reset();
    t.close();
  }
});

test('classificação pública: só o mês em curso, sem sessão, sem dados sensíveis e desativável', async () => {
  const t = await prepared();
  try {
    clock.set('2026-06-30T10:00:00Z');
    const rui = await login(t.app, 'rui');
    await rui.get('/api/game/today');
    await rui.postJson('/api/game/guess', { guess: secretOf(t.ctx) }).expect(200); // pontos em junho

    clock.set('2026-07-14T10:00:00Z');
    const ana = await login(t.app, 'ana');
    await ana.get('/api/game/today');
    const secret = secretOf(t.ctx);
    await ana.postJson('/api/game/guess', { guess: 'ARROZ' }).expect(200);

    const anon = request(t.app);
    const page = await anon.get('/ranking').expect(200);
    assert.match(page.text, /Classificação/);

    // Jogo em curso: a palavra nunca aparece; a resposta não cria sessão.
    const during = await anon.get('/api/public/leaderboard').expect(200);
    assert.equal(during.headers['set-cookie'], undefined);
    assert.ok(!during.text.includes(secret));
    assert.equal(during.body.season, '2026-07');
    assert.equal(during.body.endsOn, '2026-07-31');
    assert.equal(during.body.rows.length, 0, 'os pontos de junho não contam');

    await ana.postJson('/api/game/guess', { guess: secret }).expect(200);
    const after = await anon.get('/api/public/leaderboard?season=2026-06').expect(200);
    assert.equal(after.body.season, '2026-07', 'não é possível pedir outro mês');
    assert.deepEqual(after.body.rows.map((r) => r.displayName), ['Ana']);
    assert.ok(!after.text.includes(secret), 'nem depois de alguém terminar');
    const row = after.body.rows[0];
    for (const k of ['userId', 'username', 'isMe']) assert.ok(!(k in row), k);

    // Não existem outras classificações públicas; as autenticadas continuam protegidas.
    await anon.get('/api/public/leaderboard/alltime').expect(404);
    await anon.get('/api/public/leaderboard/daily').expect(404);
    await anon.get('/api/leaderboard/monthly').expect(401);

    const admin = await login(t.app, 'admin');
    await admin.putJson('/api/admin/settings', { public_leaderboard: false }).expect(200);
    await anon.get('/api/public/leaderboard').expect(404);
    await ana.get('/api/leaderboard/alltime').expect(200);
  } finally {
    clock.reset();
    t.close();
  }
});

test('importação via API: resumo, confirmação explícita e exportação', async () => {
  const t = await prepared();
  try {
    const admin = await login(t.app, 'admin');
    const content = fs.readFileSync(path.join(__dirname, '..', 'examples', 'exemplo-palavras.txt'), 'utf8');
    const p = (await admin.postJson('/api/admin/words/preview', { listType: 'secret', filename: 'exemplo-palavras.txt', content }).expect(200)).body;
    assert.ok(p.validCount > 0);
    assert.ok(p.previewId);
    const r = await admin.postJson('/api/admin/words/import', { previewId: p.previewId, mode: 'replace' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'CONFIRM_REQUIRED');
    const ok = await admin.postJson('/api/admin/words/import', { previewId: p.previewId, mode: 'replace', confirmReplace: true }).expect(200);
    assert.equal(ok.body.total, p.validCount);
    const exp = await admin.get('/api/admin/words/secret/export').expect(200);
    assert.match(exp.headers['content-disposition'], /attachment/);
    assert.equal(exp.text.trim().split('\n').length, p.validCount);
  } finally {
    t.close();
  }
});
