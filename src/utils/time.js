'use strict';

/**
 * Utilitários de datas no fuso horário da aplicação (Europe/Lisbon por omissão).
 * Todas as datas de desafio são strings "YYYY-MM-DD" no fuso configurado.
 */

const formatters = new Map();

function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }
  return formatters.get(timeZone);
}

function zonedParts(date, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Data local ("YYYY-MM-DD") de um instante, no fuso indicado. */
function localDate(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Desvio (ms) do fuso em relação a UTC num dado instante. */
function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instante UTC correspondente a uma hora local no fuso indicado. */
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = guess - offsetMs(new Date(guess), timeZone);
  // Segunda iteração para acertar em dias de mudança de hora.
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

/** Soma dias a uma data "YYYY-MM-DD" (aritmética de calendário, sem fuso). */
function addDays(dateStr, days) {
  const { y, m, d } = parseDate(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Instante da próxima meia-noite local a seguir a "now". */
function nextMidnight(now, timeZone) {
  const tomorrow = parseDate(addDays(localDate(now, timeZone), 1));
  return zonedTimeToUtc(tomorrow.y, tomorrow.m, tomorrow.d, 0, 0, timeZone);
}

/** Minutos desde a meia-noite local (0–1439) de um instante, no fuso indicado. */
function minutesOfDay(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** "HH:MM" → minutos. "00:00" como fim de período significa 24:00 (usar endOfDay=true). */
function parseHHMM(text, { endOfDay = false } = {}) {
  const [h, m] = text.split(':').map(Number);
  const mins = h * 60 + m;
  return endOfDay && mins === 0 ? 1440 : mins;
}

/** Instante UTC de "minutos desde a meia-noite" numa data local (1440 = meia-noite seguinte). */
function instantAt(dateStr, minutes, timeZone) {
  const day = minutes >= 1440 ? addDays(dateStr, 1) : dateStr;
  const mins = minutes % 1440;
  const { y, m, d } = parseDate(day);
  return zonedTimeToUtc(y, m, d, Math.floor(mins / 60), mins % 60, timeZone);
}

/** Código da época mensal ("YYYY-MM") de uma data "YYYY-MM-DD". */
function seasonCode(dateStr) {
  return dateStr.slice(0, 7);
}

function monthBounds(code) {
  const [y, m] = code.split('-').map(Number);
  const start = `${code}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseDate(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

module.exports = {
  localDate,
  zonedTimeToUtc,
  addDays,
  nextMidnight,
  minutesOfDay,
  parseHHMM,
  instantAt,
  seasonCode,
  monthBounds,
  isValidDateString,
};
