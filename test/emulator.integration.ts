import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreStore } from '../src/store.js';
import { Marketplace } from '../src/marketplace.js';
import type { Actor, User } from '../src/domain.js';
import type { Integrations } from '../src/integrations.js';

test('Firestore emulator: rules and transaction invariants', async (t) => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run via npm run test:emulator');
  const projectId = 'demo-kabadiwala';
  const environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  const app = initializeApp({ projectId }, 'backend-integration');
  const db = getFirestore(app);
  const store = new FirestoreStore(db);
  const now = new Date().toISOString();
  const users: User[] = [
    ['seller', 'kabadiwala'],
    ['buyer', 'recycler'],
    ['buyer2', 'recycler'],
    ['admin', 'admin'],
  ].map(([id, role]) => ({
    id: id!,
    role: role as User['role'],
    name: id!,
    phone: '',
    email: '',
    geo: null,
    address: '',
    locality: '',
    available: true,
    verificationStatus: 'verified',
    createdAt: now,
    lastActiveAt: now,
  }));
  const actor = (id: string): Actor => ({ uid: id, user: users.find((u) => u.id === id)! });
  const integrations: Integrations = {
    upload: async () => '',
    detect: async () => {
      throw new Error('offline');
    },
    estimate: async () => {
      throw new Error('offline');
    },
    send: async () => {},
  };
  const market = new Marketplace(store, integrations);
  try {
    await environment.clearFirestore();
    await store.run(async (tx) => {
      for (const user of users) tx.create('users', user.id, user);
    });
    const listing = (await market.createKnown(actor('seller'), {
      category: 'paper',
      name: 'Paper',
      weight: 10,
      volume: 0,
      quantity: 1,
      geo: null,
      buyPrice: 10,
      sellPrice: 15,
      priceUnit: 'per_kg',
    }))!;
    await t.test('client cannot self-promote, write ledger or read private listing', async () => {
      const seller = environment.authenticatedContext('seller').firestore();
      const buyer = environment.authenticatedContext('buyer').firestore();
      const admin = environment.authenticatedContext('admin').firestore();
      await assertSucceeds(getDoc(doc(seller, 'users', 'seller')));
      await assertFails(setDoc(doc(seller, 'users', 'seller'), { role: 'admin' }, { merge: true }));
      await assertFails(setDoc(doc(admin, 'ledgerEntries', 'fake'), { amount: 1 }));
      await assertFails(getDoc(doc(buyer, 'listings', listing.id)));
      await assertSucceeds(getDoc(doc(seller, 'listings', listing.id)));
      await assertFails(
        getDoc(doc(environment.unauthenticatedContext().firestore(), 'listings', listing.id)),
      );
    });
    let dealId = '';
    await t.test('competing real Firestore transactions create one reservation', async () => {
      const results = await Promise.allSettled([
        market.offer(actor('buyer'), 'listings', listing.id, 150),
        market.offer(actor('buyer2'), 'listings', listing.id, 150),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const deals = await store.query('deals');
      assert.equal(deals.length, 1);
      dealId = deals[0]!.id;
    });
    await t.test('repeated real completion creates exactly two ledger documents', async () => {
      const deal = (await store.get('deals', dealId))!;
      await market.accept(actor(deal.buyerId), dealId);
      await market.complete(actor('seller'), dealId);
      await Promise.all([
        market.complete(actor(deal.buyerId), dealId),
        market.complete(actor(deal.buyerId), dealId),
      ]);
      assert.equal((await store.query('ledgerEntries')).length, 2);
      const seller = environment.authenticatedContext('seller').firestore();
      await assertSucceeds(
        getDocs(query(collection(seller, 'ledgerEntries'), where('userId', '==', 'seller'))),
      );
      await assertFails(getDocs(collection(seller, 'ledgerEntries')));
    });
  } finally {
    await environment.cleanup();
    await db.terminate();
    await deleteApp(app);
  }
});
