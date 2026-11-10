'use strict';

/* Aplica as migrações pendentes. Uso: npm run migrate */
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { migrate } = require('../src/db/migrate');

const config = loadConfig();
const db = openDatabase(config.dbFile);
const applied = migrate(db, { log: console.log });
console.log(applied.length ? `${applied.length} migração(ões) aplicada(s).` : 'Base de dados já atualizada.');
db.close();
