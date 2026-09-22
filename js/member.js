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
const EARLY_CLOCKIN_MINUTES = 30; // members can clock in this many minutes before their selected start time
const LATE_GRACE_MINUTES = 5;     // grace period after selected start time before a clock-in counts as "Late"
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
    <div class="event-list-item${selectedEventId === ev.id ? ' selected' : ''}" data-event-id="${ev.id}">
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
    const entry = list.find(v => v.uid === currentUser.uid);
    if (entry) return { event: ev, date: today, startTime: entry.startTime || null, endTime: entry.endTime || null };
  }
  return null;
}

// Builds a JS Date for a "YYYY-MM-DD" date + "HH:MM" 24-hour time.
function combineDateTime(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00`);
}

// 30-minute-increment time options between an event's dutyStart and dutyEnd.
function timeOptionsForEvent(ev) {
  if (!ev.dutyStart || !ev.dutyEnd) return [];
  const times = [];
  let [h, m] = ev.dutyStart.split(":").map(Number);
  const [endH, endM] = ev.dutyEnd.split(":").map(Number);
  while (h < endH || (h === endH && m <= endM)) {
    times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 30;
    if (m >= 60) { m -= 60; h += 1; }
  }
  return times;
}

// Minutes between two "HH:MM" 24-hour time strings.
function minutesBetween(startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}


async function reserveDate(ev, date, startTime, endTime) {
  const entry = {
    uid: currentUser.uid,
    fullName: myProfile.fullName || myProfile.username,
    studentNo: myProfile.studentNo || ""
  };
  if (startTime) entry.startTime = startTime;
  if (endTime) entry.endTime = endTime;

  await updateDoc(doc(db, "events", ev.id), {
    [`volunteersByDate.${date}`]: arrayUnion(entry)
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
  const timeOptions = timeOptionsForEvent(ev);
  const hasTimeRange = timeOptions.length > 1;

  const datesHtml = dates.map(date => {
    const list = volunteersByDate[date] || [];
    const full = ev.maxVolunteers != null && list.length >= ev.maxVolunteers;
    const myEntry = list.find(v => v.uid === currentUser.uid);
    const alreadyReserved = !!myEntry;
    const dateLabel = new Date(date + "T00:00:00").toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});

    const namesHtml = list.length
      ? `<p class="muted" style="margin:4px 0 0;font-size:.8rem;">${list.map(v => escapeHtml(v.fullName || "") + (v.startTime ? ` (${formatTime12(v.startTime)}–${formatTime12(v.endTime)})` : "")).join(", ")}</p>`
      : `<p class="muted" style="margin:4px 0 0;font-size:.8rem;">No one yet.</p>`;

    let actionHtml;
    if (alreadyReserved) {
      actionHtml = `<div style="text-align:right;">
          <span class="badge green">Reserved${myEntry.startTime ? `: ${formatTime12(myEntry.startTime)}–${formatTime12(myEntry.endTime)}` : ""}</span><br>
          <button class="danger" data-cancel-date="${date}" style="padding:4px 10px;font-size:.7rem;margin-top:4px;">Cancel</button>
        </div>`;
    } else if (full) {
      actionHtml = `<span class="badge red">Full</span>`;
    } else {
      actionHtml = `<button class="secondary" data-reserve-date="${date}" style="padding:6px 14px;">Reserve</button>`;
    }

    const timePickerHtml = (!alreadyReserved && !full && hasTimeRange) ? `
        <div class="row" style="margin-top:8px;">
          <select data-start-time="${date}">
            ${timeOptions.slice(0, -1).map(t => `<option value="${t}">${formatTime12(t)}</option>`).join("")}
          </select>
          <select data-end-time="${date}">
            ${timeOptions.slice(1).map(t => `<option value="${t}">${formatTime12(t)}</option>`).join("")}
          </select>
        </div>` : "";

    return `
      <div class="card" style="margin-bottom:8px;">
        <div class="row" style="align-items:center;">
          <div>
            <strong>${dateLabel}</strong>
            <p class="muted" style="margin:2px 0 0;">${list.length}${ev.maxVolunteers != null ? ' / ' + ev.maxVolunteers : ''} volunteered</p>
          </div>
          ${actionHtml}
        </div>
        ${timePickerHtml}
        ${namesHtml}
      </div>`;
  }).join("");

     el.innerHTML = `
    <hr class="section-divider">
    <div class="card event-detail-card" style="margin-top:10px;">
      <p class="eyebrow">Event Details</p>
      <h3 style="margin-bottom:8px;">${escapeHtml(ev.name)}</h3>
      <p class="muted" style="margin:0 0 6px;">${escapeHtml(CATEGORY_LABELS[ev.category] || "")} · ${escapeHtml(ev.location || "")}</p>
      ${ev.pic ? `<p class="muted">PIC: ${escapeHtml(ev.pic)}</p>` : ""}
      ${ev.maxHours != null ? `<p class="muted">Max hours for this event: ${ev.maxHours}</p>` : ""}
      ${ev.dutyStart && ev.dutyEnd ? `<p class="muted">Duty hours: ${formatTime12(ev.dutyStart)} – ${formatTime12(ev.dutyEnd)}</p>` : ""}
      ${ev.compliance ? `<p class="muted" style="color:var(--red);">${escapeHtml(ev.compliance)}</p>` : ""}
    </div>
    ${dates.length ? `<h3 style="margin:16px 0 8px;">Dates</h3>${datesHtml}` : `<p class="muted">This event has no set dates.</p>`}`;
  

  el.querySelectorAll('[data-reserve-date]').forEach(btn => btn.addEventListener("click", () => {
    const date = btn.dataset.reserveDate;
    const startSel = el.querySelector(`[data-start-time="${date}"]`);
    const endSel = el.querySelector(`[data-end-time="${date}"]`);
    const startTime = startSel ? startSel.value : null;
    const endTime = endSel ? endSel.value : null;
    if (startSel && endSel && minutesBetween(startTime, endTime) < 60) {
      alert("Please select a shift of at least 1 hour (60 minutes).");
      return;
    }
    reserveDate(ev, date, startTime, endTime);
  }));

  
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
  if (!reservation) {
    btn.textContent = "Clock In";
    btn.disabled = true;
    label.textContent = "Reserve a slot for today's date on an event above, then come back here.";
    return;
  }

  if (reservation.startTime) {
    const scheduledStart = combineDateTime(reservation.date, reservation.startTime);
    const earliestClockIn = new Date(scheduledStart.getTime() - EARLY_CLOCKIN_MINUTES * 60000);
    const timeRangeLabel = `${formatTime12(reservation.startTime)}–${formatTime12(reservation.endTime)}`;

    if (new Date() < earliestClockIn) {
      btn.textContent = `Clock In (${reservation.event.name})`;
      btn.disabled = true;
      label.textContent = `Today's reserved shift: ${reservation.event.name} (${timeRangeLabel}). You can clock in starting at ${earliestClockIn.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}.`;
      return;
    }

    btn.textContent = `Clock In (${reservation.event.name})`;
    btn.disabled = false;
    label.textContent = `Today's reserved shift: ${reservation.event.name} (${timeRangeLabel}).`;
  } else {
    btn.textContent = `Clock In (${reservation.event.name})`;
    btn.disabled = false;
    label.textContent = `Today's reserved shift: ${reservation.event.name}`;
  }
}

// Re-check every 30s so the button enables itself once a member crosses
// into their 30-minutes-early window, without needing a page refresh.
setInterval(renderClockCard, 30000);


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

      let late = false;
      if (reservation.startTime) {
        const scheduledStart = combineDateTime(reservation.date, reservation.startTime);
        const earliestClockIn = new Date(scheduledStart.getTime() - EARLY_CLOCKIN_MINUTES * 60000);
        const lateThreshold = new Date(scheduledStart.getTime() + LATE_GRACE_MINUTES * 60000);

        if (now < earliestClockIn) {
          errEl.textContent = `Too early to clock in. You can clock in starting at ${earliestClockIn.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}.`;
          btn.disabled = false;
          return;
        }
        late = now > lateThreshold;
      }

      await addDoc(collection(db, "dutyRecords"), {
        uid: currentUser.uid,
        studentNo: myProfile.studentNo,
        fullName: myProfile.fullName || myProfile.username,
        committee: myProfile.committee || "",
        eventId: ev.id,
        eventName: ev.name,
        shift: now.getHours() < 12 ? "AM" : "PM",
        shiftStart: reservation.startTime || null,
        shiftEnd: reservation.endTime || null,
        date: reservation.date,
        timeIn: now.getTime(),
        timeOut: null,
        hours: null,
        pic: ev.pic || "",
        verified: false,
        late,
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
      <p class="muted">Late Count: <strong style="color:var(--orange);">${myRecords.filter(r => r.late).length}</strong></p>
      <table>
        <tr><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th>Status</th></tr>
        ${filtered.map(r => `
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
      ${filtered.length === 0 ? `<p class="muted">No duty logs yet.</p>` : ""}
    </div>`;
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
