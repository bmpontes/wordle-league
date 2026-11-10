'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { openDatabase } = require('../src/db');
const { migrate } = require('../src/db/migrate');
const { setup, createUser, importWords, login, secretOf, tempDir, clock, SECRET_WORDS, ACCEPTED_WORDS } = require('./helpers');

async function prepared() {
  const t = setup({ neutral: false }); // valores reais: 09:30–00:00 e bónus de 10
  const admin = await createUser(t.ctx, 'admin', 'admin');
  importWords(t.ctx, admin.id, 'secret', SECRET_WORDS);
  importWords(t.ctx, admin.id, 'accepted', ACCEPTED_WORDS);
  const ana = await createUser(t.ctx, 'ana', 'user', 'Ana');
  const rui = await createUser(t.ctx, 'rui', 'user', 'Rui');
  const eva = await createUser(t.ctx, 'eva', 'user', 'Eva');
  return { t, admin, ana, rui, eva, game: t.ctx.services.game };
}

test('período de jogo por omissão: 09:30 às 00:00 (hora de Portugal)', async () => {
  const { t, ana, game } = await prepared();
  try {
    // 14/07 é horário de verão (UTC+1): 09:29 em Lisboa = 08:29 UTC.
    clock.set('2026-07-14T08:29:00Z');
    let s = game.getState(ana.id);
    assert.equal(s.available, false);
    assert.equal(s.code, 'CLOSED');
    assert.match(s.message, /abre às 09:30/);
    assert.equal(s.window.opensAt, '2026-07-14T08:30:00.000Z');
    assert.throws(() => game.submitGuess(ana.id, 'ARROZ'), (e) => e.code === 'CLOSED');
    assert.equal(t.ctx.models.challenges.count(), 0, 'antes da abertura nem sequer é escolhida a palavra');

    clock.set('2026-07-14T08:30:00Z'); // 09:30 em Lisboa
    s = game.getState(ana.id);
    assert.equal(s.available, true);
    assert.equal(s.window.open, true);
    assert.equal(s.window.closesAt, '2026-07-14T23:00:00.000Z'); // meia-noite de Lisboa
    game.submitGuess(ana.id, 'ARROZ');

    clock.set('2026-07-14T22:59:59Z'); // 23:59:59 ainda aberto
    assert.equal(game.getState(ana.id).window.open, true);

    // Inverno (UTC+0): 09:30 em Lisboa = 09:30 UTC.
    clock.set('2026-12-01T09:29:00Z');
    assert.equal(game.getState(ana.id).code, 'CLOSED');
    clock.set('2026-12-01T09:30:00Z');
    assert.equal(game.getState(ana.id).available, true);
  } finally {
    clock.reset();
    t.close();
  }
});

test('período configurável: depois do fecho não se joga, mas vê-se o resultado', async () => {
  const { t, admin, ana, rui, game } = await prepared();
  try {
    const settings = t.ctx.services.settings;
    assert.throws(() => settings.update({ play_start: '18:00', play_end: '12:00' }, admin.id), /anterior à hora de fecho/);
    assert.throws(() => settings.update({ play_start: '9:30' }, admin.id), /Hora de abertura/);
    assert.throws(() => settings.update({ play_end: '24:00' }, admin.id), /Hora de fecho/);
    settings.update({ play_start: '10:00', play_end: '18:00' }, admin.id);
    assert.ok(t.ctx.models.audit.recent().some((a) => a.action === 'settings.update' && a.details.play_end));

    clock.set('2026-07-14T10:00:00Z'); // 11:00 em Lisboa
    game.getState(ana.id);
    game.submitGuess(ana.id, secretOf(t.ctx));
    game.submitGuess(rui.id, 'ARROZ');

    clock.set('2026-07-14T17:00:00Z'); // 18:00 em Lisboa → fechado
    const anaState = game.getState(ana.id);
    assert.equal(anaState.status, 'won', 'quem terminou continua a ver o resultado');
    assert.equal(anaState.window.open, false);
    const ruiState = game.getState(rui.id);
    assert.equal(ruiState.status, 'in_progress');
    assert.equal(ruiState.solution, undefined, 'a palavra continua secreta para quem não terminou');
    assert.throws(() => game.submitGuess(rui.id, 'BOLSA'), (e) => e.code === 'CLOSED');
    assert.match(game.getState(t.ctx.models.users.findAuthByUsername('eva').id).message, /terminou às 18:00.*a partir das 10:00/);
    assert.equal(game.playWindow().opensAt, '2026-07-15T09:00:00.000Z');

    // No dia seguinte, o jogo que ficou a meio expira com pontos de participação.
    clock.set('2026-07-15T10:00:00Z');
    game.getState(rui.id);
    assert.equal(t.ctx.services.stats.profile(rui.id).history[0].status, 'expired');
  } finally {
    clock.reset();
    t.close();
  }
});

test('bónus de pódio: 15, 10 e 5 pontos para o 1.º, 2.º e 3.º a acertar', async () => {
  const { t, ana, rui, eva, game } = await prepared();
  try {
    const ivo = await createUser(t.ctx, 'ivo', 'user', 'Ivo');
    clock.set('2026-07-14T09:00:00Z');
    game.getState(ana.id);
    const secret = secretOf(t.ctx);

    game.submitGuess(eva.id, 'ARROZ'); // começa primeiro, mas acerta depois (conta a hora da vitória)
    for (const w of ['ARROZ', 'BOLSA', 'CHAVE', 'DENTE', 'FESTA', 'GRUPO']) game.submitGuess(ivo.id, w); // derrota: não ocupa posição

    let s = game.submitGuess(rui.id, secret); // 1.º, à 1.ª tentativa
    assert.equal(s.points, 115);
    assert.deepEqual(s.bonuses.map((b) => [b.type, b.rank, b.points]), [['first_win_bonus', 1, 15]]);
    s = game.submitGuess(ana.id, secret); // 2.º, à 1.ª tentativa
    assert.equal(s.points, 110);
    assert.equal(s.bonuses[0].rank, 2);
    s = game.submitGuess(eva.id, secret); // 3.º, à 2.ª tentativa
    assert.equal(s.points, 85);
    assert.equal(s.bonuses[0].rank, 3);

    const zeca = await createUser(t.ctx, 'zeca', 'user', 'Zeca');
    s = game.submitGuess(zeca.id, secret); // 4.º: sem bónus
    assert.equal(s.points, 100);
    assert.equal(s.bonus, 0);

    // Classificação diária e perfil refletem o bónus, com a origem descrita.
    const daily = t.ctx.services.leaderboard.daily('2026-07-14');
    assert.deepEqual(daily.rows.slice(0, 4).map((r) => [r.displayName, r.points]), [['Rui', 115], ['Ana', 110], ['Zeca', 100], ['Eva', 85]]);
    assert.equal(t.ctx.services.stats.profile(ana.id).history[0].bonus, 10);
    assert.ok(t.ctx.services.stats.profile(eva.id).pointEvents.some((e) => e.type === 'first_win_bonus' && /3\.º a acertar/.test(e.reason)));

    // A BD impede posições repetidas e um segundo bónus de pódio para a mesma pessoa.
    const ch = t.ctx.models.challenges.findByDate('2026-07-14');
    const tryInsert = (userId, winRank) =>
      t.ctx.models.points.insert({ userId, seasonId: ch.season_id, challengeId: ch.id, type: 'first_win_bonus', points: 1, winRank, reason: 'x' });
    assert.equal(tryInsert(zeca.id, 1), false, '1.º lugar já ocupado');
    assert.equal(tryInsert(rui.id, 4), false, 'o Rui já tem bónus neste desafio');

    // Novo dia: o pódio recomeça.
    clock.set('2026-07-15T09:00:00Z');
    game.getState(ana.id);
    assert.equal(game.submitGuess(ana.id, secretOf(t.ctx)).points, 115);
  } finally {
    clock.reset();
    t.close();
  }
});

test('bónus de pódio configurável (mais/menos posições, zeros) e desativável', async () => {
  const { t, admin, ana, rui, eva, game } = await prepared();
  try {
    const set = (v) => t.ctx.services.settings.update({ podium_bonus_points: v }, admin.id);
    assert.throws(() => set([10, -1]), /Bónus do 2\.º/);
    assert.throws(() => set('15,10'), /pódio inválido/);

    // Uma posição com 0 não dá pontos, mas conta para a ordem de chegada.
    set([20, 0, 7]);
    clock.set('2026-07-14T09:00:00Z');
    game.getState(ana.id);
    let secret = secretOf(t.ctx);
    assert.equal(game.submitGuess(rui.id, secret).points, 120);
    assert.equal(game.submitGuess(ana.id, secret).points, 100);
    assert.equal(game.submitGuess(eva.id, secret).points, 107);

    set([]);
    clock.set('2026-07-15T09:00:00Z');
    game.getState(ana.id);
    secret = secretOf(t.ctx);
    assert.equal(game.submitGuess(ana.id, secret).points, 100);
  } finally {
    clock.reset();
    t.close();
  }
});

test('API: período e bónus nos parâmetros do painel e no estado do jogo', async () => {
  const { t } = await prepared();
  try {
    clock.set('2026-07-14T07:00:00Z'); // 08:00 em Lisboa
    const admin = await login(t.app, 'admin');
    const { settings } = (await admin.get('/api/admin/settings').expect(200)).body;
    assert.equal(settings.play_start, '09:30');
    assert.equal(settings.play_end, '00:00');
    assert.deepEqual(settings.podium_bonus_points, [15, 10, 5]);

    const ana = await login(t.app, 'ana');
    const st = (await ana.get('/api/game/today').expect(200)).body;
    assert.equal(st.code, 'CLOSED');
    const r = await ana.postJson('/api/game/guess', { guess: 'ARROZ' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'CLOSED');

    await admin.putJson('/api/admin/settings', { play_start: '07:00' }).expect(200);
    assert.equal((await ana.get('/api/game/today')).body.available, true);
  } finally {
    clock.reset();
    t.close();
  }
});

test('migrações 002 e 003 preservam os pontos de uma BD criada com a versão 1.0/1.1', () => {
  const dir = tempDir();
  const file = path.join(dir, 'prod.sqlite');
  const db = openDatabase(file);
  // Simula a BD de produção: só a migração 001, com dados.
  db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL,
           applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`);
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '001_initial.sql'), 'utf8'));
  db.prepare("INSERT INTO schema_migrations (version, name) VALUES (1, '001_initial.sql')").run();
  db.exec(`
    INSERT INTO users (id, username, display_name, password_hash) VALUES (1, 'ana', 'Ana', 'x'), (2, 'chefe', 'Chefe', 'x');
    INSERT INTO seasons (id, code, starts_on, ends_on) VALUES (1, '2026-10', '2026-10-01', '2026-10-31');
    INSERT INTO daily_challenges (id, challenge_date, season_id, word, word_plain, word_length, max_attempts, accent_mode)
      VALUES (1, '2026-10-19', 1, 'CRIME', 'CRIME', 5, 6, 'strip');
    INSERT INTO daily_results (id, challenge_id, user_id, status, attempts_used, points, finished_at)
      VALUES (1, 1, 1, 'won', 2, 80, '2026-10-19T10:00:00Z');
    INSERT INTO point_transactions (id, user_id, season_id, challenge_id, result_id, type, points, reason, created_at)
      VALUES (1, 1, 1, 1, 1, 'game_result', 80, 'Vitória', '2026-10-19T10:00:00.000Z'),
             (2, 1, 1, 1, 1, 'streak_bonus', 15, 'Bónus', '2026-10-19T10:00:00.000Z');
    INSERT INTO point_transactions (id, user_id, season_id, type, points, reason, created_by)
      VALUES (3, 1, 1, 'admin_adjustment', -5, 'Ajuste', 2);
  `);
  const before = db.prepare('SELECT * FROM point_transactions ORDER BY id').all();

  const applied = migrate(db);
  assert.deepEqual(applied, ['002_first_win_bonus.sql', '003_podium_bonus.sql', '004_brand_assets.sql']);
  const after = db.prepare('SELECT * FROM point_transactions ORDER BY id').all();
  for (const row of after) assert.equal(row.win_rank, null);
  assert.deepEqual(after.map(({ win_rank, ...r }) => r), before, 'linhas idênticas');
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  // Restrições e triggers continuam em vigor; o novo tipo é aceite uma vez por desafio.
  assert.throws(() => db.prepare('UPDATE point_transactions SET points = 1').run(), /não podem ser alterados/);
  assert.throws(() => db.prepare('DELETE FROM point_transactions').run(), /não podem ser apagados/);
  assert.throws(() => db.prepare("INSERT INTO point_transactions (user_id, season_id, challenge_id, result_id, type, points, reason) VALUES (1, 1, 1, 1, 'game_result', 1, 'dup')").run(), /UNIQUE/);
  db.prepare("INSERT INTO point_transactions (user_id, season_id, challenge_id, result_id, type, points, win_rank, reason) VALUES (1, 1, 1, 1, 'first_win_bonus', 15, 1, 'ok')").run();
  db.prepare("INSERT INTO point_transactions (user_id, season_id, challenge_id, type, points, win_rank, reason) VALUES (2, 1, 1, 'first_win_bonus', 10, 2, 'ok')").run();
  assert.throws(() => db.prepare("INSERT INTO point_transactions (user_id, season_id, challenge_id, type, points, win_rank, reason) VALUES (2, 1, 1, 'first_win_bonus', 5, 3, 'dup')").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO point_transactions (user_id, season_id, challenge_id, type, points, win_rank, reason) VALUES (1, 1, 1, 'first_win_bonus', 5, 2, 'dup')").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO point_transactions (user_id, season_id, challenge_id, type, points, win_rank, reason) VALUES (2, 1, 1, 'first_win_bonus', 5, 11, 'x')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO point_transactions (user_id, season_id, challenge_id, type, points, reason) VALUES (1, 1, 1, 'inventado', 1, 'x')").run(), /CHECK/);
  assert.deepEqual(migrate(db), [], 'idempotente');
  db.close();
});

test('migração 003 converte bónus de "primeiro a acertar" já atribuídos (versão 1.2) em 1.º lugar', () => {
  const dir = tempDir();
  const db = openDatabase(path.join(dir, 'v12.sqlite'));
  db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL,
           applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`);
  for (const [v, f] of [[1, '001_initial.sql'], [2, '002_first_win_bonus.sql']]) {
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(v, f);
  }
  db.exec(`
    INSERT INTO users (id, username, display_name, password_hash) VALUES (1, 'ana', 'Ana', 'x'), (2, 'rui', 'Rui', 'x');
    INSERT INTO seasons (id, code, starts_on, ends_on) VALUES (1, '2026-10', '2026-10-01', '2026-10-31');
    INSERT INTO daily_challenges (id, challenge_date, season_id, word, word_plain, word_length, max_attempts, accent_mode)
      VALUES (1, '2026-10-20', 1, 'CRIME', 'CRIME', 5, 6, 'strip');
    INSERT INTO daily_results (id, challenge_id, user_id, status, attempts_used, points, finished_at)
      VALUES (1, 1, 1, 'won', 2, 80, '2026-10-20T10:00:00Z');
    INSERT INTO point_transactions (user_id, season_id, challenge_id, result_id, type, points, reason)
      VALUES (1, 1, 1, 1, 'game_result', 80, 'Vitória'), (1, 1, 1, 1, 'first_win_bonus', 10, 'Bónus: primeiro a acertar');
  `);
  assert.deepEqual(migrate(db), ['003_podium_bonus.sql', '004_brand_assets.sql']);
  const bonus = db.prepare("SELECT * FROM point_transactions WHERE type = 'first_win_bonus'").get();
  assert.equal(bonus.win_rank, 1);
  assert.equal(bonus.points, 10);
  assert.throws(() => db.prepare('UPDATE point_transactions SET points = 1').run(), /não podem ser alterados/, 'trigger reposto');
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  db.close();
});
