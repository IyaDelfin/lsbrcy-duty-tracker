import { auth, db, usernameToEmail } from "./firebase-init.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const errorEl = document.getElementById("error");
const loginBtn = document.getElementById("loginBtn");

// If already logged in, skip straight to the right dashboard.
onAuthStateChanged(auth, async (user) => {
  if (user) await routeByRole(user.uid);
});

loginBtn.addEventListener("click", handleLogin);
document.getElementById("password").addEventListener("keydown", e => {
  if (e.key === "Enter") handleLogin();
});

async function handleLogin() {
  errorEl.textContent = "";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  if (!username || !password) {
    errorEl.textContent = "Enter both username and password.";
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in...";

  try {
    const email = usernameToEmail(username);
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await routeByRole(cred.user.uid);
  } catch (err) {
    errorEl.textContent = friendlyError(err.code);
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In";
  }
}

// Every account's role lives in Firestore at users/{uid}.role
// ("admin" or "member") — set there when the admin creates the account.
async function routeByRole(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) {
    errorEl.textContent = "No profile found for this account. Contact an admin.";
    return;
  }
  const role = snap.data().role;
  window.location.href = role === "admin" ? "admin.html" : "member.html";
}

function friendlyError(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect username or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a minute.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
