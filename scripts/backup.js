'use strict';

/*
 * Cópia de segurança consistente da base de dados (pode ser feita com a
 * aplicação em funcionamento — usa a API de backup do SQLite).
 *
 *   npm run backup                       → DATA_DIR/backups/wordle-AAAAMMDD-HHMMSS.sqlite
 *   npm run backup -- /caminho/destino.sqlite
 *   docker compose exec app node scripts/backup.js
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');

async function main() {
  const config = loadConfig();
  if (!fs.existsSync(config.dbFile)) throw new Error(`Base de dados não encontrada: ${config.dbFile}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dest = path.resolve(process.argv[2] || path.join(config.dataDir, 'backups', `wordle-${stamp}.sqlite`));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) throw new Error(`O destino já existe: ${dest}`);

  const db = openDatabase(config.dbFile);
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  console.log(`Backup criado: ${dest}`);
}

main().catch((err) => {
  console.error(`Erro: ${err.message}`);
  process.exitCode = 1;
});
