import { auth, db, getSecondaryAuth, usernameToEmail } from "./firebase-init.js";
import { onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, deleteDoc, updateDoc,
  collection, addDoc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- AUTH GUARD ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  const profile = await getDoc(doc(db, "users", user.uid));
  if (!profile.exists() || profile.data().role !== "admin") {
    window.location.href = "member.html"; // logged in, but not an admin
    return;
  }
  initDashboard();
});

document.getElementById("signOutBtn").addEventListener("click", () => signOut(auth));

// ---------- TABS ----------
document.getElementById("mainTabs").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  const tab = e.target.dataset.tab;
  document.querySelectorAll("#mainTabs button").forEach(b => b.classList.toggle("active", b === e.target));
  document.querySelectorAll(".tabpanel").forEach(p => p.style.display = "none");
  document.getElementById("tab-" + tab).style.display = "block";
});

// ---------- STATE ----------
let allEvents = [];
let allMembers = [];
let allRecords = [];
let activeEventFilter = "all";
let activeCommitteeFilter = "all";

function initDashboard() {
  onSnapshot(collection(db, "events"), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
    renderEventSubTabs();
function renderRecords() {
  const el = document.getElementById("recordsList");
  let filtered = activeEventFilter === "all" ? allRecords : allRecords.filter(r => r.eventId === activeEventFilter);

  const committees = [...new Set(allRecords.map(r => r.committee).filter(Boolean))];
  const committeeTabsHtml = ["all", ...committees].map(c =>
    `<button data-committee="${escapeHtml(c)}" class="${activeCommitteeFilter === c ? 'active' : ''}">${c === "all" ? "All Committees" : escapeHtml(c)}</button>`
  ).join("");

  if (activeCommitteeFilter !== "all") {
    filtered = filtered.filter(r => r.committee === activeCommitteeFilter);
  }

  el.innerHTML = `
    <div class="tabs" id="committeeSubTabs">${committeeTabsHtml}</div>
    <div class="card">
      <table>
        <tr><th>Student</th><th>Name</th><th>Committee</th><th>Event</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th></th></tr>
        ${filtered.map(r => `
          <tr>
            <td>${escapeHtml(r.studentNo || "")}</td>
            <td>${escapeHtml(r.fullName || "")}</td>
            <td>${escapeHtml(r.committee || "")}</td>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${escapeHtml(r.shift || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "<span class='badge blue'>Active</span>"}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
            <td><button class="danger" data-action="delete-record" data-id="${r.id}" style="padding:6px 10px;font-size:.75rem;">Del</button></td>
          </tr>`).join("")}
      </table>
      ${filtered.length === 0 ? `<p class="muted">No duty records for this filter yet.</p>` : ""}
    </div>`;

  document.getElementById("committeeSubTabs").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    activeCommitteeFilter = btn.dataset.committee;
    renderRecords();
  }));

  el.querySelectorAll('[data-action="delete-record"]').forEach(btn => btn.addEventListener("click", async () => {
    if (confirm("Delete this duty record?")) await deleteDoc(doc(db, "dutyRecords", btn.dataset.id));
  }));
  
  onSnapshot(collection(db, "users"), (snap) => {
    allMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMembers();
    updateStats();
  });

  onSnapshot(query(collection(db, "dutyRecords"), orderBy("createdAt", "desc")), (snap) => {
    allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRecords();
    updateStats();
  });
}

function updateStats() {
  document.getElementById("statMembers").textContent = allMembers.filter(m => m.role === "member").length;
  document.getElementById("statEvents").textContent = allEvents.length;
  document.getElementById("statRecords").textContent = allRecords.length;
}

// ---------- EVENTS ----------
document.getElementById("addEventBtn").addEventListener("click", async () => {
  const name = document.getElementById("evName").value.trim();
  const location = document.getElementById("evLocation").value.trim();
  const pic = document.getElementById("evPic").value.trim();
  const compliance = document.getElementById("evCompliance").value.trim();
  if (!name) return;

  await addDoc(collection(db, "events"), {
    name, location, pic, compliance,
    status: "active",
    createdAt: Date.now()
  });

  ["evName","evLocation","evPic","evCompliance"].forEach(id => document.getElementById(id).value = "");
});

function renderEvents() {
  const el = document.getElementById("eventsList");
  el.innerHTML = allEvents.map(ev => `
    <div class="card">
      <div class="row" style="align-items:center;">
        <div>
          <h3 style="margin-bottom:4px;">${escapeHtml(ev.name)}</h3>
          <p class="muted" style="margin:0 0 6px;">${escapeHtml(ev.location || "")}</p>
          <span class="badge ${ev.status === 'active' ? 'green' : 'blue'}">${ev.status}</span>
        </div>
        <div style="text-align:right;">
          <button class="secondary" data-action="toggle" data-id="${ev.id}" data-status="${ev.status}">
            ${ev.status === 'active' ? 'Mark Completed' : 'Reopen'}
          </button><br><br>
          <button class="danger" data-action="delete-event" data-id="${ev.id}">Delete</button>
        </div>
      </div>
      ${ev.pic ? `<p class="muted">PIC: ${escapeHtml(ev.pic)}</p>` : ""}
      ${ev.compliance ? `<p class="muted" style="color:var(--red);">${escapeHtml(ev.compliance)}</p>` : ""}
    </div>`).join("") || `<p class="muted">No events yet.</p>`;

  el.querySelectorAll('[data-action="toggle"]').forEach(btn => btn.addEventListener("click", async () => {
    const newStatus = btn.dataset.status === "active" ? "completed" : "active";
    await updateDoc(doc(db, "events", btn.dataset.id), { status: newStatus });
  }));
  el.querySelectorAll('[data-action="delete-event"]').forEach(btn => btn.addEventListener("click", async () => {
    if (confirm("Delete this event? Duty records referencing it will remain but show as orphaned.")) {
      await deleteDoc(doc(db, "events", btn.dataset.id));
    }
  }));
}

// ---------- MEMBERS ----------
document.getElementById("addMemberBtn").addEventListener("click", async () => {
  const errorEl = document.getElementById("mError");
  errorEl.textContent = "";

  const fullName = document.getElementById("mFullName").value.trim();
  const studentNo = document.getElementById("mStudentNo").value.trim();
  const committee = document.getElementById("mCommittee").value.trim();
  const username = document.getElementById("mUsername").value.trim();
  const password = document.getElementById("mPassword").value;
  const role = document.getElementById("mRole").value;

  if (!fullName || !studentNo || !username || !password) {
    errorEl.textContent = "Fill in name, student no., username, and password.";
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = "Password must be at least 6 characters (Firebase minimum).";
    return;
  }

  const btn = document.getElementById("addMemberBtn");
  btn.disabled = true; btn.textContent = "Creating...";

  try {
    // Use the SECONDARY auth instance so this doesn't sign the admin out.
    const secondaryAuth = getSecondaryAuth();
    const email = usernameToEmail(username);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);

    await setDoc(doc(db, "users", cred.user.uid), {
      fullName, studentNo, committee, username, role, createdAt: Date.now()
    });

    await signOut(secondaryAuth); // clean up the secondary session

    ["mFullName","mStudentNo","mCommittee","mUsername","mPassword"].forEach(id => document.getElementById(id).value = "");
  } catch (err) {
    errorEl.textContent = err.code === "auth/email-already-in-use"
      ? "That username is already taken."
      : "Could not create account: " + err.message;
  } finally {
    btn.disabled = false; btn.textContent = "+ Create Account";
  }
});

function renderMembers() {
  const el = document.getElementById("membersList");
  el.innerHTML = `
    <div class="card">
      <h3>Registered Roster (${allMembers.length})</h3>
      <table>
        <tr><th>Student No.</th><th>Name</th><th>Committee</th><th>Role</th><th></th></tr>
        ${allMembers.map(m => `
          <tr>
            <td>${escapeHtml(m.studentNo || "")}</td>
            <td>${escapeHtml(m.fullName || m.username || "")}</td>
            <td>${escapeHtml(m.committee || "")}</td>
            <td><span class="badge ${m.role === 'admin' ? 'red' : 'blue'}">${m.role}</span></td>
            <td><button class="danger" data-action="delete-member" data-id="${m.id}" style="padding:6px 10px;font-size:.75rem;">Remove</button></td>
          </tr>`).join("")}
      </table>
    </div>`;

  el.querySelectorAll('[data-action="delete-member"]').forEach(btn => btn.addEventListener("click", async () => {
    if (confirm("Remove this member's profile? (Their login account itself must also be deleted from the Firebase Console > Authentication tab.)")) {
      await deleteDoc(doc(db, "users", btn.dataset.id));
    }
  }));
}

// ---------- DUTY RECORDS (tabbed by event) ----------
function renderEventSubTabs() {
  const el = document.getElementById("eventSubTabs");
  const tabs = [{ id: "all", name: "All" }, ...allEvents.map(e => ({ id: e.id, name: e.name }))];
  el.innerHTML = tabs.map(t => `<button data-ev="${t.id}" class="${activeEventFilter === t.id ? 'active' : ''}">${escapeHtml(t.name)}</button>`).join("");
  el.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    activeEventFilter = btn.dataset.ev;
    renderEventSubTabs();
    renderRecords();
  }));
}

function renderRecords() {
  const el = document.getElementById("recordsList");
  const filtered = activeEventFilter === "all" ? allRecords : allRecords.filter(r => r.eventId === activeEventFilter);

  el.innerHTML = `
    <div class="card">
      <table>
        <tr><th>Student</th><th>Event</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th></th></tr>
        ${filtered.map(r => `
          <tr>
            <td>${escapeHtml(r.studentNo || "")}</td>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${escapeHtml(r.shift || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "<span class='badge blue'>Active</span>"}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
            <td><button class="danger" data-action="delete-record" data-id="${r.id}" style="padding:6px 10px;font-size:.75rem;">Del</button></td>
          </tr>`).join("")}
      </table>
      ${filtered.length === 0 ? `<p class="muted">No duty records for this event yet.</p>` : ""}
    </div>`;

  el.querySelectorAll('[data-action="delete-record"]').forEach(btn => btn.addEventListener("click", async () => {
    if (confirm("Delete this duty record?")) await deleteDoc(doc(db, "dutyRecords", btn.dataset.id));
  }));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
