'use strict';

/*
 * Cria uma conta de administrador de forma segura.
 *
 *   npm run create-admin                      (pergunta os dados; password não é mostrada)
 *   docker compose exec app node scripts/create-admin.js
 *
 * Também aceita ADMIN_USERNAME / ADMIN_DISPLAY_NAME / ADMIN_PASSWORD no ambiente
 * (útil em automatização). Nunca existem credenciais predefinidas.
 */
const readline = require('readline');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { migrate } = require('../src/db/migrate');
const { createContext } = require('../src/context');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else if (s === '\r\n' || s === '\n') rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbFile);
  migrate(db);
  const ctx = createContext({ db, config });
  try {
    const env = process.env;
    const fromEnv = Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD);
    if (!fromEnv && !process.stdin.isTTY) {
      throw new Error('Sem terminal interativo: defina ADMIN_USERNAME e ADMIN_PASSWORD, ou use "docker compose exec -it".');
    }
    const username = env.ADMIN_USERNAME || (await ask('Nome de utilizador do administrador: '));
    const displayName =
      env.ADMIN_DISPLAY_NAME || (fromEnv ? username : await ask(`Nome de apresentação [${username}]: `)) || username;
    let password = env.ADMIN_PASSWORD;
    if (!password) {
      password = await ask('Password (mín. 10 caracteres): ', { hidden: true });
      const again = await ask('Repita a password: ', { hidden: true });
      if (password !== again) throw new Error('As passwords não coincidem.');
    }
    const user = await ctx.services.auth.createUser({ username, displayName, password, role: 'admin' });
    ctx.models.audit.log(null, 'admin.create_cli', user.username);
    console.log(`Administrador "${user.username}" criado com sucesso.`);
  } catch (err) {
    console.error(`Erro: ${err.message}`);
    process.exitCode = 1;
  } finally {
    ctx.close();
    db.close();
  }
}

main();
