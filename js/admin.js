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
let activeCategory = "clinic";
let viewedCategoryEventId = null;
let evStatusFilter = "active";
let evCategoryFilter = "all";
let editingEventId = null;
let editingTimeWindows = [];



document.getElementById("evStatusTabs").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  evStatusFilter = e.target.dataset.status;
  document.querySelectorAll("#evStatusTabs button").forEach(b => b.classList.toggle("active", b === e.target));
  renderEvents();
});

document.getElementById("evCategoryFilterTabs").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  evCategoryFilter = e.target.dataset.cat;
  document.querySelectorAll("#evCategoryFilterTabs button").forEach(b => b.classList.toggle("active", b === e.target));
  renderEvents();
});


const CATEGORY_LABELS_2 = { clinic: "Clinic Duty", office: "Office Duty" };

document.getElementById("categoryTabs").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  activeCategory = e.target.dataset.cat;
  document.querySelectorAll("#categoryTabs button").forEach(b => b.classList.toggle("active", b === e.target));
  renderCategoryEvents();
});


const CATEGORY_LABELS = { clinic: "Clinic Duty", office: "Office Duty" };

function initDashboard() {
    onSnapshot(collection(db, "events"), (snap) => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
    renderEventSubTabs();
    renderRecords();
    renderCategoryEvents();
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

function renderCategoryEvents() {
  const listEl = document.getElementById("categoryEventsList");
  if (!listEl) return;
  const active = allEvents.filter(e => e.status === "active" && (e.category || "clinic") === activeCategory);

    listEl.innerHTML = active.map(ev => `
    <div class="event-list-item${viewedCategoryEventId === ev.id ? ' selected' : ''}" data-view-ev="${ev.id}">
      <h3 style="margin-bottom:2px;">${escapeHtml(ev.name)}</h3>
      <p class="muted" style="margin:0;">${escapeHtml(ev.location || "")}</p>
      ${viewedCategoryEventId === ev.id ? `<span class="badge red">Selected</span>` : ""}
    </div>`).join("") || `<p class="muted">No active events under ${CATEGORY_LABELS_2[activeCategory]} right now.</p>`;

  
  listEl.querySelectorAll('[data-view-ev]').forEach(card => card.addEventListener("click", () => {
    viewedCategoryEventId = card.dataset.viewEv;
    renderCategoryEvents();
    renderCategoryEventDetails();
  }));

  renderCategoryEventDetails();
}

function renderCategoryEventDetails() {
  const el = document.getElementById("eventDetails");
  if (!el) return;
  const ev = allEvents.find(e => e.id === viewedCategoryEventId);
  if (!ev) { el.innerHTML = ""; return; }

    el.innerHTML = `
    <hr class="section-divider">
    <div class="card event-detail-card" style="margin-top:10px;">
      <p class="eyebrow">Event Details</p>
      <h3 style="margin-bottom:8px;">${escapeHtml(ev.name)}</h3>
      <p class="muted" style="margin:0 0 6px;">${escapeHtml(CATEGORY_LABELS_2[ev.category] || "")} · ${escapeHtml(ev.location || "")}</p>
      ${ev.pic ? `<p class="muted">PIC: ${escapeHtml(ev.pic)}</p>` : ""}
      ${ev.maxHours != null ? `<p class="muted">Max hours: ${ev.maxHours}</p>` : ""}
      ${formatTimeWindows(ev) ? `<p class="muted">Duty hours: ${formatTimeWindows(ev)}</p>` : ""}
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
  const maxVolunteersRaw = document.getElementById("evMaxVolunteers").value.trim();
  const maxVolunteers = maxVolunteersRaw === "" ? null : parseInt(maxVolunteersRaw, 10);
  const maxPerMemberRaw = document.getElementById("evMaxPerMember").value.trim();
  const maxPerMember = maxPerMemberRaw === "" ? null : parseInt(maxPerMemberRaw, 10);
  const startDate = document.getElementById("evStartDate").value || null;
  const endDate = document.getElementById("evEndDate").value || null;
  const timeWindows = editingTimeWindows.filter(w => w.start && w.end);
  const pic = document.getElementById("evPic").value.trim();
  const compliance = document.getElementById("evCompliance").value.trim();
  const manualOnly = document.getElementById("evManualOnly").checked;
  if (!name) return;

  const payload = { name, location, category, maxHours, maxVolunteers, maxPerMember, startDate, endDate, timeWindows, pic, compliance, manualOnly };

  if (editingEventId) {
    await updateDoc(doc(db, "events", editingEventId), payload);
    editingEventId = null;
    document.getElementById("addEventBtn").textContent = "+ Add Event";
    document.getElementById("cancelEditEventBtn").style.display = "none";
  } else {
    await addDoc(collection(db, "events"), {
      ...payload,
      status: "active",
      signupCount: 0,
      createdAt: Date.now()
    });
  }

  ["evName","evLocation","evMaxHours","evMaxVolunteers","evMaxPerMember","evStartDate","evEndDate","evPic","evCompliance"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("evManualOnly").checked = false;
  editingTimeWindows = [];
  renderTimeWindowRows();
});

document.getElementById("cancelEditEventBtn").addEventListener("click", () => {
  editingEventId = null;
  document.getElementById("addEventBtn").textContent = "+ Add Event";
  document.getElementById("cancelEditEventBtn").style.display = "none";
  ["evName","evLocation","evMaxHours","evMaxVolunteers","evMaxPerMember","evStartDate","evEndDate","evPic","evCompliance"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("evManualOnly").checked = false;
  editingTimeWindows = [];
  renderTimeWindowRows();
});


function startEditEvent(ev) {
  editingEventId = ev.id;
  document.getElementById("evName").value = ev.name || "";
  document.getElementById("evLocation").value = ev.location || "";
  document.getElementById("evCategory").value = ev.category || "clinic";
  document.getElementById("evMaxHours").value = ev.maxHours != null ? ev.maxHours : "";
  document.getElementById("evMaxVolunteers").value = ev.maxVolunteers != null ? ev.maxVolunteers : "";
  document.getElementById("evMaxPerMember").value = ev.maxPerMember != null ? ev.maxPerMember : "";
  document.getElementById("evStartDate").value = ev.startDate || "";
  document.getElementById("evEndDate").value = ev.endDate || "";
  editingTimeWindows = Array.isArray(ev.timeWindows) && ev.timeWindows.length
    ? ev.timeWindows.map(w => ({ start: w.start, end: w.end }))
    : (ev.dutyStart && ev.dutyEnd ? [{ start: ev.dutyStart, end: ev.dutyEnd }] : []);
  renderTimeWindowRows();
  document.getElementById("evPic").value = ev.pic || "";
  document.getElementById("evCompliance").value = ev.compliance || "";
  document.getElementById("evManualOnly").checked = !!ev.manualOnly;
  document.getElementById("addEventBtn").textContent = "Save Changes";
  document.getElementById("cancelEditEventBtn").style.display = "inline-block";
  document.getElementById("evName").scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderTimeWindowRows() {
  const el = document.getElementById("evTimeWindows");
  el.innerHTML = editingTimeWindows.map((w, i) => `
    <div class="row" data-window-row="${i}">
      <input type="time" data-window-start="${i}" value="${w.start || ""}">
      <input type="time" data-window-end="${i}" value="${w.end || ""}">
      <button type="button" class="danger" data-remove-window="${i}" style="padding:6px 10px;font-size:.75rem;">✕</button>
    </div>`).join("");

  el.querySelectorAll("[data-window-start]").forEach(input => input.addEventListener("input", () => {
    editingTimeWindows[+input.dataset.windowStart].start = input.value;
  }));
  el.querySelectorAll("[data-window-end]").forEach(input => input.addEventListener("input", () => {
    editingTimeWindows[+input.dataset.windowEnd].end = input.value;
  }));
  el.querySelectorAll("[data-remove-window]").forEach(btn => btn.addEventListener("click", () => {
    editingTimeWindows.splice(+btn.dataset.removeWindow, 1);
    renderTimeWindowRows();
  }));
}

document.getElementById("addTimeWindowBtn").addEventListener("click", () => {
  editingTimeWindows.push({ start: "", end: "" });
  renderTimeWindowRows();
});

// "7:00 AM – 10:00 AM, 1:00 PM – 5:00 PM" style summary of an event's duty
// time windows. Falls back to the old single dutyStart/dutyEnd pair for
// events created before split time windows existed.
function formatTimeWindows(ev) {
  const windows = Array.isArray(ev.timeWindows) && ev.timeWindows.length
    ? ev.timeWindows
    : (ev.dutyStart && ev.dutyEnd ? [{ start: ev.dutyStart, end: ev.dutyEnd }] : []);
  return windows.map(w => `${formatTime12(w.start)} – ${formatTime12(w.end)}`).join(", ");
}

function renderEvents() {
  const el = document.getElementById("eventsList");
  let visible = allEvents;
  if (evStatusFilter !== "all") visible = visible.filter(ev => ev.status === evStatusFilter);
  if (evCategoryFilter !== "all") visible = visible.filter(ev => (ev.category || "clinic") === evCategoryFilter);

  el.innerHTML = visible.map(ev => `

    <div class="card">
      <div class="row" style="align-items:center;">
        <div>
          <h3 style="margin-bottom:4px;">${escapeHtml(ev.name)}</h3>
          <p class="muted" style="margin:0 0 6px;">${escapeHtml(ev.location || "")}</p>
          <span class="badge blue">${escapeHtml(CATEGORY_LABELS[ev.category] || "Uncategorized")}</span>
          <span class="badge ${ev.status === 'active' ? 'green' : 'blue'}">${ev.status}</span>
          ${ev.manualOnly ? `<span class="badge red">Manual Only</span>` : ""}
        </div>
        <div style="text-align:right;">
          <button class="secondary" data-action="toggle" data-id="${ev.id}" data-status="${ev.status}">
            ${ev.status === 'active' ? 'Mark Completed' : 'Reopen'}
          </button><br><br>
          <button class="secondary" data-action="edit-event" data-id="${ev.id}">Edit</button>
          <button class="danger" data-action="delete-event" data-id="${ev.id}">Delete</button>
        </div>
      </div>
      ${ev.startDate ? `<p class="muted">Dates: ${escapeHtml(ev.startDate)}${ev.endDate && ev.endDate !== ev.startDate ? ' to ' + escapeHtml(ev.endDate) : ''}</p>` : ""}
      ${ev.pic ? `<p class="muted">PIC: ${escapeHtml(ev.pic)}</p>` : ""}
      ${ev.maxHours != null ? `<p class="muted">Max hours: ${ev.maxHours}</p>` : ""}
      ${ev.maxVolunteers != null ? `<p class="muted">Max per day: ${ev.maxVolunteers}${ev.volunteersByDate ? ' · Total reservations: ' + Object.values(ev.volunteersByDate).reduce((s,a)=>s+a.length,0) : ''}</p>` : ""}
      ${ev.maxPerMember != null ? `<p class="muted">Max days per member: ${ev.maxPerMember}</p>` : ""}
      ${ev.maxPerMember != null ? `<p class="muted">Max days per member: ${ev.maxPerMember}</p>` : ""}
        ${formatTimeWindows(ev) ? `<p class="muted">Duty hours: ${formatTimeWindows(ev)}</p>` : ""}
      ${ev.compliance ? `<p class="muted" style="color:var(--red);">${escapeHtml(ev.compliance)}</p>` : ""}
    </div>`).join("") || `<p class="muted">No events match this filter.</p>`;


    el.querySelectorAll('[data-action="toggle"]').forEach(btn => btn.addEventListener("click", async () => {
    const newStatus = btn.dataset.status === "active" ? "completed" : "active";
    await updateDoc(doc(db, "events", btn.dataset.id), { status: newStatus });
  }));
  el.querySelectorAll('[data-action="edit-event"]').forEach(btn => btn.addEventListener("click", () => {
    const ev = allEvents.find(e => e.id === btn.dataset.id);
    if (ev) startEditEvent(ev);
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
            <td><span class="badge ${m.role === 'admin' ? 'red' : m.role === 'stratres' ? 'orange' : 'blue'}">${m.role}</span></td>
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
  const eventOptionsHtml = allEvents.map(ev => `<option value="${ev.id}">${escapeHtml(ev.name)}</option>`).join("");

  
  el.innerHTML = `
    <hr class="section-divider">
    <div class="card event-detail-card" style="margin-top:5px; position: relative;">
      <button class="secondary" id="closeMemberDetail" style="position: absolute; top: 16px; right: 16px; width: auto;">Close</button>
      <p class="eyebrow">Member Details</p>
      <h3 style="margin:0;">${escapeHtml(m.fullName || m.username || "")}</h3>
    </div>
      <p class="muted">ID: ${escapeHtml(m.studentNo || "–")} · Committee: ${escapeHtml(m.committee || "–")} · Role: ${escapeHtml(m.role || "")}</p>
      <p class="muted">Total Hours Rendered: <strong style="color:var(--text);">${totalHours.toFixed(1)}</strong></p>
      <p class="muted">Late Count: <strong style="color:var(--orange);">${records.filter(r => r.late).length}</strong></p>
      <p class="muted">Early Out Count: <strong style="color:var(--blue);">${records.filter(r => r.earlyOut).length}</strong></p>
      <p class="muted">No Show Count: <strong style="color:var(--red);">${records.filter(r => r.noShow).length}</strong></p>
      <table>
        <tr><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th>Status</th><th></th></tr>
        ${records.map(r => `
          <tr>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) : "–"}</td>
            <td>${escapeHtml(r.shift || "")}${r.shiftStart ? ` (${formatTime12(r.shiftStart)}–${formatTime12(r.shiftEnd)})` : ""}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "<span class='badge blue'>Active</span>"}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
            <td>${r.noShow ? "<span class='badge red'>No Show</span>" : ""}${r.late ? " <span class='badge orange'>Late</span>" : ""}${r.earlyOut ? " <span class='badge blue'>Early Out</span>" : ""}</td>
            <td><button class="secondary" data-action="edit-record" data-id="${r.id}" style="padding:6px 10px;font-size:.75rem;">Edit</button></td>          </tr>`).join("")}
      </table>
      ${records.length === 0 ? `<p class="muted">No duty records yet.</p>` : ""}
      <hr class="section-divider">
      <h3 style="margin:16px 0 8px;">+ Add Duty Record</h3>
      <p class="muted">Manually log a duty entry for this member (e.g. paper logs or make-up duty).</p>
      <select id="manualRecordEvent">${eventOptionsHtml || `<option value="">No events yet</option>`}</select>
      <div class="row">
        <input id="manualRecordDate" type="date">
        <input id="manualRecordTimeIn" type="time" placeholder="Time in">
      </div>
      <input id="manualRecordHours" type="number" min="0" step="0.5" placeholder="Hours rendered (e.g. 4)">
      <label class="muted" style="display:flex;align-items:center;gap:8px;margin:-4px 0 12px;">
        <input type="checkbox" id="manualRecordLate" style="width:auto;margin:0;"> Mark as Late
      </label>
      <button class="primary" id="addManualRecordBtn" style="width:100%;">+ Add Record</button>
    </div>`;

  document.getElementById("closeMemberDetail").addEventListener("click", () => {
    selectedMemberId = null;
    renderMemberDetail();
  });

  el.querySelectorAll('[data-action="edit-record"]').forEach(btn => btn.addEventListener("click", async () => {
    const r = allRecords.find(x => x.id === btn.dataset.id);
    if (!r) return;
    const hoursInput = prompt("Hours rendered:", r.hours != null ? r.hours : "");
    if (hoursInput === null) return;
    const hours = hoursInput.trim() === "" ? null : parseFloat(hoursInput);
    const late = confirm("Mark this record as LATE?\n\nOK = Late · Cancel = Not late");
    await updateDoc(doc(db, "dutyRecords", r.id), { hours, late });
  }));

  const addManualBtn = document.getElementById("addManualRecordBtn");
  if (addManualBtn) {
    addManualBtn.addEventListener("click", async () => {
      const eventId = document.getElementById("manualRecordEvent").value;
      const ev = allEvents.find(e => e.id === eventId);
      const date = document.getElementById("manualRecordDate").value;
      const timeInStr = document.getElementById("manualRecordTimeIn").value || "08:00";
      const hoursRaw = document.getElementById("manualRecordHours").value.trim();
      const late = document.getElementById("manualRecordLate").checked;

      if (!ev || !date || hoursRaw === "") {
        alert("Please select an event, a date, and enter hours rendered.");
        return;
      }
      const hours = parseFloat(hoursRaw);
      const timeIn = new Date(`${date}T${timeInStr}:00`).getTime();
      const timeOut = timeIn + hours * 3600000;

      await addDoc(collection(db, "dutyRecords"), {
        uid: m.id,
        studentNo: m.studentNo || "",
        fullName: m.fullName || m.username || "",
        committee: m.committee || "",
        eventId: ev.id,
        eventName: ev.name,
        shift: new Date(timeIn).getHours() < 12 ? "AM" : "PM",
        shiftStart: null,
        shiftEnd: null,
        date,
        timeIn,
        timeOut,
        hours,
        pic: ev.pic || "",
        verified: true,
        late,
        addedByAdmin: true,
        createdAt: Date.now()
      });

      document.getElementById("manualRecordDate").value = "";
      document.getElementById("manualRecordTimeIn").value = "";
      document.getElementById("manualRecordHours").value = "";
      document.getElementById("manualRecordLate").checked = false;
    });
  }
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
// Applies the same event/committee tab filters the Records tab is currently
// showing. Shared by renderRecords() and the Excel export so the export
// always matches exactly what's on screen.
function getFilteredRecords() {
  let filtered = activeEventFilter === "all" ? allRecords : allRecords.filter(r => r.eventId === activeEventFilter);
  if (activeCommitteeFilter !== "all") {
    filtered = filtered.filter(r => r.committee === activeCommitteeFilter);
  }
  return filtered;
}

function renderRecords() {
  const el = document.getElementById("recordsList");
  const filtered = getFilteredRecords();

  const committees = [...new Set(allRecords.map(r => r.committee).filter(Boolean))];
  const committeeTabsHtml = ["all", ...committees].map(c =>
    `<button data-committee="${escapeHtml(c)}" class="${activeCommitteeFilter === c ? 'active' : ''}">${c === "all" ? "All Committees" : escapeHtml(c)}</button>`
  ).join("");

  el.innerHTML = `

    <div class="tabs" id="committeeSubTabs">${committeeTabsHtml}</div>
    <div class="card">
            <table>
        <tr><th>Student</th><th>Name</th><th>Committee</th><th>Event</th><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th>Status</th><th></th></tr>
        ${filtered.map(r => `
          <tr>
            <td>${escapeHtml(r.studentNo || "")}</td>
            <td>${escapeHtml(r.fullName || "")}</td>
            <td>${escapeHtml(r.committee || "")}</td>
            <td>${escapeHtml(r.eventName || "")}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) : "–"}</td>
            <td>${escapeHtml(r.shift || "")}${r.shiftStart ? ` (${formatTime12(r.shiftStart)}–${formatTime12(r.shiftEnd)})` : ""}</td>
            <td>${r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : "–"}</td>
            <td>${r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : (r.noShow ? "–" : "<span class='badge blue'>Active</span>")}</td>
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>
            <td>${r.noShow ? "<span class='badge red'>No Show</span>" : ""}${r.late ? " <span class='badge orange'>Late</span>" : ""}${r.earlyOut ? " <span class='badge blue'>Early Out</span>" : ""}</td>
            <td><button class="danger" data-action="delete-record" data-id="${r.id}" style="padding:6px 10px;font-size:.75rem;">Del</button></td>          </tr>`).join("")}
    </table>
      ${filtered.length === 0 ? `<p class="muted">No records match this filter.</p>` : ""}
    </div>`;

  document.getElementById("committeeSubTabs").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    activeCommitteeFilter = btn.dataset.committee;
    renderRecords();
  }));

  el.querySelectorAll('[data-action="delete-record"]').forEach(btn => btn.addEventListener("click", async () => {
    if (confirm("Delete this duty record?")) await deleteDoc(doc(db, "dutyRecords", btn.dataset.id));
  }));
}

document.getElementById("exportRecordsBtn").addEventListener("click", async () => {
  const btn = document.getElementById("exportRecordsBtn");
  btn.disabled = true;
  btn.textContent = "Exporting...";
  try {
    await exportRecordsToExcel(getFilteredRecords());
  } catch (err) {
    alert("Export failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "⬇ Export to Excel";
  }
});


// One sheet per committee ("Unassigned" for records with no committee set),
// and inside each sheet, one small table per event — ordered by that
// event's earliest reserved date — rather than one long flat table.
async function exportRecordsToExcel(records) {
  const workbook = new ExcelJS.Workbook();
  const columnDefs = [
    { header: "Student No.", width: 14 },
    { header: "Name", width: 26 },
    { header: "Date", width: 12 },
    { header: "Shift", width: 20 },
    { header: "In", width: 10 },
    { header: "Out", width: 10 },
    { header: "Hrs", width: 8 },
    { header: "Status", width: 20 },
  ];

  const byCommittee = new Map();
  for (const r of records) {
    const committee = r.committee || "Unassigned";
    if (!byCommittee.has(committee)) byCommittee.set(committee, []);
    byCommittee.get(committee).push(r);
  }
  const committeeNames = [...byCommittee.keys()].sort((a, b) =>
    a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)
  );

  for (const committee of committeeNames) {
    const sheet = workbook.addWorksheet(uniqueSheetName(workbook, sanitizeSheetName(committee)));
    sheet.columns = columnDefs.map(c => ({ width: c.width }));


    const byEvent = new Map();
    for (const r of byCommittee.get(committee)) {
      const key = r.eventId || r.eventName || "Unknown Event";
      if (!byEvent.has(key)) byEvent.set(key, { name: r.eventName || "Unknown Event", records: [] });
      byEvent.get(key).records.push(r);
    }
    const eventGroups = [...byEvent.values()].sort((a, b) => {
      const aDate = a.records.map(r => r.date).filter(Boolean).sort()[0] || "";
      const bDate = b.records.map(r => r.date).filter(Boolean).sort()[0] || "";
      return aDate.localeCompare(bDate);
    });

    for (const group of eventGroups) {
      const titleRow = sheet.addRow([group.name]);
      titleRow.font = { bold: true, size: 12 };
      sheet.mergeCells(titleRow.number, 1, titleRow.number, columnDefs.length);

      const headerRow = sheet.addRow(columnDefs.map(c => c.header));
      headerRow.font = { bold: true };
      headerRow.eachCell(cell => { cell.border = { bottom: { style: "thin" } }; });

      const sortedRecords = [...group.records].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      for (const r of sortedRecords) {
        sheet.addRow([
          r.studentNo || "",
          r.fullName || "",
          r.date || "",
          `${r.shift || ""}${r.shiftStart ? ` (${formatTime12(r.shiftStart)}–${formatTime12(r.shiftEnd)})` : ""}`.trim(),
          r.timeIn ? new Date(r.timeIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–",
          r.timeOut ? new Date(r.timeOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : (r.noShow ? "–" : "Active"),
          r.hours != null ? Number(r.hours.toFixed(1)) : "",
          [r.noShow ? "No Show" : "", r.late ? "Late" : "", r.earlyOut ? "Early Out" : ""].filter(Boolean).join(", "),
        ]);
      }

      sheet.addRow([]); // spacer before the next event's table
    }
  }

   const buffer = await workbook.xlsx.writeBuffer();
  // The real Excel mime type, not generic octet-stream — Safari needs this
  // to show a proper "Download"/"Save to Files" prompt instead of a blank page.
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const filename = `LSBRCY-Duty-Records-${new Date().toISOString().slice(0, 10)}.xlsx`;

  // A single same-tab download link, built fresh and clicked immediately —
  // dropped the earlier "open a blank tab up front" trick, since Safari's
  // handling of repeated window.open() calls turned out to be what broke
  // the *second* export, not something helping the first.
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}


// Excel sheet names can't contain \ / ? * [ ] : and are capped at 31 chars.
function sanitizeSheetName(name) {
  return String(name).replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Sheet";
}

// Committee names come from free-text admin input, so two can collide once
// sanitized/truncated (e.g. differing only by whitespace or casing) — that
// causes ExcelJS to throw on a duplicate sheet name.
function uniqueSheetName(workbook, base) {
  let name = base;
  let n = 2;
  while (workbook.getWorksheet(name)) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  return name;
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

