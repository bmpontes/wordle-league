'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Aplica, por ordem, as migrações em src/db/migrations ainda não registadas
 * em schema_migrations. Cada migração corre numa transação.
 * Para alterar o esquema no futuro: criar 002_descricao.sql (nunca editar
 * uma migração já aplicada).
 */
function migrate(db, { log = () => {} } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all());
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const done = [];
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, file);
    })();
    log(`Migração aplicada: ${file}`);
    done.push(file);
  }
  return done;
}

module.exports = { migrate };
