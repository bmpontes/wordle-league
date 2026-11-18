/*
 * Análise de ficheiros de palavras (TXT: uma por linha; CSV: primeira coluna, com
 * cabeçalho opcional "palavra"). Corre no browser, no painel de administração; a base
 * de dados volta a validar todas as palavras antes de as guardar.
 * Também é usado pelos testes (Node).
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./normalize.js') : root.WordNormalize);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WordsFile = api;
})(typeof self !== 'undefined' ? self : this, function (norm) {
  'use strict';

  const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
  const MAX_LINES = 300000;
  const HEADER_NAMES = new Set(['PALAVRA', 'PALAVRAS', 'WORD', 'WORDS']);

  function fail(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
  }

  /** Primeiro campo de uma linha CSV (aspas, vírgula, ponto e vírgula ou tab). */
  function firstCsvField(line) {
    const t = line.trim();
    if (t.startsWith('"')) {
      const end = t.indexOf('"', 1);
      return end > 0 ? t.slice(1, end) : t.slice(1);
    }
    return t.split(/[;,\t]/)[0];
  }

  function parseWordFile(content, { filename = '', wordLength }) {
    if (typeof content !== 'string') throw fail('Conteúdo do ficheiro inválido.');
    if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) throw fail('Ficheiro demasiado grande (máximo 5 MB).');
    if (content.includes('\u0000')) throw fail('O ficheiro não parece ser um ficheiro de texto.');
    if (content.includes('�')) throw fail('O ficheiro tem caracteres inválidos. Guarde-o com codificação UTF-8.');

    const text = content.replace(/^﻿/, '');
    const lines = text.split(/\r\n|\n|\r/);
    if (lines.length > MAX_LINES) throw fail(`Ficheiro com demasiadas linhas (máximo ${MAX_LINES}).`);

    const lower = filename.toLowerCase();
    const isCsv = lower.endsWith('.csv') || (!lower.endsWith('.txt') && lines.some((l) => /[;,\t]/.test(l)));
    if (filename && !/\.(txt|csv)$/i.test(filename)) throw fail('Formato não suportado. Utilize um ficheiro .txt ou .csv.');

    const valid = [];
    const invalid = [];
    const duplicates = [];
    const seen = new Set();
    let emptyLines = 0;
    let headerSkipped = false;

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      let raw = isCsv ? firstCsvField(line) : line;
      raw = raw.trim();
      if (!raw || (!isCsv && raw.startsWith('#'))) {
        emptyLines++;
        return;
      }
      const display = norm.toDisplay(raw);
      if (!headerSkipped && valid.length === 0 && invalid.length === 0 && HEADER_NAMES.has(norm.stripAccents(display))) {
        headerSkipped = true;
        return;
      }
      if (!norm.isValidCharacters(display)) {
        invalid.push({ line: lineNo, value: raw.slice(0, 40), reason: 'Caracteres não permitidos' });
        return;
      }
      const length = norm.letterCount(display);
      if (length !== wordLength) {
        invalid.push({ line: lineNo, value: raw.slice(0, 40), reason: `Tem ${length} letras (esperado: ${wordLength})` });
        return;
      }
      if (seen.has(display)) {
        duplicates.push({ line: lineNo, value: display });
        return;
      }
      seen.add(display);
      valid.push(display);
    });

    return { format: isCsv ? 'csv' : 'txt', valid, invalid, duplicates, emptyLines, headerSkipped };
  }

  /** Tipo real da imagem pelos primeiros bytes (a extensão não é de confiança). */
  function detectImageType(bytes) {
    const b = bytes;
    if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'image/png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
    if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    return null;
  }

  return { parseWordFile, detectImageType };
});
