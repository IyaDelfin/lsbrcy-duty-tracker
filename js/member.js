import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, collection, addDoc, updateDoc, arrayUnion, arrayRemove,
  onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser = null;
let myProfile = null;
let allEvents = [];
let myRecords = [];
let activeEventFilter = "all";     // for the "My Duty Logs" history tabs
let activeCategory = "clinic";     // for the "Available Events" tabs
let selectedEventId = null;        // event chosen from the list, to view details
let openRecord = null;             // the duty record currently clocked-in, if any

const MIN_MINUTES = 60; // minimum shift length before clock-out is allowed
const CATEGORY_LABELS = { clinic: "Clinic Duty", office: "Office Duty" };

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

document.getElementById("categoryTabs").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  activeCategory = e.target.dataset.cat;
  document.querySelectorAll("#categoryTabs button").forEach(b => b.classList.toggle("active", b === e.target));
  renderCategoryEvents();
});

function initData() {
  onSnapshot(query(collection(db, "events")), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategoryEvents();
    renderEventDetails();
    renderClockCard();
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

// ---------- AVAILABLE EVENTS (category tabs + clickable list) ----------
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
    </div>`).join("") || `<p class="muted">No active events under ${CATEGORY_LABELS[activeCategory]} right now.</p>`;

  listEl.querySelectorAll('[data-event-id]').forEach(card => card.addEventListener("click", () => {
    selectedEventId = card.dataset.eventId;
    renderCategoryEvents();
    renderEventDetails();
  }));
}

// ---------- DATE HELPERS ----------
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateRange(start, end) {
  const dates = [];
  let cur = new Date(start + "T00:00:00");
  const last = new Date((end || start) + "T00:00:00");
  while (cur <= last) {
    dates.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function findTodaysReservation() {
  const today = todayStr();
  for (const ev of allEvents) {
    const list = (ev.volunteersByDate || {})[today] || [];
    if (list.some(v => v.uid === currentUser.uid)) return { event: ev, date: today };
  }
  return null;
}

async function reserveDate(ev, date) {
  await updateDoc(doc(db, "events", ev.id), {
    [`volunteersByDate.${date}`]: arrayUnion({
      uid: currentUser.uid,
      fullName: myProfile.fullName || myProfile.username,
      studentNo: myProfile.studentNo || ""
    })
  });
}

async function cancelReservation(ev, date, entry) {
  await updateDoc(doc(db, "events", ev.id), {
    [`volunteersByDate.${date}`]: arrayRemove(entry)
  });
}

// ---------- EVENT DETAILS (per-date reserve cards) ----------
function renderEventDetails() {
  const el = document.getElementById("eventDetails");
  const ev = allEvents.find(e => e.id === selectedEventId);
  if (!ev) { el.innerHTML = ""; return; }

  const volunteersByDate = ev.volunteersByDate || {};
  const dates = ev.startDate ? dateRange(ev.startDate, ev.endDate) : [];

  const datesHtml = dates.map(date => {
    const list = volunteersByDate[date] || [];
    const full = ev.maxVolunteers != null && list.length >= ev.maxVolunteers;
    const alreadyReserved = list.some(v => v.uid === currentUser.uid);
    const dateLabel = new Date(date + "T00:00:00").toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});

    const namesHtml = list.length
      ? `<p class="muted" style="margin:4px 0 0;font-size:.8rem;">${list.map(v => escapeHtml(v.fullName || "")).join(", ")}</p>`
      : `<p class="muted" style="margin:4px 0 0;font-size:.8rem;">No one yet.</p>`;

    let actionHtml;
    if (alreadyReserved) {
      actionHtml = `<div style="text-align:right;">
          <span class="badge green">Reserved</span><br>
          <button class="danger" data-cancel-date="${date}" style="padding:4px 10px;font-size:.7rem;margin-top:4px;">Cancel</button>
        </div>`;
    } else if (full) {
      actionHtml = `<span class="badge red">Full</span>`;
    } else {
      actionHtml = `<button class="secondary" data-reserve-date="${date}" style="padding:6px 14px;">Reserve</button>`;
    }


    return `
      <div class="card" style="margin-bottom:8px;">
        <div class="row" style="align-items:center;">
          <div>
            <strong>${dateLabel}</strong>
            <p class="muted" style="margin:2px 0 0;">${list.length}${ev.maxVolunteers != null ? ' / ' + ev.maxVolunteers : ''} volunteered</p>
          </div>
          ${actionHtml}
        </div>
        ${namesHtml}
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="card" style="margin-top:10px;">
      <h3 style="margin-bottom:8px;">${escapeHtml(ev.name)}</h3>
      <p class="muted" style="margin:0 0 6px;">${escapeHtml(CATEGORY_LABELS[ev.category] || "")} · ${escapeHtml(ev.location || "")}</p>
      ${ev.pic ? `<p class="muted">PIC: ${escapeHtml(ev.pic)}</p>` : ""}
      ${ev.maxHours != null ? `<p class="muted">Max hours for this event: ${ev.maxHours}</p>` : ""}
      ${ev.compliance ? `<p class="muted" style="color:var(--red);">${escapeHtml(ev.compliance)}</p>` : ""}
    </div>
    ${dates.length ? `<h3 style="margin:16px 0 8px;">Dates</h3>${datesHtml}` : `<p class="muted">This event has no set dates.</p>`}`;

    el.querySelectorAll('[data-reserve-date]').forEach(btn => btn.addEventListener("click", () => reserveDate(ev, btn.dataset.reserveDate)));

  el.querySelectorAll('[data-cancel-date]').forEach(btn => btn.addEventListener("click", () => {
    const date = btn.dataset.cancelDate;
    const list = (ev.volunteersByDate || {})[date] || [];
    const entry = list.find(v => v.uid === currentUser.uid);
    if (entry) cancelReservation(ev, date, entry);
  }));

}

// ---------- CLOCK IN / OUT ----------
function renderClockCard() {
  const btn = document.getElementById("clockBtn");
  const label = document.getElementById("selectedEventLabel");

  if (openRecord) {
    const ev = allEvents.find(e => e.id === openRecord.eventId);
    btn.textContent = `Clock Out (${ev ? ev.name : "current shift"})`;
    btn.disabled = false;
    label.textContent = `Currently clocked in${ev ? " — " + ev.name : ""}.`;
    return;
  }

  const reservation = findTodaysReservation();
  if (reservation) {
    btn.textContent = `Clock In (${reservation.event.name})`;
    btn.disabled = false;
    label.textContent = `Today's reserved shift: ${reservation.event.name}`;
  } else {
    btn.textContent = "Clock In";
    btn.disabled = true;
    label.textContent = "Reserve a slot for today's date on an event above, then come back here.";
  }
}

document.getElementById("clockBtn").addEventListener("click", async () => {
  const btn = document.getElementById("clockBtn");
  const errEl = document.getElementById("clockError");
  errEl.textContent = "";
  btn.disabled = true;
  try {
    if (openRecord) {
      const timeOut = Date.now();
      const minutesElapsed = (timeOut - openRecord.timeIn) / 60000;

      if (minutesElapsed < MIN_MINUTES) {
        const remaining = Math.ceil(MIN_MINUTES - minutesElapsed);
        errEl.textContent = `You can clock out in about ${remaining} more minute(s). Minimum shift is ${MIN_MINUTES} minutes.`;
        btn.disabled = false;
        return;
      }

      const hours = +((timeOut - openRecord.timeIn) / 3600000).toFixed(2);
      await updateDoc(doc(db, "dutyRecords", openRecord.id), { timeOut, hours });
    } else {
      const reservation = findTodaysReservation();
      if (!reservation) { btn.disabled = false; return; }
      const ev = reservation.event;
      const now = new Date();
            await addDoc(collection(db, "dutyRecords"), {
        uid: currentUser.uid,
        studentNo: myProfile.studentNo,
        fullName: myProfile.fullName || myProfile.username,
        committee: myProfile.committee || "",
        eventId: ev.id,
        eventName: ev.name,
        shift: now.getHours() < 12 ? "AM" : "PM",
        date: reservation.date,
        timeIn: now.getTime(),
        timeOut: null,
        hours: null,
        pic: ev.pic || "",
        verified: false,
        createdAt: Date.now()
      });
    }
  } catch (err) {
    errEl.textContent = "Clock in/out failed: " + (err.code || err.message);
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
