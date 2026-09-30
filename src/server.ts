import { firebase } from './firebase.js';
import { realIntegrations } from './integrations.js';
import { createApp } from './app.js';
const { config, store, auth } = firebase();
const app = createApp({
  store,
  integrations: realIntegrations(),
  verifyToken: (token) => auth.verifyIdToken(token, true),
  corsOrigins: config.CORS_ORIGINS.split(',').map((s) => s.trim()),
  trustProxyHops: config.TRUST_PROXY_HOPS,
});
const server = app.listen(config.PORT, () =>
  console.log(`Kabadiwala Connect API listening on port ${config.PORT}`),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
