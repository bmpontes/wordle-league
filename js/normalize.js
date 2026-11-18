/*
 * Normalização de palavras — módulo partilhado entre backend (Node) e frontend
 * (servido em /shared/normalize.js). Existe uma única implementação para que a
 * regra seja exatamente a mesma nos dois lados.
 *
 * Política de acentos ("accentMode"):
 *  - "strip"  (omissão): os acentos e a cedilha são ignorados na comparação
 *              (Á→A, Ç→C). A forma original é preservada para apresentação.
 *  - "strict": os acentos contam; "PÔR" e "POR" são palavras diferentes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WordNormalize = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACCENTED_LETTERS = 'ÁÀÂÃÉÊÍÓÔÕÚÇ';
  const VALID_WORD = new RegExp('^[A-Z' + ACCENTED_LETTERS + ']+$');
  const ACCENT_MODES = ['strip', 'strict'];

  /** Forma de apresentação: NFC, maiúsculas, sem espaços envolventes. */
  function toDisplay(raw) {
    return String(raw == null ? '' : raw).normalize('NFC').trim().toLocaleUpperCase('pt-PT');
  }

  /** Remove diacríticos (inclui a cedilha). Espera texto em maiúsculas. */
  function stripAccents(text) {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  }

  /** Chave de comparação de acordo com a política de acentos. */
  function toKey(raw, accentMode) {
    const display = toDisplay(raw);
    return accentMode === 'strict' ? display : stripAccents(display);
  }

  /** Número de letras (cada letra acentuada conta como uma). */
  function letterCount(text) {
    return Array.from(toDisplay(text)).length;
  }

  /** Divide em letras (pontos de código NFC). */
  function letters(text) {
    return Array.from(text);
  }

  function isValidCharacters(display) {
    return VALID_WORD.test(display);
  }

  return {
    ACCENTED_LETTERS,
    ACCENT_MODES,
    toDisplay,
    stripAccents,
    toKey,
    letterCount,
    letters,
    isValidCharacters,
  };
});
