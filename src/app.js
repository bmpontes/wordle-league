'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { loadUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { rateLimit } = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const createApiRouter = require('./routes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SHARED_DIR = path.join(__dirname, 'shared');

function createApp(ctx) {
  const { config, models, sessionStore } = ctx;
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          // Só força HTTPS nos recursos quando a aplicação é servida por HTTPS.
          ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: config.cookieSecure ? { maxAge: 15552000 } : false,
      crossOriginOpenerPolicy: config.cookieSecure ? { policy: 'same-origin' } : false,
      originAgentCluster: config.cookieSecure,
    })
  );

  if (config.logRequests) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        if (req.path.startsWith('/api')) {
          console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
        }
      });
      next();
    });
  }

  // Ficheiros estáticos (sem informação sensível).
  app.use('/shared', express.static(SHARED_DIR, { maxAge: '1h' }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h', index: 'index.html' }));

  // API
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', rateLimit({ max: 3000, windowMs: 5 * 60 * 1000 }));
  // O carregamento de listas de palavras pode ser maior do que os restantes pedidos.
  app.use('/api/admin/words/preview', express.json({ limit: '6mb' }));
  app.use('/api', express.json({ limit: '20kb' }));
  app.use(
    '/api',
    session({
      name: 'fwl.sid',
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.cookieSecure,
        maxAge: config.sessionMaxAgeHours * 3600 * 1000,
        path: '/',
      },
    })
  );
  app.use('/api', loadUser(models));
  app.use('/api', csrfProtection);
  app.use('/api', createApiRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
