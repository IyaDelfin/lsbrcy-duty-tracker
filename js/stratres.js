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
    renderEvents();
  });

  onSnapshot(collection(db, "dutyRecords"), (snap) => {
    allRecords = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.createdAt - a.createdAt);
    renderEventSubTabs();
    renderRecords();
    renderEvents();
  });
}

function renderEventSubTabs() {
  const el = document.getElementById("eventSubTabs");
  // Only events that have at least one duty record get a tab.
  const withRecords = new Set(allRecords.map(r => r.eventId));
  const tabs = [{ id: "all", name: "All" }, ...allEvents.filter(e => withRecords.has(e.id)).map(e => ({ id: e.id, name: e.name }))];
  // If the selected event no longer has records, fall back to "All".
  if (!tabs.some(t => t.id === activeEventFilter)) activeEventFilter = "all";
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

  const totalHours = filtered.reduce((s, r) => s + (r.hours || 0), 0);
  const sub = (txt) => `<div class="muted" style="font-size:.75rem;margin-top:2px;">${txt}</div>`;

  const rowHtml = (r) => {
    const day = recordDate(r);
    const dayLabel = day ? new Date(day + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "–";
    const shiftText = r.shiftStart ? `${formatTime12(r.shiftStart)} – ${formatTime12(r.shiftEnd)}` : (r.shift || "–");
    const inOut = r.noShow ? "Did not clock in" : `${fmtClock(r.timeIn)} → ${r.timeOut ? fmtClock(r.timeOut) : "–"}`;
    const statusBadge = r.noShow ? `<span class="badge red">No Show</span>`
      : (r.timeIn && !r.timeOut) ? `<span class="badge blue">On Duty</span>`
      : `<span class="badge green">Completed</span>`;
    return `
          <tr data-view-uid="${r.uid || ''}" style="cursor:pointer;${r.uid && r.uid === selectedMemberUid ? 'background:rgba(255,255,255,.04);' : ''}">
            <td><strong>${escapeHtml(r.fullName || "")}</strong>${sub(`${escapeHtml(r.studentNo || "")}${r.committee ? ` · ${escapeHtml(r.committee)}` : ""}`)}</td>
            <td>${escapeHtml(r.eventName || "")}${sub(dayLabel)}</td>
            <td>${escapeHtml(shiftText)}${sub(inOut)}</td>
            <td><strong>${r.hours != null ? r.hours.toFixed(1) : "–"}</strong></td>
            <td>${statusBadge}${r.late ? ` <span class="badge orange">Late</span>` : ""}${r.earlyOut ? ` <span class="badge blue">Early Out</span>` : ""}${r.addedByAdmin ? ` <span class="badge blue">Manual</span>` : ""}</td>
          </tr>`;
  };

  el.innerHTML = `
    <div class="tabs" id="committeeSubTabs">${committeeTabsHtml}</div>
    <div class="card">
      <p class="muted" style="margin:0 0 10px;"><strong style="color:var(--text);">${filtered.length}</strong> record${filtered.length === 1 ? "" : "s"} · <strong style="color:var(--text);">${totalHours.toFixed(1)}</strong> total hours <span style="font-size:.78rem;">· tap a row to see that member's full history</span></p>
      <div style="overflow-x:auto;font-size:.88rem;">
        <table>
          <tr><th>Member</th><th>Event</th><th>Shift</th><th>Hrs</th><th>Status</th></tr>
          ${filtered.map(rowHtml).join("")}
        </table>
      </div>
      ${filtered.length === 0 ? `<p class="muted">No duty records for this filter yet.</p>` : ""}
    </div>`;

  document.getElementById("committeeSubTabs").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    activeCommitteeFilter = btn.dataset.committee;
    renderRecords();
  }));

  el.querySelectorAll('tr[data-view-uid]').forEach(row => row.addEventListener("click", () => {
    if (!row.dataset.viewUid) return;
    selectedMemberUid = row.dataset.viewUid;
    renderRecords();
    const detail = document.getElementById("memberDetail");
    if (detail) detail.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const chip = (label, value, color) => `
      <div style="flex:1;min-width:90px;text-align:center;padding:8px 6px;border:1px solid var(--border);border-radius:8px;">
        <div style="font-size:1.2rem;font-weight:700;${color ? `color:var(--${color});` : ""}">${value}</div>
        <div class="muted" style="font-size:.7rem;">${label}</div>
      </div>`;
  const sub = (txt) => `<div class="muted" style="font-size:.75rem;margin-top:2px;">${txt}</div>`;

  const rowHtml = (r) => {
    const day = recordDate(r);
    const dayLabel = day ? new Date(day + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "–";
    const shiftText = r.shiftStart ? `${formatTime12(r.shiftStart)} – ${formatTime12(r.shiftEnd)}` : (r.shift || "–");
    const inOut = r.noShow ? "Did not clock in" : `${fmtClock(r.timeIn)} → ${r.timeOut ? fmtClock(r.timeOut) : "–"}`;
    const statusBadge = r.noShow ? `<span class="badge red">No Show</span>`
      : (r.timeIn && !r.timeOut) ? `<span class="badge blue">On Duty</span>`
      : `<span class="badge green">Completed</span>`;
    return `
          <tr>
            <td>${escapeHtml(r.eventName || "")}${sub(dayLabel)}</td>
            <td>${escapeHtml(shiftText)}${sub(inOut)}</td>
            <td><strong>${r.hours != null ? r.hours.toFixed(1) : "–"}</strong></td>
            <td>${statusBadge}${r.late ? ` <span class="badge orange">Late</span>` : ""}${r.earlyOut ? ` <span class="badge blue">Early Out</span>` : ""}${r.addedByAdmin ? ` <span class="badge blue">Manual</span>` : ""}</td>
          </tr>`;
  };

  el.innerHTML = `
    <hr class="section-divider">
    <div class="card event-detail-card" style="margin-top:5px; position: relative;">
      <button class="secondary" id="closeMemberDetail" style="position: absolute; top: 16px; right: 16px; width: auto;">Close</button>
      <p class="eyebrow">Member Details</p>
      <h3 style="margin:0 0 4px;">${escapeHtml(first.fullName || "")}</h3>
      <p class="muted" style="margin:0;">${escapeHtml(first.studentNo || "–")} · ${escapeHtml(first.committee || "–")}</p>
    </div>
    <div class="card">
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">
        ${chip("Total hours", totalHours.toFixed(1))}
        ${chip("Late", records.filter(r => r.late).length, "orange")}
        ${chip("Early out", records.filter(r => r.earlyOut).length, "blue")}
        ${chip("No show", records.filter(r => r.noShow).length, "red")}
      </div>
      <div style="overflow-x:auto;font-size:.88rem;">
        <table>
          <tr><th>Event</th><th>Shift</th><th>Hrs</th><th>Status</th></tr>
          ${records.map(rowHtml).join("")}
        </table>
      </div>
    </div>`;

  document.getElementById("closeMemberDetail").addEventListener("click", () => {
    selectedMemberUid = null;
    renderRecords();
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

// =====================================================================
// EVENTS TAB (view-only) — same event cards as the admin's Events tab,
// but Strategic Response can only open the Attendance section. There is no
// add / edit / mark completed / delete here.
// =====================================================================
const CATEGORY_LABELS = { clinic: "Clinic Duty", office: "Office Duty" };
let evStatusFilter = "active";
let evCategoryFilter = "all";
let attendanceOpenFor = null; // id of the event whose attendance section is open

// ---- Main tabs (Duty Records / Events) ----
document.querySelectorAll("#mainTabs button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#mainTabs button").forEach(b => b.classList.toggle("active", b === btn));
  document.getElementById("tab-records").style.display = btn.dataset.tab === "records" ? "" : "none";
  document.getElementById("tab-events").style.display = btn.dataset.tab === "events" ? "" : "none";
}));

document.querySelectorAll("#evStatusTabs button").forEach(btn => btn.addEventListener("click", () => {
  evStatusFilter = btn.dataset.status;
  document.querySelectorAll("#evStatusTabs button").forEach(b => b.classList.toggle("active", b === btn));
  renderEvents();
}));
document.querySelectorAll("#evCategoryFilterTabs button").forEach(btn => btn.addEventListener("click", () => {
  evCategoryFilter = btn.dataset.cat;
  document.querySelectorAll("#evCategoryFilterTabs button").forEach(b => b.classList.toggle("active", b === btn));
  renderEvents();
}));

// Location(s) used on one date: each override block's location for that day
// (a blank block falls back to the event's basic location), otherwise the
// basic location from the event's Basics.
function locationsForDate(ev, date) {
  const base = (ev.location || "").trim();
  const blocks = ev.dateOverrides && ev.dateOverrides[date];
  if (blocks && blocks.length) {
    const locs = [];
    blocks.forEach(b => {
      const l = ((b.location || "").trim()) || base;
      if (l && !locs.includes(l)) locs.push(l);
    });
    return locs;
  }
  return base ? [base] : [];
}

// HTML lines of "Mon, Oct 19 – Wed, Oct 21  📍 Location". Consecutive dates that
// share the same location are merged into one range; a different location on
// an overridden date gets its own line.
function formatEventDatesWithLocation(ev) {
  const fmt = d => new Date(d + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const nextDay = d => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return localDateStr(x); };
  const pill = loc => loc ? `<span style="display:inline-block;background:rgba(217,51,46,.15);color:var(--red);padding:1px 8px;border-radius:6px;font-size:.78rem;font-weight:700;margin-left:6px;">📍 ${escapeHtml(loc)}</span>` : "";

  const dates = eventDates(ev);
  if (!dates.length) return pill((ev.location || "").trim());

  const groups = [];
  dates.forEach(d => {
    const key = locationsForDate(ev, d).join(" / ");
    const last = groups[groups.length - 1];
    if (last && last.key === key && nextDay(last.end) === d) last.end = d;
    else groups.push({ start: d, end: d, key });
  });
  return groups.map(g => {
    const label = g.start === g.end ? fmt(g.start) : `${fmt(g.start)} – ${fmt(g.end)}`;
    return `<div style="margin-bottom:4px;">${escapeHtml(label)}${pill(g.key)}</div>`;
  }).join("");
}

function renderEvents() {
  const el = document.getElementById("eventsList");
  if (!el) return;
  let visible = allEvents;
  if (evStatusFilter !== "all") visible = visible.filter(ev => ev.status === evStatusFilter);
  if (evCategoryFilter !== "all") visible = visible.filter(ev => (ev.category || "clinic") === evCategoryFilter);

  // Small label-over-value cell used in the event card's details grid.
  const meta = (label, value, wide) => (value === "" || value == null) ? "" : `
        <div style="min-width:0;${wide ? "grid-column:1/-1;" : ""}">
          <div style="font-size:.66rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;">${label}</div>
          <div style="font-size:.9rem;font-weight:600;color:var(--text);overflow-wrap:anywhere;">${value}</div>
        </div>`;
  const btnStyle = "width:auto;margin:0;padding:7px 14px;font-size:.82rem;";

  el.innerHTML = visible.map(ev => {
    const isOpen = attendanceOpenFor === ev.id;
    const datesHtml = formatEventDatesWithLocation(ev);
    const windowsText = formatTimeWindows(ev);
    return `
    <div class="card" style="padding:18px 20px;${isOpen ? "border-color:var(--red);" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
        <div style="flex:1 1 260px;min-width:0;">
          <h3 style="margin:0 0 4px;">${escapeHtml(ev.name)}</h3>
          ${ev.location ? `<p class="muted" style="margin:0 0 10px;">📍 ${escapeHtml(ev.location)}</p>` : `<div style="height:8px;"></div>`}
          <span class="badge blue">${escapeHtml(CATEGORY_LABELS[ev.category] || "Uncategorized")}</span>
          <span class="badge ${ev.status === 'active' ? 'green' : 'blue'}">${escapeHtml(ev.status || "")}</span>
          ${ev.manualOnly ? `<span class="badge red">Manual Only</span>` : ""}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button class="secondary" data-action="toggle-attendance" data-id="${ev.id}" style="${btnStyle}${isOpen ? "border-color:var(--red);color:var(--red);" : ""}">${isOpen ? "▲ Hide Attendance" : "📋 Attendance"}</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px 18px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
        ${meta("Dates", datesHtml, true)}
        ${meta("Duty hours", windowsText ? escapeHtml(windowsText) : "")}
        ${meta("PIC", ev.pic ? escapeHtml(ev.pic) : "")}
        ${meta("Max hours", ev.maxHours != null ? `${ev.maxHours} hr${ev.maxHours === 1 ? "" : "s"}` : "")}
        ${meta("Max per hour", ev.maxVolunteers != null ? `${ev.maxVolunteers} member${ev.maxVolunteers === 1 ? "" : "s"}` : "")}
        ${meta("Max days / member", ev.maxPerMember != null ? String(ev.maxPerMember) : "")}
        ${meta("Reservations", String(volunteerCount(ev)))}
      </div>

      ${ev.compliance ? `<div style="margin-top:14px;padding:8px 12px;border-radius:8px;background:rgba(217,51,46,.1);border-left:3px solid var(--red);color:var(--red);font-size:.85rem;font-weight:600;">${escapeHtml(ev.compliance)}</div>` : ""}
      ${isOpen ? renderAttendanceSection(ev) : ""}
    </div>`;
  }).join("") || `<p class="muted">No events match this filter.</p>`;

  el.querySelectorAll('[data-action="toggle-attendance"]').forEach(btn => btn.addEventListener("click", () => {
    attendanceOpenFor = attendanceOpenFor === btn.dataset.id ? null : btn.dataset.id;
    renderEvents();
  }));
}

// ---- Helpers copied from the admin page (read-only attendance view) ----

function volunteerCount(ev) {
  return Object.values(ev.volunteersByDate || {}).reduce((s, a) => s + a.length, 0);
}

function dateRange(start, end) {
  const dates = [];
  let cur = new Date(start + "T00:00:00");
  const last = new Date((end || start) + "T00:00:00");
  while (cur <= last) {
    dates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function eventDates(ev) {
  if (ev.overridesOnly && ev.dateOverrides) {
    const keys = Object.keys(ev.dateOverrides).sort();
    if (keys.length) return keys;
  }
  return ev.startDate ? dateRange(ev.startDate, ev.endDate) : [];
}

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

function formatTimeWindows(ev) {
  const windows = Array.isArray(ev.timeWindows) && ev.timeWindows.length
    ? ev.timeWindows
    : (ev.dutyStart && ev.dutyEnd ? [{ start: ev.dutyStart, end: ev.dutyEnd }] : []);
  return windows.map(w => `${formatTime12(w.start)} – ${formatTime12(w.end)}`).join(", ");
}

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function recordDate(r) {
  return r.date || (r.timeIn ? localDateStr(new Date(r.timeIn)) : "");
}

function fmtClock(ts) {
  return ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–";
}

function attendanceStatus(rec, v, date, today, now) {
  if (rec) {
    if (rec.noShow) return { label: "No Show", cls: "red" };
    if (rec.timeIn && !rec.timeOut) return { label: "On Duty", cls: "blue" };
    return { label: "Completed", cls: "green" };
  }
  // Reservation with no duty record yet.
  if (date > today) return { label: "Reserved", cls: "blue" };
  if (date === today) {
    if (!v.startTime) return { label: "Reserved", cls: "blue" };
    const noShowAt = new Date(`${date}T${v.startTime}:00`).getTime() + 15 * 60000;
    if (now < noShowAt) return { label: "Reserved", cls: "blue" };
  }
  // Past the no-show cutoff and never clocked in. (The member's own app turns this
  // into a "No Show" record the next time they open it.)
  return { label: "Not clocked in", cls: "orange" };
}

function attendanceRowsForEvent(ev) {
  const now = Date.now();
  const today = localDateStr();
  const records = allRecords.filter(r => r.eventId === ev.id);
  const dateSet = new Set(eventDates(ev));
  records.forEach(r => { const d = recordDate(r); if (d) dateSet.add(d); });

  const rows = [];
  for (const date of [...dateSet].sort()) {
    const reservations = (ev.volunteersByDate || {})[date] || [];
    const recs = records.filter(r => recordDate(r) === date);
    const used = new Set();

    for (const v of reservations) {
      const rec = recs.find(r => r.uid === v.uid && !used.has(r.id));
      if (rec) used.add(rec.id);
      rows.push(makeAttendanceRow(date, v, rec, today, now));
    }
    for (const rec of recs) {
      if (!used.has(rec.id)) rows.push(makeAttendanceRow(date, null, rec, today, now));
    }
  }
  return rows;
}

function makeAttendanceRow(date, v, rec, today, now) {
  const status = attendanceStatus(rec, v || {}, date, today, now);
  const start = (rec && rec.shiftStart) || (v && v.startTime) || "";
  const end = (rec && rec.shiftEnd) || (v && v.endTime) || "";
  return {
    date,
    name: (v && v.fullName) || (rec && rec.fullName) || "",
    studentNo: (v && v.studentNo) || (rec && rec.studentNo) || "",
    committee: (v && v.committee) || (rec && rec.committee) || "",
    location: (v && v.location) || "",
    timeRange: start ? `${formatTime12(start)} – ${formatTime12(end)}` : "",
    timeIn: rec ? rec.timeIn : null,
    timeOut: rec ? rec.timeOut : null,
    hours: rec && rec.hours != null ? rec.hours : null,
    late: !!(rec && rec.late),
    earlyOut: !!(rec && rec.earlyOut),
    manual: !!(rec && rec.addedByAdmin),
    status
  };
}

function attendanceSummary(rows) {
  return {
    total: rows.length,
    attended: rows.filter(r => r.status.label === "Completed" || r.status.label === "On Duty").length,
    late: rows.filter(r => r.late).length,
    earlyOut: rows.filter(r => r.earlyOut).length,
    noShow: rows.filter(r => r.status.label === "No Show").length,
    notClockedIn: rows.filter(r => r.status.label === "Not clocked in").length,
    hours: rows.reduce((s, r) => s + (r.hours || 0), 0)
  };
}

function renderAttendanceSection(ev) {
  const rows = attendanceRowsForEvent(ev);
  const s = attendanceSummary(rows);
  const chip = (label, value, color) => `
    <div style="flex:1;min-width:84px;text-align:center;padding:8px 6px;border:1px solid var(--border);border-radius:8px;">
      <div style="font-size:1.15rem;font-weight:700;${color ? `color:var(--${color});` : ""}">${value}</div>
      <div class="muted" style="font-size:.7rem;">${label}</div>
    </div>`;

  const dates = [...new Set(rows.map(r => r.date))];
  const tablesHtml = dates.map(date => {
    const dayRows = rows.filter(r => r.date === date);
    const label = new Date(date + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    return `
      <h4 style="margin:14px 0 6px;">${label} <span class="muted" style="font-weight:400;font-size:.8rem;">· ${dayRows.length}</span></h4>
      <table>
        <tr><th>Name</th><th>Committee</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th>Status</th></tr>
        ${dayRows.map(r => `
          <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.committee)}</td>
            <td>${escapeHtml(r.timeRange || "–")}</td>
            <td>${fmtClock(r.timeIn)}</td>
            <td>${fmtClock(r.timeOut)}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
            <td><span class="badge ${r.status.cls}">${r.status.label}</span>${r.late ? ` <span class="badge orange">Late</span>` : ""}${r.earlyOut ? ` <span class="badge blue">Early Out</span>` : ""}${r.manual ? ` <span class="badge blue">Manual</span>` : ""}</td>
          </tr>`).join("")}
      </table>`;
  }).join("");

  return `
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
      <div class="row" style="align-items:center;">
        <h3 style="margin:0;">Attendance</h3>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
        ${chip("Reserved / logged", s.total)}
        ${chip("Attended", s.attended, "green")}
        ${chip("Late", s.late, "orange")}
        ${chip("Early out", s.earlyOut, "blue")}
        ${chip("No show", s.noShow, "red")}
        ${chip("Not clocked in", s.notClockedIn, "orange")}
        ${chip("Total hours", s.hours.toFixed(1))}
      </div>
      ${tablesHtml || `<p class="muted">No reservations or duty records for this event yet.</p>`}
    </div>`;
}
