// Simulador local do Supabase para experimentar a app sem internet:
//   npm run serve   →   http://localhost:5173
// Serve os ficheiros do site e imita as partes do Supabase que a app usa (Auth, RPC e
// Storage), com a base de dados de teste (PGlite) em memória. Só para desenvolvimento.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setup, SECRET_WORDS, ACCEPTED_WORDS } from './helpers.mjs';

const PORT = Number(process.env.PORT || 5173);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

const t = await setup({ neutral: true });
const tokens = new Map(); // access/refresh token → user id
const files = new Map(); // Storage em memória

// Dados de demonstração: administrador "admin" e jogadora "ana" (password: password-de-teste-123).
const admin = await t.signUp('admin', { displayName: 'Administração' });
await t.importWords(admin, 'secret', SECRET_WORDS);
await t.importWords(admin, 'accepted', ACCEPTED_WORDS);
await t.signUp('ana', { displayName: 'Ana' });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function session(userId, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, email, role: 'authenticated', exp })}.sig${randomUUID()}`;
  const refresh = randomUUID();
  tokens.set(access, userId);
  tokens.set(refresh, userId);
  const user = { id: userId, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: refresh, user };
}

const send = (res, status, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isBuf ? headers['Content-Type'] : 'application/json', ...headers });
  res.end(isBuf ? body : body === undefined ? '' : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
const userOf = (req) => tokens.get((req.headers.authorization || '').replace(/^Bearer /, '')) || null;

async function checkPassword(email, password) {
  const rows = await t.sql('select id from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password) and (banned_until is null or banned_until < now())', [email, password]);
  return rows[0] && rows[0].id;
}

async function auth(req, res, path, body) {
  const q = new URL(req.url, 'http://x').searchParams;
  if (path === 'token' && q.get('grant_type') === 'password') {
    const id = await checkPassword(body.email, body.password);
    if (!id) return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', message: 'Invalid login credentials' });
    return send(res, 200, session(id, body.email));
  }
  if (path === 'token' && q.get('grant_type') === 'refresh_token') {
    const id = tokens.get(body.refresh_token);
    if (!id) return send(res, 400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' });
    const email = (await t.sql('select email from auth.users where id = $1', [id]))[0].email;
    return send(res, 200, session(id, email));
  }
  if (path === 'signup') {
    if ((await t.sql('select 1 from auth.users where email = $1', [body.email])).length) {
      return send(res, 422, { code: 'user_already_exists', message: 'User already registered' });
    }
    const id = randomUUID();
    try {
      await t.sql(`insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
                   values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf', 4)), $4)`, [id, body.email, body.password, (body.data || {})]);
    } catch (e) {
      return send(res, 500, { code: 'unexpected_failure', message: 'Database error saving new user' });
    }
    return send(res, 200, session(id, body.email));
  }
  if (path === 'user' && req.method === 'PUT') {
    const id = userOf(req);
    if (!id) return send(res, 401, { message: 'not authenticated' });
    if (body.password) await t.sql(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 4)) where id = $1`, [id, body.password]);
    return send(res, 200, { id });
  }
  if (path === 'logout') return send(res, 204);
  if (path === 'user') {
    const id = userOf(req);
    return id ? send(res, 200, { id }) : send(res, 401, { message: 'not authenticated' });
  }
  return send(res, 404, { message: `auth ${path}` });
}

async function rpc(req, res, fn, body) {
  const uid = userOf(req);
  const args = body.length ? JSON.parse(body) : {};
  const meta = await t.sql(`select p.proargnames as names, array(select format_type(x, null) from unnest(p.proargtypes) x) as types
                              from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
  if (!meta.length) return send(res, 404, { code: 'PGRST202', message: `função ${fn} inexistente` });
  const { names = [], types = [] } = meta[0];
  const params = [];
  const parts = Object.keys(args).map((k) => {
    const type = types[(names || []).indexOf(k)] || 'text';
    params.push(JSON.stringify(args[k]));
    const p = `$${params.length}::jsonb`;
    const expr = type.endsWith('[]') ? `(select array_agg(x) from jsonb_array_elements_text(${p}) x)` : type === 'jsonb' ? p : `(${p} #>> '{}')::${type}`;
    return `${k} => coalesce(${expr}, ${type.endsWith('[]') ? `'{}'::${type}` : 'null'})`;
  });
  try {
    const r = await t.db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
      await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
      return (await tx.query(`select to_jsonb(public.${fn}(${parts.join(', ')})) as r`, params)).rows[0].r;
    });
    return send(res, 200, r);
  } catch (e) {
    const status = e.code === '42501' ? 401 : 400;
    return send(res, status, { code: e.code, message: e.message, details: e.detail || null, hint: e.hint || null });
  }
}

async function storage(req, res, path, body) {
  let m;
  if ((m = path.match(/^object\/public\/marca\/(.+)$/))) {
    const f = files.get(decodeURIComponent(m[1]));
    return f ? send(res, 200, f.data, { 'Content-Type': f.type }) : send(res, 404, { message: 'not found' });
  }
  const admin = userOf(req) && (await t.sql(`select 1 from wl.profiles where id = $1 and role = 'admin'`, [userOf(req)])).length;
  if (!admin) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
  if (req.method === 'POST' && (m = path.match(/^object\/marca\/(.+)$/))) {
    files.set(decodeURIComponent(m[1]), { data: body, type: req.headers['content-type'] });
    return send(res, 200, { Key: `marca/${m[1]}` });
  }
  if (req.method === 'DELETE' && path === 'object/marca') {
    for (const p of JSON.parse(body).prefixes || []) files.delete(p);
    return send(res, 200, []);
  }
  return send(res, 404, { message: `storage ${path}` });
}

async function staticFile(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/config.js') {
    return send(res, 200, Buffer.from(`window.WL_CONFIG = { SUPABASE_URL: 'http://localhost:${PORT}', SUPABASE_ANON_KEY: 'chave-local', EMAIL_DOMAIN: 'wordle-league.local' };\n`), { 'Content-Type': TYPES['.js'] });
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT)) || /node_modules|\.git/.test(file)) return send(res, 404, { message: 'not found' });
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    return send(res, 200, await readFile(file), { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  } catch {
    return send(res, 404, { message: 'not found' });
  }
}

http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://x').pathname;
    const body = await readBody(req);
    let m;
    if ((m = path.match(/^\/auth\/v1\/(.+)$/))) return await auth(req, res, m[1], body.length ? JSON.parse(body) : {});
    if ((m = path.match(/^\/rest\/v1\/rpc\/(\w+)$/))) return await rpc(req, res, m[1], body);
    if ((m = path.match(/^\/storage\/v1\/(.+)$/))) return await storage(req, res, m[1], body);
    if (req.method !== 'GET') return send(res, 405, { message: 'method' });
    return await staticFile(req, res);
  } catch (e) {
    console.error(e);
    send(res, 500, { message: String(e.message) });
  }
}).listen(PORT, () => console.log(`Wordle League (simulador) em http://localhost:${PORT} — contas: admin / ana, password: password-de-teste-123`));
