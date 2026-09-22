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

let allEvents = [];
let allRecords = [];
let activeEventFilter = "all";
let activeCommitteeFilter = "all";
let memberSearchTerm = "";
let selectedMemberUid = null;

document.getElementById("memberSearch").addEventListener("input", (e) => {
  memberSearchTerm = e.target.value.trim().toLowerCase();
  renderRecords();
});



// ---------- DUTY RECORDS (tabbed by event, filterable by committee) ----------

function initData() {
  onSnapshot(collection(db, "events"), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEventSubTabs();
    renderRecords();
  });

  onSnapshot(collection(db, "dutyRecords"), (snap) => {
    allRecords = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.createdAt - a.createdAt);
    renderRecords();
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
  if (memberSearchTerm) {
    filtered = filtered.filter(r =>
      (r.fullName || "").toLowerCase().includes(memberSearchTerm) ||
      (r.studentNo || "").toLowerCase().includes(memberSearchTerm)
    );
  }



  el.innerHTML = `
    <div class="tabs" id="committeeSubTabs">${committeeTabsHtml}</div>
    <div class="card">
      <table>
        <tr><th>Student</th><th>Name</th><th>Committee</th><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th></th></tr>
                ${filtered.map(r => `
          <tr data-view-uid="${r.uid || ''}" style="cursor:pointer;">

            <td>${escapeHtml(r.studentNo || "")}</td>
            <td>${escapeHtml(r.fullName || "")}</td>
            <td>${escapeHtml(r.committee || "")}</td>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) : "–"}</td>
            <td>${escapeHtml(r.shift || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "<span class='badge blue'>Active</span>"}</td>
   el.innerHTML = `
    <div class="tabs" id="committeeSubTabs">${committeeTabsHtml}</div>
    <div class="card">
      <table>
        <tr><th>Student</th><th>Name</th><th>Committee</th><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th>Status</th></tr>
                ${filtered.map(r => `
          <tr data-view-uid="${r.uid || ''}" style="cursor:pointer;">

            <td>${escapeHtml(r.studentNo || "")}</td>
            <td>${escapeHtml(r.fullName || "")}</td>
            <td>${escapeHtml(r.committee || "")}</td>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) : "–"}</td>
            <td>${escapeHtml(r.shift || "")}${r.shiftStart ? ` (${formatTime12(r.shiftStart)}–${formatTime12(r.shiftEnd)})` : ""}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "<span class='badge blue'>Active</span>"}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
            <td>${r.late ? "<span class='badge orange'>Late</span>" : ""}</td>
          </tr>`).join("")}
      </table>
      ${filtered.length === 0 ? `<p class="muted">No duty records for this filter yet.</p>` : ""}
    </div>`;

  
    document.getElementById("committeeSubTabs").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    activeCommitteeFilter = btn.dataset.committee;
    renderRecords();
  }));

  el.querySelectorAll('tr[data-view-uid]').forEach(row => row.addEventListener("click", () => {
    if (!row.dataset.viewUid) return;
    selectedMemberUid = row.dataset.viewUid;
    renderMemberDetail();
  }));

  renderMemberDetail();
}

function renderMemberDetail() {
  const el = document.getElementById("memberDetail");
  if (!selectedMemberUid) { el.innerHTML = ""; return; }

  const records = allRecords.filter(r => r.uid === selectedMemberUid);
  if (records.length === 0) { el.innerHTML = ""; return; }

  const first = records[0];
  const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);

  el.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center;">
        <h3 style="margin:0;">${escapeHtml(first.fullName || "")}</h3>
        <button class="secondary" id="closeMemberDetail" style="max-width:100px;">Close</button>
      </div>
      <p class="muted">ID: ${escapeHtml(first.studentNo || "–")} · Committee: ${escapeHtml(first.committee || "–")}</p>
      <p class="muted">Total Hours Rendered: <strong style="color:var(--text);">${totalHours.toFixed(1)}</strong></p>
      <p class="muted">Late Count: <strong style="color:var(--orange);">${records.filter(r => r.late).length}</strong></p>
      <table>
        <tr><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th>Status</th></tr>
        ${records.map(r => `
          <tr>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) : "–"}</td>
            <td>${escapeHtml(r.shift || "")}${r.shiftStart ? ` (${formatTime12(r.shiftStart)}–${formatTime12(r.shiftEnd)})` : ""}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "<span class='badge blue'>Active</span>"}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
            <td>${r.late ? "<span class='badge orange'>Late</span>" : ""}</td>
          </tr>`).join("")}
      </table>
    </div>`;
  document.getElementById("closeMemberDetail").addEventListener("click", () => {
    selectedMemberUid = null;
    renderMemberDetail();
  });
}


function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// Formats a 24-hour "HH:MM" string as "H:MM AM/PM", using "NN" for noon
// and "MN" for midnight (Philippine duty-roster convention).
function formatTime12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const mm = String(m).padStart(2, "0");
  if (h === 0) return `12:${mm} MN`;
  if (h === 12) return `12:${mm} NN`;
  if (h < 12) return `${h}:${mm} AM`;
  return `${h - 12}:${mm} PM`;
}
