'use strict';

const crypto = require('crypto');
const clock = require('../utils/clock');
const { localDate, seasonCode } = require('../utils/time');
const { unavailable } = require('../utils/errors');
const { stripAccents } = require('../shared/normalize');

/**
 * Seleção da palavra diária.
 *
 * Estratégia (determinística e sem repetições até esgotar a lista):
 *  - as palavras secretas com o tamanho configurado são ordenadas por
 *    SHA-256(semente_secreta + ":" + palavra). A semente é gerada uma vez e
 *    guardada na BD, por isso a ordem é estável mas não é adivinhável a partir
 *    da lista importada (que pode estar, por exemplo, por ordem alfabética);
 *  - é escolhida a primeira palavra dessa ordem que ainda não foi usada;
 *  - a escolha é persistida em daily_challenges (UNIQUE por data). Pedidos
 *    seguintes, ou reinícios do servidor, devolvem sempre o registo guardado;
 *  - esgotada a lista, só reutiliza palavras se "recycle_words" estiver ativo
 *    (nesse caso, as menos usadas primeiro, numa ordem nova por ciclo).
 */

function rank(seed, cycle, key) {
  return crypto.createHash('sha256').update(`${seed}:${cycle}:${key}`).digest('hex');
}

/**
 * Função pura de escolha (testável isoladamente).
 * @param {{id:number, word:string, key:string}[]} candidates
 * @param {Map<string, number>} usage  nº de vezes que cada chave já foi usada
 * @returns {{candidate, cycle} | {exhausted:true} | {empty:true}}
 */
function pickWord(candidates, usage, seed, { recycle = false } = {}) {
  // Uma entrada por chave (no modo sem acentos, "PÔR" e "POR" são a mesma palavra).
  const byKey = new Map();
  for (const c of candidates) {
    const prev = byKey.get(c.key);
    if (!prev || c.word < prev.word) byKey.set(c.key, c);
  }
  const unique = [...byKey.values()];
  if (!unique.length) return { empty: true };

  const minUsage = Math.min(...unique.map((c) => usage.get(c.key) || 0));
  if (minUsage > 0 && !recycle) return { exhausted: true };

  const cycle = minUsage + 1;
  const pool = unique.filter((c) => (usage.get(c.key) || 0) === minUsage);
  pool.sort((a, b) => (rank(seed, cycle, a.key) < rank(seed, cycle, b.key) ? -1 : 1));
  return { candidate: pool[0], cycle };
}

module.exports = function createDailyWordService({ db, models, settings, config }) {
  const tz = config.timezone;

  function today() {
    return localDate(clock.now(), tz);
  }

  function loadCandidates(s) {
    return models.words.secretCandidates(s.word_length).map((w) => ({
      id: w.id,
      word: w.word,
      key: s.accent_mode === 'strict' ? w.word : w.word_plain,
    }));
  }

  /**
   * Devolve o desafio da data indicada, criando-o (uma única vez) se ainda não
   * existir. Lança um erro controlado se não houver palavra disponível.
   */
  function ensureChallenge(date = today()) {
    const existing = models.challenges.findByDate(date);
    if (existing) return existing;

    return db
      .transaction(() => {
        const again = models.challenges.findByDate(date);
        if (again) return again;

        const s = settings.getAll();
        const usage = models.challenges.usage(s.accent_mode);
        const pick = pickWord(loadCandidates(s), usage, settings.selectionSeed(), { recycle: s.recycle_words });
        if (pick.empty) {
          throw unavailable('Ainda não existe uma lista de palavras secretas importada. Contacte o administrador.', 'NO_WORDS');
        }
        if (pick.exhausted) {
          throw unavailable('A lista de palavras secretas está esgotada. Contacte o administrador.', 'WORDS_EXHAUSTED');
        }

        const season = models.seasons.ensure(seasonCode(date));
        const id = models.challenges.insert({
          date,
          seasonId: season.id,
          wordBankId: pick.candidate.id,
          word: pick.candidate.word,
          plain: stripAccents(pick.candidate.word),
          length: s.word_length,
          maxAttempts: s.max_attempts,
          accentMode: s.accent_mode,
          cycle: pick.cycle,
        });
        return models.challenges.findById(id);
      })
      .immediate();
  }

  /** Estado da lista de palavras secretas (para o painel de administração). */
  function poolStatus() {
    const s = settings.getAll();
    const candidates = loadCandidates(s);
    const usage = models.challenges.usage(s.accent_mode);
    const keys = new Set(candidates.map((c) => c.key));
    let unused = 0;
    for (const k of keys) if (!usage.get(k)) unused++;
    return {
      total: models.words.count('secret'),
      matchingLength: keys.size,
      unused,
      exhausted: keys.size > 0 && unused === 0,
      empty: keys.size === 0,
      recycle: s.recycle_words,
      daysLeft: unused,
    };
  }

  return { today, ensureChallenge, poolStatus };
};

module.exports.pickWord = pickWord;
