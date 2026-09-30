import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firebase } from './firebase.js';
import type { Role, User } from './domain.js';

type DemoAccount = {
  key: 'admin' | 'collector' | 'aggregator' | 'recycler';
  email: string;
  password: string;
  name: string;
  role: Role;
};
type LocalCredentials = Record<string, { email: string; password: string; uid: string }>;

const accounts: DemoAccount[] = [
  {
    key: 'admin',
    email: 'admin@demo.local',
    password: 'admin123',
    name: 'Demo Administrator',
    role: 'admin',
  },
  {
    key: 'collector',
    email: 'kabadiwala@demo.local',
    password: 'kabadiwala123',
    name: 'Demo Collector',
    role: 'kabadiwala',
  },
  {
    key: 'aggregator',
    email: 'middleman@demo.local',
    password: 'middleman123',
    name: 'Demo Aggregator',
    role: 'middleman',
  },
  {
    key: 'recycler',
    email: 'recycler@demo.local',
    password: 'recycler123',
    name: 'Demo Recycler',
    role: 'recycler',
  },
];
const credentialsPath = resolve(process.cwd(), '.demo-accounts.json');

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
  let identity;
  try {
    identity = await auth.getUserByEmail(account.email);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 'auth/user-not-found'
    ) {
      const previousUid = existingCredentials[account.key]?.uid;
      try {
        identity = previousUid
          ? await auth.updateUser(previousUid, {
              email: account.email,
              password: account.password,
              displayName: account.name,
              emailVerified: true,
            })
          : await auth.createUser({
              email: account.email,
              password: account.password,
              displayName: account.name,
              emailVerified: true,
            });
      } catch (migrationError: unknown) {
        if (
          typeof migrationError === 'object' &&
          migrationError &&
          'code' in migrationError &&
          migrationError.code === 'auth/user-not-found'
        ) {
          identity = await auth.createUser({
            email: account.email,
            password: account.password,
            displayName: account.name,
            emailVerified: true,
          });
        } else {
          throw migrationError;
        }
      }
    } else {
      throw error;
    }
  }

  identity = await auth.updateUser(identity.uid, {
    email: account.email,
    password: account.password,
    displayName: account.name,
    emailVerified: true,
  });

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
  existingCredentials[account.key] = {
    email: account.email,
    password: account.password,
    uid: identity.uid,
  };
}

await writeFile(credentialsPath, `${JSON.stringify(existingCredentials, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
console.log('Demo users are ready. Credentials were saved only to .demo-accounts.json.');
