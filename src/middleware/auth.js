'use strict';

const { unauthorized, forbidden } = require('../utils/errors');

/**
 * Carrega o utilizador da sessão em cada pedido. Se a conta tiver sido
 * bloqueada entretanto, a sessão deixa de ser válida de imediato.
 */
function loadUser(models) {
  return (req, res, next) => {
    req.user = null;
    const id = req.session && req.session.userId;
    if (id) {
      const user = models.users.findById(id);
      if (user && user.status === 'active') req.user = user;
      else delete req.session.userId;
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden());
  next();
}

module.exports = { loadUser, requireAuth, requireAdmin };
