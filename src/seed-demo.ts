import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firebase } from './firebase.js';
import type { Role, User } from './domain.js';

type DemoAccount = {
  key: 'admin' | 'collector' | 'aggregator' | 'recycler';
  email: string;
  name: string;
  role: Role;
};
type LocalCredentials = Record<string, { email: string; password: string; uid: string }>;

const accounts: DemoAccount[] = [
  { key: 'admin', email: 'demo.admin@kabadiwala.local', name: 'Demo Administrator', role: 'admin' },
  { key: 'collector', email: 'demo.collector@kabadiwala.local', name: 'Demo Collector', role: 'kabadiwala' },
  { key: 'aggregator', email: 'demo.aggregator@kabadiwala.local', name: 'Demo Aggregator', role: 'middleman' },
  { key: 'recycler', email: 'demo.recycler@kabadiwala.local', name: 'Demo Recycler', role: 'recycler' },
];
const credentialsPath = resolve(process.cwd(), '.demo-accounts.json');
const newPassword = () => `Kc-${randomBytes(14).toString('base64url')}-9!`;

async function readCredentials(): Promise<LocalCredentials> {
  try {
    return JSON.parse(await readFile(credentialsPath, 'utf8')) as LocalCredentials;
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

const existingCredentials = await readCredentials();
const { store, auth } = firebase();

for (const account of accounts) {
  const password = existingCredentials[account.key]?.password ?? newPassword();
  let identity;
  try {
    identity = await auth.getUserByEmail(account.email);
    // Recover cleanly if a prior seed was interrupted before the local credentials file was written.
    if (!existingCredentials[account.key]) identity = await auth.updateUser(identity.uid, { password });
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'auth/user-not-found') {
      identity = await auth.createUser({
        email: account.email,
        password,
        displayName: account.name,
        emailVerified: true,
      });
    } else {
      throw error;
    }
  }

  const now = new Date().toISOString();
  await store.run(async (tx) => {
    const current = await tx.get('users', identity.uid);
    const profile: User = {
      id: identity.uid,
      role: account.role,
      name: account.name,
      phone: '',
      email: account.email,
      address: '',
      locality: 'Demo locality',
      geo: null,
      available: account.role === 'kabadiwala',
      verificationStatus: 'verified',
      createdAt: current?.createdAt ?? now,
      lastActiveAt: now,
    };
    tx.set('users', identity.uid, profile);
  });
  existingCredentials[account.key] = { email: account.email, password, uid: identity.uid };
}

await writeFile(credentialsPath, `${JSON.stringify(existingCredentials, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
console.log('Demo users are ready. Credentials were saved only to .demo-accounts.json.');
