'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/services/evaluator');

const ev = (guess, secret) => evaluate(Array.from(guess), Array.from(secret));

test('todas as letras corretas → todas verdes', () => {
  assert.equal(ev('PEDRA', 'PEDRA'), 'CCCCC');
});

test('nenhuma letra em comum → todas cinzentas', () => {
  assert.equal(ev('FUMOS', 'PEDRA'), 'AAAAA');
});

test('letras presentes noutra posição → amarelas', () => {
  // ARDEP vs PEDRA: todas existem, nenhuma na posição certa
  assert.equal(ev('ARDEP', 'PEDRA'), 'PPCPP');
  assert.equal(ev('LIVRO', 'OLIVR'), 'PPPPP');
});

test('mistura de verdes, amarelas e cinzentas', () => {
  assert.equal(ev('PORTA', 'PEDRA'), 'CAPAC');
});

test('letras repetidas: secreta com um só A, tentativa com dois A', () => {
  // Secreta PEDRA (1 A). Tentativa CASAS: o 1.º A não está certo, deve ser amarelo uma vez só.
  assert.equal(ev('CASAS', 'PEDRA'), 'APAAA');
  // Tentativa AABBB vs secreta XAXXX: o A na posição 2 é verde; o da posição 1 não pode ser amarelo.
  assert.equal(ev('AABBB', 'XAXXX'), 'ACAAA');
});

test('letras repetidas: o verde tem prioridade sobre o amarelo', () => {
  // Secreta ABBEY, tentativa BABES: B(0) amarelo, A(1) amarelo, B(2) verde, E(3) verde, S cinzento
  assert.equal(ev('BABES', 'ABBEY'), 'PPCCA');
  // Secreta com 1 E; tentativa com 3 E onde um está certo → só esse é marcado.
  assert.equal(ev('EEEXX', 'XXEYY'), 'AACPP'); // os dois X existem na secreta
});

test('letras repetidas na secreta e na tentativa', () => {
  // Secreta CASAS (2 A, 2 S), tentativa SALSA
  assert.equal(ev('SALSA', 'CASAS'), 'PCAPP');
  // Secreta com 2 A; tentativa com 3 A → no máximo 2 marcados
  const r = ev('AAAXX', 'XAYAZ');
  assert.equal((r.match(/[CP]/g) || []).length, 3); // 2 A + 1 X
  assert.equal(r, 'PCAPA');
});

test('tamanhos diferentes lançam erro', () => {
  assert.throws(() => ev('ABC', 'ABCD'));
});
