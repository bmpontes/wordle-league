'use strict';

/**
 * Relógio injetável. Em produção devolve a hora real; nos testes pode ser
 * fixado para simular a passagem da meia-noite.
 */
let fixed = null;

module.exports = {
  now() {
    return fixed ? new Date(fixed.getTime()) : new Date();
  },
  set(date) {
    fixed = date ? new Date(date) : null;
  },
  reset() {
    fixed = null;
  },
};
