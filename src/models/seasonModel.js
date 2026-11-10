'use strict';

const { monthBounds } = require('../utils/time');

module.exports = (db) => {
  const s = {
    byCode: db.prepare('SELECT * FROM seasons WHERE code = ?'),
    insert: db.prepare('INSERT OR IGNORE INTO seasons (code, starts_on, ends_on) VALUES (?, ?, ?)'),
    list: db.prepare('SELECT code, starts_on, ends_on FROM seasons ORDER BY code DESC'),
  };

  return {
    findByCode: (code) => s.byCode.get(code),
    ensure(code) {
      const { start, end } = monthBounds(code);
      s.insert.run(code, start, end);
      return s.byCode.get(code);
    },
    list: () => s.list.all(),
  };
};
