'use strict';

/*
 * Restauro de uma cópia de segurança. A APLICAÇÃO TEM DE ESTAR PARADA.
 *
 *   npm run restore -- /caminho/backup.sqlite --yes
 *
 * Passos: verifica a integridade do backup, guarda a BD atual em
 * "<bd>.pre-restore-<data>" e substitui-a pelo backup.
 */
const fs = require('fs');
const Database = require('better-sqlite3');
const { loadConfig } = require('../src/config');

function main() {
  const args = process.argv.slice(2);
  const source = args.find((a) => !a.startsWith('--'));
  if (!source) throw new Error('Indique o ficheiro de backup: npm run restore -- <ficheiro> --yes');
  if (!fs.existsSync(source)) throw new Error(`Ficheiro não encontrado: ${source}`);
  if (!args.includes('--yes')) {
    throw new Error('Operação destrutiva: confirme com --yes (e garanta que a aplicação está parada).');
  }

  const check = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const result = check.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`O backup não passou a verificação de integridade: ${result}`);
    const hasSchema = check.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name = 'schema_migrations'").pluck().get();
    if (!hasSchema) throw new Error('O ficheiro não parece ser uma base de dados do Wordle League.');
  } finally {
    check.close();
  }

  const config = loadConfig();
  const target = config.dbFile;
  if (fs.existsSync(target)) {
    // Incorpora o WAL no ficheiro principal antes de guardar a cópia da BD atual.
    const current = new Database(target, { fileMustExist: true });
    current.pragma('wal_checkpoint(TRUNCATE)');
    current.close();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const keep = `${target}.pre-restore-${stamp}`;
    fs.copyFileSync(target, keep);
    console.log(`BD atual guardada em: ${keep}`);
  }
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(target + suffix)) fs.rmSync(target + suffix);
  }
  fs.copyFileSync(source, target);
  console.log(`Restauro concluído: ${target}. Pode voltar a iniciar a aplicação.`);
}

try {
  main();
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exitCode = 1;
}
