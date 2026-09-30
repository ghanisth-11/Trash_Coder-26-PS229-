import { firebase } from './firebase.js';

const uid = process.argv[2];
if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))
  throw new Error('Usage: npm run bootstrap-admin -- FIREBASE_UID');

const { store, auth } = firebase();
const identity = await auth.getUser(uid);

await store.run(async (tx) => {
  const existing = await tx.get('users', uid);
  if (existing && existing.role !== 'admin')
    throw new Error('Existing profile must be promoted through an authenticated admin API');
  const now = new Date().toISOString();
  tx.set('users', uid, {
    id: uid,
    role: 'admin',
    name: identity.displayName ?? 'Administrator',
    phone: identity.phoneNumber ?? '',
    email: identity.email ?? '',
    geo: null,
    address: '',
    locality: '',
    available: false,
    verificationStatus: 'verified',
    createdAt: existing?.createdAt ?? now,
    lastActiveAt: now,
  });
});

console.log(`Admin profile ready for ${uid}`);
