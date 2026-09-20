import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  const profile = await getDoc(doc(db, "users", user.uid));
  if (!profile.exists() || profile.data().role !== "stratres") {
    window.location.href = "index.html";
    return;
  }
  initData();
});

document.getElementById("signOutBtn").addEventListener("click", () => signOut(auth));

let activeEventFilter = "all";
let activeCommitteeFilter = "all";
let activeMemberCommittee = "all";
let memberSearchTerm = "";
let selectedMemberId = null;



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

function initData() {
  onSnapshot(collection(db, "events"), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEventSubTabs();
    renderRecords();
  });

    onSnapshot(collection(db, "dutyRecords"), orderBy("createdAt", "desc")), (snap) => {
    allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRecords();
    updateStats();
    renderMemberDetail();
  });

}

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
          </tr>`).join("")}
      </table>
      ${filtered.length === 0 ? `<p class="muted">No duty records for this filter yet.</p>` : ""}
    </div>`;

  document.getElementById("committeeSubTabs").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    activeCommitteeFilter = btn.dataset.committee;
    renderRecords();
  }));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
