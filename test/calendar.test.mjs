// Dias de jogo (fins de semana), palavra que passa para o dia seguinte e streaks por dias de jogo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, prepared, rejects, SECRET_WORDS, ACCEPTED_WORDS, WRONG } from './helpers.mjs';

// Julho de 2026: 13 = segunda … 17 = sexta, 18 = sábado, 19 = domingo, 20 = segunda.
async function weekdays() {
  const t = await setup({ neutral: false }); // omissão: segunda a sexta, 09:30–00:00
  const admin = await t.signUp('admin');
  await t.importWords(admin, 'secret', SECRET_WORDS);
  await t.importWords(admin, 'accepted', ACCEPTED_WORDS);
  await t.rpc(admin, 'admin_update_settings', { p_changes: { podium_bonus_points: [] } });
  const ana = await t.signUp('ana');
  const rui = await t.signUp('rui');
  return { t, admin, ana, rui };
}

test('por omissão não há jogo ao sábado nem ao domingo', async () => {
  const { t, ana } = await weekdays();
  t.setNow('2026-07-18T10:00:00Z'); // sábado, 11:00 em Lisboa
  const s = await t.rpc(ana, 'get_game_state');
  assert.equal(s.available, false);
  assert.equal(s.code, 'CLOSED');
  assert.equal(s.window.phase, 'off');
  assert.equal(s.message, 'Hoje não há desafio. O próximo é na segunda-feira, a partir das 09:30.');
  assert.equal(s.window.opensAt, '2026-07-20T08:30:00.000Z');
  assert.equal(s.nextChallengeAt, '2026-07-19T23:00:00.000Z');
  await rejects(t.rpc(ana, 'submit_guess', { p_guess: 'ARROZ' }), (e) => e.code === 'CLOSED' && e.status === 409);
  t.setNow('2026-07-19T10:00:00Z'); // domingo
  assert.equal((await t.rpc(ana, 'get_game_state')).window.phase, 'off');
  assert.equal(Number((await t.sql('select count(*) n from wl.daily_challenges'))[0].n), 0, 'não gasta palavras');

  t.setNow('2026-07-20T08:30:00Z'); // segunda, 09:30
  assert.equal((await t.rpc(ana, 'get_game_state')).available, true);
});

test('à sexta, o próximo desafio é na segunda-feira', async () => {
  const { t, admin, ana } = await weekdays();
  t.setNow('2026-07-17T10:00:00Z'); // sexta
  const s = await t.rpc(ana, 'get_game_state');
  assert.equal(s.available, true);
  assert.equal(s.nextChallengeAt, '2026-07-19T23:00:00.000Z', 'meia-noite de domingo para segunda');
  await t.rpc(admin, 'admin_update_settings', { p_changes: { play_end: '18:00' } });
  t.setNow('2026-07-17T17:30:00Z'); // sexta, 18:30 em Lisboa
  const closed = await t.rpc(ana, 'get_game_state');
  assert.match(closed.message, /terminou às 18:00\. Volte na segunda-feira a partir das 09:30/);
  assert.equal(closed.window.opensAt, '2026-07-20T08:30:00.000Z');
  t.setNow('2026-07-14T17:30:00Z'); // terça depois do fecho
  assert.match((await t.rpc(ana, 'get_game_state')).message, /Volte amanhã a partir das 09:30/);
});

test('dias de jogo configuráveis no painel (validados, auditados e nas regras)', async () => {
  const { t, admin, ana } = await weekdays();
  const set = (v) => t.rpc(admin, 'admin_update_settings', { p_changes: { play_days: v } });
  await rejects(set([]), /pelo menos um dia/);
  await rejects(set([0, 8]), /pelo menos um dia/);
  await rejects(set('1,2'), /pelo menos um dia/);
  const r = await set([6, 1, 6, 7]);
  assert.deepEqual(r.settings.play_days, [1, 6, 7]);
  assert.ok((await t.rpc(admin, 'admin_audit')).entries.some((a) => a.action === 'settings.update' && a.details.play_days));
  assert.deepEqual((await t.rpc(ana, 'get_rules')).playDays, [1, 6, 7]);

  t.setNow('2026-07-18T10:00:00Z'); // sábado: agora há jogo
  assert.equal((await t.rpc(ana, 'get_game_state')).available, true);
  t.setNow('2026-07-14T10:00:00Z'); // terça: já não há
  const s = await t.rpc(ana, 'get_game_state');
  assert.equal(s.window.phase, 'off');
  assert.match(s.message, /O próximo é no sábado/);
});

test('palavra de um dia sem jogadores passa para o dia de jogo seguinte', async () => {
  const { t, admin, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'get_game_state'); // abre o jogo, mas não joga
  const unplayed = await t.secretOf('2026-07-14');

  t.setNow('2026-07-15T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  assert.equal(await t.secretOf('2026-07-15'), unplayed, 'a mesma palavra no dia seguinte');
  // O painel não mostra a palavra do dia sem jogadores (ainda está em jogo).
  assert.deepEqual((await t.rpc(admin, 'admin_stats')).pastChallenges, []);
  assert.equal((await t.rpc(admin, 'admin_status')).wordPool.unused, SECRET_WORDS.length);

  await t.rpc(user, 'submit_guess', { p_guess: WRONG[0] });
  t.setNow('2026-07-16T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  assert.notEqual(await t.secretOf('2026-07-16'), unplayed, 'depois de jogada, já não se repete');
  const past = (await t.rpc(admin, 'admin_stats')).pastChallenges.map((c) => [c.challenge_date, c.word]);
  assert.deepEqual(past, [['2026-07-15', unplayed]]);
  assert.equal((await t.rpc(admin, 'admin_status')).wordPool.unused, SECRET_WORDS.length - 1);
});

test('streak: o fim de semana e os dias sem jogadores não a interrompem', async () => {
  const { t, ana, rui } = await weekdays();
  const win = async (user, iso) => {
    t.setNow(iso);
    await t.rpc(user, 'get_game_state');
    return t.rpc(user, 'submit_guess', { p_guess: await t.secretOf() });
  };
  // Segunda a sexta (13–17) e segunda seguinte (20): 6 dias de jogo seguidos.
  for (const d of ['13', '14', '15', '16', '17']) await win(ana, `2026-07-${d}T10:00:00Z`);
  t.setNow('2026-07-18T10:00:00Z'); // sábado
  assert.equal((await t.rpc(ana, 'get_profile')).currentStreak, 5);
  t.setNow('2026-07-20T10:00:00Z'); // segunda, ainda não jogou
  assert.equal((await t.rpc(ana, 'get_profile')).currentStreak, 5);
  await win(ana, '2026-07-20T10:00:00Z');
  // Terça 21: ninguém joga. Quarta 22: continua.
  const s = await win(ana, '2026-07-22T10:00:00Z');
  assert.equal(s.bonus, 15, 'bónus ao 7.º dia de jogo seguido');
  let p = await t.rpc(ana, 'get_profile');
  assert.equal(p.currentStreak, 7);
  assert.equal(p.bestStreak, 7);

  // Quinta 23: o Rui joga e a Ana não → a streak dela quebra.
  await win(rui, '2026-07-23T10:00:00Z');
  t.setNow('2026-07-24T10:00:00Z');
  p = await t.rpc(ana, 'get_profile');
  assert.equal(p.currentStreak, 0);
  assert.equal(p.bestStreak, 7);
  const monthly = await t.rpc(ana, 'leaderboard_monthly', { p_season: '2026-07' });
  assert.equal(monthly.rows.find((r) => r.isMe).bestStreak, 7);
});
