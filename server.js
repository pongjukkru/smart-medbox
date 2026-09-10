const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const LIFF_ID = process.env.LIFF_ID || "YOUR_LIFF_ID";
const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID || "";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

const initialData = { users: {}, devices: {}, logs: [] };
let db = loadData();

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    return structuredClone(initialData);
  }
}
function saveData() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

async function verifyLineIdToken(idToken) {
  if (!LINE_CHANNEL_ID || !idToken) throw new Error("LINE auth is not configured");
  const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID })
  });
  if (!r.ok) throw new Error("invalid LINE ID token");
  const payload = await r.json();
  if (!payload.sub) throw new Error("missing LINE user id");
  return payload;
}

async function authUser(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const payload = await verifyLineIdToken(idToken);
    req.user = {
      id: payload.sub,
      name: payload.name || "LINE user",
      picture: payload.picture || ""
    };
    next();
  } catch (e) {
    res.status(401).json({ error: "unauthorized", message: e.message });
  }
}

function cleanSchedule(s) {
  return {
    id: String(s.id),
    time: String(s.time),
    label: String(s.label || "รับประทานยา"),
    channels: [...new Set(s.channels.map(Number))].filter(n => n >= 1 && n <= 4).sort((a,b)=>a-b),
    enabled: Boolean(s.enabled)
  };
}

function ensureUser(user) {
  if (!db.users[user.id]) {
    db.users[user.id] = { name: user.name, picture: user.picture, schedules: [], devices: [] };
  } else {
    db.users[user.id].name = user.name;
    db.users[user.id].picture = user.picture;
  }
  return db.users[user.id];
}

app.get("/api/config", (req, res) => {
  res.json({ liffId: LIFF_ID, appName: "ตู้จัดยาอัจฉริยะ" });
});

app.get("/api/me", authUser, (req, res) => {
  const u = ensureUser(req.user);
  saveData();
  res.json({ id: req.user.id, name: u.name, picture: u.picture });
});

app.get("/api/schedules", authUser, (req, res) => {
  const u = ensureUser(req.user);
  res.json(u.schedules);
});

app.post("/api/schedules", authUser, (req, res) => {
  const { time, label, channels, enabled = true } = req.body;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || "")) {
    return res.status(400).json({ error: "invalid_time" });
  }
  if (!Array.isArray(channels) || !channels.length ||
      channels.some(n => !Number.isInteger(n) || n < 1 || n > 4)) {
    return res.status(400).json({ error: "invalid_channels" });
  }

  const u = ensureUser(req.user);
  const item = cleanSchedule({
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    time, label, channels, enabled
  });
  u.schedules.push(item);
  u.schedules.sort((a,b) => a.time.localeCompare(b.time));
  saveData();
  res.json(item);
});

app.put("/api/schedules/:id", authUser, (req, res) => {
  const u = ensureUser(req.user);
  const item = u.schedules.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: "not_found" });

  const next = { ...item, ...req.body };
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next.time || "")) {
    return res.status(400).json({ error: "invalid_time" });
  }
  if (!Array.isArray(next.channels) || !next.channels.length ||
      next.channels.some(n => !Number.isInteger(n) || n < 1 || n > 4)) {
    return res.status(400).json({ error: "invalid_channels" });
  }
  Object.assign(item, cleanSchedule(next));
  u.schedules.sort((a,b) => a.time.localeCompare(b.time));
  saveData();
  res.json(item);
});

app.delete("/api/schedules/:id", authUser, (req, res) => {
  const u = ensureUser(req.user);
  u.schedules = u.schedules.filter(s => s.id !== req.params.id);
  saveData();
  res.json({ ok: true });
});

// Bind one physical ESP8266 to the current LINE user.
app.post("/api/device/register", authUser, (req, res) => {
  const deviceId = String(req.body.deviceId || "").trim();
  if (!deviceId || !/^[A-Za-z0-9_-]{3,32}$/.test(deviceId)) {
    return res.status(400).json({ error: "invalid_device_id" });
  }
  const u = ensureUser(req.user);

  // Remove the device from any previous owner.
  for (const d of Object.values(db.devices)) {
    if (d.ownerId === req.user.id && d.deviceId === deviceId) d.ownerId = req.user.id;
  }
  db.devices[deviceId] = {
    deviceId,
    ownerId: req.user.id,
    registeredAt: new Date().toISOString()
  };
  if (!u.devices.includes(deviceId)) u.devices.push(deviceId);
  saveData();
  res.json({ ok: true, deviceId });
});

app.get("/api/device/status", authUser, (req, res) => {
  const u = ensureUser(req.user);
  res.json(u.devices.map(id => db.devices[id]?.status || { deviceId: id, online: false }));
});

// ESP8266 asks for its current schedule. No LINE token is needed here.
app.get("/api/device/schedule", (req, res) => {
  const deviceId = String(req.query.deviceId || "");
  const device = db.devices[deviceId];
  if (!device) return res.status(404).json({ error: "device_not_registered" });

  const u = db.users[device.ownerId];
  if (!u) return res.status(404).json({ error: "owner_not_found" });

  res.json({
    deviceId,
    serverTime: new Date().toISOString(),
    schedules: u.schedules
  });
});

app.post("/api/device/status", (req, res) => {
  const deviceId = String(req.body.deviceId || "");
  const device = db.devices[deviceId];
  if (!device) return res.status(404).json({ error: "device_not_registered" });

  device.status = {
    deviceId,
    online: true,
    alarm: Boolean(req.body.alarm),
    rtc: String(req.body.rtc || ""),
    lastSeen: new Date().toISOString()
  };
  saveData();
  res.json({ ok: true });
});

app.post("/api/device/log", (req, res) => {
  const deviceId = String(req.body.deviceId || "");
  const device = db.devices[deviceId];
  if (!device) return res.status(404).json({ error: "device_not_registered" });

  const entry = {
    id: Date.now().toString(36),
    deviceId,
    time: String(req.body.time || ""),
    channels: Array.isArray(req.body.channels) ? req.body.channels : [],
    result: String(req.body.result || "dispensed"),
    createdAt: new Date().toISOString()
  };
  db.logs.unshift(entry);
  db.logs = db.logs.slice(0, 500);
  saveData();
  res.json({ ok: true });
});

app.get("/api/history", authUser, (req, res) => {
  const u = ensureUser(req.user);
  const owned = new Set(u.devices);
  res.json(db.logs.filter(x => owned.has(x.deviceId)).slice(0, 100));
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`Smart MedBox running on port ${PORT}`));