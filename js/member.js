import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, collection, addDoc, updateDoc, increment, arrayUnion,
  onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";



let currentUser = null;
let myProfile = null;
let allEvents = [];
let myRecords = [];
let activeEventFilter = "all";     // for the "My Duty Logs" history tabs
let activeCategory = "clinic";     // for the "Available Events" tabs
let selectedEventId = null;        // event chosen from the list, used to clock in
let openRecord = null;             // the duty record currently clocked-in, if any
let selectedDate = null;           // chosen day, for multi-day events


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
      renderEventDetails();
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
    if (openRecord) return; // don't allow switching selection while clocked in
    selectedEventId = card.dataset.eventId;
    selectedDate = null;
    renderCategoryEvents();
    renderEventDetails();
    renderClockCard();
  }));


  renderEventDetails();
}

function renderEventDetails() {
  const el = document.getElementById("eventDetails");
  const ev = allEvents.find(e => e.id === selectedEventId);
  if (!ev) { el.innerHTML = ""; document.getElementById("dateChoice").innerHTML = ""; return; }

  const slotsLine = ev.maxVolunteers != null
    ? `<p class="muted">Slots: ${ev.signupCount || 0} / ${ev.maxVolunteers} filled (${Math.max(0, ev.maxVolunteers - (ev.signupCount || 0))} left)</p>`
    : "";

  const volunteers = ev.volunteers || [];
  const volunteersHtml = volunteers.length
    ? `<div style="margin-top:10px;"><p class="muted" style="margin-bottom:6px;">Who's volunteered (${volunteers.length}):</p>
        <ul style="margin:0;padding-left:18px;">
          ${volunteers.map(v => `<li>${escapeHtml(v.fullName || "")}${v.studentNo ? ` <span class="muted">(${escapeHtml(v.studentNo)})</span>` : ""}</li>`).join("")}
        </ul></div>`
    : `<p class="muted" style="margin-top:10px;">No one has signed up yet.</p>`;

  el.innerHTML = `
    <div class="card" style="margin-top:10px;">
      <h3 style="margin-bottom:8px;">${escapeHtml(ev.name)}</h3>
      <p class="muted" style="margin:0 0 6px;">${escapeHtml(CATEGORY_LABELS[ev.category] || "")} · ${escapeHtml(ev.location || "")}</p>
      ${ev.startDate ? `<p class="muted">Dates: ${escapeHtml(ev.startDate)}${ev.endDate && ev.endDate !== ev.startDate ? ' to ' + escapeHtml(ev.endDate) : ''}</p>` : ""}
      ${ev.pic ? `<p class="muted">PIC: ${escapeHtml(ev.pic)}</p>` : ""}
      ${ev.maxHours != null ? `<p class="muted">Max hours for this event: ${ev.maxHours}</p>` : ""}
      ${slotsLine}
      ${ev.compliance ? `<p class="muted" style="color:var(--red);">${escapeHtml(ev.compliance)}</p>` : ""}
      ${volunteersHtml}
    </div>`;

  renderDateChoice(ev);

}

function renderDateChoice(ev) {
  const el = document.getElementById("dateChoice");
  if (!ev.startDate || openRecord) { el.innerHTML = ""; return; }

  if (!selectedDate) selectedDate = ev.startDate;

  el.innerHTML = `
    <div class="card" style="margin-top:10px;">
      <label class="muted" style="display:block;margin-bottom:6px;">Which date are you volunteering?</label>
      <input type="date" id="shiftDate" min="${ev.startDate}" max="${ev.endDate || ev.startDate}" value="${selectedDate}">
    </div>`;

  document.getElementById("shiftDate").addEventListener("change", (e) => {
    selectedDate = e.target.value;
  });
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
  } else if (selectedEventId) {
    const ev = allEvents.find(e => e.id === selectedEventId);
    btn.textContent = "Clock In";
    btn.disabled = false;
    label.textContent = ev ? `Selected: ${ev.name}` : "Select an event above first.";
  } else {
    btn.textContent = "Clock In";
    btn.disabled = true;
    label.textContent = "Select an event above first.";
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
      selectedEventId = null;
    }     } else {
      if (!selectedEventId) { btn.disabled = false; return; }
      const ev = allEvents.find(e => e.id === selectedEventId);
      if (!ev) { btn.disabled = false; return; }

      if (ev.startDate && !selectedDate) {
        errEl.textContent = "Pick a date for this event first.";
        btn.disabled = false;
        return;
      }

      const now = new Date();
      await addDoc(collection(db, "dutyRecords"), {
        uid: currentUser.uid,
        studentNo: myProfile.studentNo,
        fullName: myProfile.fullName || myProfile.username,
        committee: myProfile.committee || "",
        eventId: selectedEventId,
        eventName: ev.name,
        shift: now.getHours() < 12 ? "AM" : "PM",
        date: selectedDate || null,
        timeIn: now.getTime(),
        timeOut: null,
        hours: null,
        pic: ev.pic || "",
        verified: false,
        createdAt: Date.now()
      });

      // First time signing up for this event? Add to the volunteer list, and
      // count a slot if this event has a max-volunteers cap.
      const alreadySignedUp = myRecords.some(r => r.eventId === selectedEventId);
      if (!alreadySignedUp) {
        const updates = {
          volunteers: arrayUnion({
            uid: currentUser.uid,
            fullName: myProfile.fullName || myProfile.username,
            studentNo: myProfile.studentNo || ""
          })
        };
        if (ev.maxVolunteers != null) updates.signupCount = increment(1);
        await updateDoc(doc(db, "events", selectedEventId), updates);
      }

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
