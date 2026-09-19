// ============================================================
// FIREBASE CONFIG — REPLACE with YOUR project's values.
// Get this from: Firebase Console > Project Settings > General
// > "Your apps" > Web app > SDK setup and configuration
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyDw4YMuTMXpcab2KEJpyMuBIoW4I6WAy3Y",
  authDomain: "lsb-rcy-duty-tracker.firebaseapp.com",
  projectId: "lsb-rcy-duty-tracker",
  storageBucket: "lsb-rcy-duty-tracker.firebasestorage.app",
  messagingSenderId: "495623550834",
  appId: "1:495623550834:web:236e0c745a576ee4598feb"
};

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Main app instance — used for the currently logged-in session.
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

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
