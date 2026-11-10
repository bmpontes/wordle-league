'use strict';

const session = require('express-session');

/** Store de sessões do express-session sobre a mesma base de dados SQLite. */
class SqliteSessionStore extends session.Store {
  constructor(db, { ttlMs = 12 * 3600 * 1000, cleanupIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.stmts = {
      get: db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?'),
      set: db.prepare(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`
      ),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires < ?'),
      destroyForUser: db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?"),
    };
    this.timer = setInterval(() => this.stmts.cleanup.run(Date.now()), cleanupIntervalMs);
    this.timer.unref();
  }

  expiryOf(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    return exp ? new Date(exp).getTime() : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      this.stmts.set.run(sid, JSON.stringify(sess), this.expiryOf(sess));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      this.stmts.destroy.run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      this.stmts.touch.run(this.expiryOf(sess), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  /** Termina todas as sessões de um utilizador (ex.: ao ser bloqueado). */
  destroyUserSessions(userId) {
    this.stmts.destroyForUser.run(userId);
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = { SqliteSessionStore };
