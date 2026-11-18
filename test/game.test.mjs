// Jogo, pontuação, streaks e integridade (equivalente aos testes do servidor 1.x).
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepared, rejects, WRONG } from './helpers.mjs';

test('palavra inválida é rejeitada sem consumir tentativa', async () => {
  const { t, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  for (const bad of ['XXXXX', 'ABC', 'CASASS', 'AB1CD', '', 'NU EM']) {
    await rejects(t.rpc(user, 'submit_guess', { p_guess: bad }), (e) => e.status === 422);
  }
  await rejects(t.rpc(user, 'submit_guess', { p_guess: null }), (e) => e.status === 400);
  const s = await t.rpc(user, 'get_game_state');
  assert.equal(s.status, 'not_started');
  assert.equal(s.attemptsUsed, 0);
  assert.equal(s.attemptsLeft, 6);
});

test('palavras aceites com e sem acentos (modo "strip") e forma original preservada', async () => {
  const { t, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  const s = await t.rpc(user, 'submit_guess', { p_guess: 'macas' });
  assert.equal(s.guesses[0].word, 'MAÇÃS');
  assert.equal(s.attemptsUsed, 1);
});

test('vitória: pontos conforme o número de tentativas e jogo bloqueado depois', async () => {
  const { t, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  const secret = await t.secretOf();
  await t.rpc(user, 'submit_guess', { p_guess: WRONG[0] });
  await t.rpc(user, 'submit_guess', { p_guess: WRONG[1] });
  const s = await t.rpc(user, 'submit_guess', { p_guess: secret.toLowerCase() });
  assert.equal(s.status, 'won');
  assert.equal(s.attemptsUsed, 3);
  assert.equal(s.points, 65);
  assert.equal(s.solution, secret);
  assert.deepEqual(s.lastPattern, Array(5).fill('correct'));
  await rejects(t.rpc(user, 'submit_guess', { p_guess: WRONG[2] }), (e) => e.code === 'GAME_OVER' && e.status === 409);
  assert.equal(await t.total(user), 65);
});

test('derrota: limite de seis tentativas e pontos de participação; solução só no fim', async () => {
  const { t, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  let s;
  for (let i = 0; i < 6; i++) {
    s = await t.rpc(user, 'submit_guess', { p_guess: WRONG[i] });
    if (i < 5) {
      assert.equal(s.status, 'in_progress');
      assert.equal(s.solution, undefined, 'a solução não é revelada durante o jogo');
      assert.ok(!JSON.stringify(s).includes(await t.secretOf()), 'a palavra secreta não aparece em lado nenhum');
    }
  }
  assert.equal(s.status, 'lost');
  assert.equal(s.attemptsLeft, 0);
  assert.equal(s.points, 5);
  assert.equal(s.solution, await t.secretOf());
  await rejects(t.rpc(user, 'submit_guess', { p_guess: WRONG[6] }), (e) => e.code === 'GAME_OVER');
  assert.equal(Number((await t.sql('select count(*) n from wl.guesses'))[0].n), 6);
});

test('pontuação por número de tentativas (100/80/65/50/35/25)', async () => {
  const expected = [100, 80, 65, 50, 35, 25];
  for (let attempts = 1; attempts <= 6; attempts++) {
    const { t, user } = await prepared();
    t.setNow('2026-07-14T10:00:00Z');
    await t.rpc(user, 'get_game_state');
    for (let i = 0; i < attempts - 1; i++) await t.rpc(user, 'submit_guess', { p_guess: WRONG[i] });
    const s = await t.rpc(user, 'submit_guess', { p_guess: await t.secretOf() });
    assert.equal(s.points, expected[attempts - 1], `vitória em ${attempts}`);
  }
});

test('pontuação configurável pelo administrador', async () => {
  const { t, admin, user } = await prepared();
  await t.rpc(admin, 'admin_update_settings', { p_changes: { points_by_attempt: [10, 9, 8, 7, 6, 5], points_loss: 1 } });
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  assert.equal((await t.rpc(user, 'submit_guess', { p_guess: await t.secretOf() })).points, 10);
  await rejects(t.rpc(admin, 'admin_update_settings', { p_changes: { points_by_attempt: [1, 2] } }), /um valor por cada tentativa/);
});

test('avaliação com letras repetidas (duas passagens)', async () => {
  const { t } = await prepared();
  const ev = async (g, s) => (await t.sql('select wl.evaluate($1, $2) p', [g, s]))[0].p;
  assert.equal(await ev('PAPEL', 'PEDRA'), 'CPAPA');
  assert.equal(await ev('AAAAA', 'CASAS'), 'ACACA');
  assert.equal(await ev('SALSA', 'CASAS'), 'PCAPP');
  assert.equal(await ev('PEDRA', 'PEDRA'), 'CCCCC');
});

test('streak: bónus de 15 pontos ao 7.º dia consecutivo, atribuído uma única vez', async () => {
  const { t, user } = await prepared();
  let total = 0;
  for (let day = 1; day <= 8; day++) {
    t.setNow(`2026-07-${String(day).padStart(2, '0')}T10:00:00Z`);
    await t.rpc(user, 'get_game_state');
    const s = await t.rpc(user, 'submit_guess', { p_guess: await t.secretOf() });
    total += s.points;
    assert.equal(s.bonus, day === 7 ? 15 : 0, `dia ${day}`);
  }
  assert.equal(total, 8 * 100 + 15);
  assert.equal(await t.total(user), total);
  const p = await t.rpc(user, 'get_profile');
  assert.equal(p.currentStreak, 8);
  assert.equal(p.bestStreak, 8);
  assert.equal(p.games, 8);
  assert.equal(p.winRate, 100);
  assert.equal(p.distribution[0].count, 8);
  assert.equal(p.bestMonthlyRank.position, 1);
  assert.equal(p.bestMonthlyRank.season, '2026-07');

  // Um dia sem jogar interrompe a streak; ela mantém-se até ao fim do dia seguinte.
  t.setNow('2026-07-09T10:00:00Z');
  assert.equal((await t.rpc(user, 'get_profile')).currentStreak, 8);
  t.setNow('2026-07-10T10:00:00Z');
  assert.equal((await t.rpc(user, 'get_profile')).currentStreak, 0);
});

test('prevenção de pontuação duplicada e registos imutáveis', async () => {
  const { t, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  await t.rpc(user, 'submit_guess', { p_guess: await t.secretOf() });
  // Repetir a atribuição (ex.: pedido duplicado) não gera pontos.
  await t.sql(`select wl.award(r, c, 'won', 1) from wl.daily_results r join wl.daily_challenges c on c.id = r.challenge_id`);
  assert.equal(await t.total(user), 100);
  await rejects(t.sql(`insert into wl.point_transactions (user_id, season_id, challenge_id, result_id, type, points, reason)
                       select user_id, c.season_id, c.id, r.id, 'game_result', 100, 'x'
                         from wl.daily_results r join wl.daily_challenges c on c.id = r.challenge_id`));
  await rejects(t.sql('insert into wl.daily_results (challenge_id, user_id) select challenge_id, user_id from wl.daily_results'));
  await rejects(t.sql('update wl.daily_results set points = 999'), /não pode ser alterado/);
  await rejects(t.sql('update wl.point_transactions set points = 999'), /não podem ser alterados/);
  await rejects(t.sql('delete from wl.point_transactions'), /não podem ser alterados nem apagados/);
  await rejects(t.sql('delete from wl.audit_log'), /auditoria/);
});

test('jogo não concluído num dia anterior expira com pontos de participação', async () => {
  const { t, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'submit_guess', { p_guess: WRONG[0] });
  t.setNow('2026-07-15T10:00:00Z');
  const s = await t.rpc(user, 'get_game_state');
  assert.equal(s.status, 'not_started');
  const hist = (await t.rpc(user, 'get_profile')).history;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].status, 'expired');
  assert.equal(hist[0].points, 5);
  assert.equal((await t.sql('select wl.finalize_expired() n'))[0].n, 0, 'idempotente');
});

test('ajustes administrativos ficam registados e não alteram resultados', async () => {
  const { t, admin, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await rejects(t.rpc(admin, 'admin_adjust_points', { p_user: user.id, p_points: 10, p_reason: '' }), /Motivo/);
  await rejects(t.rpc(admin, 'admin_adjust_points', { p_user: user.id, p_points: 0, p_reason: 'Correção' }), /zero/);
  await t.rpc(admin, 'admin_adjust_points', { p_user: user.id, p_points: -10, p_reason: 'Correção de teste' });
  assert.equal(await t.total(user), -10);
  assert.ok((await t.rpc(admin, 'admin_audit')).entries.some((a) => a.action === 'points.adjust'));
  assert.ok((await t.rpc(user, 'get_profile')).pointEvents.some((e) => e.type === 'admin_adjustment'));
  const adj = (await t.rpc(admin, 'admin_adjustments')).adjustments;
  assert.equal(adj[0].points, -10);
  assert.equal(adj[0].created_by_username, 'admin');
});
