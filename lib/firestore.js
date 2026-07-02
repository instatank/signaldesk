// Firestore (firebase-admin) singleton. The service account JSON lives in
// the FIREBASE_SERVICE_ACCOUNT env var — either raw JSON or base64 of it.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
  }
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(jsonText);
}

export function getDb() {
  if (getApps().length === 0) {
    initializeApp({ credential: cert(parseServiceAccount()) });
  }
  return getFirestore();
}
