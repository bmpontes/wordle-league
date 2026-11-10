'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, createUser, login } = require('./helpers');
const { detectImageType } = require('../src/services/brandService');

// PNG 1×1 válido.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// Cabeçalho WEBP mínimo (a validação verifica a assinatura RIFF....WEBP).
const WEBP_MIN = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(14)]).toString('base64');

async function prepared() {
  const t = setup();
  await createUser(t.ctx, 'admin', 'admin');
  await createUser(t.ctx, 'ana');
  return t;
}

test('deteção do tipo de imagem pelo conteúdo', () => {
  assert.equal(detectImageType(Buffer.from(PNG_1PX, 'base64')), 'image/png');
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectImageType(Buffer.from(WEBP_MIN, 'base64')), 'image/webp');
  assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectImageType(Buffer.from('GIF89a')), null);
});

test('sem personalização: nome e logótipo genéricos, sem imagem de ranking', async () => {
  const t = await prepared();
  try {
    const b = (await request(t.app).get('/api/brand').expect(200)).body;
    assert.equal(b.name, 'Wordle League');
    assert.equal(b.customLogo, false);
    assert.equal(b.rankingUrl, null);
    const logo = await request(t.app).get('/brand/logo').expect(200);
    assert.match(logo.headers['content-type'], /image\/svg\+xml/);
    await request(t.app).get('/brand/ranking').expect(404);

    // As páginas não trazem nenhuma marca fixa.
    for (const page of ['/', '/login', '/ranking', '/regras', '/admin', '/leaderboard', '/profile']) {
      const html = (await request(t.app).get(page).expect(200)).text;
      assert.ok(!/cociber|forense/i.test(html), `marca fixa em ${page}`);
      assert.match(html, /data-brand/);
    }
  } finally {
    t.close();
  }
});

test('administrador altera nome, subtítulo e rodapé (validados e auditados)', async () => {
  const t = await prepared();
  try {
    const admin = await login(t.app, 'admin');
    await admin.putJson('/api/admin/settings', { brand_name: 'Liga da Equipa', brand_tagline: 'Secção X', brand_footer: '', brand_logo_round: true }).expect(200);
    const b = (await request(t.app).get('/api/brand')).body;
    assert.deepEqual([b.name, b.tagline, b.footer, b.logoRound], ['Liga da Equipa', 'Secção X', '', true]);
    assert.ok(t.ctx.models.audit.recent().some((a) => a.action === 'settings.update' && a.details.brand_name));

    await admin.putJson('/api/admin/settings', { brand_name: '<script>' }).expect(400);
    await admin.putJson('/api/admin/settings', { brand_name: 'X' }).expect(400);
    await admin.putJson('/api/admin/settings', { brand_tagline: 'a'.repeat(61) }).expect(400);
    const ana = await login(t.app, 'ana');
    await ana.putJson('/api/admin/settings', { brand_name: 'Hack' }).expect(403);
  } finally {
    t.close();
  }
});

test('carregar e remover logótipo e imagem do ranking', async () => {
  const t = await prepared();
  try {
    const admin = await login(t.app, 'admin');
    let b = (await admin.postJson('/api/admin/brand/logo', { filename: 'logo.png', data: `data:image/png;base64,${PNG_1PX}` }).expect(200)).body;
    assert.equal(b.customLogo, true);
    assert.match(b.logoUrl, /^\/brand\/logo\?v=[0-9a-f]+$/);

    const logo = await request(t.app).get(b.logoUrl).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    assert.equal(logo.headers['content-type'], 'image/png');
    assert.equal(logo.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(logo.body, Buffer.from(PNG_1PX, 'base64'));

    b = (await admin.postJson('/api/admin/brand/ranking', { filename: 'cartaz.webp', data: WEBP_MIN }).expect(200)).body;
    assert.match(b.rankingUrl, /^\/brand\/ranking\?v=/);
    const rk = await request(t.app).get('/brand/ranking').expect(200);
    assert.equal(rk.headers['content-type'], 'image/webp');

    // A imagem fica na BD (entra nos backups) e a operação na auditoria.
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM brand_assets').pluck().get(), 2);
    assert.ok(t.ctx.models.audit.recent().some((a) => a.action === 'brand.upload' && a.target === 'ranking'));

    b = (await admin.postJson('/api/admin/brand/ranking/remove', {}).expect(200)).body;
    assert.equal(b.rankingUrl, null);
    await request(t.app).get('/brand/ranking').expect(404);
    b = (await admin.postJson('/api/admin/brand/logo/remove', {}).expect(200)).body;
    assert.equal(b.customLogo, false);
    assert.match((await request(t.app).get('/brand/logo')).headers['content-type'], /svg/);
  } finally {
    t.close();
  }
});

test('imagens inválidas, disfarçadas ou grandes demais são recusadas; só administradores', async () => {
  const t = await prepared();
  try {
    const admin = await login(t.app, 'admin');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>').toString('base64');
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    for (const data of [svg, html, '', 'não-é-base64!!', `data:image/png;base64,${svg}`]) {
      const r = await admin.postJson('/api/admin/brand/logo', { filename: 'x.png', data });
      assert.equal(r.status, 400, data.slice(0, 20));
    }
    const big = Buffer.concat([Buffer.from(PNG_1PX, 'base64'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64');
    const r = await admin.postJson('/api/admin/brand/logo', { filename: 'big.png', data: big });
    assert.ok([400, 413].includes(r.status));
    await admin.postJson('/api/admin/brand/fundo', { data: PNG_1PX }).expect(400);
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM brand_assets').pluck().get(), 0);

    const ana = await login(t.app, 'ana');
    await ana.postJson('/api/admin/brand/logo', { data: PNG_1PX }).expect(403);
    await request(t.app).post('/api/admin/brand/logo').send({ data: PNG_1PX }).expect(403); // sem sessão nem CSRF
  } finally {
    t.close();
  }
});
