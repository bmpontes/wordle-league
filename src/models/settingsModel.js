'use strict';

module.exports = (db) => {
  const s = {
    all: db.prepare('SELECT key, value FROM settings'),
    get: db.prepare('SELECT value FROM settings WHERE key = ?').pluck(),
    upsert: db.prepare(
      `INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ),
  };

  return {
    all() {
      const out = {};
      for (const row of s.all.all()) out[row.key] = JSON.parse(row.value);
      return out;
    },
    get(key) {
      const v = s.get.get(key);
      return v === undefined ? undefined : JSON.parse(v);
    },
    set(key, value, userId = null) {
      s.upsert.run(key, JSON.stringify(value), userId);
    },
  };
};
