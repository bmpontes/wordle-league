'use strict';

/**
 * Avaliação de uma tentativa (função pura).
 *  C = correta (verde), P = presente noutra posição (amarelo), A = ausente (cinzento)
 *
 * Algoritmo em duas passagens, para tratar corretamente letras repetidas:
 *  1. marcar as letras na posição correta e contar as letras secretas restantes;
 *  2. marcar como presentes apenas enquanto houver ocorrências por consumir.
 *
 * @param {string[]} guess   letras da tentativa (já normalizadas)
 * @param {string[]} secret  letras da palavra secreta (já normalizadas)
 * @returns {string} padrão, ex.: "CPAAC"
 */
function evaluate(guess, secret) {
  if (guess.length !== secret.length) throw new Error('Tamanhos diferentes na avaliação.');
  const result = new Array(guess.length).fill('A');
  const remaining = new Map();

  for (let i = 0; i < secret.length; i++) {
    if (guess[i] === secret[i]) result[i] = 'C';
    else remaining.set(secret[i], (remaining.get(secret[i]) || 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'C') continue;
    const left = remaining.get(guess[i]) || 0;
    if (left > 0) {
      result[i] = 'P';
      remaining.set(guess[i], left - 1);
    }
  }
  return result.join('');
}

const PATTERN_NAMES = { C: 'correct', P: 'present', A: 'absent' };

function describePattern(pattern) {
  return Array.from(pattern, (ch) => PATTERN_NAMES[ch]);
}

module.exports = { evaluate, describePattern };
