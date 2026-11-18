// Contas, permissões e proteção da palavra secreta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, prepared, rejects } from './helpers.mjs';

test('o browser não consegue ler as tabelas diretamente (nem com sessão)', async () => {
  const { t, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['daily_challenges', 'word_bank', 'settings', 'profiles']) {
      await rejects(
        t.db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          return tx.query(`select * from wl.${table}`);
        }),
        /permission denied/
      );
    }
    // As funções internas também não são acessíveis.
    await rejects(
      t.db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        return tx.query(`select (wl.ensure_challenge()).word`);
      }),
      /permission denied/
    );
  }
});

test('sem sessão só se acede às funções públicas', async () => {
  const { t } = await prepared();
  for (const fn of ['get_game_state', 'get_profile', 'leaderboard_alltime', 'get_rules', 'admin_status', 'admin_users']) {
    await rejects(t.rpc(null, fn), /permission denied/);
  }
  assert.equal((await t.rpc(null, 'get_brand')).name, 'Wordle League');
  assert.equal((await t.rpc(null, 'get_session')).user, null);
});

test('funções de administração só para administradores', async () => {
  const { t, user } = await prepared();
  for (const [fn, args] of [
    ['admin_status', {}], ['admin_users', {}], ['admin_stats', {}], ['admin_audit', {}], ['admin_words', {}],
    ['admin_export_words', { p_list: 'secret' }], ['admin_get_settings', {}],
    ['admin_update_settings', { p_changes: { registration_enabled: false } }],
    ['admin_adjust_points', { p_user: user.id, p_points: 100, p_reason: 'Batota pura' }],
  ]) {
    await rejects(t.rpc(user, fn, args), (e) => e.status === 403, fn);
  }
  assert.equal(await t.total(user), 0);
});

test('a primeira conta fica administradora; as seguintes são jogadores', async () => {
  const t = await setup();
  const first = await t.signUp('chefe');
  const second = await t.signUp('ana');
  assert.equal((await t.rpc(first, 'get_session')).user.role, 'admin');
  assert.equal((await t.rpc(second, 'get_session')).user.role, 'user');
  const audit = (await t.rpc(first, 'admin_audit')).entries.map((a) => a.action);
  assert.ok(audit.includes('admin.bootstrap') && audit.includes('user.register'));
});

test('registo: validações, nome repetido, desativação e contas criadas pelo administrador', async () => {
  const { t, admin } = await prepared();
  await rejects(t.rpc(null, 'check_signup', { p_username: 'a', p_display_name: 'Nome' }), /3 a 32/);
  await rejects(t.rpc(null, 'check_signup', { p_username: 'novo', p_display_name: '<b>x</b>' }), /apresentação/);
  await rejects(t.rpc(null, 'check_signup', { p_username: 'ANA', p_display_name: 'Outra' }), (e) => e.code === 'USERNAME_TAKEN');
  assert.deepEqual(await t.rpc(null, 'check_signup', { p_username: 'novo', p_display_name: 'Novo' }), { ok: true });

  await t.rpc(admin, 'admin_update_settings', { p_changes: { registration_enabled: false } });
  assert.equal((await t.rpc(null, 'get_session')).registrationEnabled, false);
  await rejects(t.rpc(null, 'check_signup', { p_username: 'novo', p_display_name: 'Novo' }), (e) => e.status === 403);
  await rejects(t.signUp('novo'), /registo de novas contas está desativado/);

  // O administrador reserva o nome e a conta é aceite mesmo com o registo fechado.
  await rejects(t.rpc(admin, 'admin_prepare_user', { p_username: 'ana', p_display_name: 'Outra Ana', p_role: 'user' }), /já existe/);
  await t.rpc(admin, 'admin_prepare_user', { p_username: 'Rita', p_display_name: 'Rita Silva', p_role: 'admin' });
  const rita = await t.signUp('rita', { displayName: 'ignorado' });
  const s = (await t.rpc(rita, 'get_session')).user;
  assert.equal(s.displayName, 'Rita Silva');
  assert.equal(s.role, 'admin');
  assert.ok((await t.rpc(admin, 'admin_audit')).entries.some((a) => a.action === 'user.create' && a.target === 'rita' && a.actor === 'admin'));
});

test('bloquear: perde o acesso de imediato, termina sessões e não pode bloquear-se a si nem ao último admin', async () => {
  const { t, admin, user } = await prepared();
  await t.sql('insert into auth.sessions (user_id) values ($1)', [user.id]);
  await rejects(t.rpc(admin, 'admin_set_status', { p_id: admin.id, p_status: 'blocked' }), /própria conta/);
  await t.rpc(admin, 'admin_set_status', { p_id: user.id, p_status: 'blocked' });
  await rejects(t.rpc(user, 'get_game_state'), (e) => e.status === 401);
  assert.equal((await t.rpc(user, 'get_session')).user, null);
  const au = (await t.sql('select banned_until from auth.users where id = $1', [user.id]))[0];
  assert.ok(au.banned_until, 'conta banida no Supabase Auth');
  assert.equal((await t.sql('select count(*) n from auth.sessions where user_id = $1', [user.id]))[0].n, 0);
  await t.rpc(admin, 'admin_set_status', { p_id: user.id, p_status: 'active' });
  assert.equal((await t.sql('select banned_until from auth.users where id = $1', [user.id]))[0].banned_until, null);
  await t.rpc(user, 'get_game_state');

  const other = await t.signUp('outro');
  await t.sql("update wl.profiles set role = 'admin' where id = $1", [other.id]);
  await t.rpc(admin, 'admin_set_status', { p_id: other.id, p_status: 'blocked' });
  await rejects(t.rpc(other, 'admin_set_status', { p_id: admin.id, p_status: 'blocked' }), (e) => e.status === 401);
});

test('redefinir password (validada) e alterar nome de apresentação (auditado)', async () => {
  const { t, admin, user } = await prepared();
  await rejects(t.rpc(admin, 'admin_reset_password', { p_id: user.id, p_password: 'curta' }), /10 caracteres/);
  await rejects(t.rpc(admin, 'admin_reset_password', { p_id: user.id, p_password: 'xx-ana-xxxxxx' }), /nome de utilizador/);
  await t.rpc(admin, 'admin_reset_password', { p_id: user.id, p_password: 'uma-password-nova' });
  const ok = (await t.sql("select encrypted_password = extensions.crypt('uma-password-nova', encrypted_password) ok from auth.users where id = $1", [user.id]))[0].ok;
  assert.equal(ok, true);

  await rejects(t.rpc(admin, 'admin_rename', { p_id: user.id, p_display_name: 'A' }), /2 a 40/);
  const r = await t.rpc(admin, 'admin_rename', { p_id: user.id, p_display_name: 'Ana Maria' });
  assert.equal(r.user.displayName, 'Ana Maria');
  assert.ok((await t.rpc(admin, 'admin_audit')).entries.some((a) => a.action === 'user.rename' && a.details.to === 'Ana Maria'));
});

test('administrador só vê palavras de dias anteriores', async () => {
  const { t, admin, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  t.setNow('2026-07-15T10:00:00Z');
  await t.rpc(user, 'get_game_state');
  const today = await t.secretOf();
  const stats = await t.rpc(admin, 'admin_stats');
  assert.deepEqual(stats.pastChallenges.map((c) => c.challenge_date), ['2026-07-14']);
  assert.ok(!JSON.stringify(stats).includes(today) || stats.pastChallenges[0].word === today);
  const st = await t.rpc(admin, 'admin_status');
  assert.equal(st.todayChallenge.exists, true);
  assert.equal(st.todayChallenge.word, undefined);
});

test('importação: validação no servidor, confirmação explícita e exportação', async () => {
  const { t, admin } = await prepared();
  const imp = (args) => t.rpc(admin, 'admin_import_words', {
    p_list: 'secret', p_mode: 'append', p_filename: 'x.txt', p_words: [], p_invalid: 0, p_duplicates: 0, p_confirm_replace: false, ...args,
  });
  await rejects(imp({ p_words: ['PEDRA', 'ABC'] }), /Palavra inválida/);
  await rejects(imp({ p_words: ['PEDR4'] }), /Palavra inválida/);
  await rejects(imp({ p_words: [] }), /não contém palavras/);
  await rejects(imp({ p_words: ['FOLHA'], p_mode: 'replace' }), (e) => e.code === 'CONFIRM_REQUIRED');
  const r = await imp({ p_words: ['folha', 'FOLHA', ' Pêras ', 'PEDRA'] });
  assert.equal(r.inserted, 2, 'PEDRA já existia; duplicados contam uma vez');
  assert.equal(r.total, 12);
  const ex = await t.rpc(admin, 'admin_words_existing', { p_list: 'secret', p_words: ['PEDRA', 'XXXXX'] });
  assert.equal(ex.alreadyInList, 1);
  const text = await t.rpc(admin, 'admin_export_words', { p_list: 'secret' });
  assert.ok(text.includes('PÊRAS\n') && text.includes('FOLHA\n'));
  const w = await t.rpc(admin, 'admin_words');
  assert.equal(w.imports[0].inserted_count, 2);
  assert.equal(w.imports[0].imported_by_username, 'admin');
  assert.equal(w.lists.secret.total, 12);
});

test('personalização: textos validados e imagens só por administradores', async () => {
  const { t, admin, user } = await prepared();
  await rejects(t.rpc(admin, 'admin_update_settings', { p_changes: { brand_name: '<script>' } }), /caracteres inválidos/);
  await rejects(t.rpc(admin, 'admin_update_settings', { p_changes: { desconhecido: 1 } }), /desconhecido/);
  await t.rpc(admin, 'admin_update_settings', { p_changes: { brand_name: 'Liga da Equipa', brand_tagline: '' } });
  const b = await t.rpc(null, 'get_brand');
  assert.equal(b.name, 'Liga da Equipa');
  assert.equal(b.tagline, '');
  assert.equal(b.logoPath, null);

  await rejects(t.rpc(user, 'admin_brand_set', { p_kind: 'logo', p_path: 'logo-abc.png', p_mime: 'image/png', p_size: 100 }), (e) => e.status === 403);
  await rejects(t.rpc(admin, 'admin_brand_set', { p_kind: 'logo', p_path: 'logo-abc.svg', p_mime: 'image/svg+xml', p_size: 100 }), /Formato/);
  await rejects(t.rpc(admin, 'admin_brand_set', { p_kind: 'logo', p_path: '../x.png', p_mime: 'image/png', p_size: 100 }), /Caminho/);
  await rejects(t.rpc(admin, 'admin_brand_set', { p_kind: 'logo', p_path: 'logo-a.png', p_mime: 'image/png', p_size: 3e6 }), /2 MB/);
  let r = await t.rpc(admin, 'admin_brand_set', { p_kind: 'logo', p_path: 'logo-abc.png', p_mime: 'image/png', p_size: 100 });
  assert.equal(r.logoPath, 'logo-abc.png');
  assert.equal(r.customLogo, true);
  r = await t.rpc(admin, 'admin_brand_set', { p_kind: 'logo', p_path: 'logo-def.webp', p_mime: 'image/webp', p_size: 100 });
  assert.equal(r.previousPath, 'logo-abc.png');
  r = await t.rpc(admin, 'admin_brand_remove', { p_kind: 'logo' });
  assert.equal(r.logoPath, null);
  assert.equal(r.previousPath, 'logo-def.webp');
});

test('o esquema pode ser aplicado de novo sem perder dados', async () => {
  const { t, user } = await prepared();
  t.setNow('2026-07-14T10:00:00Z');
  await t.rpc(user, 'submit_guess', { p_guess: 'ARROZ' });
  const { readFileSync } = await import('node:fs');
  await t.db.exec(readFileSync(new URL('../supabase/1-esquema.sql', import.meta.url), 'utf8'));
  const s = await t.rpc(user, 'get_game_state');
  assert.equal(s.attemptsUsed, 1);
  assert.equal((await t.rpc(user, 'get_session')).user.username, 'ana');
});
