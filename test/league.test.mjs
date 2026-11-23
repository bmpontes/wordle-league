// Palavra do dia, horário, pódio e classificações.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, prepared, rejects, SECRET_WORDS, ACCEPTED_WORDS } from './helpers.mjs';

async function league() {
  const t = await setup({ neutral: false }); // valores reais: 09:30–00:00 e pódio 15/10/5
  const admin = await t.signUp('admin');
  await t.importWords(admin, 'secret', SECRET_WORDS);
  await t.importWords(admin, 'accepted', ACCEPTED_WORDS);
  const ana = await t.signUp('ana', { displayName: 'Ana' });
  const rui = await t.signUp('rui', { displayName: 'Rui' });
  const eva = await t.signUp('eva', { displayName: 'Eva' });
  return { t, admin, ana, rui, eva };
}

const challengeCount = async (t) => Number((await t.sql('select count(*) n from wl.daily_challenges'))[0].n);

test('sem lista importada: estado indisponível e erro controlado', async () => {
  const t = await setup();
  await t.signUp('admin');
  const ana = await t.signUp('ana');
  t.setNow('2026-07-14T10:00:00Z');
  const s = await t.rpc(ana, 'get_game_state');
  assert.equal(s.available, false);
  assert.equal(s.code, 'NO_WORDS');
  await rejects(t.rpc(ana, 'submit_guess', { p_guess: 'PEDRA' }), (e) => e.code === 'NO_WORDS' && e.status === 503);
  assert.equal(await challengeCount(t), 0);
});

test('a mesma palavra durante todo o dia e mudança à meia-noite de Lisboa', async () => {
  const { t, user } = await prepared();
  const ensure = async () => (await t.sql('select (wl.ensure_challenge()).*'))[0];
  t.setNow('2026-07-14T00:00:00Z'); // 01:00 em Lisboa (verão)
  const morning = await ensure();
  assert.equal(morning.challenge_date.toISOString().slice(0, 10), '2026-07-14');
  t.setNow('2026-07-14T22:59:59Z'); // 23:59:59 em Lisboa
  const late = await ensure();
  assert.equal(late.id, morning.id);
  await t.rpc(user, 'submit_guess', { p_guess: 'ARROZ' }); // jogada: a palavra fica gasta
  t.setNow('2026-07-14T23:00:00Z'); // 00:00 de 15/07 em Lisboa
  const next = await ensure();
  assert.equal(next.challenge_date.toISOString().slice(0, 10), '2026-07-15');
  assert.notEqual(next.word, morning.word, 'não repete palavras');
  t.setNow('2026-12-01T23:59:59Z'); // inverno: meia-noite = 00:00 UTC
  assert.equal((await ensure()).challenge_date.toISOString().slice(0, 10), '2026-12-01');
  t.setNow('2026-12-02T00:00:00Z');
  assert.equal((await ensure()).challenge_date.toISOString().slice(0, 10), '2026-12-02');
});

test('escolha determinística: não repete até esgotar; reutilização só se configurada', async () => {
  const t = await setup();
  const admin = await t.signUp('admin');
  const ana = await t.signUp('ana');
  await t.importWords(admin, 'secret', ['PEDRA', 'LIVRO']);
  t.setNow('2026-07-01T10:00:00Z');
  await t.rpc(ana, 'submit_guess', { p_guess: 'PEDRA' });
  const d1 = await t.secretOf();
  t.setNow('2026-07-02T10:00:00Z');
  await t.rpc(ana, 'submit_guess', { p_guess: 'PEDRA' });
  const d2 = await t.secretOf();
  assert.notEqual(d1, d2);

  t.setNow('2026-07-03T10:00:00Z');
  assert.equal((await t.rpc(ana, 'get_game_state')).code, 'WORDS_EXHAUSTED');
  const st = await t.rpc(admin, 'admin_status');
  assert.ok(st.wordPool.exhausted);
  assert.ok(st.warnings.some((w) => /esgotada/.test(w)));

  await t.rpc(admin, 'admin_update_settings', { p_changes: { recycle_words: true } });
  await t.rpc(ana, 'get_game_state');
  const c3 = (await t.sql("select word, cycle from wl.daily_challenges where challenge_date = '2026-07-03'"))[0];
  assert.equal(c3.cycle, 2);
  assert.ok(['PEDRA', 'LIVRO'].includes(c3.word));
});

test('substituir a lista não altera desafios já criados nem repete palavras usadas', async () => {
  const t = await setup();
  const admin = await t.signUp('admin');
  const ana = await t.signUp('ana');
  await t.importWords(admin, 'secret', ['PEDRA']);
  t.setNow('2026-07-01T10:00:00Z');
  await t.rpc(ana, 'submit_guess', { p_guess: 'PEDRA' });
  await t.importWords(admin, 'secret', ['PEDRA', 'NUVEM']);
  assert.equal(await t.secretOf('2026-07-01'), 'PEDRA');
  t.setNow('2026-07-02T10:00:00Z');
  await t.rpc(ana, 'get_game_state');
  assert.equal(await t.secretOf(), 'NUVEM');
});

test('período de jogo por omissão: 09:30 às 00:00 (hora de Portugal)', async () => {
  const { t, ana } = await league();
  t.setNow('2026-07-14T08:29:00Z'); // 09:29 em Lisboa (verão)
  let s = await t.rpc(ana, 'get_game_state');
  assert.equal(s.available, false);
  assert.equal(s.code, 'CLOSED');
  assert.match(s.message, /abre às 09:30/);
  assert.equal(s.window.opensAt, '2026-07-14T08:30:00.000Z');
  await rejects(t.rpc(ana, 'submit_guess', { p_guess: 'ARROZ' }), (e) => e.code === 'CLOSED' && e.status === 409);
  assert.equal(await challengeCount(t), 0, 'antes da abertura nem sequer é escolhida a palavra');

  t.setNow('2026-07-14T08:30:00Z');
  s = await t.rpc(ana, 'get_game_state');
  assert.equal(s.available, true);
  assert.equal(s.window.closesAt, '2026-07-14T23:00:00.000Z');
  await t.rpc(ana, 'submit_guess', { p_guess: 'ARROZ' });
  t.setNow('2026-07-14T22:59:59Z');
  assert.equal((await t.rpc(ana, 'get_game_state')).window.open, true);

  t.setNow('2026-12-01T09:29:00Z'); // inverno (UTC+0)
  assert.equal((await t.rpc(ana, 'get_game_state')).code, 'CLOSED');
  t.setNow('2026-12-01T09:30:00Z');
  assert.equal((await t.rpc(ana, 'get_game_state')).available, true);
});

test('período configurável: depois do fecho não se joga, mas vê-se o resultado', async () => {
  const { t, admin, ana, rui, eva } = await league();
  const set = (c) => t.rpc(admin, 'admin_update_settings', { p_changes: c });
  await rejects(set({ play_start: '18:00', play_end: '12:00' }), /anterior à hora de fecho/);
  await rejects(set({ play_start: '9:30' }), /Hora de abertura/);
  await rejects(set({ play_end: '24:00' }), /Hora de fecho/);
  await set({ play_start: '10:00', play_end: '18:00' });
  assert.ok((await t.rpc(admin, 'admin_audit')).entries.some((a) => a.action === 'settings.update' && a.details.play_end));

  t.setNow('2026-07-14T10:00:00Z'); // 11:00 em Lisboa
  await t.rpc(ana, 'get_game_state');
  await t.rpc(ana, 'submit_guess', { p_guess: await t.secretOf() });
  await t.rpc(rui, 'submit_guess', { p_guess: 'ARROZ' });

  t.setNow('2026-07-14T17:00:00Z'); // 18:00 → fechado
  const a = await t.rpc(ana, 'get_game_state');
  assert.equal(a.status, 'won');
  assert.equal(a.window.open, false);
  const r = await t.rpc(rui, 'get_game_state');
  assert.equal(r.status, 'in_progress');
  assert.equal(r.solution, undefined);
  await rejects(t.rpc(rui, 'submit_guess', { p_guess: 'BOLSA' }), (e) => e.code === 'CLOSED');
  const e = await t.rpc(eva, 'get_game_state');
  assert.match(e.message, /terminou às 18:00.*a partir das 10:00/);
  assert.equal(e.window.opensAt, '2026-07-15T09:00:00.000Z');

  t.setNow('2026-07-15T10:00:00Z');
  await t.rpc(rui, 'get_game_state');
  assert.equal((await t.rpc(rui, 'get_profile')).history[0].status, 'expired');
});

test('bónus de pódio: 15, 10 e 5 pontos para o 1.º, 2.º e 3.º a acertar', async () => {
  const { t, ana, rui, eva } = await league();
  const ivo = await t.signUp('ivo', { displayName: 'Ivo' });
  t.setNow('2026-07-14T09:00:00Z');
  await t.rpc(ana, 'get_game_state');
  const secret = await t.secretOf();

  await t.rpc(eva, 'submit_guess', { p_guess: 'ARROZ' }); // começa primeiro, acerta depois
  for (const w of ['ARROZ', 'BOLSA', 'CHAVE', 'DENTE', 'FESTA', 'GRUPO']) await t.rpc(ivo, 'submit_guess', { p_guess: w });

  let s = await t.rpc(rui, 'submit_guess', { p_guess: secret });
  assert.equal(s.points, 115);
  assert.deepEqual(s.bonuses.map((b) => [b.type, b.rank, b.points]), [['first_win_bonus', 1, 15]]);
  s = await t.rpc(ana, 'submit_guess', { p_guess: secret });
  assert.equal(s.points, 110);
  assert.equal(s.bonuses[0].rank, 2);
  s = await t.rpc(eva, 'submit_guess', { p_guess: secret });
  assert.equal(s.points, 85);
  assert.equal(s.bonuses[0].rank, 3);
  const zeca = await t.signUp('zeca', { displayName: 'Zeca' });
  s = await t.rpc(zeca, 'submit_guess', { p_guess: secret });
  assert.equal(s.points, 100);
  assert.equal(s.bonus, 0);

  const daily = await t.rpc(ana, 'leaderboard_daily', { p_date: '2026-07-14' });
  assert.deepEqual(daily.rows.slice(0, 4).map((r) => [r.displayName, r.points]), [['Rui', 115], ['Ana', 110], ['Zeca', 100], ['Eva', 85]]);
  assert.equal(daily.rows.find((r) => r.isMe).displayName, 'Ana');
  assert.equal((await t.rpc(ana, 'get_profile')).history[0].bonus, 10);
  assert.ok((await t.rpc(eva, 'get_profile')).pointEvents.some((e) => e.type === 'first_win_bonus' && /3\.º a acertar/.test(e.reason)));

  t.setNow('2026-07-15T09:00:00Z');
  await t.rpc(ana, 'get_game_state');
  assert.equal((await t.rpc(ana, 'submit_guess', { p_guess: await t.secretOf() })).points, 115, 'o pódio recomeça');
});

test('bónus de pódio configurável (zeros contam para a ordem) e desativável', async () => {
  const { t, admin, ana, rui, eva } = await league();
  const set = (v) => t.rpc(admin, 'admin_update_settings', { p_changes: { podium_bonus_points: v } });
  await rejects(set([10, -1]), /Bónus do 2\.º/);
  await rejects(set('15,10'), /pódio inválido/);
  await set([20, 0, 7]);
  t.setNow('2026-07-14T09:00:00Z');
  await t.rpc(ana, 'get_game_state');
  let secret = await t.secretOf();
  assert.equal((await t.rpc(rui, 'submit_guess', { p_guess: secret })).points, 120);
  assert.equal((await t.rpc(ana, 'submit_guess', { p_guess: secret })).points, 100);
  assert.equal((await t.rpc(eva, 'submit_guess', { p_guess: secret })).points, 107);
  await set([]);
  t.setNow('2026-07-15T09:00:00Z');
  await t.rpc(ana, 'get_game_state');
  secret = await t.secretOf();
  assert.equal((await t.rpc(ana, 'submit_guess', { p_guess: secret })).points, 100);
});

test('classificações diária (desempates), mensal e geral', async () => {
  const { t, admin, user: ana } = await prepared();
  const rui = await t.signUp('rui', { displayName: 'Rui' });
  const eva = await t.signUp('eva', { displayName: 'Eva' });
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(ana, 'get_game_state');
  const secret = await t.secretOf();
  await t.rpc(rui, 'submit_guess', { p_guess: 'ARROZ' });
  await t.rpc(rui, 'submit_guess', { p_guess: secret }); // 80
  t.setNow('2026-07-14T10:05:00Z');
  await t.rpc(eva, 'submit_guess', { p_guess: 'BOLSA' });
  await t.rpc(eva, 'submit_guess', { p_guess: secret }); // 80, mais tarde
  await t.rpc(ana, 'submit_guess', { p_guess: secret }); // 100
  const d = await t.rpc(ana, 'leaderboard_daily', {});
  assert.deepEqual(d.rows.map((r) => [r.position, r.displayName, r.points]), [[1, 'Nome ana', 100], [2, 'Rui', 80], [3, 'Eva', 80]]);
  await rejects(t.rpc(ana, 'leaderboard_daily', { p_date: '2026-07-15' }), /futuras/);
  await rejects(t.rpc(ana, 'leaderboard_daily', { p_date: 'ontem' }), /Data inválida/);

  t.setNow('2026-08-01T10:00:00Z');
  await t.rpc(admin, 'admin_adjust_points', { p_user: eva.id, p_points: 50, p_reason: 'Prémio de agosto' });
  const jul = await t.rpc(ana, 'leaderboard_monthly', { p_season: '2026-07' });
  assert.deepEqual(jul.rows.map((r) => r.displayName), ['Nome ana', 'Eva', 'Rui'], 'empate: ordem alfabética');
  assert.equal(jul.rows[0].successRate, 100);
  const aug = await t.rpc(ana, 'leaderboard_monthly', {});
  assert.equal(aug.season, '2026-08');
  assert.deepEqual(aug.rows.map((r) => [r.displayName, r.points]), [['Eva', 50]]);
  const all = await t.rpc(ana, 'leaderboard_alltime');
  assert.deepEqual(all.rows.map((r) => [r.displayName, r.points]), [['Eva', 130], ['Nome ana', 100], ['Rui', 80]]);
  assert.deepEqual((await t.rpc(ana, 'leaderboard_seasons')).seasons, ['2026-08', '2026-07']);

  // Bloqueados não aparecem nas classificações.
  await t.rpc(admin, 'admin_set_status', { p_id: eva.id, p_status: 'blocked' });
  assert.deepEqual((await t.rpc(ana, 'leaderboard_alltime')).rows.map((r) => r.displayName), ['Nome ana', 'Rui']);
});

test('classificação pública: só o mês em curso, sem sessão, sem dados sensíveis e desativável', async () => {
  const { t, admin, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  await t.rpc(user, 'submit_guess', { p_guess: await t.secretOf() });
  const pub = await t.rpc(null, 'public_leaderboard');
  assert.equal(pub.season, '2026-07');
  assert.equal(pub.endsOn, '2026-07-31');
  assert.equal(pub.today, '2026-07-14');
  assert.deepEqual(Object.keys(pub.rows[0]).sort(), ['bestStreak', 'displayName', 'games', 'points', 'position', 'successRate', 'wins']);
  await t.rpc(admin, 'admin_update_settings', { p_changes: { public_leaderboard: false } });
  await rejects(t.rpc(null, 'public_leaderboard'), (e) => e.status === 404);
});

test('regras refletem os parâmetros do administrador', async () => {
  const { t, admin, user } = await prepared();
  await t.rpc(admin, 'admin_update_settings', { p_changes: { max_attempts: 5, points_by_attempt: [50, 40, 30, 20, 10] } });
  const r = await t.rpc(user, 'get_rules');
  assert.equal(r.maxAttempts, 5);
  assert.deepEqual(r.pointsByAttempt, [50, 40, 30, 20, 10]);
  assert.equal(r.playStart, '00:00');
  assert.equal(r.timezone, 'Europe/Lisbon');
});
