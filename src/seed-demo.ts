import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firebase } from './firebase.js';
import type { Inventory, Listing, Role, User } from './domain.js';

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
const accountIds = {} as Record<DemoAccount['key'], string>;

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
  accountIds[account.key] = identity.uid;
}

const demoListings: Array<
  Pick<
    Listing,
    | 'id'
    | 'name'
    | 'category'
    | 'subType'
    | 'condition'
    | 'weight'
    | 'quantity'
    | 'buyPrice'
    | 'sellPrice'
    | 'priceUnit'
    | 'priceNote'
  >
> = [
  {
    id: 'demo-collector-cardboard-lot',
    name: 'Sorted cardboard cartons',
    category: 'cardboard',
    subType: 'corrugated-cardboard',
    condition: 'intact',
    weight: 180,
    quantity: 24,
    buyPrice: 11,
    sellPrice: 15,
    priceUnit: 'per_kg',
    priceNote: 'Clean, dry cartons bundled for pickup.',
  },
  {
    id: 'demo-collector-metal-lot',
    name: 'Mixed iron and steel scrap',
    category: 'metal',
    subType: 'ferrous-scrap',
    condition: 'damaged',
    weight: 95,
    quantity: 18,
    buyPrice: 28,
    sellPrice: 36,
    priceUnit: 'per_kg',
    priceNote: 'Sorted ferrous scrap, ready for weighing.',
  },
];

const demoInventory: Array<Omit<Inventory, 'middlemanId' | 'createdAt'>> = [
  {
    id: 'demo-aggregator-paper-lot',
    sourcedFrom: [],
    aggregatedCategory: 'paper',
    totalWeight: 420,
    askingPrice: 7140,
    status: 'listed_to_recycler',
    dealId: null,
  },
  {
    id: 'demo-aggregator-plastic-lot',
    sourcedFrom: [],
    aggregatedCategory: 'plastic',
    totalWeight: 260,
    askingPrice: 14300,
    status: 'listed_to_recycler',
    dealId: null,
  },
];

await store.run(async (tx) => {
  const now = new Date().toISOString();
  const existingListings = new Map(
    await Promise.all(
      demoListings.map(async (lot) => [lot.id, await tx.get('listings', lot.id)] as const),
    ),
  );
  const existingInventory = new Map(
    await Promise.all(
      demoInventory.map(
        async (lot) => [lot.id, await tx.get('middlemanInventory', lot.id)] as const,
      ),
    ),
  );
  for (const lot of demoListings) {
    const existing = existingListings.get(lot.id);
    const listing: Listing = {
      id: lot.id,
      type: 'known',
      status: 'listed',
      kabadiwalaId: accountIds.collector,
      middlemanId: null,
      category: lot.category,
      subType: lot.subType,
      name: lot.name,
      condition: lot.condition,
      weight: lot.weight,
      volume: 0,
      quantity: lot.quantity,
      photoUrl: [],
      isEwaste: false,
      needsOperatorQC: false,
      aiDescription: '',
      aiConfidence: 'high',
      aiFailed: false,
      aiPipeline: {
        status: 'not_run',
        model: 'demo-seed',
        promptVersion: 'demo-seed-v1',
        attemptedAt: null,
        completedAt: null,
        failureCode: null,
        identification: null,
        classification: null,
        pricing: null,
      },
      keyComponents: [],
      currency: 'INR',
      marketTrend: 'stable',
      buyPrice: lot.buyPrice,
      sellPrice: lot.sellPrice,
      priceUnit: lot.priceUnit,
      priceNote: lot.priceNote,
      finalPrice: null,
      qcPriceLocked: false,
      geo: { lat: 28.6139, lng: 77.209 },
      inventoryId: null,
      dealId: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set('listings', listing.id, listing);
  }
  for (const lot of demoInventory) {
    const existing = existingInventory.get(lot.id);
    tx.set('middlemanInventory', lot.id, {
      ...lot,
      middlemanId: accountIds.aggregator,
      createdAt: existing?.createdAt ?? now,
    });
  }
});

await writeFile(credentialsPath, `${JSON.stringify(existingCredentials, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
console.log(
  'Demo users and four shop lots are ready. Credentials were saved only to .demo-accounts.json.',
);
