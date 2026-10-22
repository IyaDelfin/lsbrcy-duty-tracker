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
let expandedDate = null;           // date card currently expanded to show its hour-slot table
let openRecord = null;             // the duty record currently clocked-in, if any


const EARLY_CLOCKIN_MINUTES = 30; // members can clock in this many minutes before their selected start time
const LATE_GRACE_MINUTES = 5;     // grace period after selected start time before a clock-in counts as "Late"
const NO_SHOW_MINUTES = 15;       // if not clocked in this many minutes after start, the reservation is auto-cancelled as a No Show
const EARLY_CLOCKOUT_GRACE_MINUTES = 5; // members can clock out this many minutes before their scheduled end without it counting as "Early Out"
const CATEGORY_LABELS = { clinic: "Clinic Duty", office: "Office Duty" };

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "index.html"; return; }
  myProfile = snap.data();

  document.getElementById("memberName").textContent = myProfile.fullName || myProfile.username;
  document.getElementById("memberMetaChips").innerHTML =
    `<span class="hero-chip">ID: ${escapeHtml(myProfile.studentNo || "–")}</span><span class="hero-chip">${escapeHtml(myProfile.committee || "No committee")}</span>`;

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
  initAnnouncements();
  onSnapshot(query(collection(db, "events")), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategoryEvents();
    renderEventDetails();
    renderClockCard();
    renderWeeklyReservations();
  });

  // Security rules restrict this query to the signed-in user's own records.
  // Sorting is done client-side (no orderBy) to avoid needing a composite index.
  onSnapshot(
    query(collection(db, "dutyRecords"), where("uid", "==", currentUser.uid)),
    (snap) => {
      myRecords = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.createdAt - a.createdAt);
      openRecord = myRecords.find(r => r.timeIn != null && r.timeOut == null && !r.noShow) || null;
      myRecordsLoaded = true;
      updateTotalHours();
      renderClockCard();
      renderEventSubTabs();
      renderRecords();
      renderWeeklyReservations();
    }
  );
}


function updateTotalHours() {
  const total = myRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
  document.getElementById("totalHours").textContent = total.toFixed(1);
  const shiftsEl = document.getElementById("shiftCount");
  if (shiftsEl) shiftsEl.textContent = myRecords.filter(r => r.timeOut != null && !r.noShow).length;
}

// ---------- AVAILABLE EVENTS (category tabs + clickable list) ----------
// Open/closed state of each week section in the Available Events list
// (key -> true/false). Weeks not in here use their default (this/next week open).
const weekOpenState = {};

function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// Distinct locations across all of an event's dates (falls back to its basic location).
function eventLocationList(ev) {
  const set = [];
  eventDates(ev).forEach(d => locationsForDate(ev, d).forEach(l => { if (l && !set.includes(l)) set.push(l); }));
  if (!set.length && ev.location) set.push(ev.location);
  return set;
}

function renderCategoryEvents() {
  const listEl = document.getElementById("categoryEventsList");
  const active = allEvents.filter(e => e.status === "active" && !e.manualOnly && (e.category || "clinic") === activeCategory);

  if (!active.length) {
    listEl.innerHTML = `<p class="muted">No active events under ${CATEGORY_LABELS[activeCategory]} right now.</p>`;
    return;
  }

  // ---- group events by the week of their next upcoming date ----
  const today = todayStr();
  const thisMon = mondayOf(today);
  const nextMon = addDaysStr(thisMon, 7);
  const groups = {};
  active.forEach(ev => {
    const dates = eventDates(ev).slice().sort();
    let key, anchor = "";
    if (!dates.length) { key = "tba"; }
    else {
      anchor = dates.find(d => d >= today) || "";
      if (anchor) key = mondayOf(anchor);
      else { key = "earlier"; anchor = dates[dates.length - 1]; }
    }
    (groups[key] = groups[key] || []).push({ ev, anchor });
  });

  const weekKeys = Object.keys(groups).filter(k => k !== "earlier" && k !== "tba").sort();
  const orderedKeys = [...weekKeys, ...(groups.earlier ? ["earlier"] : []), ...(groups.tba ? ["tba"] : [])];
  const fmtMD = (d) => new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" });

  const cardHtml = ({ ev }) => {
    const sel = selectedEventId === ev.id;
    const vols = Object.values(ev.volunteersByDate || {}).reduce((s, a) => s + a.length, 0);
    const locs = eventLocationList(ev);
    const shownLocs = locs.slice(0, 3).map(l => locPill(l)).join("");
    const moreLocs = locs.length > 3 ? `<span style="margin-left:6px;color:var(--muted);font-size:.75rem;">+${locs.length - 3} more</span>` : "";
    const dateLine = formatEventDateRange(ev);
    return `
    <div class="event-list-item${sel ? ' selected' : ''}" data-event-id="${ev.id}" style="margin-bottom:8px;">
      <div class="row" style="align-items:center;">
        <div style="min-width:0;">
          <h3 style="margin-bottom:2px;">${escapeHtml(ev.name)}</h3>
          ${dateLine ? `<div style="margin:4px 0 0;font-size:.82rem;font-weight:600;">${escapeHtml(dateLine)}</div>` : ""}
          ${(shownLocs || moreLocs) ? `<div style="margin:6px 0 0 -6px;line-height:1.9;">${shownLocs}${moreLocs}</div>` : ""}
          <p class="muted" style="margin:4px 0 0;font-size:.78rem;">${vols} volunteer${vols === 1 ? '' : 's'}</p>
        </div>
        ${sel ? `<span class="badge red" style="flex:0 0 auto;">Selected</span>` : ""}
      </div>
    </div>`;
  };

  listEl.innerHTML = orderedKeys.map(key => {
    const items = groups[key].slice().sort((a, b) => (a.anchor || "9999").localeCompare(b.anchor || "9999") || a.ev.name.localeCompare(b.ev.name));
    let title, sub = "", defaultOpen;
    if (key === "tba") { title = "Dates to be announced"; defaultOpen = true; }
    else if (key === "earlier") { title = "Earlier"; sub = "dates already passed"; defaultOpen = false; }
    else {
      title = key === thisMon ? "This week" : key === nextMon ? "Next week" : `Week of ${fmtMD(key)}`;
      sub = `${fmtMD(key)} – ${fmtMD(addDaysStr(key, 6))}`;
      defaultOpen = key === thisMon || key === nextMon;
    }
    const hasSelected = items.some(i => i.ev.id === selectedEventId);
    const open = hasSelected ? true : (key in weekOpenState ? weekOpenState[key] : defaultOpen);
    return `
    <div class="wk-group">
      <div class="wk-head" data-week-toggle="${key}" style="display:flex;align-items:center;gap:10px;padding:10px 4px;margin:6px 0 8px;border-bottom:1px solid var(--border);cursor:pointer;">
        <span style="color:var(--red);font-size:.8rem;width:12px;">${open ? "▾" : "▸"}</span>
        <strong style="font-size:.95rem;">${title}</strong>
        <span style="color:var(--muted);font-size:.78rem;">${sub}</span>
        <span style="margin-left:auto;background:var(--card-2);border:1px solid var(--border);color:var(--muted);font-size:.72rem;padding:1px 9px;border-radius:999px;">${items.length} event${items.length === 1 ? "" : "s"}</span>
      </div>
      ${open ? items.map(cardHtml).join("") : ""}
    </div>`;
  }).join("");

  listEl.querySelectorAll('[data-week-toggle]').forEach(h => h.addEventListener("click", () => {
    const key = h.dataset.weekToggle;
    const isOpen = h.querySelector("span").textContent.trim() === "▾";
    weekOpenState[key] = !isOpen;
    renderCategoryEvents();
  }));

  listEl.querySelectorAll('[data-event-id]').forEach(card => card.addEventListener("click", () => {
    selectedEventId = card.dataset.eventId;
    expandedDate = null;
    renderCategoryEvents();
    renderEventDetails();
  }));
}

// ---------- SMALL UI HELPERS ----------
function fmtClock(ts) {
  return ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–";
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtCountdown(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDate(dateStr, withYear) {
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (withYear) opts.year = "numeric";
  return new Date(dateStr + "T00:00:00").toLocaleDateString([], opts);
}

function locPill(loc) {
  return loc ? `<span class="loc-pill">📍 ${escapeHtml(loc)}</span>` : "";
}

// Lines of "Mon, Oct 19 – Tue, Oct 20  📍 Location". Uses each date's own
// location (an override block's location, else the event's basic location);
// consecutive dates sharing a location are merged into one range.
function formatEventDatesWithLocation(ev) {
  const dates = eventDates(ev);
  if (!dates.length) return locPill((ev.location || "").trim());
  const nextDay = (d) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return ymd(x); };
  const groups = [];
  dates.forEach(d => {
    const key = locationsForDate(ev, d).join(" / ");
    const last = groups[groups.length - 1];
    if (last && last.key === key && nextDay(last.end) === d) last.end = d;
    else groups.push({ start: d, end: d, key });
  });
  return groups.map(g => {
    const label = g.start === g.end ? shortDate(g.start) : `${shortDate(g.start)} – ${shortDate(g.end)}`;
    return `<div style="margin-bottom:4px;">${escapeHtml(label)}${locPill(g.key)}</div>`;
  }).join("");
}

// The member's soonest reservation after today (for the clock card's "next up").
function findNextReservation() {
  const today = todayStr();
  let best = null;
  for (const ev of allEvents) {
    const vbd = ev.volunteersByDate || {};
    for (const date in vbd) {
      if (date <= today) continue;
      const entry = (vbd[date] || []).find(v => v.uid === currentUser.uid);
      if (!entry) continue;
      const cand = { event: ev, date, startTime: entry.startTime || "", endTime: entry.endTime || "", location: entry.location || ev.location || "" };
      if (!best || date < best.date || (date === best.date && cand.startTime < best.startTime)) best = cand;
    }
  }
  return best;
}

// ---------- DATE HELPERS ----------
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Dates this event runs on. Normally every day from startDate to endDate;
// with "overridesOnly" set, just the dates that have a per-date override
// (so a non-consecutive event like Oct 19 + Oct 21 skips Oct 20).
function eventDates(ev) {
  if (ev.overridesOnly && ev.dateOverrides) {
    const keys = Object.keys(ev.dateOverrides).sort();
    if (keys.length) return keys;
  }
  return ev.startDate ? dateRange(ev.startDate, ev.endDate) : [];
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

// "Mon, Oct 19 – Wed, Oct 21" (or just "Mon, Oct 19" for a one-day event)
// summary of an event's date range, for display on event cards.
function formatEventDateRange(ev) {
  if (ev.overridesOnly && ev.dateOverrides) {
    const ds = Object.keys(ev.dateOverrides).sort();
    if (ds.length) return ds.map(d => new Date(d + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })).join(" · ");
  }
  if (!ev.startDate) return "";
  const startLabel = new Date(ev.startDate + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  if (!ev.endDate || ev.endDate === ev.startDate) return startLabel;
  const endLabel = new Date(ev.endDate + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}`;
}


function findTodaysReservation() {
  const today = todayStr();
  const candidates = [];
  for (const ev of allEvents) {
    const list = (ev.volunteersByDate || {})[today] || [];
    const entry = list.find(v => v.uid === currentUser.uid);
    if (!entry) continue;
    // Skip a reservation already completed today (clocked out) — otherwise
    // the card gets stuck re-offering a finished shift and can never move
    // on to a different event reserved for the same day.
    const alreadyDone = myRecords.some(r => r.eventId === ev.id && r.date === today && r.timeOut != null);
    if (alreadyDone) continue;
    candidates.push({ event: ev, date: today, startTime: entry.startTime || null, endTime: entry.endTime || null, location: entry.location || ev.location || "" });
  }
  if (!candidates.length) return null;
  // Earliest shift first; but prefer whichever event you currently have
  // selected in the list, if it's among today's still-open reservations.
  candidates.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  return candidates.find(c => c.event.id === selectedEventId) || candidates[0];
}

// Monday-to-Sunday range containing `date` (defaults to today).
function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

// Live reservations for this member within the current week. A reservation
// drops off once there's a dutyRecord for that event+date that's clocked
// out or a no-show (early-out/no-show already clear the underlying
// volunteersByDate entry too — this also covers a normal, on-time clock-out,
// which doesn't remove that entry).
function renderWeeklyReservations() {
  const el = document.getElementById("weeklyReservations");
  if (!el) return;

  const { start, end } = getWeekRange();
  const today = todayStr();
  const items = [];

  for (const ev of allEvents) {
    const volunteersByDate = ev.volunteersByDate || {};
    for (const date in volunteersByDate) {
      const dateObj = new Date(date + "T00:00:00");
      if (dateObj < start || dateObj > end) continue;

      const entry = (volunteersByDate[date] || []).find(v => v.uid === currentUser.uid);
      if (!entry) continue;

      const record = myRecords.find(r => r.eventId === ev.id && r.date === date);
      if (record && (record.timeOut != null || record.noShow)) continue;

      items.push({ ev, date, entry, onDuty: !!(record && record.timeOut == null) });
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || (a.entry.startTime || "").localeCompare(b.entry.startTime || ""));

  const rangeLabel = `${start.toLocaleDateString([], { month: "short", day: "numeric" })} – ${end.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const head = `
    <div class="sec-head">
      <h3 style="margin:0;">This Week</h3>
      <span class="sec-sub">${rangeLabel} · ${items.length} reservation${items.length === 1 ? "" : "s"}</span>
    </div>`;

  if (!items.length) {
    el.innerHTML = head + `<div class="empty-state">No reservations this week.<br><span>Pick an event below to reserve a shift.</span></div>`;
    return;
  }

  el.innerHTML = head + items.map(({ ev, date, entry, onDuty }) => {
    const d = new Date(date + "T00:00:00");
    const dow = d.toLocaleDateString([], { weekday: "short" });
    const isToday = date === today;
    const loc = entry.location || ev.location || "";
    const timeText = entry.startTime ? `${formatTime12(entry.startTime)} – ${formatTime12(entry.endTime)}` : "Any time";
    const badge = onDuty ? `<span class="badge blue">On Duty</span>`
      : isToday ? `<span class="badge orange">Today</span>`
      : `<span class="badge green">Reserved</span>`;
    return `
      <div class="res-item${isToday ? " today" : ""}">
        <div class="res-date"><span>${dow}</span><strong>${d.getDate()}</strong></div>
        <div class="res-main">
          <div class="res-title">${escapeHtml(ev.name)}</div>
          <div class="res-sub">${timeText}${locPill(loc)}</div>
        </div>
        <div class="res-side">
          ${badge}
          ${onDuty ? "" : `<button class="danger res-cancel" data-cancel-ev="${ev.id}" data-cancel-date="${date}">Cancel</button>`}
        </div>
      </div>`;
  }).join("");

  el.querySelectorAll("[data-cancel-ev]").forEach(btn => btn.addEventListener("click", async () => {
    const ev = allEvents.find(e => e.id === btn.dataset.cancelEv);
    const date = btn.dataset.cancelDate;
    if (!ev) return;
    const entry = ((ev.volunteersByDate || {})[date] || []).find(v => v.uid === currentUser.uid);
    if (!entry) return;
    if (!confirm(`Cancel your reservation for ${ev.name} on ${shortDate(date)}?`)) return;
    btn.disabled = true;
    try { await cancelReservation(ev, date, entry); }
    catch (err) { alert("Could not cancel: " + (err.code || err.message)); btn.disabled = false; }
  }));
}

// How many dates this member has already reserved/attempted on this event — counts
// current live reservations AND any past dutyRecords (even ones whose reservation
// was later auto-removed, e.g. an early-out or a no-show). This stops a member from
// clocking in/out repeatedly to free up slots and reserve past their per-member limit.
function memberReservationCountForEvent(ev) {
  const volunteersByDate = ev.volunteersByDate || {};
  const dateSet = new Set();
  for (const date in volunteersByDate) {
    if ((volunteersByDate[date] || []).some(v => v.uid === currentUser.uid)) dateSet.add(date);
  }
  myRecords.filter(r => r.eventId === ev.id).forEach(r => { if (r.date) dateSet.add(r.date); });
  return dateSet.size;
}

// ---------- NO-SHOW SWEEP ----------
// Auto-cancels a reservation the member never clocked in for, more than
// NO_SHOW_MINUTES after their selected start time — freeing the slot for
// others — and leaves behind a "No Show" duty record so it still counts
// toward their per-member reservation limit on this event.

// Shows a visible error (under the Clock In button) instead of failing silently.
function reportNoShowError(step, err) {
  console.error("No-show sweep failed while " + step + ":", err);
  const el = document.getElementById("clockError");
  if (el) el.textContent = "No-show check failed (" + step + "): " + (err.code || err.message);
}

let myRecordsLoaded = false;    // true once the duty-records listener has delivered data
let noShowSweepRunning = false; // stops two sweeps overlapping (would double-create records)

async function checkNoShowReservations() {
  if (!currentUser || !myProfile || !myRecordsLoaded || noShowSweepRunning) return;
  noShowSweepRunning = true;
  try { await runNoShowSweep(); }
  finally { noShowSweepRunning = false; }
}

async function runNoShowSweep() {
  const now = Date.now();

  for (const ev of allEvents) {
    const volunteersByDate = ev.volunteersByDate || {};
    for (const date in volunteersByDate) {
      const list = volunteersByDate[date] || [];
      const entry = list.find(v => v.uid === currentUser.uid);
      if (!entry || !entry.startTime) continue;

      const existing = myRecords.find(r => r.eventId === ev.id && r.date === date);
      if (existing && !existing.noShow) continue; // they showed up (clocked in) — nothing to do
      if (existing && existing.noShow) {
        // A no-show record was already saved but the reservation never got
        // removed (the cancel step failed earlier) — finish the job.
        try { await cancelReservation(ev, date, entry); }
        catch (err) { reportNoShowError("removing the reservation", err); }
        continue;
      }

      const scheduledStart = combineDateTime(date, entry.startTime);
      const noShowThreshold = scheduledStart.getTime() + NO_SHOW_MINUTES * 60000;
      if (now < noShowThreshold) continue;

      try {
        await addDoc(collection(db, "dutyRecords"), {
          uid: currentUser.uid,
          studentNo: myProfile.studentNo || "",
          fullName: myProfile.fullName || myProfile.username || "",
          committee: myProfile.committee || "",
          eventId: ev.id,
          eventName: ev.name,
          shift: null,
          shiftStart: entry.startTime || null,
          shiftEnd: entry.endTime || null,
          date,
          timeIn: null,
          timeOut: null,
          hours: 0,
          pic: ev.pic || "",
          verified: false,
          late: false,
          earlyOut: false,
          noShow: true,
          createdAt: Date.now()
        });
        await cancelReservation(ev, date, entry);
      } catch (err) {
        reportNoShowError("auto-cancelling a no-show", err);
      }
    }
  }
}

setInterval(checkNoShowReservations, 60000);
// Phones pause timers while the screen is off / the tab is hidden, so also
// check the moment the page comes back to the foreground.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkNoShowReservations();
});

// Builds a JS Date for a "YYYY-MM-DD" date + "HH:MM" 24-hour time.
function combineDateTime(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00`);
}

// This event's duty time windows (each as {start, end, location}) for a
// specific date — using that date's per-date schedule override if the
// event has one, otherwise the event's regular timeWindows. A block's
// location defaults to the event's own `location` field when left blank.
// Falls back to the old single dutyStart/dutyEnd pair for events created
// before split time windows existed. Call without a date (or with a date
// that has no override) to get the event's default windows.
function timeWindowsForEvent(ev, date) {
  const overrides = date && ev.dateOverrides && ev.dateOverrides[date];
  let windows;
  if (overrides && overrides.length) {
    windows = overrides;
  } else if (Array.isArray(ev.timeWindows) && ev.timeWindows.length) {
    windows = ev.timeWindows;
  } else if (ev.dutyStart && ev.dutyEnd) {
    windows = [{ start: ev.dutyStart, end: ev.dutyEnd }];
  } else {
    windows = [];
  }
  return windows.map(w => ({ start: w.start, end: w.end, location: (w.location && w.location.trim()) || ev.location || "", pic: (w.pic || "").trim() }));
}

// 30-minute-increment time options within a single {start,end} window.
function timeOptionsForWindow(win) {
  const times = [];
  let [h, m] = win.start.split(":").map(Number);
  const [endH, endM] = win.end.split(":").map(Number);
  while (h < endH || (h === endH && m <= endM)) {
    times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 30;
    if (m >= 60) { m -= 60; h += 1; }
  }
  return times;
}

// The date's windows, limited to one location when `loc` is given.
function windowsAt(ev, date, loc) {
  const wins = timeWindowsForEvent(ev, date);
  return loc ? wins.filter(w => w.location === loc) : wins;
}

// Distinct locations offered on a date (the picker only shows when > 1).
function locationsForDate(ev, date) {
  return [...new Set(timeWindowsForEvent(ev, date).map(w => w.location).filter(Boolean))];
}

// All start/end time options across every one of the event's windows for
// a given date — e.g. two separate blocks of options for a 7–10 AM / 1–5 PM
// split shift.
function timeOptionsForEvent(ev, date) {
  return timeWindowsForEvent(ev, date).flatMap(timeOptionsForWindow);
}

// Valid shift-start options for a given date: every window's own times,
// minus each window's final time (can't start a shift with nowhere left
// to go in that window).
function startTimeOptionsForEvent(ev, date, loc) {
  const all = windowsAt(ev, date, loc).flatMap(w => timeOptionsForWindow(w).slice(0, -1));
  // De-duplicate (overlapping windows would otherwise list the same time twice) and sort.
  return [...new Set(all)].sort();
}

// The specific window a given start time falls under on a given date, so
// end-time options never cross into an unrelated block (e.g. a 9:30 AM
// start in a 7–10 AM window offers 10:00 AM as the latest end, never
// jumping to a 1–5 PM block).
function windowContaining(ev, time, date, loc) {
  const wins = windowsAt(ev, date, loc);
  // Prefer a window where this time is NOT the last option, so a start time that
  // is also the END of another window (e.g. 5:00 PM ending a 12–5 PM block while
  // starting a 5–9 PM block) picks the window it can actually start in.
  return wins.find(w => { const t = timeOptionsForWindow(w); return t.includes(time) && t[t.length - 1] !== time; })
      || wins.find(w => timeOptionsForWindow(w).includes(time));
}

// End-time options after `startTime` on a given date, confined to the same
// window as the start and capped so the shift never exceeds the event's
// max hours.
function endTimeOptions(ev, startTime, date, loc) {
  // Union of the later times from EVERY window this start time can begin in
  // (overlapping windows, e.g. two locations at the same hours, both count).
  let after = [];
  for (const w of windowsAt(ev, date, loc)) {
    const winTimes = timeOptionsForWindow(w);
    const idx = winTimes.indexOf(startTime);
    if (idx !== -1) after.push(...winTimes.slice(idx + 1));
  }
  after = [...new Set(after)].sort();
  if (ev.maxHours != null) after = after.filter(t => minutesBetween(startTime, t) <= ev.maxHours * 60);
  return after;
}

// "7:00 AM – 10:00 AM, 1:00 PM – 5:00 PM" style summary of an event's
// duty time windows, for display.
function formatTimeWindows(ev) {
  return timeWindowsForEvent(ev).map(w => `${formatTime12(w.start)} – ${formatTime12(w.end)}`).join(", ");
}

// Minutes between two "HH:MM" 24-hour time strings.
function minutesBetween(startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

// Builds 30-minute blocks across all of an event's duty time windows —
// matching the same granularity members pick start/end times in, so a
// reservation like 10:30–11:30 only ever occupies the half-hour blocks
// it actually covers, instead of blocking out two full clock hours.
function hourSlotsForEvent(ev, date) {
  const slots = [];
  for (const win of timeWindowsForEvent(ev, date)) {
    const opts = timeOptionsForWindow(win);
    for (let i = 0; i < opts.length - 1; i++) {
      slots.push({ start: opts[i], end: opts[i + 1], location: win.location, pic: win.pic });
    }
  }
  return slots;
}


// Renders the per-date volunteer list as a stack of blue slot cards (one
// per 30-minute block within the event's duty time windows), each a
// header row of the time + occupancy, followed by the volunteers whose
// reserved range overlaps that block. Falls back to a flat name list for
// events with no duty-time range set.
function renderHourSlotTable(ev, list, date) {
  const slots = hourSlotsForEvent(ev, date);
  if (!slots.length) {
    return list.length
      ? `<p class="muted" style="margin:4px 0 0;font-size:.8rem;">${list.map(v => escapeHtml(v.fullName || "")).join(", ")}</p>`
      : `<p class="muted" style="margin:4px 0 0;font-size:.8rem;">No one yet.</p>`;
  }

  // Merge each clock hour's two 30-min slots into one display row when
  // they'd show the exact same people in the exact same location (the
  // common case) — but keep them split into two half-hour rows whenever a
  // reservation starts or ends on that half-hour mark (e.g. 10:30-11:30),
  // so a partial-hour booking doesn't visually "claim" the whole hour.
  // Only count a volunteer toward a slot's location if they picked that location
  // (older reservations with no location still count everywhere).
  const occupantsOf = (slot) => list.filter(v => v.startTime && v.endTime && v.startTime < slot.end && v.endTime > slot.start && (!v.location || !slot.location || v.location === slot.location));
  const sameOccupants = (a, b) => {
    const au = a.map(v => v.uid).sort();
    const bu = b.map(v => v.uid).sort();
    return au.length === bu.length && au.every((u, idx) => u === bu[idx]);
  };
  const rows = [];
  for (let i = 0; i < slots.length; i += 2) {
    const hourIndex = i / 2;
    const a = slots[i], b = slots[i + 1];
    const inA = occupantsOf(a);
    if (!b) { rows.push({ start: a.start, end: a.end, occupants: inA, hourIndex, location: a.location, pic: a.pic }); continue; }
    const inB = occupantsOf(b);
    if (sameOccupants(inA, inB) && a.location === b.location && a.pic === b.pic) {
      rows.push({ start: a.start, end: b.end, occupants: inA, hourIndex, location: a.location, pic: a.pic });
    } else {
      rows.push({ start: a.start, end: a.end, occupants: inA, hourIndex, location: a.location, pic: a.pic });
      rows.push({ start: b.start, end: b.end, occupants: inB, hourIndex, location: b.location, pic: b.pic });
    }
  }

  return `
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
      ${rows.map(row => {
        const isFull = ev.maxVolunteers != null && row.occupants.length >= ev.maxVolunteers;
        const accent = isFull ? '239,68,68' : '59,130,246'; // red once the slot hits its max-volunteers cap
        const capLabel = ev.maxVolunteers != null ? `${row.occupants.length}/${ev.maxVolunteers}` : `${row.occupants.length}`;
        return `
          <div style="background:rgba(${accent},.06);border:1px solid rgba(${accent},.25);border-left:3px solid rgba(${accent},.8);border-radius:8px;padding:8px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:.82rem;font-weight:600;color:var(--text);">${row.location ? `<span style="background:rgba(217,51,46,.15);color:var(--red);padding:2px 8px;border-radius:6px;margin-right:8px;font-weight:700;">${escapeHtml(row.location)}</span>` : ''}${formatTime12(row.start)} – ${formatTime12(row.end)}${row.pic ? `<span style="margin-left:10px;font-weight:500;color:var(--muted);">PIC: ${escapeHtml(row.pic)}</span>` : ''}</span>
              <span style="font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:999px;${isFull ? 'background:var(--red);color:#fff;' : 'background:rgba(255,255,255,.06);color:var(--muted);'}">${isFull ? '⚠ Full' : capLabel}</span>
            </div>
            ${row.occupants.length ? `
              <div style="margin-top:6px;border-top:1px solid var(--border);">
                ${row.occupants.map(v => `
                  <div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;font-size:.8rem;border-bottom:1px solid var(--border);">
                    <span style="color:var(--text);">${escapeHtml(v.fullName || "")}</span>
                    <span class="muted">${escapeHtml(v.committee || "")}</span>
                  </div>`).join("")}
              </div>` : `<p class="muted" style="margin:6px 0 0;font-size:.76rem;">No one yet.</p>`}
          </div>`;
      }).join("")}
    </div>`;
}


// True if every hour this [startTime, endTime) range touches still has
// room under the event's max-volunteers-per-hour cap (no cap set = always ok).
function hourCapacityOk(ev, list, startTime, endTime, date, loc) {
  if (ev.maxVolunteers == null) return true;
  for (const slot of hourSlotsForEvent(ev, date)) {
    if (!(startTime < slot.end && endTime > slot.start)) continue;
    if (loc && slot.location !== loc) continue;
    const count = list.filter(v => v.startTime && v.endTime && v.startTime < slot.end && v.endTime > slot.start && (!v.location || !slot.location || v.location === slot.location)).length;
    if (count >= ev.maxVolunteers) return false;
  }
  return true;
}


// True if the member already has a timed reservation on `date` (on any
// other event) whose [start, end) overlaps the newly requested range.
function hasOverlappingReservation(date, startTime, endTime, excludeEventId) {
  if (!startTime || !endTime) return false;
  const newStart = combineDateTime(date, startTime).getTime();
  const newEnd = combineDateTime(date, endTime).getTime();
  for (const ev of allEvents) {
    if (ev.id === excludeEventId) continue;
    const list = (ev.volunteersByDate || {})[date] || [];
    for (const entry of list) {
      if (entry.uid !== currentUser.uid || !entry.startTime || !entry.endTime) continue;
      const existStart = combineDateTime(date, entry.startTime).getTime();
      const existEnd = combineDateTime(date, entry.endTime).getTime();
      if (newStart < existEnd && existStart < newEnd) return true;
    }
  }
  return false;
}


// True if the signed-in member already holds a reservation on `date` for
// this event — regardless of time block or location (1 per date per event).
// Reads the live copy of the event so a stale card can't slip past it.
function hasReservationOnDate(ev, date) {
  const live = allEvents.find(e => e.id === ev.id) || ev;
  const list = (live.volunteersByDate || {})[date] || [];
  return list.some(v => v.uid === currentUser.uid);
}


async function reserveDate(ev, date, startTime, endTime, loc) {
  const entry = {
    uid: currentUser.uid,
    fullName: myProfile.fullName || myProfile.username,
    studentNo: myProfile.studentNo || "",
    committee: myProfile.committee || ""
  };
  if (startTime) entry.startTime = startTime;
  if (endTime) entry.endTime = endTime;
  if (startTime) {
    const win = windowContaining(ev, startTime, date, loc);
    if (loc) entry.location = loc;
    else if (win && win.location) entry.location = win.location;
  }

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
  const dates = eventDates(ev);
  const myReservationCount = memberReservationCountForEvent(ev);
  const atMemberLimit = ev.maxPerMember != null && myReservationCount >= ev.maxPerMember;
  const today = todayStr();

  const datesHtml = dates.map(date => {
    const list = volunteersByDate[date] || [];
    const timeOptions = timeOptionsForEvent(ev, date);
    const hasTimeRange = timeOptions.length > 1;
    const full = ev.maxVolunteers != null && !hasTimeRange && list.length >= ev.maxVolunteers;

    const myEntry = list.find(v => v.uid === currentUser.uid);
    const alreadyReserved = !!myEntry;
    const isActiveShift = !!(openRecord && openRecord.eventId === ev.id && openRecord.date === date);
    const isPastDate = date < today; // "YYYY-MM-DD" strings compare correctly lexically
    const dateLabel = new Date(date + "T00:00:00").toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});

    // Today's start options drop any time that's already passed.
    // Start times still bookable (today: not yet passed), optionally for one location.
    const futureStarts = (loc) => startTimeOptionsForEvent(ev, date, loc).filter(t =>
      date !== today || combineDateTime(date, t).getTime() > Date.now()
    );
    const dateLocs = locationsForDate(ev, date);
    // Only locations that still have a bookable time (e.g. by 12 NN the morning
    // Grandstand blocks are over, so default to the next location instead).
    const availableLocs = dateLocs.filter(l => futureStarts(l).length > 0);
    const defaultLoc = dateLocs.length > 1 ? (availableLocs[0] || dateLocs[0]) : null;
    const startOptionsForDate = futureStarts(defaultLoc);
    // "Time Passed" only when NO location has any time left today.
    const pastCutoffToday = hasTimeRange && date === today && futureStarts(null).length === 0;
    const defaultStart = startOptionsForDate[0];
    const endOptionsForDefaultStart = defaultStart ? endTimeOptions(ev, defaultStart, date, defaultLoc) : [];

    const namesHtml = renderHourSlotTable(ev, list, date);

    let actionHtml;
    if (alreadyReserved) {
      actionHtml = `<div style="text-align:right;">
          <span class="badge green">Reserved${myEntry.startTime ? `: ${formatTime12(myEntry.startTime)}–${formatTime12(myEntry.endTime)}` : ""}${myEntry.location ? ` · ${escapeHtml(myEntry.location)}` : ""}</span><br>
          ${isActiveShift
            ? `<p class="muted" style="margin:4px 0 0;font-size:.7rem;">Currently on duty</p>`
            : `<button class="danger" data-cancel-date="${date}" style="padding:4px 10px;font-size:.7rem;margin-top:4px;">Cancel</button>`}
        </div>`;
    } else if (full) {
      actionHtml = `<span class="badge red">Full</span>`;
    } else if (atMemberLimit) {
      actionHtml = `<span class="badge red">Limit Reached</span>`;
    } else if (isPastDate) {
      actionHtml = `<span class="badge red">Past</span>`;
    } else if (pastCutoffToday) {
      actionHtml = `<span class="badge red">Time Passed</span>`;
    } else {
      actionHtml = `<button class="secondary" data-reserve-date="${date}" style="padding:6px 14px;">Reserve</button>`;
    }

    const timePickerHtml = (!alreadyReserved && !full && !atMemberLimit && !isPastDate && !pastCutoffToday && hasTimeRange) ? `
        ${locationsForDate(ev, date).length > 1 ? `
        <div class="row" style="margin-top:8px;">
          <select data-location-pick="${date}">
            ${(availableLocs.length ? availableLocs : dateLocs).map(l => `<option value="${escapeHtml(l)}"${l === defaultLoc ? ' selected' : ''}>${escapeHtml(l)}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="row" style="margin-top:8px;">
          <select data-start-time="${date}">
            ${startOptionsForDate.map(t => `<option value="${t}">${formatTime12(t)}</option>`).join("")}
          </select>
          <select data-end-time="${date}">
            ${endOptionsForDefaultStart.map(t => `<option value="${t}">${formatTime12(t)}</option>`).join("")}
          </select>
        </div>` : "";

    const isExpanded = expandedDate === date;

    return `
      <div class="card" style="margin-bottom:8px;${isExpanded ? 'border-color:var(--orange);' : ''}">
        <div class="row" style="align-items:center;">
          <div data-toggle-date="${date}" style="cursor:pointer;">
            <strong style="${isExpanded ? 'color:var(--orange);' : ''}">${dateLabel}</strong>${locPill(locationsForDate(ev, date).join(" / "))}
            ${(ev.dateOverrides && ev.dateOverrides[date] && ev.dateOverrides[date].length) ? `<span class="badge orange" style="margin-left:4px;font-size:.65rem;">Custom schedule</span>` : ''}
            ${hasTimeRange ? `<span class="muted" style="font-size:.7rem;margin-left:4px;">${isExpanded ? '▲ hide slots' : '▼ view slots'}</span>` : ''}

            <p class="muted" style="margin:2px 0 0;">${list.length}${ev.maxVolunteers != null && !hasTimeRange ? ' / ' + ev.maxVolunteers : ''} volunteered</p>
          </div>
          ${actionHtml}
        </div>
        ${timePickerHtml}
        ${hasTimeRange ? (isExpanded ? namesHtml : '') : namesHtml}
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
      ${formatTimeWindows(ev) ? `<p class="muted">Duty hours: ${formatTimeWindows(ev)}</p>` : ""}
      ${ev.maxPerMember != null ? `<p class="muted">Your reservations for this event: <strong style="color:${atMemberLimit ? 'var(--red)' : 'var(--text)'};">${myReservationCount} / ${ev.maxPerMember}</strong></p>` : ""}
      ${ev.compliance ? `<p class="muted" style="color:var(--red);">${escapeHtml(ev.compliance)}</p>` : ""}
    </div>
    ${dates.length ? `<h3 style="margin:16px 0 8px;">Dates</h3>${datesHtml}` : `<p class="muted">This event has no set dates.</p>`}`;

  el.querySelectorAll('[data-toggle-date]').forEach(div => div.addEventListener("click", () => {
    const date = div.dataset.toggleDate;
    expandedDate = expandedDate === date ? null : date;
    renderEventDetails();
  }));

  const selectedLoc = (date) => {
    const s = el.querySelector(`[data-location-pick="${date}"]`);
    return s ? s.value : null;
  };
  const fillEndOptions = (date) => {
    const startSel = el.querySelector(`[data-start-time="${date}"]`);
    const endSel = el.querySelector(`[data-end-time="${date}"]`);
    if (!startSel || !endSel) return;
    endSel.innerHTML = endTimeOptions(ev, startSel.value, date, selectedLoc(date))
      .map(t => `<option value="${t}">${formatTime12(t)}</option>`).join("");
  };
  el.querySelectorAll('[data-start-time]').forEach(startSel => startSel.addEventListener("change", () => {
    fillEndOptions(startSel.dataset.startTime);
  }));
  // Changing the location rebuilds the start/end times for that location only.
  el.querySelectorAll('[data-location-pick]').forEach(locSel => locSel.addEventListener("change", () => {
    const date = locSel.dataset.locationPick;
    const startSel = el.querySelector(`[data-start-time="${date}"]`);
    if (!startSel) return;
    const today = todayStr();
    startSel.innerHTML = startTimeOptionsForEvent(ev, date, locSel.value)
      .filter(t => date !== today || combineDateTime(date, t).getTime() > Date.now())
      .map(t => `<option value="${t}">${formatTime12(t)}</option>`).join("");
    fillEndOptions(date);
  }));


  el.querySelectorAll('[data-reserve-date]').forEach(btn => btn.addEventListener("click", () => {
    const date = btn.dataset.reserveDate;
    const startSel = el.querySelector(`[data-start-time="${date}"]`);
    const endSel = el.querySelector(`[data-end-time="${date}"]`);
    const startTime = startSel ? startSel.value : null;
    const endTime = endSel ? endSel.value : null;
    const loc = selectedLoc(date);
    if (hasReservationOnDate(ev, date)) {
      alert("You already have a reservation on this date for this event. Only 1 reservation per date is allowed.");
      return;
    }
    if (startSel && endSel) {
      if (!startTime || !endTime) {
        alert("No available time left for this location. Please pick another location or date.");
        return;
      }
      const duration = minutesBetween(startTime, endTime);
      if (duration < 60) {
        alert("Please select a shift of at least 1 hour (60 minutes).");
        return;
      }
      if (ev.maxHours != null && duration > ev.maxHours * 60) {
        alert(`This event's max shift length is ${ev.maxHours} hour${ev.maxHours === 1 ? "" : "s"}.`);
        return;
      }
      if (hasOverlappingReservation(date, startTime, endTime, ev.id)) {
        alert("You already have a reservation that overlaps with this time on this date.");
        return;
      }
      const dateList = (ev.volunteersByDate || {})[date] || [];
      if (!hourCapacityOk(ev, dateList, startTime, endTime, date, loc)) {
        alert(`One or more hours in this range are already full (max ${ev.maxVolunteers} per hour).`);
        return;
      }

    }
    reserveDate(ev, date, startTime, endTime, loc);

  }));

  el.querySelectorAll('[data-cancel-date]').forEach(btn => btn.addEventListener("click", () => {
    const date = btn.dataset.cancelDate;
    const list = (ev.volunteersByDate || {})[date] || [];
    const entry = list.find(v => v.uid === currentUser.uid);
    if (entry) cancelReservation(ev, date, entry);
  }));
}


// ---------- CLOCK IN / OUT ----------
let clockBusy = false; // true while a clock in/out write is in flight (blocks re-renders)

function renderClockCard() {
  if (clockBusy) return;
  const btn = document.getElementById("clockBtn");
  const box = document.getElementById("clockStatus");
  if (!btn || !box) return;

  const line = (label, value) => value ? `<div class="clock-line"><span>${label}</span><strong>${value}</strong></div>` : "";
  const timeText = (s, e) => s ? `${formatTime12(s)} – ${formatTime12(e)}` : "";
  const now = new Date();

  // ---- currently on duty ----
  if (openRecord) {
    const ev = allEvents.find(e => e.id === openRecord.eventId);
    const entry = ev ? ((ev.volunteersByDate || {})[openRecord.date] || []).find(v => v.uid === currentUser.uid) : null;
    const loc = (entry && entry.location) || (ev && ev.location) || "";
    box.innerHTML = `
      <div class="clock-top"><span class="badge green"><span class="dot live"></span>On duty</span>${openRecord.late ? `<span class="badge orange">Late</span>` : ""}</div>
      <h3 class="clock-title">${escapeHtml(ev ? ev.name : (openRecord.eventName || "Duty"))}</h3>
      <div class="clock-timer" id="clockElapsed">${fmtDuration(Date.now() - openRecord.timeIn)}</div>
      <div class="clock-timer-label">time on duty</div>
      ${line("Clocked in", fmtClock(openRecord.timeIn))}
      ${line("Shift", timeText(openRecord.shiftStart, openRecord.shiftEnd))}
      ${line("Location", loc ? locPill(loc) : "")}
      ${line("PIC", openRecord.pic ? escapeHtml(openRecord.pic) : "")}`;
    btn.textContent = "Clock Out";
    btn.disabled = false;
    return;
  }

  // ---- reserved shift today ----
  const reservation = findTodaysReservation();
  if (reservation) {
    let waiting = false, opensLine = "", note = "";
    if (reservation.startTime) {
      const scheduledStart = combineDateTime(reservation.date, reservation.startTime);
      const earliest = new Date(scheduledStart.getTime() - EARLY_CLOCKIN_MINUTES * 60000);
      if (now < earliest) {
        waiting = true;
        opensLine = `${earliest.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · in ${fmtCountdown(earliest - now)}`;
      } else if (now.getTime() > scheduledStart.getTime() + NO_SHOW_MINUTES * 60000) {
        note = `<div class="clock-note red">Past the no-show cutoff — this reservation may be cancelled automatically.</div>`;
      } else if (now.getTime() > scheduledStart.getTime() + LATE_GRACE_MINUTES * 60000) {
        note = `<div class="clock-note orange">Clocking in now will be marked late.</div>`;
      }
    }
    box.innerHTML = `
      <div class="clock-top">${waiting ? `<span class="badge orange">Not open yet</span>` : `<span class="badge green"><span class="dot"></span>Ready to clock in</span>`}</div>
      <h3 class="clock-title">${escapeHtml(reservation.event.name)}</h3>
      ${line("Today's shift", timeText(reservation.startTime, reservation.endTime))}
      ${line("Location", reservation.location ? locPill(reservation.location) : "")}
      ${line("PIC", reservation.event.pic ? escapeHtml(reservation.event.pic) : "")}
      ${line("Clock-in opens", opensLine)}
      ${note}`;
    btn.textContent = "Clock In";
    btn.disabled = waiting;
    return;
  }

  // ---- nothing to clock into ----
  const today = todayStr();
  const doneToday = myRecords.some(r => r.date === today && r.timeOut != null && !r.noShow);
  const next = findNextReservation();
  box.innerHTML = `
    <div class="clock-top"><span class="badge blue">${doneToday ? "Done for today" : "No shift today"}</span></div>
    <div class="clock-empty">${doneToday ? "Nice work — today's duty is logged." : "Reserve a shift under Available Events to clock in here."}</div>
    ${next ? `
      <div class="clock-next">
        <span>Next reservation</span>
        <strong>${escapeHtml(next.event.name)}</strong>
        <div>${shortDate(next.date)}${next.startTime ? ` · ${formatTime12(next.startTime)} – ${formatTime12(next.endTime)}` : ""}${locPill(next.location)}</div>
      </div>` : ""}`;
  btn.textContent = "Clock In";
  btn.disabled = true;
}

// Live timer while on duty, and a periodic refresh so "opens in" / late / no-show
// hints stay current without reloading the page.
setInterval(() => {
  const t = document.getElementById("clockElapsed");
  if (t && openRecord && openRecord.timeIn) t.textContent = fmtDuration(Date.now() - openRecord.timeIn);
}, 1000);
setInterval(() => { if (currentUser && myProfile) { renderClockCard(); renderWeeklyReservations(); } }, 30000);


document.getElementById("clockBtn").addEventListener("click", async () => {
  const btn = document.getElementById("clockBtn");
  const errEl = document.getElementById("clockError");
  errEl.textContent = "";
  clockBusy = true;
  btn.disabled = true;
  try {

    if (openRecord) {
      // Snapshot everything we need from openRecord *before* the write below —
      // the onSnapshot listener can flip the module-level `openRecord` to null
      // the instant the record's timeOut is saved, so referencing openRecord
      // again after the await is unreliable.
      const recordId = openRecord.id;
      const eventId = openRecord.eventId;
      const recordDate = openRecord.date;
      const shiftEnd = openRecord.shiftEnd;
      const timeIn = openRecord.timeIn;

      const timeOut = Date.now();
      const hours = +((timeOut - timeIn) / 3600000).toFixed(2);

      let earlyOut = false;
      let confirmMsg = "Confirm clock out.";
      if (shiftEnd) {
        const scheduledEnd = combineDateTime(recordDate, shiftEnd);
        const earlyOutThreshold = scheduledEnd.getTime() - EARLY_CLOCKOUT_GRACE_MINUTES * 60000;
        if (timeOut < earlyOutThreshold) {
          earlyOut = true;

          const remainingMins = Math.ceil((scheduledEnd.getTime() - timeOut) / 60000);
          const hrs = Math.floor(remainingMins / 60);
          const mins = remainingMins % 60;
          const remainingLabel = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
          confirmMsg = `Confirm clock out? You still have ${remainingLabel} left.`;
        }
      }

      if (!confirm(confirmMsg)) { btn.disabled = false; return; }

      await updateDoc(doc(db, "dutyRecords", recordId), { timeOut, hours, earlyOut });

      if (earlyOut) {
        const ev = allEvents.find(e => e.id === eventId);
        if (ev) {
          const list = (ev.volunteersByDate || {})[recordDate] || [];
          const entry = list.find(v => v.uid === currentUser.uid);
          if (entry) await cancelReservation(ev, recordDate, entry);
        }
      }
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
        earlyOut: false,
        createdAt: Date.now()
      });
    }
  } catch (err) {
    errEl.textContent = "Clock in/out failed: " + (err.code || err.message);
  } finally {
    clockBusy = false;
    renderClockCard();
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
    logsVisible = LOGS_PAGE_SIZE;
    renderEventSubTabs();
    renderRecords();
  }));
}

const LOGS_PAGE_SIZE = 15;
let logsVisible = LOGS_PAGE_SIZE;

function renderRecords() {
  const el = document.getElementById("recordsList");
  if (!el) return;
  const filtered = activeEventFilter === "all" ? myRecords : myRecords.filter(r => r.eventId === activeEventFilter);
  const totalHours = filtered.reduce((s, r) => s + (r.hours || 0), 0);
  const visible = filtered.slice(0, logsVisible);

  const tile = (label, value, color) => `
    <div class="mini-stat"><strong style="color:var(--${color});">${value}</strong><span>${label}</span></div>`;

  const rowHtml = (r) => {
    const day = r.date || (r.timeIn ? ymd(new Date(r.timeIn)) : "");
    const dayLabel = day ? shortDate(day, true) : "–";
    const shiftText = r.shiftStart ? `${formatTime12(r.shiftStart)} – ${formatTime12(r.shiftEnd)}` : (r.shift || "");
    const inOut = r.noShow ? "Did not clock in" : `${fmtClock(r.timeIn)} → ${r.timeOut ? fmtClock(r.timeOut) : "–"}`;
    const isOpen = r.timeIn && !r.timeOut && !r.noShow;
    const status = r.noShow ? `<span class="badge red">No Show</span>`
      : isOpen ? `<span class="badge blue">On Duty</span>`
      : `<span class="badge green">Completed</span>`;
    const hrs = r.noShow ? "0.0" : (r.hours != null ? r.hours.toFixed(1) : "–");
    return `
      <div class="log-row">
        <div class="log-main">
          <div class="log-title">${escapeHtml(r.eventName || "")}</div>
          <div class="log-sub">${dayLabel}</div>
          <div class="log-sub">${shiftText ? `${escapeHtml(shiftText)} · ` : ""}${inOut}</div>
          <div class="log-chips">${status}${r.late ? `<span class="badge orange">Late</span>` : ""}${r.earlyOut ? `<span class="badge blue">Early Out</span>` : ""}${r.addedByAdmin ? `<span class="badge blue">Manual</span>` : ""}</div>
        </div>
        <div class="log-hrs"><strong>${hrs}</strong><span>hrs</span></div>
      </div>`;
  };

  el.innerHTML = `
    <div class="mini-stats">
      ${tile("Late", myRecords.filter(r => r.late).length, "orange")}
      ${tile("Early out", myRecords.filter(r => r.earlyOut).length, "blue")}
      ${tile("No show", myRecords.filter(r => r.noShow).length, "red")}
    </div>
    <div class="log-total"><strong>${filtered.length}</strong> record${filtered.length === 1 ? "" : "s"} · <strong>${totalHours.toFixed(1)}</strong> hrs</div>
    ${visible.map(rowHtml).join("")}
    ${filtered.length > visible.length ? `<button class="secondary" id="moreLogsBtn" style="width:100%;margin-top:10px;">Show more (${filtered.length - visible.length} more)</button>` : ""}
    ${filtered.length === 0 ? `<div class="empty-state">No duty logs yet.</div>` : ""}`;

  const more = document.getElementById("moreLogsBtn");
  if (more) more.addEventListener("click", () => { logsVisible += LOGS_PAGE_SIZE; renderRecords(); });
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


// =====================================================================
// ANNOUNCEMENTS — admins post short notices; members see the newest one as
// a banner at the top of the page, and all of them behind the ✉ button
// (top right). The ✉ button shows a pulsing badge with the unread count.
// "Unread" and "dismissed" are remembered on this device only (localStorage).
// The banner has a ✕ button: dismissing hides that announcement's banner
// until a NEWER announcement is posted (it stays available under ✉).
// =====================================================================
let allAnnouncements = [];
let mailPanelOpen = false;
const BANNER_MAX_AGE_DAYS = 14; // the top banner hides announcements older than this

function annSeenKey() { return "lsbrcy_ann_seen_" + (currentUser ? currentUser.uid : ""); }
function getAnnSeen() { try { return Number(localStorage.getItem(annSeenKey())) || 0; } catch (e) { return 0; } }
function setAnnSeen(ts) { try { localStorage.setItem(annSeenKey(), String(ts)); } catch (e) {} }

// Remembers which announcement's banner the member closed (by its id).
function annDismissedKey() { return "lsbrcy_ann_dismissed_" + (currentUser ? currentUser.uid : ""); }
function getAnnDismissed() { try { return localStorage.getItem(annDismissedKey()) || ""; } catch (e) { return ""; } }
function setAnnDismissed(id) { try { localStorage.setItem(annDismissedKey(), String(id)); } catch (e) {} }

function annTimeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function initAnnouncements() {
  onSnapshot(collection(db, "announcements"), (snap) => {
    allAnnouncements = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.text)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderAnnouncements();
  });
}

function renderAnnouncements() {
  const seen = getAnnSeen();
  const unread = allAnnouncements.filter(a => (a.createdAt || 0) > seen).length;

  // ✉ badge
  const badge = document.getElementById("mailBadge");
  const btn = document.getElementById("mailBtn");
  if (badge && btn) {
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? "9+" : String(unread);
    btn.classList.toggle("has-unread", unread > 0);
  }

  // Banner: newest announcement, if recent and not dismissed by this member
  const bannerEl = document.getElementById("announceBanner");
  if (bannerEl) {
    const latest = allAnnouncements[0];
    const fresh = latest
      && (Date.now() - (latest.createdAt || 0)) < BANNER_MAX_AGE_DAYS * 86400000
      && latest.id !== getAnnDismissed();
    bannerEl.innerHTML = fresh ? `
      <div class="ann-banner" style="position:relative;">
        <button type="button" id="annDismiss" aria-label="Dismiss announcement" title="Dismiss"
          style="position:absolute;top:8px;right:8px;width:28px;height:28px;min-width:0;padding:0;margin:0;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:var(--muted);font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
        <div class="ann-banner__icon">📢</div>
        <div class="ann-banner__body" style="padding-right:30px;">
          <div class="ann-banner__label">Announcement · ${escapeHtml(annTimeAgo(latest.createdAt || Date.now()))}</div>
          <div class="ann-banner__text">${escapeHtml(latest.text)}</div>
          ${allAnnouncements.length > 1 ? `<button type="button" class="ann-banner__more" id="annSeeAll">See all (${allAnnouncements.length})</button>` : ""}
        </div>
      </div>` : "";
    const dismiss = document.getElementById("annDismiss");
    if (dismiss) dismiss.addEventListener("click", (e) => {
      e.stopPropagation();
      setAnnDismissed(latest.id);
      renderAnnouncements();
    });
    const seeAll = document.getElementById("annSeeAll");
    if (seeAll) seeAll.addEventListener("click", () => setMailPanel(true));
  }

  // Inbox panel (✉)
  const panel = document.getElementById("mailPanel");
  if (panel) {
    panel.hidden = !mailPanelOpen;
    if (mailPanelOpen) {
      panel.innerHTML = `
        <div class="mail-panel__head"><strong>Announcements</strong>
          <button type="button" class="mail-panel__close" id="mailClose" aria-label="Close">✕</button></div>
        ${allAnnouncements.length ? allAnnouncements.map(a => `
          <div class="mail-item${(a.createdAt || 0) > seen ? " is-new" : ""}">
            <div class="mail-item__text">${escapeHtml(a.text)}</div>
            <div class="mail-item__meta">${a.createdByName ? escapeHtml(a.createdByName) + " · " : ""}${escapeHtml(annTimeAgo(a.createdAt || Date.now()))}</div>
          </div>`).join("") : `<div class="mail-empty">No announcements yet.</div>`}`;
      document.getElementById("mailClose").addEventListener("click", () => setMailPanel(false));
    }
  }
}

function setMailPanel(open) {
  mailPanelOpen = open;
  renderAnnouncements();           // draw first, so the "new" highlight shows
  if (open && allAnnouncements.length) {
    setAnnSeen(Math.max(...allAnnouncements.map(a => a.createdAt || 0)));
    const badge = document.getElementById("mailBadge");
    if (badge) badge.hidden = true;  // clear the badge right away
    const btn = document.getElementById("mailBtn");
    if (btn) btn.classList.remove("has-unread");
  }
}

document.getElementById("mailBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  setMailPanel(!mailPanelOpen);
});
document.addEventListener("click", (e) => {
  if (mailPanelOpen && !e.target.closest("#mailPanel") && !e.target.closest("#annSeeAll")) setMailPanel(false);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && mailPanelOpen) setMailPanel(false); });
