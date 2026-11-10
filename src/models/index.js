'use strict';

module.exports = function createModels(db) {
  return {
    users: require('./userModel')(db),
    settings: require('./settingsModel')(db),
    words: require('./wordModel')(db),
    challenges: require('./challengeModel')(db),
    results: require('./resultModel')(db),
    points: require('./pointModel')(db),
    seasons: require('./seasonModel')(db),
    audit: require('./auditModel')(db),
  };
};
