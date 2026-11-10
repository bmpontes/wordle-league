'use strict';

const crypto = require('crypto');
const norm = require('../shared/normalize');
const { badRequest, notFound } = require('../utils/errors');

const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const MAX_LINES = 300000;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const SAMPLE_SIZE = 50;
const HEADER_NAMES = new Set(['PALAVRA', 'PALAVRAS', 'WORD', 'WORDS']);

/** Extrai o primeiro campo de uma linha CSV (aspas, vírgula ou ponto e vírgula). */
function firstCsvField(line) {
  const t = line.trim();
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    return end > 0 ? t.slice(1, end) : t.slice(1);
  }
  return t.split(/[;,\t]/)[0];
}

/**
 * Analisa o conteúdo de um ficheiro TXT (uma palavra por linha) ou CSV
 * (primeira coluna, com cabeçalho opcional "palavra"). Função pura.
 */
function parseWordFile(content, { filename = '', wordLength }) {
  if (typeof content !== 'string') throw badRequest('Conteúdo do ficheiro inválido.');
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw badRequest('Ficheiro demasiado grande (máximo 5 MB).');
  if (content.includes('\u0000')) throw badRequest('O ficheiro não parece ser um ficheiro de texto.');
  if (content.includes('�')) throw badRequest('O ficheiro tem caracteres inválidos. Guarde-o com codificação UTF-8.');

  const text = content.replace(/^﻿/, '');
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > MAX_LINES) throw badRequest(`Ficheiro com demasiadas linhas (máximo ${MAX_LINES}).`);

  const lower = filename.toLowerCase();
  const isCsv = lower.endsWith('.csv') || (!lower.endsWith('.txt') && lines.some((l) => /[;,\t]/.test(l)));
  if (filename && !/\.(txt|csv)$/i.test(filename)) throw badRequest('Formato não suportado. Utilize um ficheiro .txt ou .csv.');

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
    valid.push({ word: display, plain: norm.stripAccents(display), length });
  });

  return { format: isCsv ? 'csv' : 'txt', valid, invalid, duplicates, emptyLines, headerSkipped };
}

module.exports = function createWordImportService({ db, models, settings }) {
  const previews = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [id, p] of previews) if (p.expires < now) previews.delete(id);
  }

  function checkType(listType) {
    if (!models.words.TYPES.includes(listType)) throw badRequest('Tipo de lista inválido (secret ou accepted).');
  }

  /** Passo 1: analisa o ficheiro e devolve um resumo, sem alterar nada. */
  function preview({ listType, content, filename }, userId) {
    checkType(listType);
    cleanup();
    const s = settings.getAll();
    const parsed = parseWordFile(content, { filename: String(filename || ''), wordLength: s.word_length });
    const existing = models.words.existingWordSet(listType);
    const alreadyInList = parsed.valid.filter((w) => existing.has(w.word)).length;

    const previewId = crypto.randomBytes(16).toString('hex');
    previews.set(previewId, {
      userId,
      listType,
      filename: String(filename || '').slice(0, 200),
      words: parsed.valid,
      stats: { valid: parsed.valid.length, invalid: parsed.invalid.length, duplicates: parsed.duplicates.length },
      expires: Date.now() + PREVIEW_TTL_MS,
    });

    return {
      previewId,
      listType,
      format: parsed.format,
      wordLength: s.word_length,
      validCount: parsed.valid.length,
      invalidCount: parsed.invalid.length,
      duplicateCount: parsed.duplicates.length,
      emptyLines: parsed.emptyLines,
      headerSkipped: parsed.headerSkipped,
      alreadyInList,
      currentCount: existing.size,
      sampleValid: parsed.valid.slice(0, SAMPLE_SIZE).map((w) => w.word),
      sampleInvalid: parsed.invalid.slice(0, SAMPLE_SIZE),
      sampleDuplicates: parsed.duplicates.slice(0, SAMPLE_SIZE),
    };
  }

  /**
   * Passo 2: aplica a importação analisada. Substituir uma lista que já tem
   * palavras exige confirmReplace === true.
   */
  function confirm({ previewId, mode, confirmReplace }, userId) {
    cleanup();
    const p = previews.get(previewId);
    if (!p || p.userId !== userId) throw notFound('Pré-visualização inexistente ou expirada. Volte a carregar o ficheiro.');
    if (!['replace', 'append'].includes(mode)) throw badRequest('Modo de importação inválido (replace ou append).');
    if (!p.words.length) throw badRequest('O ficheiro não contém palavras válidas.');

    const currentCount = models.words.count(p.listType);
    if (mode === 'replace' && currentCount > 0 && confirmReplace !== true) {
      throw badRequest(
        `A lista atual tem ${currentCount} palavras. Confirme explicitamente a substituição.`,
        'CONFIRM_REQUIRED'
      );
    }

    const inserted = db
      .transaction(() => {
        const importId = models.words.logImport({
          listType: p.listType,
          filename: p.filename,
          mode,
          valid: p.stats.valid,
          invalid: p.stats.invalid,
          duplicates: p.stats.duplicates,
          userId,
        });
        if (mode === 'replace') models.words.clear(p.listType);
        const n = models.words.insertMany(p.listType, p.words, importId);
        models.words.setImportInserted(importId, n);
        models.audit.log(userId, 'words.import', p.listType, { mode, filename: p.filename, ...p.stats, inserted: n, previous: currentCount });
        return n;
      })
      .immediate();

    previews.delete(previewId);
    return { listType: p.listType, mode, inserted, total: models.words.count(p.listType) };
  }

  function exportList(listType) {
    checkType(listType);
    return models.words.allWords(listType).join('\n') + '\n';
  }

  function summary() {
    const out = {};
    for (const t of models.words.TYPES) out[t] = { total: models.words.count(t), byLength: models.words.lengths(t) };
    return out;
  }

  return { preview, confirm, exportList, summary, recentImports: () => models.words.recentImports() };
};

module.exports.parseWordFile = parseWordFile;
