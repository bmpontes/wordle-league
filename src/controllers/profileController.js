'use strict';

module.exports = ({ services }) => ({
  me: (req, res) => res.json(services.stats.profile(req.user.id)),
});
