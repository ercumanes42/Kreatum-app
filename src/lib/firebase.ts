import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
} from 'firebase/functions';
import {
  connectStorageEmulator,
  getStorage,
} from 'firebase/storage';
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
};

const app = initializeApp(firebaseConfig);

const runtimeState = globalThis as typeof globalThis & {
  __kreatumEmulatorsConnected?: boolean;
  __kreatumAppCheckInitialized?: boolean;
};

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim();
if (
  import.meta.env.PROD
  && appCheckSiteKey
  && !runtimeState.__kreatumAppCheckInitialized
) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  runtimeState.__kreatumAppCheckInitialized = true;
}

const functionsRegion =
  import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || 'europe-west1';

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functionsClient = getFunctions(app, functionsRegion);
export const storage = getStorage(app);

if (
  import.meta.env.VITE_FIREBASE_USE_EMULATORS === 'true'
  && !runtimeState.__kreatumEmulatorsConnected
) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functionsClient, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  runtimeState.__kreatumEmulatorsConnected = true;
}

export const signInAnonymous = () => signInAnonymously(auth);