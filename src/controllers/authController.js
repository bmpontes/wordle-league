'use strict';

const { ensureCsrfToken } = require('../middleware/csrf');

const publicUser = (u) => u && { id: u.id, username: u.username, displayName: u.display_name, role: u.role };

/** Regenera a sessão (evita session fixation) e associa o utilizador. */
function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      const token = ensureCsrfToken(req);
      req.session.save((err2) => (err2 ? reject(err2) : resolve(token)));
    });
  });
}

module.exports = ({ services }) => ({
  session(req, res) {
    const csrfToken = ensureCsrfToken(req);
    res.json({
      user: publicUser(req.user),
      csrfToken,
      registrationEnabled: services.settings.getAll().registration_enabled,
    });
  },

  async login(req, res) {
    const user = await services.auth.login(req.body || {}, req.ip);
    const csrfToken = await establishSession(req, user);
    res.json({ user: publicUser(user), csrfToken });
  },

  async register(req, res) {
    const user = await services.auth.register(req.body);
    const csrfToken = await establishSession(req, user);
    res.status(201).json({ user: publicUser(user), csrfToken });
  },

  logout(req, res, next) {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('fwl.sid');
      res.json({ ok: true });
    });
  },

  async changePassword(req, res) {
    await services.auth.changePassword(req.user.id, req.body || {});
    res.json({ ok: true });
  },
});
