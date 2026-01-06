# Habit Tracker

Mobile-first habit tracker built with React, TypeScript, Vite, and Firebase Firestore. The app is serverless and designed to deploy on GitHub Pages.

## Quick start

```bash
npm install
npm run dev
```

## Firebase config (local only)

The app reads Firebase config from your browser localStorage or from a local `.env` file.

### Option A: Paste into the UI (localStorage)

1. Run the app.
2. Paste the Firebase web config JSON from the Firebase console into the setup screen.
3. The config is stored locally in your browser and not committed anywhere.

### Option B: Local `.env`

Create a `.env` file (not committed) with:

```
VITE_FIREBASE_CONFIG={"apiKey":"...","authDomain":"...","projectId":"...","appId":"...","storageBucket":"...","messagingSenderId":"..."}
```

> Note: Firebase client config is not a secret. Protect access using Firestore security rules and authentication.

## Authentication

This app uses Firebase Authentication (Email/Password). Enable the provider in the Firebase Console before signing in.

After signing in, copy your UID from the UI and lock Firestore rules to it.

## Firestore structure

- Habit definitions: `trackerDefs/{habitId}`

  `habitId` is the document ID (the UI generates a camelCase ID from the label).

  Habit `type` can be:

  - `boolean`: tracked as a boolean toggle
  - `enum`: tracked as a single selected string
  - `multiEnum`: tracked as multiple selected strings
  - `number`: tracked as a number (int/float) with a `unit`

  Example documents:

  **Boolean**

  ```json
  {
    "label": "Floss",
    "active": true,
    "category": "health",
    "type": "boolean",
    "order": 10,
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  }
  ```

  **Enum**

  ```json
  {
    "label": "Workout intensity",
    "active": true,
    "category": "fitness",
    "type": "enum",
    "enumOptions": ["Low", "Medium", "High"],
    "order": 20,
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  }
  ```

  **Multi enum**

  ```json
  {
    "label": "Supplements",
    "active": true,
    "category": "health",
    "type": "multiEnum",
    "enumOptions": ["Vitamin D", "Magnesium", "Creatine"],
    "order": 30,
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  }
  ```

  **Number**

  ```json
  {
    "label": "Water",
    "active": true,
    "category": "health",
    "type": "number",
    "unit": "L",
    "order": 40,
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  }
  ```

- Day entries: `days/{yyyy-mm-dd}` with:

  ```json
  {
    "date": "2026-01-01",
    "note": "",
    "v": {
      "floss": true,
      "workoutIntensity": "High",
      "supplements": ["Vitamin D", "Creatine"],
      "water": 2.5
    },
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  }
  ```

  Notes:

  - “Not tracked” is represented by the absence of the key in `v` (the UI clears values by deleting the field).
  - `v` values are one of: `boolean` (boolean habits), `string` (enum), `string[]` (multiEnum), or `number` (number).

## Firestore rules (single user)

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trackerDefs/{habitId} {
      allow read, write: if request.auth != null && request.auth.uid == "YOUR_UID";
    }
    match /days/{dayId} {
      allow read, write: if request.auth != null && request.auth.uid == "YOUR_UID";
    }
  }
}
```

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow that builds and deploys to Pages. Enable Pages in the repo settings (`Actions` → `GitHub Pages`). The Vite base path is set to `/habit-tracker/` for production builds.

## Scripts

- `npm run dev` — start dev server
- `npm run build` — typecheck + build
- `npm run preview` — preview production build
