'use strict';

module.exports = ({ services }) => ({
  today(req, res) {
    res.json(services.game.getState(req.user.id));
  },

  guess(req, res) {
    const body = req.body || {};
    res.json(services.game.submitGuess(req.user.id, body.guess));
  },
});
