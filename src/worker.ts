import { firebase } from './firebase.js';
import { realIntegrations } from './integrations.js';
import { JobQueue } from './whatsapp.js';
import { Marketplace } from './marketplace.js';
const { store, config } = firebase();
const integrations = realIntegrations();
const queue = new JobQueue(store, integrations);
const market = new Marketplace(store, integrations);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
  });
console.log('Kabadiwala Connect worker started');
while (!stopping) {
  try {
    await queue.tick();
    const priced = await store.query('listings', [['status', '==', 'priced']], 100);
    for (const listing of priced) await market.checkPriorityAndAssign(listing.id);
  } catch {
    console.error('Worker iteration failed; will retry');
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
}
