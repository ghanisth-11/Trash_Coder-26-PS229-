import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { loadConfig } from './config.js';
import { FirestoreStore } from './store.js';
export function firebase() {
  const config = loadConfig();
  const app =
    getApps()[0] ??
    initializeApp({
      projectId: config.FIREBASE_PROJECT_ID,
      ...(process.env.FIRESTORE_EMULATOR_HOST
        ? {}
        : {
            credential: config.FIREBASE_SERVICE_ACCOUNT_JSON
              ? cert(JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON))
              : applicationDefault(),
          }),
    });
  return { config, store: new FirestoreStore(getFirestore(app)), auth: getAuth(app) };
}
