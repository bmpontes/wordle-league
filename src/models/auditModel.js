'use strict';

module.exports = (db) => {
  const s = {
    insert: db.prepare('INSERT INTO audit_log (actor_id, action, target, details) VALUES (?, ?, ?, ?)'),
    recent: db.prepare(
      `SELECT a.id, a.action, a.target, a.details, a.created_at, u.username AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.id DESC LIMIT ?`
    ),
  };

  return {
    log: (actorId, action, target = null, details = null) =>
      s.insert.run(actorId, action, target, details == null ? null : JSON.stringify(details)),
    recent: (limit = 100) =>
      s.recent.all(limit).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
  };
};
