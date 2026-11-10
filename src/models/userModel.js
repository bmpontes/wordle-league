'use strict';

const PUBLIC_COLUMNS = 'id, username, display_name, role, status, created_at, last_login_at';

module.exports = (db) => {
  const s = {
    byId: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`),
    authByUsername: db.prepare(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = ?`),
    authById: db.prepare(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE id = ?`),
    insert: db.prepare(
      'INSERT INTO users (username, display_name, password_hash, role) VALUES (@username, @displayName, @passwordHash, @role)'
    ),
    list: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY username`),
    setStatus: db.prepare(
      "UPDATE users SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ),
    setPassword: db.prepare(
      "UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ),
    setDisplayName: db.prepare(
      "UPDATE users SET display_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ),
    touchLogin: db.prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"),
    countAdmins: db.prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'").pluck(),
    count: db.prepare('SELECT COUNT(*) FROM users').pluck(),
    countActive: db.prepare("SELECT COUNT(*) FROM users WHERE status = 'active'").pluck(),
  };

  return {
    findById: (id) => s.byId.get(id),
    findAuthByUsername: (username) => s.authByUsername.get(username),
    findAuthById: (id) => s.authById.get(id),
    create: ({ username, displayName, passwordHash, role = 'user' }) =>
      Number(s.insert.run({ username, displayName, passwordHash, role }).lastInsertRowid),
    list: () => s.list.all(),
    setStatus: (id, status) => s.setStatus.run(status, id),
    setPassword: (id, hash) => s.setPassword.run(hash, id),
    setDisplayName: (id, name) => s.setDisplayName.run(name, id),
    touchLogin: (id) => s.touchLogin.run(id),
    countActiveAdmins: () => s.countAdmins.get(),
    count: () => s.count.get(),
    countActive: () => s.countActive.get(),
  };
};
