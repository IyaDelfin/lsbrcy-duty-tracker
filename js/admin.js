const name = document.getElementById("evName").value.trim();
const location = document.getElementById("evLocation").value.trim();
const category = document.getElementById("evCategory").value;
   const maxHoursRaw = document.getElementById("evMaxHours").value.trim();
  const maxHoursRaw = document.getElementById("evMaxHours").value.trim();
const maxHours = maxHoursRaw === "" ? null : parseFloat(maxHoursRaw);
const maxVolunteersRaw = document.getElementById("evMaxVolunteers").value.trim();
const maxVolunteers = maxVolunteersRaw === "" ? null : parseInt(maxVolunteersRaw, 10);
  const maxPerMemberRaw = document.getElementById("evMaxPerMember").value.trim();
  const maxPerMember = maxPerMemberRaw === "" ? null : parseInt(maxPerMemberRaw, 10);
const startDate = document.getElementById("evStartDate").value || null;
const endDate = document.getElementById("evEndDate").value || null;
const pic = document.getElementById("evPic").value.trim();
const compliance = document.getElementById("evCompliance").value.trim();
if (!name) return;

  await addDoc(collection(db, "events"), {
    name, location, category, maxHours, maxVolunteers, startDate, endDate, pic, compliance,
    await addDoc(collection(db, "events"), {
    name, location, category, maxHours, maxVolunteers, maxPerMember, startDate, endDate, pic, compliance,
status: "active",
signupCount: 0,
createdAt: Date.now()
});

   ["evName","evLocation","evMaxHours","evMaxVolunteers","evStartDate","evEndDate","evPic","evCompliance"].forEach(id => document.getElementById(id).value = "");
  ["evName","evLocation","evMaxHours","evMaxVolunteers","evMaxPerMember","evStartDate","evEndDate","evPic","evCompliance"].forEach(id => document.getElementById(id).value = "");

});

function renderEvents() {
@@ -188,6 +191,7 @@ function renderEvents() {
     ${ev.pic ? `<p class="muted">PIC: ${escapeHtml(ev.pic)}</p>` : ""}
     ${ev.maxHours != null ? `<p class="muted">Max hours: ${ev.maxHours}</p>` : ""}
     ${ev.maxVolunteers != null ? `<p class="muted">Max per day: ${ev.maxVolunteers}${ev.volunteersByDate ? ' · Total reservations: ' + Object.values(ev.volunteersByDate).reduce((s,a)=>s+a.length,0) : ''}</p>` : ""}
      ${ev.maxPerMember != null ? `<p class="muted">Max days per member: ${ev.maxPerMember}</p>` : ""}
     ${ev.compliance ? `<p class="muted" style="color:var(--red);">${escapeHtml(ev.compliance)}</p>` : ""}
   </div>`).join("") || `<p class="muted">No events match this filter.</p>`;
