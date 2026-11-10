'use strict';

const clock = require('../utils/clock');
const { nextMidnight, localDate, addDays, minutesOfDay, parseHHMM, instantAt } = require('../utils/time');
const { badRequest, conflict, unprocessable, AppError } = require('../utils/errors');
const norm = require('../shared/normalize');
const { evaluate, describePattern } = require('./evaluator');

/**
 * Lógica do jogo. Toda a validação, avaliação e pontuação acontece aqui, no
 * backend. A palavra secreta só é incluída no estado devolvido depois de o
 * jogo do utilizador estar concluído.
 */
module.exports = function createGameService({ db, models, config, settings, dailyWord, scoring }) {
  /**
   * Período diário em que se pode jogar (hora de Portugal), configurável no painel.
   * Fora do período não é possível submeter tentativas.
   */
  function playWindow(now = clock.now()) {
    const s = settings.getAll();
    const tz = config.timezone;
    const today = localDate(now, tz);
    const start = parseHHMM(s.play_start);
    const end = parseHHMM(s.play_end, { endOfDay: true });
    const mins = minutesOfDay(now, tz);
    return {
      open: mins >= start && mins < end,
      phase: mins < start ? 'before' : mins >= end ? 'after' : 'open',
      start: s.play_start,
      end: s.play_end,
      opensAt: instantAt(mins < start ? today : addDays(today, 1), start, tz).toISOString(),
      closesAt: instantAt(today, end, tz).toISOString(),
    };
  }

  function closedMessage(win) {
    return win.phase === 'before'
      ? `O desafio de hoje abre às ${win.start}.`
      : `O desafio de hoje terminou às ${win.end}. Volte amanhã a partir das ${win.start}.`;
  }

  function secretLetters(challenge) {
    return norm.letters(challenge.accent_mode === 'strict' ? challenge.word : challenge.word_plain);
  }

  /**
   * Conclui como "expired" os jogos iniciados em dias anteriores e não
   * terminados, atribuindo os pontos de participação. Idempotente.
   */
  function finalizeExpired() {
    const today = dailyWord.today();
    const pending = models.results.expiredInProgress(today);
    if (!pending.length) return 0;
    let n = 0;
    db.transaction(() => {
      for (const r of pending) {
        const points = scoring.currentPointsFor('expired', r.attempts_used);
        const ok = models.results.finish({ id: r.id, status: 'expired', points, finishedAt: clock.now().toISOString() });
        if (!ok) continue;
        scoring.award({ result: r, challenge: models.challenges.findById(r.challenge_id), status: 'expired', attempts: r.attempts_used });
        n++;
      }
    }).immediate();
    return n;
  }

  function buildState(challenge, result, win = playWindow()) {
    const now = clock.now();
    const base = {
      available: true,
      window: win,
      date: challenge.challenge_date,
      wordLength: challenge.word_length,
      maxAttempts: challenge.max_attempts,
      accentMode: challenge.accent_mode,
      nextChallengeAt: nextMidnight(now, config.timezone).toISOString(),
      serverNow: now.toISOString(),
    };
    if (!result) {
      return { ...base, status: 'not_started', guesses: [], attemptsUsed: 0, attemptsLeft: challenge.max_attempts };
    }
    const guesses = models.results.guesses(result.id).map((g) => ({ word: g.guess, pattern: describePattern(g.pattern) }));
    const state = {
      ...base,
      status: result.status,
      guesses,
      attemptsUsed: result.attempts_used,
      attemptsLeft: Math.max(0, challenge.max_attempts - result.attempts_used),
    };
    if (result.status !== 'in_progress') {
      const tx = models.points.forUser(result.user_id).filter((p) => p.challenge_date === challenge.challenge_date && p.type !== 'admin_adjustment');
      state.points = tx.reduce((sum, p) => sum + p.points, 0);
      const bonuses = tx.filter((p) => p.type === 'streak_bonus' || p.type === 'first_win_bonus');
      state.bonus = bonuses.reduce((sum, p) => sum + p.points, 0);
      state.bonuses = bonuses.map((p) => ({ type: p.type, points: p.points, rank: p.win_rank, reason: p.reason }));
      state.solution = challenge.word; // só após o fim do jogo deste utilizador
    }
    return state;
  }

  function unavailableState(err, win = playWindow()) {
    const now = clock.now();
    return {
      available: false,
      window: win,
      code: err.code,
      message: err.message,
      date: dailyWord.today(),
      nextChallengeAt: nextMidnight(now, config.timezone).toISOString(),
      serverNow: now.toISOString(),
    };
  }

  function getState(userId) {
    finalizeExpired();
    const win = playWindow();
    if (!win.open) {
      // Fora do período: mostra o jogo de hoje se o utilizador já o tiver começado.
      const today = models.challenges.findByDate(dailyWord.today());
      const result = today && models.results.find(today.id, userId);
      if (result) return buildState(today, result, win);
      return unavailableState({ code: 'CLOSED', message: closedMessage(win) }, win);
    }
    let challenge;
    try {
      challenge = dailyWord.ensureChallenge();
    } catch (err) {
      if (err instanceof AppError && err.status === 503) return unavailableState(err);
      throw err;
    }
    return buildState(challenge, models.results.find(challenge.id, userId), win);
  }

  /**
   * Valida a palavra introduzida. Se for inválida lança um erro 422 SEM
   * consumir uma tentativa. Devolve a forma de apresentação e as letras-chave.
   */
  function validateGuess(raw, challenge) {
    if (typeof raw !== 'string' || raw.length > 64) throw badRequest('Tentativa inválida.');
    const display = norm.toDisplay(raw);
    if (!display) throw unprocessable('Escreva uma palavra.', 'EMPTY_GUESS');
    if (!norm.isValidCharacters(display)) {
      throw unprocessable('A palavra contém caracteres não permitidos.', 'INVALID_CHARACTERS');
    }
    if (norm.letterCount(display) !== challenge.word_length) {
      throw unprocessable(`A palavra deve ter ${challenge.word_length} letras.`, 'WRONG_LENGTH');
    }
    const lookup = {
      display,
      plain: norm.stripAccents(display),
      length: challenge.word_length,
      accentMode: challenge.accent_mode,
    };
    // As palavras secretas são sempre aceites como tentativa.
    const found = models.words.find('accepted', lookup) || models.words.find('secret', lookup);
    if (!found) throw unprocessable('Palavra não reconhecida.', 'WORD_NOT_ACCEPTED');
    return { display: found, key: norm.letters(norm.toKey(found, challenge.accent_mode)) };
  }

  function submitGuess(userId, rawGuess) {
    finalizeExpired();
    const win = playWindow();
    if (!win.open) throw conflict(closedMessage(win), 'CLOSED');
    const challenge = dailyWord.ensureChallenge();

    const existing = models.results.find(challenge.id, userId);
    if (existing && existing.status !== 'in_progress') {
      throw conflict('O jogo de hoje já terminou. Volte amanhã!', 'GAME_OVER');
    }

    const guess = validateGuess(rawGuess, challenge);

    const outcome = db
      .transaction(() => {
        const result = models.results.findOrCreate(challenge.id, userId);
        if (result.status !== 'in_progress') throw conflict('O jogo de hoje já terminou. Volte amanhã!', 'GAME_OVER');
        const attempt = result.attempts_used + 1;
        if (attempt > challenge.max_attempts) throw conflict('Sem tentativas disponíveis.', 'NO_ATTEMPTS_LEFT');

        const pattern = evaluate(guess.key, secretLetters(challenge));
        models.results.insertGuess({
          resultId: result.id,
          challengeId: challenge.id,
          userId,
          attempt,
          guess: guess.display,
          pattern,
        });
        if (!models.results.recordAttempt(result.id, result.attempts_used)) {
          throw conflict('Tentativa duplicada. Atualize a página.', 'DUPLICATE_ATTEMPT');
        }

        const won = /^C+$/.test(pattern);
        if (won || attempt === challenge.max_attempts) {
          const status = won ? 'won' : 'lost';
          const points = scoring.currentPointsFor(status, attempt);
          models.results.finish({ id: result.id, status, points, finishedAt: clock.now().toISOString() });
          scoring.award({ result, challenge, status, attempts: attempt });
        }
        return { pattern };
      })
      .immediate();

    return {
      ...buildState(challenge, models.results.find(challenge.id, userId)),
      lastPattern: describePattern(outcome.pattern),
    };
  }

  return { getState, submitGuess, finalizeExpired, playWindow };
};
