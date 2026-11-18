// Módulos do browser que também correm no Node: normalização e análise de ficheiros.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const norm = require('../js/normalize.js');
const { parseWordFile, detectImageType } = require('../js/words-file.js');

test('normalização: maiúsculas, acentos e caracteres válidos', () => {
  assert.equal(norm.toDisplay('  maçãs '), 'MAÇÃS');
  assert.equal(norm.stripAccents('MAÇÃS'), 'MACAS');
  assert.equal(norm.toKey('pêras', 'strip'), 'PERAS');
  assert.equal(norm.toKey('pêras', 'strict'), 'PÊRAS');
  assert.equal(norm.letterCount('PÊRAS'), 5);
  assert.ok(norm.isValidCharacters('AÇÃO'));
  assert.ok(!norm.isValidCharacters('AB1CD'));
  assert.ok(!norm.isValidCharacters('NU EM'));
});

test('ficheiro TXT: comentários, linhas vazias, inválidas e duplicadas', () => {
  const r = parseWordFile('# comentário\n\ncasas\nPÊRAS\nabc\nCASAS\nab1cd\n', { filename: 'lista.txt', wordLength: 5 });
  assert.equal(r.format, 'txt');
  assert.deepEqual(r.valid, ['CASAS', 'PÊRAS']);
  assert.equal(r.invalid.length, 2);
  assert.match(r.invalid[0].reason, /3 letras/);
  assert.deepEqual(r.duplicates, [{ line: 6, value: 'CASAS' }]);
  assert.equal(r.emptyLines, 3, 'comentário, linha vazia e fim do ficheiro');
});

test('ficheiro CSV: cabeçalho, aspas e separadores', () => {
  const r = parseWordFile('﻿palavra;notas\n"livro";x\nnuvem,y\n', { filename: 'lista.csv', wordLength: 5 });
  assert.equal(r.format, 'csv');
  assert.equal(r.headerSkipped, true);
  assert.deepEqual(r.valid, ['LIVRO', 'NUVEM']);
});

test('ficheiros recusados: formato, codificação e binário', () => {
  assert.throws(() => parseWordFile('casas', { filename: 'lista.docx', wordLength: 5 }), /Formato não suportado/);
  assert.throws(() => parseWordFile('cas�s', { filename: 'lista.txt', wordLength: 5 }), /UTF-8/);
  assert.throws(() => parseWordFile('ca\u0000sas', { filename: 'lista.txt', wordLength: 5 }), /texto/);
});

test('tipo de imagem pelo conteúdo (a extensão não conta)', () => {
  assert.equal(detectImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(detectImageType(new TextEncoder().encode('<svg xmlns="x"/>')), null);
});
