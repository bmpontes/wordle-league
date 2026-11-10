'use strict';

const createModels = require('./models');

/** Liga modelos e serviços (injeção de dependências simples). */
function createContext({ db, config, sessionStore = null }) {
  const models = createModels(db);
  const base = { db, models, config };

  const settings = require('./services/settingsService')(base);
  const dailyWord = require('./services/dailyWordService')({ ...base, settings });
  const scoring = require('./services/scoringService')({ ...base, settings });
  const game = require('./services/gameService')({ ...base, settings, dailyWord, scoring });
  const auth = require('./services/authService')({ ...base, settings });
  const wordImport = require('./services/wordImportService')({ ...base, settings });
  const leaderboard = require('./services/leaderboardService')({ ...base, settings, dailyWord });
  const stats = require('./services/statsService')({ ...base, settings, dailyWord, leaderboard });
  const brand = require('./services/brandService')({ ...base, settings });
  const admin = require('./services/adminService')({ ...base, auth, dailyWord, sessionStore });

  // Garante a semente secreta de seleção desde o primeiro arranque.
  settings.selectionSeed();

  return {
    ...base,
    sessionStore,
    services: { settings, dailyWord, scoring, game, auth, wordImport, leaderboard, stats, admin, brand },
    close() {
      auth.close();
    },
  };
}

module.exports = { createContext };
