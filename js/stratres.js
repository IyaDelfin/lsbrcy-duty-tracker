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
  const filtered = activeEventFilter === "all" ? allRecords : allRecords.filter(r => r.eventId === activeEventFilter);
  const el = document.getElementById("recordsList");
  el.innerHTML = `
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
            <td>${r.hours != null ? r.hours.toFixed(1) : "–"}</td>     </tr>`).join("")}
      </table>
      ${filtered.length === 0 ? `<p class="muted">No duty records for this event yet.</p>` : ""}
    </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
