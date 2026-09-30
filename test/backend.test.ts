import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Marketplace } from '../src/marketplace.js';
import { JobQueue } from '../src/whatsapp.js';
import type { Actor, Role, User } from '../src/domain.js';
import type { Integrations } from '../src/integrations.js';
import { MemoryStore } from './memory-store.js';
const now = () => new Date().toISOString();
const integrations: Integrations = {
  upload: async () => 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  detect: async () => {
    throw new Error('simulated failure');
  },
  estimate: async (category) => ({
    category,
    buyPrice: 10,
    sellPrice: 15,
    priceUnit: 'per_kg',
    currency: 'INR',
    priceNote: 'Approximate estimate; verify locally.',
    marketTrend: 'stable',
    source: 'gemini_estimate',
    lastUpdated: now(),
  }),
  send: async () => {},
};
async function setup() {
  const store = new MemoryStore();
  const users: Record<string, User> = {};
  for (const [id, role] of [
    ['seller', 'kabadiwala'],
    ['seller2', 'kabadiwala'],
    ['middle', 'middleman'],
    ['buyer', 'recycler'],
    ['buyer2', 'recycler'],
    ['operator', 'operator'],
    ['admin', 'admin'],
  ] as const) {
    const user: User = {
      id,
      role,
      name: id,
      phone: '',
      email: '',
      geo: { lat: 28.6, lng: 77.2 },
      address: '',
      locality: 'delhi',
      available: true,
      verificationStatus: 'verified',
      createdAt: now(),
      lastActiveAt: now(),
    };
    users[id] = user;
    await store.run(async (tx) => tx.create('users', id, user));
  }
  const app = createApp({
    store,
    integrations,
    verifyToken: async (token) => {
      if (!users[token]) throw new Error('invalid');
      return { uid: token };
    },
    validateWebhook: (signature) => signature === 'valid',
  });
  const actor = (id: string): Actor => ({ uid: id, user: users[id]! });
  return { store, app, market: new Marketplace(store, integrations), actor, users };
}
const listingInput = {
  category: 'paper' as const,
  name: 'Paper',
  weight: 10,
  volume: 0,
  quantity: 1,
  geo: null,
  buyPrice: 10,
  sellPrice: 15,
  priceUnit: 'per_kg' as const,
};
test('auth and role enforcement; buyer shop excludes private fields', async () => {
  const { app } = await setup();
  await request(app).post('/api/listings/known').send(listingInput).expect(401);
  await request(app)
    .post('/api/listings/known')
    .auth('buyer', { type: 'bearer' })
    .send(listingInput)
    .expect(403);
  await request(app)
    .post('/api/listings/known')
    .auth('seller', { type: 'bearer' })
    .send({ ...listingInput, role: 'admin' })
    .expect(400);
  await request(app)
    .post('/api/listings/known')
    .auth('seller', { type: 'bearer' })
    .send(listingInput)
    .expect(201);
  const shop = await request(app)
    .get('/api/middleman/collector-shop')
    .auth('middle', { type: 'bearer' })
    .expect(200);
  assert.equal(shop.body.items[0].price, 100);
  assert.equal(shop.body.items[0].geo, undefined);
  assert.equal(shop.body.items[0].kabadiwalaId, undefined);
});
test('concurrent offers reserve once and remove listing from shop', async () => {
  const { market, store, actor } = await setup();
  const listing = (await market.createKnown(actor('seller'), listingInput))!;
  const results = await Promise.allSettled([
    market.offer(actor('buyer'), 'listings', listing.id, 150),
    market.offer(actor('buyer2'), 'listings', listing.id, 150),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await store.query('deals')).length, 1);
  assert.equal((await store.get('listings', listing.id))!.status, 'assigned');
});
test('both parties must confirm; completion retries create exactly two ledger entries', async () => {
  const { market, store, actor } = await setup();
  const listing = (await market.createKnown(actor('seller'), listingInput))!;
  const deal = await market.offer(actor('middle'), 'listings', listing.id, 100);
  await market.accept(actor('middle'), deal.id);
  await market.complete(actor('seller'), deal.id);
  assert.equal((await store.query('ledgerEntries')).length, 0);
  await Promise.all([
    market.complete(actor('middle'), deal.id),
    market.complete(actor('middle'), deal.id),
  ]);
  assert.equal((await store.query('ledgerEntries')).length, 2);
  assert.equal((await store.get('listings', listing.id))!.middlemanId, 'middle');
  await assert.rejects(market.complete(actor('buyer2'), deal.id));
});
test('below asking offer requires seller approval', async () => {
  const { market, actor } = await setup();
  const listing = (await market.createKnown(actor('seller'), listingInput))!;
  const deal = await market.offer(actor('buyer'), 'listings', listing.id, 90);
  await assert.rejects(market.accept(actor('buyer'), deal.id), /Seller must approve/);
  await market.accept(actor('seller'), deal.id);
  assert.equal((await market.accept(actor('buyer'), deal.id)).status, 'locked');
});
test('aggregation requires completed purchase and prevents reuse', async () => {
  const { market, actor } = await setup();
  const listing = (await market.createKnown(actor('seller'), listingInput))!;
  await assert.rejects(market.aggregate(actor('middle'), [listing.id], 'paper', 200));
  const deal = await market.offer(actor('middle'), 'listings', listing.id, 100);
  await market.accept(actor('middle'), deal.id);
  await market.complete(actor('seller'), deal.id);
  await market.complete(actor('middle'), deal.id);
  await assert.rejects(
    market.aggregate(actor('middle'), [listing.id], 'metal', 200),
    /one segregated material category/,
  );
  const batch = await market.aggregate(actor('middle'), [listing.id], 'paper', 200);
  assert.equal(batch.totalWeight, 10);
  await assert.rejects(market.aggregate(actor('middle'), [listing.id], 'paper', 200));
  await assert.rejects(market.offer(actor('middle'), 'middlemanInventory', batch.id, 200));
});
test('priority chooses highest eligible tier and skips expired or unverified users', async () => {
  const { store, market, actor } = await setup();
  await store.run(async (tx) => {
    for (const [id, recyclerId, tier, expires] of [
      ['s1', 'buyer', 1, '2099-01-01T00:00:00.000Z'],
      ['s2', 'buyer2', 3, '2099-01-01T00:00:00.000Z'],
      ['s3', 'buyer', 3, '2000-01-01T00:00:00.000Z'],
    ] as const)
      tx.create('prioritySubscriptions', id, {
        id,
        recyclerId,
        category: 'paper',
        premiumTier: tier,
        active: true,
        expiresAt: expires,
        createdAt: now(),
      });
  });
  const listing = (await market.createKnown(actor('seller'), listingInput))!;
  assert.equal(listing.status, 'assigned');
  assert.equal((await store.get('deals', listing.dealId!))!.buyerId, 'buyer2');
  await market.checkPriorityAndAssign(listing.id);
  assert.equal((await store.query('deals')).length, 1);
});
test('AI failure persists listing and QC ticket; final QC price cannot be negotiated', async () => {
  const { market, store, actor } = await setup();
  const created = await market.createEwaste(
    actor('seller'),
    { category: 'other', weight: 1, volume: 0, quantity: 1, geo: null },
    { buffer: Buffer.from('image'), mimetype: 'image/png' },
  );
  assert.ok(created.manualReviewRequired);
  assert.equal(created.listing!.status, 'qc_pending');
  assert.equal(created.listing!.aiPipeline.status, 'failed');
  assert.equal(created.listing!.aiPipeline.identification, null);
  await market.qc(actor('operator'), created.ticketId!, {
    category: 'electronic-battery',
    condition: 'damaged',
    finalPrice: 80,
    qcNotes: 'Inspected',
    useCase: 'Recycle',
  });
  await assert.rejects(
    market.offer(actor('middle'), 'listings', created.listingId, 79),
    /QC price is final/,
  );
  await market.offer(actor('middle'), 'listings', created.listingId, 80);
  assert.equal((await store.get('tickets', created.ticketId!))!.qcStatus, 'complete');
});
test('manual reference price survives AI result', async () => {
  const { store, actor } = await setup();
  await store.run(async (tx) =>
    tx.create('priceReference', 'paper', {
      ...(await integrations.estimate('paper')),
      id: 'paper',
      source: 'operator_manual',
      buyPrice: 99,
    }),
  );
  const ai: Integrations = {
    ...integrations,
    detect: async () => ({
      description: 'Paper',
      detection: {
        name: 'Paper',
        category: 'paper',
        subType: 'paper',
        condition: 'intact',
        isEwaste: false,
        needsOperatorQC: false,
        keyComponents: [],
        confidence: 'high',
      },
      price: await integrations.estimate('paper'),
      provenance: {
        model: 'test-model',
        promptVersion: 'test-v1',
        identification: 'Paper',
        classification: {
          name: 'Paper',
          category: 'paper',
          subType: 'paper',
          condition: 'intact',
          isEwaste: false,
          needsOperatorQC: false,
          keyComponents: [],
          confidence: 'high',
        },
        pricing: await integrations.estimate('paper'),
      },
    }),
  };
  const market = new Marketplace(store, ai);
  await market.createEwaste(
    actor('seller'),
    { category: 'other', weight: 1, volume: 0, quantity: 1, geo: null },
    { buffer: Buffer.from('x'), mimetype: 'image/png' },
  );
  assert.equal((await store.get('priceReference', 'paper'))!.buyPrice, 99);
});
test('Cloudinary failure does not create a listing or fabricate a fallback image', async () => {
  const { store, actor } = await setup();
  const unavailable: Integrations = {
    ...integrations,
    upload: async () => {
      throw new Error('Cloudinary unavailable');
    },
  };
  const market = new Marketplace(store, unavailable);
  await assert.rejects(
    market.createEwaste(
      actor('seller'),
      { category: 'other', weight: 1, volume: 0, quantity: 1, geo: null },
      { buffer: Buffer.from('image'), mimetype: 'image/png' },
    ),
    /Cloudinary unavailable/,
  );
  assert.equal((await store.query('listings')).length, 0);
});
test('private deal, ledger and administration access', async () => {
  const { app, market, actor } = await setup();
  const listing = (await market.createKnown(actor('seller'), listingInput))!;
  const deal = await market.offer(actor('buyer'), 'listings', listing.id, 150);
  await request(app).get(`/api/deals/${deal.id}`).auth('buyer2', { type: 'bearer' }).expect(403);
  await request(app).get('/api/admin/stats').auth('seller', { type: 'bearer' }).expect(403);
  await request(app)
    .post('/api/auth/set-role')
    .auth('seller', { type: 'bearer' })
    .send({ uid: 'seller', role: 'admin' })
    .expect(403);
  await request(app)
    .get(`/api/listings/${listing.id}`)
    .auth('buyer2', { type: 'bearer' })
    .expect(403);
});
test('OpenWA webhooks require a secret and delivery retries are deduplicated', async () => {
  const { app, store } = await setup();
  const body = {
    webhookId: 'hook-1',
    sessionId: 'sales',
    event: 'message.received',
    timestamp: Date.now(),
    payload: {
      message: { id: 'false_919876543210@c.us_TEST', from: '919876543210@c.us', body: 'hi' },
    },
  };
  await request(app).post('/api/whatsapp/openwa/webhook').send(body).expect(403);
  for (let i = 0; i < 2; i++)
    await request(app)
      .post('/api/whatsapp/openwa/webhook')
      .set('x-webhook-secret', 'valid')
      .send(body)
      .expect(204);
  assert.equal((await store.query('jobs')).length, 1);
});
test('OpenWA location messages retain coordinates and their location label', async () => {
  const { app, store } = await setup();
  await request(app)
    .post('/api/whatsapp/openwa/webhook')
    .set('x-webhook-secret', 'valid')
    .send({
      webhookId: 'hook-location',
      sessionId: 'sales',
      event: 'message.received',
      timestamp: Date.now(),
      payload: {
        message: {
          id: 'false_919876543210@c.us_LOCATION',
          from: '919876543210@c.us',
          type: 'location',
          lat: 28.6139,
          lng: 77.209,
          loc: 'New Delhi',
        },
      },
    })
    .expect(204);
  const [job] = await store.query('jobs');
  assert.deepEqual(job!.payload, {
    From: 'whatsapp:+919876543210',
    Body: '',
    Latitude: '28.6139',
    Longitude: '77.209',
    Address: 'New Delhi',
    Label: 'New Delhi',
  });
});
test('WhatsApp conversation persists across workers and assigns nearest available collector', async () => {
  const { store } = await setup();
  await store.run(async (tx) => {
    const user = await tx.get('users', 'seller2');
    tx.set('users', 'seller2', { ...user!, geo: { lat: 12, lng: 80 } });
  });
  const inputs: Array<Record<string, string>> = [
    { Body: 'hi' },
    { Body: 'Old laptop' },
    { Body: 'Delhi', Latitude: '28.61', Longitude: '77.21' },
    { Body: 'Tomorrow at 10' },
  ];
  for (let i = 0; i < inputs.length; i++) {
    const queue = new JobQueue(store, integrations);
    await queue.enqueueInbound(`msg${i}`, { From: 'whatsapp:+919876543210', ...inputs[i] });
    await queue.tick();
  }
  const pickups = await store.query('whatsappRequests');
  assert.equal(pickups.length, 1);
  assert.equal(pickups[0]!.assignedKabadiwalaId, 'seller');
  assert.equal(pickups[0]!.wasteDescription, 'Old laptop');
  assert.equal((await store.query('whatsappSessions')).length, 0);
});
test('invalid geo, body and disguised image rejected', async () => {
  const { app } = await setup();
  await request(app)
    .get('/api/middleman/collector-shop?lat=20')
    .auth('middle', { type: 'bearer' })
    .expect(400);
  await request(app)
    .post('/api/listings/known')
    .auth('seller', { type: 'bearer' })
    .send({ ...listingInput, weight: -1 })
    .expect(400);
  await request(app)
    .post('/api/listings/ewaste')
    .auth('seller', { type: 'bearer' })
    .attach('photo', Buffer.from('<script>hi</script>'), 'fake.png')
    .expect(400);
});
test('full middleman batch resale completes through the HTTP API', async () => {
  const { app, market, actor, store } = await setup();
  const listing = (await market.createKnown(actor('seller'), listingInput))!;
  const purchased = await request(app)
    .post('/api/middleman/buy')
    .auth('middle', { type: 'bearer' })
    .send({ listingId: listing.id, agreedPrice: 100 })
    .expect(201);
  const first = purchased.body.id;
  for (const [action, user] of [
    ['accept', 'middle'],
    ['complete', 'seller'],
    ['complete', 'middle'],
  ])
    await request(app)
      .post(`/api/deals/${first}/${action}`)
      .auth(user!, { type: 'bearer' })
      .expect(200);
  const batch = await request(app)
    .post('/api/middleman/aggregate')
    .auth('middle', { type: 'bearer' })
    .send({ listingIds: [listing.id], aggregatedCategory: 'paper', askingPrice: 200 })
    .expect(201);
  await request(app)
    .post('/api/middleman/list-to-recycler')
    .auth('middle', { type: 'bearer' })
    .send({ inventoryId: batch.body.id })
    .expect(200);
  const offered = await request(app)
    .post(`/api/recycler/offer/inventory/${batch.body.id}`)
    .auth('buyer', { type: 'bearer' })
    .send({ agreedPrice: 200 })
    .expect(201);
  for (const [action, user] of [
    ['accept', 'buyer'],
    ['complete', 'middle'],
    ['complete', 'buyer'],
  ])
    await request(app)
      .post(`/api/deals/${offered.body.id}/${action}`)
      .auth(user!, { type: 'bearer' })
      .expect(200);
  assert.equal((await store.get('middlemanInventory', batch.body.id))!.status, 'sold');
  assert.equal((await store.query('ledgerEntries')).length, 4);
});
test('unverified buyer cannot purchase or take priority', async () => {
  const { app, store, users } = await setup();
  await store.run(async (tx) =>
    tx.set('users', 'buyer', { ...users.buyer!, verificationStatus: 'pending' }),
  );
  await request(app)
    .post('/api/recycler/offer/listings/missing')
    .auth('buyer', { type: 'bearer' })
    .send({ agreedPrice: 10 })
    .expect(403);
  await request(app)
    .post('/api/recycler/priority')
    .auth('buyer', { type: 'bearer' })
    .send({
      category: 'paper',
      premiumTier: 3,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })
    .expect(403);
});
test('unavailable estimates preserve known-material draft and permit owner manual recovery', async () => {
  const { store, actor } = await setup();
  const offline = {
    ...integrations,
    estimate: async () => {
      throw new Error('offline');
    },
  };
  const market = new Marketplace(store, offline);
  const { buyPrice, sellPrice, ...input } = listingInput;
  const listing = (await market.createKnown(actor('seller'), input))!;
  assert.equal(listing.status, 'draft');
  const app = createApp({
    store,
    integrations: offline,
    verifyToken: async (token) => ({ uid: token }),
  });
  await request(app)
    .patch(`/api/listings/${listing.id}/manual`)
    .auth('seller2', { type: 'bearer' })
    .send({ buyPrice: 12, sellPrice: 18, priceUnit: 'per_kg' })
    .expect(404);
  await request(app)
    .patch(`/api/listings/${listing.id}/manual`)
    .auth('seller', { type: 'bearer' })
    .send({ buyPrice: 12, sellPrice: 18, priceUnit: 'per_kg' })
    .expect(200);
  assert.equal((await store.get('listings', listing.id))!.status, 'listed');
});
