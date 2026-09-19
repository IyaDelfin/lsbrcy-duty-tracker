import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, collection, addDoc, updateDoc,
  onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser = null;
let myProfile = null;
let allEvents = [];
let myRecords = [];
let activeEventFilter = "all";
let openRecord = null; // the duty record currently clocked-in, if any

const MIN_MINUTES = 60; // minimum shift length before clock-out is allowed

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "index.html"; return; }
  myProfile = snap.data();

  document.getElementById("memberName").textContent = myProfile.fullName || myProfile.username;
  document.getElementById("memberMeta").textContent =
    `ID: ${myProfile.studentNo || "–"} · Committee: ${myProfile.committee || "–"}`;

  initData();
});

document.getElementById("signOutBtn").addEventListener("click", () => signOut(auth));

function initData() {
  onSnapshot(query(collection(db, "events")), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEventSelect();
    renderEventSubTabs();
  });

  // Security rules restrict this query to the signed-in user's own records.
  // Sorting is done client-side (no orderBy) to avoid needing a composite index.
  onSnapshot(
    query(collection(db, "dutyRecords"), where("uid", "==", currentUser.uid)),
    (snap) => {
      myRecords = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.createdAt - a.createdAt);
      openRecord = myRecords.find(r => r.timeOut == null) || null;
      updateTotalHours();
      renderClockCard();
      renderEventSubTabs();
      renderRecords();
    }
  );
}

function updateTotalHours() {
  const total = myRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
  document.getElementById("totalHours").textContent = total.toFixed(1);
}

// ---------- CLOCK IN / OUT ----------
function renderEventSelect() {
  const sel = document.getElementById("eventSelect");
  const active = allEvents.filter(e => e.status === "active");
  sel.innerHTML = active.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("")
    || `<option disabled>No active events</option>`;
}

function renderClockCard() {
  const btn = document.getElementById("clockBtn");
  const sel = document.getElementById("eventSelect");
  if (openRecord) {
    const ev = allEvents.find(e => e.id === openRecord.eventId);
    btn.textContent = `Clock Out (${ev ? ev.name : "current shift"})`;
    sel.disabled = true;
  } else {
    btn.textContent = "Clock In";
    sel.disabled = false;
  }
}

document.getElementById("clockBtn").addEventListener("click", async () => {
  const btn = document.getElementById("clockBtn");
  const errEl = document.getElementById("clockError");
  if (errEl) errEl.textContent = "";
  btn.disabled = true;
  try {
    if (openRecord) {
      const timeOut = Date.now();
      const minutesElapsed = (timeOut - openRecord.timeIn) / 60000;

      if (minutesElapsed < MIN_MINUTES) {
        const remaining = Math.ceil(MIN_MINUTES - minutesElapsed);
        if (errEl) errEl.textContent = `You can clock out in about ${remaining} more minute(s). Minimum shift is ${MIN_MINUTES} minutes.`;
        btn.disabled = false;
        return;
      }

      const hours = +((timeOut - openRecord.timeIn) / 3600000).toFixed(2);
      await updateDoc(doc(db, "dutyRecords", openRecord.id), { timeOut, hours });
    } else {
      const eventId = document.getElementById("eventSelect").value;
      const ev = allEvents.find(e => e.id === eventId);
      if (!ev) { btn.disabled = false; return; }
      const now = new Date();
      await addDoc(collection(db, "dutyRecords"), {
        uid: currentUser.uid,
        studentNo: myProfile.studentNo,
        fullName: myProfile.fullName || myProfile.username,
        committee: myProfile.committee || "",
        eventId,
        eventName: ev.name,
        shift: now.getHours() < 12 ? "AM" : "PM",
        timeIn: now.getTime(),
        timeOut: null,
        hours: null,
        pic: ev.pic || "",
        verified: false,
        createdAt: Date.now()
      });
    }
  } finally {
    btn.disabled = false;
  }
});

// ---------- HISTORY BY EVENT TAB ----------
function renderEventSubTabs() {
  const eventIdsWithRecords = new Set(myRecords.map(r => r.eventId));
  const relevantEvents = allEvents.filter(e => eventIdsWithRecords.has(e.id));
  const tabs = [{ id: "all", name: "All" }, ...relevantEvents.map(e => ({ id: e.id, name: e.name }))];

  const el = document.getElementById("eventSubTabs");
  el.innerHTML = tabs.map(t => `<button data-ev="${t.id}" class="${activeEventFilter === t.id ? 'active' : ''}">${escapeHtml(t.name)}</button>`).join("");
  el.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    activeEventFilter = btn.dataset.ev;
    renderEventSubTabs();
    renderRecords();
  }));
}

function renderRecords() {
  const filtered = activeEventFilter === "all" ? myRecords : myRecords.filter(r => r.eventId === activeEventFilter);
  const el = document.getElementById("recordsList");
  el.innerHTML = `
    <div class="card">
      <h3>My Duty Logs</h3>
      <table>
        <tr><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th></tr>
        ${filtered.map(r => `
          <tr>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) : "–"}</td>
            <td>${escapeHtml(r.shift || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "<span class='badge blue'>Active</span>"}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
          </tr>`).join("")}
      </table>
      ${filtered.length === 0 ? `<p class="muted">No duty logs yet.</p>` : ""}
    </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
