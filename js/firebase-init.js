// ============================================================
// FIREBASE CONFIG — REPLACE with YOUR project's values.
// Get this from: Firebase Console > Project Settings > General
// > "Your apps" > Web app > SDK setup and configuration
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyAm1PiEBJpNT31a6XvLFz_2U8KzAMdugtc",
  authDomain: "lsb-rcy-duty-tracker-2.firebaseapp.com",
  projectId: "lsb-rcy-duty-tracker-2",
  storageBucket: "lsb-rcy-duty-tracker-2.firebasestorage.app",
  messagingSenderId: "664848454421",
  appId: "1:664848454421:web:85dd3a8a16b05364e4cf1c"
};

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Main app instance — used for the currently logged-in session.
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { experimentalForceLongPolling: true });



// A SECOND, isolated Firebase app instance.
// Why: creating a new Auth user with createUserWithEmailAndPassword()
// automatically SIGNS IN as that new user in the SDK that calls it.
// That would kick the admin out of their own session every time they
// add a member. Using a second named app avoids that side effect —
// the admin's session on `auth` stays untouched.
export function getSecondaryAuth() {
  const name = "secondary";
  const existing = getApps().find(a => a.name === name);
  const secondaryApp = existing || initializeApp(firebaseConfig, name);
  return getAuth(secondaryApp);
}

// Members log in with a plain username, not an email. Internally we
// store each account as "<username>@lsbrcy.local" in Firebase Auth,
// since Firebase's email/password provider requires an email format.
// This is invisible to the user — they only ever type a username.
export function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/\s+/g, "") + "@lsbrcy.local";
}
