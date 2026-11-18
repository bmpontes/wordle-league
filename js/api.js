/*
 * Cliente da "API". As páginas continuam a pedir os mesmos endereços que pediam ao
 * servidor Node.js (/api/game/today, /api/admin/users, ...). Aqui cada pedido é
 * traduzido numa chamada ao Supabase: funções da base de dados (RPC), Auth e Storage.
 * Toda a validação, avaliação e pontuação acontece na base de dados.
 */
(function () {
  'use strict';

  const cfg = window.WL_CONFIG || {};
  const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const EMAIL_DOMAIN = cfg.EMAIL_DOMAIN || 'wordle-league.local';

  const sb = configured
    ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wl.auth' },
      })
    : null;

  let sessionInfo = null;
  const previews = new Map(); // pré-visualizações de importação (só neste separador)

  class ApiError extends Error {
    constructor(status, message, code) {
      super(message || 'Erro de comunicação com o servidor.');
      this.status = status;
      this.code = code;
    }
  }

  const emailOf = (username) => `${String(username || '').trim().toLowerCase()}@${EMAIL_DOMAIN}`;

  function notConfigured() {
    return new ApiError(0, 'A aplicação ainda não está ligada à base de dados. Preencha o config.js (ver COMO-INSTALAR.md).', 'NOT_CONFIGURED');
  }

  /** Converte um erro do Supabase num ApiError com estado "HTTP" e mensagem em português. */
  function toApiError(error) {
    if (!error) return new ApiError(500);
    if (error instanceof ApiError) return error;
    // Erros lançados pelas funções da BD: hint = código, details = estado.
    if (error.hint && /^\d{3}$/.test(String(error.details || ''))) {
      return new ApiError(Number(error.details), error.message, error.hint);
    }
    if (error.code === '42501' || error.code === 'PGRST301' || /JWT/i.test(error.message || '')) {
      return new ApiError(401, 'Sessão expirada ou inválida. Entre novamente.', 'NOT_AUTHENTICATED');
    }
    if (error.name === 'TypeError' || /fetch|network/i.test(error.message || '')) {
      return new ApiError(0, 'Sem ligação ao servidor. Verifique a Internet e tente de novo.', 'NETWORK');
    }
    return new ApiError(error.status || 500, error.message, error.code);
  }

  async function rpc(fn, args) {
    if (!sb) throw notConfigured();
    let res;
    try {
      res = await sb.rpc(fn, args || {});
    } catch (err) {
      throw toApiError(err);
    }
    if (res.error) throw toApiError(res.error);
    return res.data;
  }

  // ---------- Sessão e contas ----------

  async function loadSession() {
    if (!sb) {
      sessionInfo = { user: null, registrationEnabled: false };
      throw notConfigured();
    }
    sessionInfo = await rpc('get_session');
    // Sessão do Supabase sem perfil ativo (ex.: conta bloqueada): termina-a.
    if (!sessionInfo.user) {
      const { data } = await sb.auth.getSession();
      if (data && data.session) await sb.auth.signOut().catch(() => {});
    }
    return sessionInfo;
  }

  function checkPassword(password, username) {
    if (typeof password !== 'string' || password.length < 10) throw new ApiError(400, 'A password deve ter pelo menos 10 caracteres.');
    if (password.length > 72) throw new ApiError(400, 'A password deve ter no máximo 72 caracteres.');
    if (username && password.toLowerCase().includes(String(username).trim().toLowerCase())) {
      throw new ApiError(400, 'A password não pode conter o nome de utilizador.');
    }
  }

  async function login({ username, password }) {
    if (!sb) throw notConfigured();
    if (!username || !password) throw new ApiError(400, 'Indique o nome de utilizador e a password.');
    const { error } = await sb.auth.signInWithPassword({ email: emailOf(username), password });
    if (error) {
      if (error.status === 429) throw new ApiError(429, 'Demasiadas tentativas. Aguarde um pouco e tente de novo.');
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        throw new ApiError(401, 'Credenciais inválidas ou conta inativa.', 'INVALID_CREDENTIALS');
      }
      throw toApiError(error);
    }
    await rpc('touch_login').catch(() => {});
    const s = await loadSession();
    if (!s.user) throw new ApiError(401, 'Credenciais inválidas ou conta inativa.', 'INVALID_CREDENTIALS');
    return s;
  }

  function signUpError(error) {
    if (/already registered|already exists/i.test(error.message || '')) return new ApiError(409, 'Esse nome de utilizador já existe.');
    if (/password/i.test(error.message || '')) return new ApiError(400, 'A password não cumpre os requisitos (mínimo 10 caracteres).');
    if (/Database error/i.test(error.message || '')) return new ApiError(400, 'Não foi possível criar a conta (registo desativado ou dados inválidos).');
    if (error.status === 429) return new ApiError(429, 'Foram criadas demasiadas contas seguidas. Aguarde uns minutos.');
    return toApiError(error);
  }

  async function register({ username, displayName, password }) {
    if (!sb) throw notConfigured();
    await rpc('check_signup', { p_username: username, p_display_name: displayName });
    checkPassword(password, username);
    const { data, error } = await sb.auth.signUp({
      email: emailOf(username),
      password,
      options: { data: { display_name: String(displayName || '').trim() } },
    });
    if (error) throw signUpError(error);
    if (!data.session) {
      throw new ApiError(400, 'Conta criada, mas o Supabase exige confirmação por email. O administrador tem de desligar "Confirm email" (ver COMO-INSTALAR.md).');
    }
    await rpc('touch_login').catch(() => {});
    return loadSession();
  }

  async function logout() {
    if (sb) await sb.auth.signOut().catch(() => {});
    sessionInfo = null;
    return { ok: true };
  }

  async function changePassword({ currentPassword, newPassword }) {
    const me = (sessionInfo && sessionInfo.user) || (await loadSession()).user;
    if (!me) throw new ApiError(401, 'Sessão expirada. Entre novamente.');
    const check = await sb.auth.signInWithPassword({ email: emailOf(me.username), password: currentPassword || '' });
    if (check.error) throw new ApiError(400, 'A password atual está incorreta.', 'WRONG_PASSWORD');
    checkPassword(newPassword, me.username);
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw signUpError(error);
    await rpc('note_password_changed').catch(() => {});
    return { ok: true };
  }

  /** Conta criada pelo administrador (sem terminar a sessão do administrador). */
  async function adminCreateUser({ username, displayName, password, role }) {
    checkPassword(password, username);
    const { username: u } = await rpc('admin_prepare_user', { p_username: username, p_display_name: displayName, p_role: role || 'user' });
    const temp = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'wl.auth.create' },
    });
    const { data, error } = await temp.auth.signUp({ email: emailOf(u), password, options: { data: { display_name: displayName } } });
    if (error) throw signUpError(error);
    if (data.session) await temp.auth.signOut({ scope: 'local' }).catch(() => {});
    return { user: { username: u } };
  }

  // ---------- Personalização ----------

  const storageUrl = (path) => `${cfg.SUPABASE_URL}/storage/v1/object/public/marca/${encodeURIComponent(path)}`;

  function brandInfo(b) {
    return {
      name: b.name,
      tagline: b.tagline,
      footer: b.footer,
      logoRound: b.logoRound,
      customLogo: b.customLogo,
      logoUrl: b.logoPath ? storageUrl(b.logoPath) : 'img/default-logo.svg',
      rankingUrl: b.rankingPath ? storageUrl(b.rankingPath) : null,
    };
  }

  async function getBrand() {
    if (!sb) {
      return { name: 'Wordle League', tagline: 'Desafio diário de palavras', footer: '', logoRound: false, customLogo: false, logoUrl: 'img/default-logo.svg', rankingUrl: null };
    }
    return brandInfo(await rpc('get_brand'));
  }

  async function removeStored(path) {
    if (path) await sb.storage.from('marca').remove([path]).catch(() => {});
  }

  async function uploadBrand(kind, { data }) {
    // "data URL" → bytes (sem fetch: as regras de segurança da página não permitem data:).
    const b64 = String(data || '').replace(/^data:[^;,]*;base64,/, '');
    let bytes;
    try {
      bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } catch {
      throw new ApiError(400, 'Imagem inválida.');
    }
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new ApiError(400, 'Imagem inválida ou demasiado grande (máximo 2 MB).');
    const mime = WordsFile.detectImageType(bytes.subarray(0, 16));
    if (!mime) throw new ApiError(400, 'Formato não suportado. Use PNG, JPEG ou WEBP.');
    const blob = new Blob([bytes], { type: mime });
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
    const path = `${kind}-${Date.now().toString(36)}.${ext}`;
    const up = await sb.storage.from('marca').upload(path, blob, { contentType: mime, upsert: false, cacheControl: '3600' });
    if (up.error) throw toApiError(up.error);
    let b;
    try {
      b = await rpc('admin_brand_set', { p_kind: kind, p_path: path, p_mime: mime, p_size: blob.size });
    } catch (err) {
      await removeStored(path);
      throw err;
    }
    await removeStored(b.previousPath);
    return brandInfo(b);
  }

  async function removeBrand(kind) {
    const b = await rpc('admin_brand_remove', { p_kind: kind });
    await removeStored(b.previousPath);
    return brandInfo(b);
  }

  // ---------- Palavras (a análise do ficheiro é feita aqui, no browser) ----------

  async function previewWords({ listType, filename, content }) {
    const st = await rpc('admin_words_existing', { p_list: listType, p_words: [] });
    let parsed;
    try {
      parsed = WordsFile.parseWordFile(content, { filename: String(filename || ''), wordLength: st.wordLength });
    } catch (err) {
      throw new ApiError(400, err.message);
    }
    const ex = parsed.valid.length
      ? await rpc('admin_words_existing', { p_list: listType, p_words: parsed.valid })
      : { alreadyInList: 0, currentCount: st.currentCount };
    const previewId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    previews.set(previewId, { listType, filename: String(filename || '').slice(0, 200), parsed });
    return {
      previewId,
      listType,
      format: parsed.format,
      wordLength: st.wordLength,
      validCount: parsed.valid.length,
      invalidCount: parsed.invalid.length,
      duplicateCount: parsed.duplicates.length,
      emptyLines: parsed.emptyLines,
      headerSkipped: parsed.headerSkipped,
      alreadyInList: ex.alreadyInList,
      currentCount: ex.currentCount,
      sampleValid: parsed.valid.slice(0, 50),
      sampleInvalid: parsed.invalid.slice(0, 50),
      sampleDuplicates: parsed.duplicates.slice(0, 50),
    };
  }

  async function importWords({ previewId, mode, confirmReplace }) {
    const p = previews.get(previewId);
    if (!p) throw new ApiError(404, 'Pré-visualização inexistente ou expirada. Volte a carregar o ficheiro.');
    const r = await rpc('admin_import_words', {
      p_list: p.listType,
      p_mode: mode,
      p_filename: p.filename,
      p_words: p.parsed.valid,
      p_invalid: p.parsed.invalid.length,
      p_duplicates: p.parsed.duplicates.length,
      p_confirm_replace: confirmReplace === true,
    });
    previews.delete(previewId);
    return r;
  }

  /** Descarrega a lista atual como .txt. */
  async function exportWords(type) {
    const text = await rpc('admin_export_words', { p_list: type });
    const name = `${type === 'secret' ? 'palavras-secretas' : 'palavras-aceites'}-${new Date().toISOString().slice(0, 10)}.txt`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Encaminhamento dos endereços usados pelas páginas ----------

  const routes = [
    ['GET', /^\/api\/auth\/session$/, () => loadSession()],
    ['POST', /^\/api\/auth\/login$/, (m, b) => login(b)],
    ['POST', /^\/api\/auth\/register$/, (m, b) => register(b)],
    ['POST', /^\/api\/auth\/logout$/, () => logout()],
    ['POST', /^\/api\/auth\/password$/, (m, b) => changePassword(b)],
    ['GET', /^\/api\/brand$/, () => getBrand()],

    ['GET', /^\/api\/game\/today$/, () => rpc('get_game_state')],
    ['POST', /^\/api\/game\/guess$/, (m, b) => rpc('submit_guess', { p_guess: b.guess == null ? null : String(b.guess) })],

    ['GET', /^\/api\/leaderboard\/daily$/, (m, b, q) => rpc('leaderboard_daily', { p_date: q.get('date') || null })],
    ['GET', /^\/api\/leaderboard\/monthly$/, (m, b, q) => rpc('leaderboard_monthly', { p_season: q.get('season') || null })],
    ['GET', /^\/api\/leaderboard\/alltime$/, () => rpc('leaderboard_alltime')],
    ['GET', /^\/api\/leaderboard\/seasons$/, () => rpc('leaderboard_seasons')],
    ['GET', /^\/api\/public\/leaderboard$/, () => rpc('public_leaderboard')],
    ['GET', /^\/api\/profile\/me$/, () => rpc('get_profile')],
    ['GET', /^\/api\/rules$/, () => rpc('get_rules')],

    ['GET', /^\/api\/admin\/status$/, () => rpc('admin_status')],
    ['GET', /^\/api\/admin\/stats$/, () => rpc('admin_stats')],
    ['GET', /^\/api\/admin\/users$/, () => rpc('admin_users')],
    ['POST', /^\/api\/admin\/users$/, (m, b) => adminCreateUser(b)],
    ['POST', /^\/api\/admin\/users\/([^/]+)\/block$/, (m) => rpc('admin_set_status', { p_id: m[1], p_status: 'blocked' })],
    ['POST', /^\/api\/admin\/users\/([^/]+)\/unblock$/, (m) => rpc('admin_set_status', { p_id: m[1], p_status: 'active' })],
    ['POST', /^\/api\/admin\/users\/([^/]+)\/password$/, (m, b) => rpc('admin_reset_password', { p_id: m[1], p_password: b.password })],
    ['POST', /^\/api\/admin\/users\/([^/]+)\/display-name$/, (m, b) => rpc('admin_rename', { p_id: m[1], p_display_name: b.displayName })],
    ['GET', /^\/api\/admin\/settings$/, () => rpc('admin_get_settings')],
    ['PUT', /^\/api\/admin\/settings$/, (m, b) => rpc('admin_update_settings', { p_changes: b })],
    ['GET', /^\/api\/admin\/words$/, () => rpc('admin_words')],
    ['POST', /^\/api\/admin\/words\/preview$/, (m, b) => previewWords(b)],
    ['POST', /^\/api\/admin\/words\/import$/, (m, b) => importWords(b)],
    ['GET', /^\/api\/admin\/points\/adjustments$/, () => rpc('admin_adjustments')],
    ['POST', /^\/api\/admin\/points\/adjust$/, (m, b) => rpc('admin_adjust_points', { p_user: b.userId, p_points: b.points, p_reason: b.reason })],
    ['GET', /^\/api\/admin\/audit$/, () => rpc('admin_audit')],
    ['POST', /^\/api\/admin\/brand\/(logo|ranking)$/, (m, b) => uploadBrand(m[1], b)],
    ['POST', /^\/api\/admin\/brand\/(logo|ranking)\/remove$/, (m) => removeBrand(m[1])],
  ];

  async function request(method, url, body) {
    const u = new URL(url, location.href);
    for (const [verb, re, handler] of routes) {
      if (verb !== method) continue;
      const m = u.pathname.replace(/^.*(?=\/api\/)/, '').match(re);
      if (m) {
        try {
          return await handler(m, body || {}, u.searchParams);
        } catch (err) {
          throw toApiError(err);
        }
      }
    }
    throw new ApiError(404, `Pedido desconhecido: ${method} ${u.pathname}`);
  }

  window.Api = {
    ApiError,
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    put: (url, body) => request('PUT', url, body),
    loadSession,
    session: () => sessionInfo,
    exportWords,
    configured,
  };
})();
