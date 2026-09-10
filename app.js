let idToken = "";
let medicineNames = JSON.parse(localStorage.getItem("medNames") || '["ยา 1","ยา 2","ยา 3","ยา 4"]');

const $ = id => document.getElementById(id);
const authHeaders = () => ({ "Authorization": `Bearer ${idToken}`, "Content-Type": "application/json" });

async function init() {
  try {
    const cfg = await fetch("/api/config").then(r => r.json());
    if (!window.liff || !cfg.liffId || cfg.liffId === "YOUR_LIFF_ID") {
      $("lineStatus").textContent = "ยังไม่ได้ตั้งค่า LIFF";
      return;
    }
    await liff.init({ liffId: cfg.liffId });
    if (!liff.isLoggedIn()) { liff.login(); return; }
    idToken = liff.getIDToken();
    if (!idToken) throw new Error("ไม่พบ LINE ID token");

    const me = await fetch("/api/me", {headers: authHeaders()}).then(r => r.json());
    $("lineStatus").textContent = `LINE: ${me.name}`;
    if (me.picture) $("avatar").innerHTML = `<img src="${escapeHtml(me.picture)}" alt="">`;

    loadMedicineNames();
    await Promise.all([loadSchedules(), loadStatus(), loadHistory()]);
    setInterval(updateClock,1000);
    setInterval(loadStatus,10000);
    updateClock();
  } catch(e) {
    console.error(e);
    $("lineStatus").textContent = "เชื่อมต่อ LINE ไม่สำเร็จ";
    alert("เปิดผ่าน LINE MINI App และตรวจสอบ LIFF ID / Channel ID");
  }
}

function updateClock(){
  $("clock").textContent = new Date().toLocaleTimeString("th-TH",{hour12:false});
}

async function loadSchedules(){
  const r=await fetch("/api/schedules",{headers:authHeaders()});
  if(!r.ok)return;
  renderSchedules(await r.json());
}

function renderSchedules(items){
  const box=$("scheduleList");
  if(!items.length){box.innerHTML='<p class="hint">ยังไม่มีตารางรับยา</p>';return;}
  box.innerHTML=items.map(s=>`
    <div class="schedule">
      <div class="schedule-main">
        <div><div class="time">${s.time}</div><div class="label">${escapeHtml(s.label)}</div></div>
        <div>${s.enabled?"🟢":"⚪"}</div>
      </div>
      <div class="pills">${s.channels.map(c=>`<span class="pill">💊 ช่อง ${c}: ${escapeHtml(medicineNames[c-1])}</span>`).join("")}</div>
      <div class="actions">
        <button class="small" onclick="toggleSchedule('${s.id}',${!s.enabled})">${s.enabled?"ปิด":"เปิด"}</button>
        <button class="small" onclick="deleteSchedule('${s.id}')">ลบ</button>
      </div>
    </div>`).join("");
}

async function toggleSchedule(id,enabled){
  await fetch(`/api/schedules/${id}`,{method:"PUT",headers:authHeaders(),body:JSON.stringify({enabled})});
  loadSchedules();
}
async function deleteSchedule(id){
  if(!confirm("ลบเวลานี้ใช่หรือไม่?"))return;
  await fetch(`/api/schedules/${id}`,{method:"DELETE",headers:authHeaders()});
  loadSchedules();
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

$("addBtn").onclick=()=>{$("modal").classList.remove("hidden")};
$("closeBtn").onclick=()=>{$("modal").classList.add("hidden")};

$("saveBtn").onclick=async()=>{
  const channels=[...document.querySelectorAll(".channels input:checked")].map(x=>Number(x.value));
  if(!channels.length)return alert("เลือกช่องยาอย่างน้อย 1 ช่อง");
  const time=$("timeInput").value;
  if(!time)return alert("เลือกเวลาก่อน");
  const payload={time,label:$("labelInput").value||"รับประทานยา",channels,enabled:true};
  const r=await fetch("/api/schedules",{method:"POST",headers:authHeaders(),body:JSON.stringify(payload)});
  if(!r.ok)return alert("บันทึกไม่สำเร็จ");
  document.querySelectorAll(".channels input").forEach(x=>x.checked=false);
  $("modal").classList.add("hidden");
  loadSchedules();
};

function loadMedicineNames(){
  ["med1","med2","med3","med4"].forEach((id,i)=>$(id).value=medicineNames[i]);
}
$("saveMeds").onclick=()=>{
  medicineNames=["med1","med2","med3","med4"].map(id=>$(id).value.trim()||"ยา");
  localStorage.setItem("medNames",JSON.stringify(medicineNames));
  loadSchedules();
  alert("บันทึกชื่อยาแล้ว");
};

$("registerBtn").onclick=async()=>{
  const deviceId=$("deviceId").value.trim();
  const r=await fetch("/api/device/register",{method:"POST",headers:authHeaders(),body:JSON.stringify({deviceId})});
  alert(r.ok?"ผูกตู้เรียบร้อย":"ผูกตู้ไม่สำเร็จ");
  loadStatus();
};

async function loadStatus(){
  const r=await fetch("/api/device/status",{headers:authHeaders()});
  if(!r.ok)return;
  const rows=await r.json(), id=$("deviceId").value.trim();
  const d=rows.find(x=>x.deviceId===id);
  if(!d){$("deviceState").textContent="ยังไม่ได้ผูกตู้";return;}
  const online=d.lastSeen && Date.now()-new Date(d.lastSeen).getTime()<30000;
  $("deviceState").textContent=online?"🟢 ตู้ออนไลน์":"🔴 ตู้ออฟไลน์";
}

async function loadHistory(){
  const r=await fetch("/api/history",{headers:authHeaders()});
  if(!r.ok)return;
  const rows=await r.json();
  $("history").innerHTML=rows.length?rows.map(x=>`
    <div class="history">💊 ${escapeHtml(x.time)} • ช่อง ${x.channels.join(", ")} • ${escapeHtml(x.result)}</div>
  `).join(""):'<p class="hint">ยังไม่มีประวัติ</p>';
}
$("refreshHistory").onclick=loadHistory;

init();
