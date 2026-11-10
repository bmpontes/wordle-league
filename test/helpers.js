'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { migrate } = require('../src/db/migrate');
const { SqliteSessionStore } = require('../src/db/sessionStore');
const { createContext } = require('../src/context');
const { createApp } = require('../src/app');
const clock = require('../src/utils/clock');

const PASSWORD = 'password-de-teste-123';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fwl-test-'));
}

/**
 * Cria um contexto completo (BD + serviços + app) isolado para um teste.
 * Por omissão, o período de jogo é o dia inteiro e o bónus de primeiro vencedor
 * está desligado, para que os testes não dependam da hora real nem desse bónus
 * (os testes próprios dessas funcionalidades usam neutral: false).
 */
function setup({ dbFile, dataDir = tempDir(), env = {}, neutral = true } = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    DB_FILE: dbFile || ':memory:',
    SESSION_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
    LOG_REQUESTS: 'false',
    ...env,
  });
  if (!dbFile) config.dbFile = ':memory:';
  const db = openDatabase(config.dbFile);
  migrate(db);
  const sessionStore = new SqliteSessionStore(db);
  const ctx = createContext({ db, config, sessionStore });
  if (neutral && !ctx.models.settings.get('play_start')) {
    ctx.models.settings.set('play_start', '00:00');
    ctx.models.settings.set('play_end', '00:00');
    ctx.models.settings.set('podium_bonus_points', []);
  }
  const app = createApp(ctx);
  return {
    ctx,
    app,
    db,
    config,
    close() {
      sessionStore.close();
      ctx.close();
      db.close();
    },
  };
}

async function createUser(ctx, username, role = 'user', displayName) {
  return ctx.services.auth.createUser({ username, displayName: displayName || `Nome ${username}`, password: PASSWORD, role });
}

/** Importa palavras diretamente pelos serviços (preview + confirmação). */
function importWords(ctx, adminId, listType, words, mode = 'replace') {
  const p = ctx.services.wordImport.preview({ listType, content: words.join('\n'), filename: 'lista.txt' }, adminId);
  return ctx.services.wordImport.confirm({ previewId: p.previewId, mode, confirmReplace: true }, adminId);
}

/** Agente HTTP autenticado (cookie de sessão + token CSRF). */
async function login(app, username, password = PASSWORD) {
  const agent = request.agent(app);
  const s = await agent.get('/api/auth/session');
  const res = await agent.post('/api/auth/login').set('X-CSRF-Token', s.body.csrfToken).send({ username, password });
  if (res.status !== 200) throw new Error(`Login falhou: ${res.status} ${JSON.stringify(res.body)}`);
  agent.csrf = res.body.csrfToken;
  agent.sessionCookie = res.headers['set-cookie'].find((c) => c.startsWith('fwl.sid=')).split(';')[0];
  agent.postJson = (url, body) => agent.post(url).set('X-CSRF-Token', agent.csrf).send(body);
  agent.putJson = (url, body) => agent.put(url).set('X-CSRF-Token', agent.csrf).send(body);
  return agent;
}

/** Palavra secreta do dia (lida diretamente da BD, só para os testes). */
function secretOf(ctx, date) {
  return ctx.models.challenges.findByDate(date || ctx.services.dailyWord.today()).word;
}

const SECRET_WORDS = ['PEDRA', 'LIVRO', 'NUVEM', 'CASAS', 'NOITE', 'PORTA', 'CAMPO', 'MESAS', 'LAPIS', 'TERRA'];
const ACCEPTED_WORDS = ['ARROZ', 'BOLSA', 'CHAVE', 'DENTE', 'FESTA', 'GRUPO', 'HORTA', 'JOGOS', 'LEITE', 'MAÇÃS', 'PÊRAS', 'SALTO'];

module.exports = { setup, createUser, importWords, login, secretOf, tempDir, clock, PASSWORD, SECRET_WORDS, ACCEPTED_WORDS };
