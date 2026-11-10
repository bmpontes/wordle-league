'use strict';

const crypto = require('crypto');
const { badRequest } = require('../utils/errors');

/**
 * Personalização da aplicação (nome, subtítulo, rodapé, logótipo e imagem do ranking).
 * Os textos são parâmetros normais (settings); as imagens ficam na tabela brand_assets.
 */

const KINDS = ['logo', 'ranking'];
const MAX_BYTES = 2 * 1024 * 1024;

/** Tipo real da imagem pelos primeiros bytes (a extensão do ficheiro não é de confiança). */
function detectImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Aceita base64 simples ou um "data URL" (data:image/png;base64,...). */
function decodeBase64Image(data) {
  if (typeof data !== 'string' || !data) throw badRequest('Imagem em falta.');
  const b64 = data.replace(/^data:[^;,]*;base64,/, '');
  if (b64.length > Math.ceil(MAX_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) {
    throw badRequest('Imagem inválida ou demasiado grande (máximo 2 MB).');
  }
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > MAX_BYTES) throw badRequest('Imagem inválida ou demasiado grande (máximo 2 MB).');
  const mime = detectImageType(buf);
  if (!mime) throw badRequest('Formato não suportado. Use PNG, JPEG ou WEBP.');
  return { buf, mime };
}

module.exports = function createBrandService({ db, models, settings }) {
  const s = {
    get: db.prepare('SELECT kind, mime, data, size, updated_at FROM brand_assets WHERE kind = ?'),
    meta: db.prepare('SELECT kind, mime, size, updated_at FROM brand_assets'),
    upsert: db.prepare(
      `INSERT INTO brand_assets (kind, mime, data, size, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET mime = excluded.mime, data = excluded.data, size = excluded.size,
         updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ),
    remove: db.prepare('DELETE FROM brand_assets WHERE kind = ?'),
  };

  function checkKind(kind) {
    if (!KINDS.includes(kind)) throw badRequest('Tipo de imagem inválido (logo ou ranking).');
  }

  const version = (row) => crypto.createHash('sha1').update(row.updated_at + row.size).digest('hex').slice(0, 10);

  /** Informação pública (sem autenticação): usada por todas as páginas. */
  function publicInfo() {
    const st = settings.getAll();
    const meta = Object.fromEntries(s.meta.all().map((r) => [r.kind, r]));
    return {
      name: st.brand_name,
      tagline: st.brand_tagline,
      footer: st.brand_footer,
      logoRound: st.brand_logo_round,
      customLogo: Boolean(meta.logo),
      logoUrl: meta.logo ? `/brand/logo?v=${version(meta.logo)}` : '/brand/logo',
      rankingUrl: meta.ranking ? `/brand/ranking?v=${version(meta.ranking)}` : null,
    };
  }

  function asset(kind) {
    checkKind(kind);
    return s.get.get(kind) || null;
  }

  function upload(kind, body, actorId) {
    checkKind(kind);
    const { buf, mime } = decodeBase64Image(body && body.data);
    s.upsert.run(kind, mime, buf, buf.length, actorId);
    models.audit.log(actorId, 'brand.upload', kind, { mime, size: buf.length, filename: String((body && body.filename) || '').slice(0, 100) });
    return publicInfo();
  }

  function remove(kind, actorId) {
    checkKind(kind);
    if (s.remove.run(kind).changes) models.audit.log(actorId, 'brand.remove', kind);
    return publicInfo();
  }

  return { publicInfo, asset, upload, remove };
};

module.exports.detectImageType = detectImageType;
