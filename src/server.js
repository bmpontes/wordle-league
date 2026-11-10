'use strict';

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { migrate } = require('./db/migrate');
const { SqliteSessionStore } = require('./db/sessionStore');
const { createContext } = require('./context');
const { createApp } = require('./app');

/** Inicializa BD, migrações, administrador inicial e servidor HTTP. */
async function start(env = process.env) {
  const config = loadConfig(env);
  const db = openDatabase(config.dbFile);
  migrate(db, { log: console.log });

  const sessionStore = new SqliteSessionStore(db, { ttlMs: config.sessionMaxAgeHours * 3600 * 1000 });
  const ctx = createContext({ db, config, sessionStore });
  await ctx.services.auth.bootstrapAdmin();

  // Conclui jogos de dias anteriores que ficaram por terminar (também é feito a pedido).
  const finalize = () => {
    try {
      ctx.services.game.finalizeExpired();
    } catch (err) {
      console.error('[erro] finalização de jogos expirados:', err);
    }
  };
  finalize();
  const timer = setInterval(finalize, 10 * 60 * 1000);
  timer.unref();

  const app = createApp(ctx);
  const server = app.listen(config.port, config.host, () => {
    console.log(`Wordle League disponível em http://${config.host}:${config.port} (fuso: ${config.timezone})`);
  });

  const shutdown = (signal) => {
    console.log(`Sinal ${signal} recebido. A terminar...`);
    clearInterval(timer);
    server.close(() => {
      sessionStore.close();
      ctx.close();
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { server, db, ctx };
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Falha ao arrancar:', err.message);
    process.exit(1);
  });
}

module.exports = { start };
