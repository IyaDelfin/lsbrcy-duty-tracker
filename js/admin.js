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
let activeMemberCommittee = "all";
let memberSearchTerm = "";
let selectedMemberId = null;


const CATEGORY_LABELS = { clinic: "Clinic Duty", office: "Office Duty" };

function initDashboard() {
  onSnapshot(collection(db, "events"), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
    renderEventSubTabs();
    renderRecords();
  });

  onSnapshot(collection(db, "users"), (snap) => {
    allMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMembers();
    updateStats();
  });

    onSnapshot(query(collection(db, "dutyRecords"), orderBy("createdAt", "desc")), (snap) => {
    allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRecords();
    updateStats();
    renderMemberDetail();
  });


}

function updateStats() {
  document.getElementById("statMembers").textContent = allMembers.filter(m => m.role === "member").length;
  document.getElementById("statEvents").textContent = allEvents.length;
  document.getElementById("statRecords").textContent = allRecords.length;
}

// ---------- AVAILABLE EVENTS (category tabs + clickable list) ----------
function initData() {
  onSnapshot(query(collection(db, "events")), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategoryEvents();

function renderCategoryEvents() {
  const listEl = document.getElementById("categoryEventsList");
  const active = allEvents.filter(e => e.status === "active" && (e.category || "clinic") === activeCategory);

  listEl.innerHTML = active.map(ev => `
    <div class="card" data-event-id="${ev.id}" style="cursor:pointer; margin-bottom:10px; ${selectedEventId === ev.id ? 'border-color:var(--red);' : ''}">
      <div class="row" style="align-items:center;">
        <div>
          <h3 style="margin-bottom:2px;">${escapeHtml(ev.name)}</h3>
          <p class="muted" style="margin:0;">${escapeHtml(ev.location || "")}</p>
        </div>
        ${selectedEventId === ev.id ? `<span class="badge red">Selected</span>` : ""}
      </div>
    </div>`;

  listEl.querySelectorAll('[data-event-id]').forEach(card => card.addEventListener("click", () => {
    if (openRecord) return; // don't allow switching selection while clocked in
    selectedEventId = card.dataset.eventId;
    renderCategoryEvents();
    renderEventDetails();
    renderClockCard();
  }));

  renderEventDetails();
}

function renderEventDetails() {
  const el = document.getElementById("eventDetails");
  const ev = allEvents.find(e => e.id === selectedEventId);
  if (!ev) { el.innerHTML = ""; return; }

  el.innerHTML = `
    <div class="card" style="margin-top:10px;">
      <h3 style="margin-bottom:8px;">${escapeHtml(ev.name)}</h3>
      <p class="muted" style="margin:0 0 6px;">${escapeHtml(CATEGORY_LABELS[ev.category] || "")} · ${escapeHtml(ev.location || "")}</p>
      ${ev.pic ? `<p class="muted">PIC: ${escapeHtml(ev.pic)}</p>` : ""}
      ${ev.maxHours != null ? `<p class="muted">Max hours for this event: ${ev.maxHours}</p>` : ""}
      ${ev.compliance ? `<p class="muted" style="color:var(--red);">${escapeHtml(ev.compliance)}</p>` : ""}
    </div>`;
}

// ---------- EVENTS ----------
document.getElementById("addEventBtn").addEventListener("click", async () => {
  const name = document.getElementById("evName").value.trim();
  const location = document.getElementById("evLocation").value.trim();
  const category = document.getElementById("evCategory").value;
  const maxHoursRaw = document.getElementById("evMaxHours").value.trim();
  const maxHours = maxHoursRaw === "" ? null : parseFloat(maxHoursRaw);
  const pic = document.getElementById("evPic").value.trim();
  const compliance = document.getElementById("evCompliance").value.trim();
  if (!name) return;

  await addDoc(collection(db, "events"), {
    name, location, category, maxHours, pic, compliance,
    status: "active",
    createdAt: Date.now()
  });

  ["evName","evLocation","evMaxHours","evPic","evCompliance"].forEach(id => document.getElementById(id).value = "");
});

function renderEvents() {
  const el = document.getElementById("eventsList");
  el.innerHTML = allEvents.map(ev => `
    <div class="card">
      <div class="row" style="align-items:center;">
        <div>
          <h3 style="margin-bottom:4px;">${escapeHtml(ev.name)}</h3>
          <p class="muted" style="margin:0 0 6px;">${escapeHtml(ev.location || "")}</p>
          <span class="badge blue">${escapeHtml(CATEGORY_LABELS[ev.category] || "Uncategorized")}</span>
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
      ${ev.maxHours != null ? `<p class="muted">Max hours: ${ev.maxHours}</p>` : ""}
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
    const secondaryAuth = getSecondaryAuth();
    const email = usernameToEmail(username);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);

    await setDoc(doc(db, "users", cred.user.uid), {
      fullName, studentNo, committee, username, role, createdAt: Date.now()
    });

    await signOut(secondaryAuth);

    ["mFullName","mStudentNo","mCommittee","mUsername","mPassword"].forEach(id => document.getElementById(id).value = "");
  } catch (err) {
    errorEl.textContent = err.code === "auth/email-already-in-use"
      ? "That username is already taken."
      : "Could not create account: " + err.message;
  } finally {
    btn.disabled = false; btn.textContent = "+ Create Account";
  }
});

document.getElementById("memberSearch").addEventListener("input", (e) => {
  memberSearchTerm = e.target.value.trim().toLowerCase();
  renderMembers();
});

function renderMembers() {
  const committees = [...new Set(allMembers.map(m => m.committee).filter(Boolean))];
  const tabsEl = document.getElementById("memberCommitteeTabs");
  tabsEl.innerHTML = ["all", ...committees].map(c =>
    `<button data-mc="${escapeHtml(c)}" class="${activeMemberCommittee === c ? 'active' : ''}">${c === "all" ? "All Committees" : escapeHtml(c)}</button>`
  ).join("");
  tabsEl.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    activeMemberCommittee = btn.dataset.mc;
    renderMembers();
  }));

  let filtered = activeMemberCommittee === "all" ? allMembers : allMembers.filter(m => m.committee === activeMemberCommittee);
  if (memberSearchTerm) {
    filtered = filtered.filter(m =>
      (m.fullName || m.username || "").toLowerCase().includes(memberSearchTerm) ||
      (m.studentNo || "").toLowerCase().includes(memberSearchTerm)
    );
  }

  const el = document.getElementById("membersList");
  el.innerHTML = `
    <div class="card">
      <h3>Registered Roster (${filtered.length})</h3>
      <table>
        <tr><th>Student No.</th><th>Name</th><th>Committee</th><th>Role</th><th></th></tr>
        ${filtered.map(m => `
          <tr data-view-id="${m.id}" style="cursor:pointer;">
            <td>${escapeHtml(m.studentNo || "")}</td>
            <td>${escapeHtml(m.fullName || m.username || "")}</td>
            <td>${escapeHtml(m.committee || "")}</td>
            <td><span class="badge ${m.role === 'admin' ? 'red' : 'blue'}">${m.role}</span></td>
            <td><button class="danger" data-action="delete-member" data-id="${m.id}" style="padding:6px 10px;font-size:.75rem;">Remove</button></td>
          </tr>`).join("")}
      </table>
      ${filtered.length === 0 ? `<p class="muted">No members match this filter.</p>` : ""}
    </div>`;

  el.querySelectorAll('tr[data-view-id]').forEach(row => row.addEventListener("click", (e) => {
    if (e.target.closest('[data-action="delete-member"]')) return;
    selectedMemberId = row.dataset.viewId;
    renderMemberDetail();
  }));

  el.querySelectorAll('[data-action="delete-member"]').forEach(btn => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (confirm("Remove this member's profile? (Their login account itself must also be deleted from the Firebase Console > Authentication tab.)")) {
      await deleteDoc(doc(db, "users", btn.dataset.id));
    }
  }));

  renderMemberDetail();
}

function renderMemberDetail() {
  const el = document.getElementById("memberDetail");
  if (!selectedMemberId) { el.innerHTML = ""; return; }
  const m = allMembers.find(x => x.id === selectedMemberId);
  if (!m) { el.innerHTML = ""; return; }

  const records = allRecords.filter(r => r.uid === selectedMemberId);
  const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);

  el.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center;">
        <h3 style="margin:0;">${escapeHtml(m.fullName || m.username || "")}</h3>
        <button class="secondary" id="closeMemberDetail" style="max-width:100px;">Close</button>
      </div>
      <p class="muted">ID: ${escapeHtml(m.studentNo || "–")} · Committee: ${escapeHtml(m.committee || "–")} · Role: ${escapeHtml(m.role || "")}</p>
      <p class="muted">Total Hours Rendered: <strong style="color:var(--text);">${totalHours.toFixed(1)}</strong></p>
      <table>
        <tr><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th></tr>
        ${records.map(r => `
          <tr>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) : "–"}</td>
            <td>${escapeHtml(r.shift || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "<span class='badge blue'>Active</span>"}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
          </tr>`).join("")}
      </table>
      ${records.length === 0 ? `<p class="muted">No duty records yet.</p>` : ""}
    </div>`;

  document.getElementById("closeMemberDetail").addEventListener("click", () => {
    selectedMemberId = null;
    renderMemberDetail();
  });
}

// ---------- DUTY RECORDS (tabbed by event, filterable by committee) ----------
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
        <tr><th>Student</th><th>Name</th><th>Committee</th><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th></th></tr>
        ${filtered.map(r => `
          <tr>
            <td>${escapeHtml(r.studentNo || "")}</td>
            <td>${escapeHtml(r.fullName || "")}</td>
            <td>${escapeHtml(r.committee || "")}</td>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) : "–"}</td>
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
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
