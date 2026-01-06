import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
};

const STORAGE_KEY = "habit-tracker.firebaseConfig";

const REQUIRED_KEYS: Array<keyof FirebaseConfig> = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
];

export const isValidFirebaseConfig = (
  value: unknown
): value is FirebaseConfig => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return REQUIRED_KEYS.every(
    (key) => typeof record[key] === "string" && record[key]
  );
};

const parseConfig = (raw: string): FirebaseConfig | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isValidFirebaseConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const loadFirebaseConfig = (): FirebaseConfig | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const config = parseConfig(stored);
    if (config) {
      return config;
    }
  }

  const envConfig = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  if (envConfig) {
    return parseConfig(envConfig);
  }

  return null;
};

export const storeFirebaseConfig = (config: FirebaseConfig) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

export const clearFirebaseConfig = () => {
  window.localStorage.removeItem(STORAGE_KEY);
};

export const initFirebase = (config: FirebaseConfig) => {
  const app = getApps().length ? getApps()[0] : initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  return { app, auth, db };
};
