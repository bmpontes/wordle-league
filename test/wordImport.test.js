'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWordFile } = require('../src/services/wordImportService');
const { setup, createUser } = require('./helpers');

test('TXT: remove vazios e duplicados, valida tamanho e caracteres', () => {
  const content = '﻿casas\nLIVRO\n\n  pedra  \nCasas\nlivro\nABC\nNOITES\nNU-EM\n12345\nmaçãs\n# comentário\n';
  const r = parseWordFile(content, { filename: 'lista.txt', wordLength: 5 });
  assert.equal(r.format, 'txt');
  assert.deepEqual(r.valid.map((w) => w.word), ['CASAS', 'LIVRO', 'PEDRA', 'MAÇÃS']);
  assert.equal(r.duplicates.length, 2);
  assert.equal(r.invalid.length, 4);
  assert.ok(r.invalid.some((i) => /3 letras/.test(i.reason)));
  assert.ok(r.invalid.some((i) => /6 letras/.test(i.reason)));
  assert.ok(r.invalid.some((i) => /Caracteres/.test(i.reason) && i.value === 'NU-EM'));
  assert.equal(r.valid.find((w) => w.word === 'MAÇÃS').plain, 'MACAS');
});

test('CSV: ignora o cabeçalho "palavra" e usa a primeira coluna', () => {
  const content = 'palavra,categoria\r\nCASAS,geral\r\n"LIVRO",geral\r\nPEDRA;x\r\nCASAS,dup\r\n';
  const r = parseWordFile(content, { filename: 'lista.csv', wordLength: 5 });
  assert.equal(r.format, 'csv');
  assert.ok(r.headerSkipped);
  assert.deepEqual(r.valid.map((w) => w.word), ['CASAS', 'LIVRO', 'PEDRA']);
  assert.equal(r.duplicates.length, 1);
});

test('rejeita formatos e ficheiros inválidos', () => {
  assert.throws(() => parseWordFile('CASAS', { filename: 'lista.xlsx', wordLength: 5 }), /Formato/);
  assert.throws(() => parseWordFile('CA\u0000SA', { filename: 'a.txt', wordLength: 5 }), /texto/);
  assert.throws(() => parseWordFile('CAS�S', { filename: 'a.txt', wordLength: 5 }), /UTF-8/);
});

test('tamanho de palavra configurável', () => {
  const r = parseWordFile('CASA\nCASAS\nLIVROS', { filename: 'a.txt', wordLength: 6 });
  assert.deepEqual(r.valid.map((w) => w.word), ['LIVROS']);
});

test('importação: pré-visualização não altera dados e substituição exige confirmação', async () => {
  const t = setup();
  try {
    const admin = await createUser(t.ctx, 'admin', 'admin');
    const svc = t.ctx.services.wordImport;

    const p1 = svc.preview({ listType: 'secret', content: 'CASAS\nLIVRO\nLIVRO\nXX', filename: 'a.txt' }, admin.id);
    assert.equal(p1.validCount, 2);
    assert.equal(p1.duplicateCount, 1);
    assert.equal(p1.invalidCount, 1);
    assert.equal(t.ctx.models.words.count('secret'), 0, 'a pré-visualização não importa nada');

    const r1 = svc.confirm({ previewId: p1.previewId, mode: 'replace' }, admin.id);
    assert.equal(r1.inserted, 2); // lista vazia: não precisa de confirmação

    const p2 = svc.preview({ listType: 'secret', content: 'PEDRA\nNOITE', filename: 'b.txt' }, admin.id);
    assert.throws(() => svc.confirm({ previewId: p2.previewId, mode: 'replace' }, admin.id), (e) => e.code === 'CONFIRM_REQUIRED');
    assert.equal(t.ctx.models.words.count('secret'), 2, 'a lista não foi substituída sem confirmação');

    const r2 = svc.confirm({ previewId: p2.previewId, mode: 'replace', confirmReplace: true }, admin.id);
    assert.equal(r2.total, 2);
    assert.deepEqual(t.ctx.models.words.allWords('secret'), ['NOITE', 'PEDRA']);

    const p3 = svc.preview({ listType: 'secret', content: 'PEDRA\nNUVEM', filename: 'c.txt' }, admin.id);
    assert.equal(p3.alreadyInList, 1);
    const r3 = svc.confirm({ previewId: p3.previewId, mode: 'append' }, admin.id);
    assert.equal(r3.inserted, 1);
    assert.equal(r3.total, 3);

    // A pré-visualização é de uso único e pessoal.
    assert.throws(() => svc.confirm({ previewId: p3.previewId, mode: 'append' }, admin.id), /expirada/);
    assert.equal(svc.exportList('secret'), 'NOITE\nNUVEM\nPEDRA\n');
    assert.equal(t.ctx.models.words.count('accepted'), 0, 'listas separadas');
  } finally {
    t.close();
  }
});
