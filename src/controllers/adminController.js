'use strict';

const { badRequest } = require('../utils/errors');

module.exports = ({ services }) => {
  const { admin, settings, wordImport, stats } = services;
  const actor = (req) => req.user.id;

  return {
    status: (req, res) => res.json(admin.status()),
    stats: (req, res) => res.json(stats.global()),

    users: (req, res) => res.json({ users: admin.listUsers() }),
    async createUser(req, res) {
      res.status(201).json({ user: await admin.createUser(req.body, actor(req)) });
    },
    block: (req, res) => res.json({ user: admin.blockUser(req.params.id, actor(req)) }),
    unblock: (req, res) => res.json({ user: admin.unblockUser(req.params.id, actor(req)) }),
    rename: (req, res) => res.json({ user: admin.renameUser(req.params.id, (req.body || {}).displayName, actor(req)) }),
    async resetPassword(req, res) {
      await admin.resetPassword(req.params.id, (req.body || {}).password, actor(req));
      res.json({ ok: true });
    },

    getSettings: (req, res) => res.json({ settings: settings.getAll(), defaults: settings.DEFAULTS }),
    updateSettings: (req, res) => res.json(settings.update(req.body, actor(req))),

    words: (req, res) =>
      res.json({ lists: wordImport.summary(), imports: wordImport.recentImports(), pool: services.dailyWord.poolStatus() }),
    previewWords: (req, res) => res.json(wordImport.preview(req.body || {}, actor(req))),
    importWords: (req, res) => res.json(wordImport.confirm(req.body || {}, actor(req))),
    exportWords(req, res) {
      const type = req.params.type;
      if (!['secret', 'accepted'].includes(type)) throw badRequest('Tipo de lista inválido.');
      const text = wordImport.exportList(type);
      const name = type === 'secret' ? 'palavras-secretas' : 'palavras-aceites';
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.txt"`);
      res.set('Cache-Control', 'no-store');
      res.send(text);
    },

    adjustments: (req, res) => res.json({ adjustments: admin.adjustments() }),
    adjustPoints(req, res) {
      admin.adjustPoints(req.body, actor(req));
      res.status(201).json({ ok: true });
    },

    audit: (req, res) => res.json({ entries: admin.audit() }),

    uploadBrand: (req, res) => res.json(services.brand.upload(req.params.kind, req.body || {}, actor(req))),
    removeBrand: (req, res) => res.json(services.brand.remove(req.params.kind, actor(req))),
  };
};
