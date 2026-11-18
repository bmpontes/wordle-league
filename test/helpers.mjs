// Ambiente de teste: PostgreSQL em memória (PGlite) com uma imitação mínima do
// Supabase (esquema auth, papéis anon/authenticated), onde se carrega o
// supabase/1-esquema.sql tal como é colado no SQL Editor do Supabase.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SCHEMA = readFileSync(new URL('../supabase/1-esquema.sql', import.meta.url), 'utf8');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema extensions;
  create extension pgcrypto schema extensions;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (
    id uuid primary key, email text unique, encrypted_password text,
    raw_user_meta_data jsonb default '{}', banned_until timestamptz, updated_at timestamptz
  );
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
`;

export const SECRET_WORDS = ['PEDRA', 'LIVRO', 'NUVEM', 'CASAS', 'NOITE', 'PORTA', 'CAMPO', 'MESAS', 'LAPIS', 'TERRA'];
export const ACCEPTED_WORDS = ['ARROZ', 'BOLSA', 'CHAVE', 'DENTE', 'FESTA', 'GRUPO', 'HORTA', 'JOGOS', 'LEITE', 'MAÇÃS', 'PÊRAS', 'SALTO'];
export const WRONG = ['ARROZ', 'BOLSA', 'CHAVE', 'DENTE', 'FESTA', 'GRUPO', 'HORTA'];

/** Erro devolvido por uma função, com os mesmos campos que a app usa. */
export class RpcError extends Error {
  constructor(e) {
    super(e.message);
    this.code = e.hint || e.code;
    this.status = Number(e.detail) || 500;
  }
}

/**
 * Cria uma BD nova. Por omissão o jogo está aberto o dia todo e sem bónus de pódio
 * (como nos testes do servidor); use neutral: false para testar esses parâmetros.
 */
export async function setup({ neutral = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await db.exec(SCHEMA);
  let now = null;

  const t = {
    db,
    setNow(iso) { now = iso; },
    /** Executa uma função RPC como o papel indicado (anon ou authenticated). */
    async rpc(user, fn, args = {}) {
      const names = Object.keys(args);
      const params = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
      return db.transaction(async (tx) => {
        if (now) await tx.query(`select set_config('wl.fake_now', $1, true)`, [now]);
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ? user.id : '']);
        await tx.exec(`set local role ${user ? 'authenticated' : 'anon'}`);
        try {
          const r = await tx.query(`select public.${fn}(${params}) as r`, names.map((n) => args[n]));
          return r.rows[0].r;
        } catch (e) {
          throw new RpcError(e);
        }
      });
    },
    /** Consulta direta (como dono da BD, sem restrições). */
    async sql(text, params = []) {
      return db.transaction(async (tx) => {
        if (now) await tx.query(`select set_config('wl.fake_now', $1, true)`, [now]);
        return (await tx.query(text, params)).rows;
      });
    },
    /** Imita o registo no Supabase Auth (o trigger cria o perfil). */
    async signUp(username, { displayName, password = 'password-de-teste-123' } = {}) {
      const id = randomUUID();
      await db.query(
        `insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
         values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf', 4)), $4)`,
        [id, `${username}@wordle-league.local`, password, { display_name: displayName || `Nome ${username}` }]
      );
      return { id, username };
    },
    async importWords(admin, list, words, mode = 'replace') {
      return t.rpc(admin, 'admin_import_words', {
        p_list: list, p_mode: mode, p_filename: 'lista.txt', p_words: words,
        p_invalid: 0, p_duplicates: 0, p_confirm_replace: true,
      });
    },
    async secretOf(date) {
      const rows = await t.sql(`select word from wl.daily_challenges where challenge_date = coalesce($1::date, wl.today())`, [date || null]);
      return rows[0] && rows[0].word;
    },
    async total(user) {
      return Number((await t.sql('select coalesce(sum(points),0) s from wl.point_transactions where user_id = $1', [user.id]))[0].s);
    },
  };

  if (neutral) {
    await db.exec(`insert into wl.settings (key, value) values
      ('play_start', '"00:00"'), ('play_end', '"00:00"'), ('podium_bonus_points', '[]')`);
  }
  return t;
}

/** BD com administrador, listas importadas e um jogador. */
export async function prepared(opts) {
  const t = await setup(opts);
  const admin = await t.signUp('admin');
  await t.importWords(admin, 'secret', SECRET_WORDS);
  await t.importWords(admin, 'accepted', ACCEPTED_WORDS);
  const user = await t.signUp('ana');
  return { t, admin, user };
}

export async function rejects(promise, check) {
  try {
    await promise;
  } catch (e) {
    if (typeof check === 'function' && !check(e)) throw new Error(`Erro inesperado: ${e.code} ${e.status} ${e.message}`);
    if (check instanceof RegExp && !check.test(e.message)) throw new Error(`Mensagem inesperada: ${e.message}`);
    return e;
  }
  throw new Error('Era esperado um erro.');
}
