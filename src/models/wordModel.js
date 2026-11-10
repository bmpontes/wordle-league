'use strict';

/**
 * Acesso às duas listas de palavras:
 *  - "secret"   → tabela word_bank (palavras do dia)
 *  - "accepted" → tabela accepted_words (palavras válidas nas tentativas)
 */
const TABLES = { secret: 'word_bank', accepted: 'accepted_words' };

module.exports = (db) => {
  const stmts = {};
  for (const [type, table] of Object.entries(TABLES)) {
    stmts[type] = {
      count: db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck(),
      countByLength: db.prepare(`SELECT COUNT(*) FROM ${table} WHERE length = ?`).pluck(),
      lengths: db.prepare(`SELECT length, COUNT(*) AS n FROM ${table} GROUP BY length ORDER BY length`),
      all: db.prepare(`SELECT word FROM ${table} ORDER BY word`).pluck(),
      existingWords: db.prepare(`SELECT word FROM ${table}`).pluck(),
      insert: db.prepare(
        `INSERT OR IGNORE INTO ${table} (word, word_plain, length, import_id) VALUES (?, ?, ?, ?)`
      ),
      clear: db.prepare(`DELETE FROM ${table}`),
      findByWord: db.prepare(`SELECT word FROM ${table} WHERE word = ? AND length = ?`).pluck(),
      findByPlain: db.prepare(`SELECT word FROM ${table} WHERE word_plain = ? AND length = ? ORDER BY word`).pluck(),
    };
  }

  const secret = {
    candidates: db.prepare('SELECT id, word, word_plain FROM word_bank WHERE length = ?'),
  };

  const importLog = {
    insert: db.prepare(
      `INSERT INTO word_imports (list_type, filename, mode, valid_count, invalid_count, duplicate_count, inserted_count, imported_by)
       VALUES (@listType, @filename, @mode, @valid, @invalid, @duplicates, 0, @userId)`
    ),
    setInserted: db.prepare('UPDATE word_imports SET inserted_count = ? WHERE id = ?'),
    recent: db.prepare(
      `SELECT wi.*, u.username AS imported_by_username FROM word_imports wi
       JOIN users u ON u.id = wi.imported_by ORDER BY wi.id DESC LIMIT ?`
    ),
  };

  function list(type) {
    const st = stmts[type];
    if (!st) throw new Error(`Lista desconhecida: ${type}`);
    return st;
  }

  return {
    TYPES: Object.keys(TABLES),
    count: (type) => list(type).count.get(),
    countByLength: (type, length) => list(type).countByLength.get(length),
    lengths: (type) => list(type).lengths.all(),
    allWords: (type) => list(type).all.all(),
    existingWordSet: (type) => new Set(list(type).existingWords.all()),
    /** Insere palavras já validadas; devolve o número efetivamente inserido. */
    insertMany(type, words, importId) {
      const st = list(type);
      let inserted = 0;
      for (const w of words) inserted += st.insert.run(w.word, w.plain, w.length, importId).changes;
      return inserted;
    },
    clear: (type) => list(type).clear.run(),
    /** Procura a palavra numa lista, segundo a política de acentos. */
    find(type, { display, plain, length, accentMode }) {
      const st = list(type);
      if (accentMode === 'strict') return st.findByWord.get(display, length) || null;
      const matches = st.findByPlain.all(plain, length);
      if (!matches.length) return null;
      // Preferir a forma exata introduzida, se existir; senão a forma da lista.
      return matches.includes(display) ? display : matches[0];
    },
    secretCandidates: (length) => secret.candidates.all(length),
    logImport: (data) => Number(importLog.insert.run(data).lastInsertRowid),
    setImportInserted: (id, n) => importLog.setInserted.run(n, id),
    recentImports: (limit = 20) => importLog.recent.all(limit),
  };
};
