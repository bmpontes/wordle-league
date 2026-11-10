'use strict';

const crypto = require('crypto');
const v = require('../utils/validate');
const { badRequest } = require('../utils/errors');
const { ACCENT_MODES } = require('../shared/normalize');
const { parseHHMM } = require('../utils/time');

/** Valores iniciais dos parâmetros do jogo (configuráveis no painel). */
const DEFAULTS = Object.freeze({
  word_length: 5,
  max_attempts: 6,
  points_by_attempt: [100, 80, 65, 50, 35, 25],
  points_loss: 5,
  streak_bonus_days: 7,
  streak_bonus_points: 15,
  podium_bonus_points: [15, 10, 5], // bónus para o 1.º, 2.º, 3.º… a acertar no desafio do dia ([] = desativado)
  play_start: '09:30', // abertura do jogo (hora de Portugal)
  play_end: '00:00', // fecho do jogo; 00:00 = meia-noite (fim do dia)
  streak_mode: 'wins', // 'wins' = dias seguidos com vitória; 'participation' = dias seguidos a jogar
  accent_mode: 'strip',
  registration_enabled: true,
  recycle_words: false,
  public_leaderboard: true, // página /ranking acessível sem autenticação
});

const PUBLIC_KEYS = Object.keys(DEFAULTS);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const VALIDATORS = {
  word_length: (x) => v.integer(x, 'word_length', { min: 3, max: 10, label: 'Tamanho das palavras' }),
  max_attempts: (x) => v.integer(x, 'max_attempts', { min: 1, max: 10, label: 'Número de tentativas' }),
  points_by_attempt: (x) => {
    if (!Array.isArray(x) || x.length < 1 || x.length > 10) throw badRequest('Tabela de pontos inválida.');
    return x.map((p, i) => v.integer(p, 'points_by_attempt', { min: 0, max: 1000, label: `Pontos (tentativa ${i + 1})` }));
  },
  points_loss: (x) => v.integer(x, 'points_loss', { min: 0, max: 1000, label: 'Pontos por participação' }),
  streak_bonus_days: (x) => v.integer(x, 'streak_bonus_days', { min: 2, max: 365, label: 'Dias do bónus de streak' }),
  streak_bonus_points: (x) => v.integer(x, 'streak_bonus_points', { min: 0, max: 1000, label: 'Pontos do bónus de streak' }),
  podium_bonus_points: (x) => {
    if (!Array.isArray(x) || x.length > 10) throw badRequest('Bónus de pódio inválido (no máximo 10 posições).');
    return x.map((p, i) => v.integer(p, 'podium_bonus_points', { min: 0, max: 1000, label: `Bónus do ${i + 1}.º a acertar` }));
  },
  play_start: (x) => v.string(x, 'play_start', { min: 5, max: 5, pattern: HHMM, label: 'Hora de abertura' }),
  play_end: (x) => v.string(x, 'play_end', { min: 5, max: 5, pattern: HHMM, label: 'Hora de fecho' }),
  streak_mode: (x) => v.oneOf(x, 'streak_mode', ['wins', 'participation']),
  accent_mode: (x) => v.oneOf(x, 'accent_mode', ACCENT_MODES),
  registration_enabled: (x) => v.boolean(x, 'registration_enabled'),
  recycle_words: (x) => v.boolean(x, 'recycle_words'),
  public_leaderboard: (x) => v.boolean(x, 'public_leaderboard'),
};

module.exports = function createSettingsService({ db, models }) {
  function getAll() {
    const stored = models.settings.all();
    const out = {};
    for (const key of PUBLIC_KEYS) out[key] = stored[key] !== undefined ? stored[key] : DEFAULTS[key];
    return out;
  }

  /** Semente secreta usada para ordenar as palavras (nunca exposta pela API). */
  function selectionSeed() {
    let seed = models.settings.get('selection_seed');
    if (!seed) {
      seed = crypto.randomBytes(32).toString('hex');
      models.settings.set('selection_seed', seed);
    }
    return seed;
  }

  /** Atualiza parâmetros; valida tudo antes de gravar e regista na auditoria. */
  function update(changes, actorId) {
    v.object(changes, 'pedido');
    const current = getAll();
    const next = { ...current };
    const changed = {};
    for (const [key, value] of Object.entries(changes)) {
      if (!VALIDATORS[key]) throw badRequest(`Parâmetro desconhecido: ${key}`);
      next[key] = VALIDATORS[key](value);
      if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) changed[key] = { from: current[key], to: next[key] };
    }
    if (parseHHMM(next.play_start) >= parseHHMM(next.play_end, { endOfDay: true })) {
      throw badRequest('A hora de abertura tem de ser anterior à hora de fecho (00:00 = meia-noite).');
    }
    if (next.points_by_attempt.length !== next.max_attempts) {
      throw badRequest('A tabela de pontos deve ter um valor por cada tentativa permitida.');
    }
    if (Object.keys(changed).length) {
      db.transaction(() => {
        for (const key of Object.keys(changed)) models.settings.set(key, next[key], actorId);
        models.audit.log(actorId, 'settings.update', null, changed);
      })();
    }
    return { settings: next, changed };
  }

  return { DEFAULTS, getAll, update, selectionSeed };
};
