'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/shared/normalize');
const { evaluate } = require('../src/services/evaluator');

test('toDisplay: maiúsculas, NFC e sem espaços', () => {
  assert.equal(N.toDisplay('  maçãs '), 'MAÇÃS');
  // Forma decomposta (NFD) é convertida para composta (NFC)
  assert.equal(N.toDisplay('ação'), 'AÇÃO');
});

test('modo "strip": acentos e cedilha são ignorados', () => {
  assert.equal(N.toKey('Maçãs', 'strip'), 'MACAS');
  assert.equal(N.toKey('ÁÀÂÃÉÊÍÓÔÕÚÇ', 'strip'), 'AAAAEEIOOOUC');
  assert.equal(N.toKey('pôr', 'strip'), N.toKey('POR', 'strip'));
});

test('modo "strict": acentos contam', () => {
  assert.equal(N.toKey('Maçãs', 'strict'), 'MAÇÃS');
  assert.notEqual(N.toKey('pôr', 'strict'), N.toKey('POR', 'strict'));
});

test('contagem de letras conta cada letra acentuada como uma', () => {
  assert.equal(N.letterCount('MAÇÃS'), 5);
  assert.equal(N.letterCount('ação'), 4);
});

test('caracteres permitidos', () => {
  assert.ok(N.isValidCharacters('MAÇÃS'));
  assert.ok(N.isValidCharacters('PÊRAS'));
  assert.ok(!N.isValidCharacters('ABC1D'));
  assert.ok(!N.isValidCharacters('AB-CD'));
  assert.ok(!N.isValidCharacters('AB CD'));
  assert.ok(!N.isValidCharacters('<SCR>'));
  assert.ok(!N.isValidCharacters('ÑANDU'));
});

test('avaliação com normalização: "strip" considera Ç igual a C', () => {
  const secret = N.letters(N.toKey('MAÇÃS', 'strip'));
  const guess = N.letters(N.toKey('MACAS', 'strip'));
  assert.equal(evaluate(guess, secret), 'CCCCC');
  const strictSecret = N.letters(N.toKey('MAÇÃS', 'strict'));
  const strictGuess = N.letters(N.toKey('MACAS', 'strict'));
  assert.equal(evaluate(strictGuess, strictSecret), 'CCAAC');
});
