'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/** Abre a base de dados SQLite com as opções de integridade recomendadas. */
function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

module.exports = { openDatabase };
