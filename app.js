/* Khatri × ESP7 Free Fire Tournament — pure HTML/JS + Firebase */

const firebaseConfig = {
  apiKey: "AIzaSyBIr6Y2y6prLKgd7P857yCnY60eUhIOd8o",
  authDomain: "kxl-9cd03.firebaseapp.com",
  projectId: "kxl-9cd03",
  storageBucket: "kxl-9cd03.firebasestorage.app",
  messagingSenderId: "617940943718",
  appId: "1:617940943718:web:9a3f2aa243e544ab12bea7",
  measurementId: "G-6FCS278QPV",
};

const REGISTRATIONS_COL = "ff_tournament_registrations_vihaan_espx";
const SETTINGS_COL = "ff_tournament_settings_vihaan_espx";
const SETTINGS_ID = "main";
const TOTAL_SLOTS = 16;
const YT_URL = "https://youtube.com/@vihaan_espx?si=04AwPwUyIOK2nLon";
const SUPPORT_TEL = "461430657";
const ADMIN_ID = "espx_admin";
const ADMIN_PASSWORD = "khatri1k";
const ADMIN_SESSION_KEY = "ff_tournament_admin_session_vihaan_espx";

const MODE_LABELS = { SOLO: "Solo", DUO: "Duo", SQUAD: "Squad", CS: "Clash Squad" };
const EMPTY_ROOMS = {
  SOLO: { id: "", pass: "" },
  DUO: { id: "", pass: "" },
  SQUAD: { id: "", pass: "" },
  CS: { id: "", pass: "" },
};

// ── State ──────────────────────────────────────────────
const state = {
  registrations: [],
  settings: {
    closed: false,
    rooms: { ...EMPTY_ROOMS },
    revealPublic: false,
    vsPublic: false,
    revealPlaying: false,
    revealIdx: 0,
    vsMatch: { aId: "", bId: "", date: "", time: "" },
  },
  ready: false,
  error: null,
  route: "/",
  // reveal
  revealIdx: 0,
  revealPlaying: false,
  revealCurtain: false,
  revealTimer: null,
  // vs
  vsA: "",
  vsB: "",
  vsDate: "",
  vsTime: "",
  vsPreview: "",
  vsBusy: false,
  vsErr: "",
  // admin
  adminAuthed: false,
  adminErr: "",
  adminQ: "",
  adminRooms: null,
  adminSaved: "",
  // register
  logoDataUrl: "",
  regBusy: false,
  modalOpen: false,
  subscribed: false,
  modalErr: "",
  confirmId: "",
  confirmName: "",
  draft: {},
  // public team select (with room)
  selectedTeamId: "",
};

// ── Firebase ───────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

function clean(value) {
  return JSON.parse(JSON.stringify(value));
}

function firestoreMessage(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/exceeds|too large|1 MiB|1048576/i.test(msg)) {
    return "Logo is too large for the database. Try a simpler square JPG.";
  }
  if (/permission|insufficient/i.test(msg)) {
    return "Firebase permission error. Check Firestore rules for this project.";
  }
  return err && err.message ? err.message : "Firebase request failed";
}

function subscribeRegistrations() {
  const col = db.collection(REGISTRATIONS_COL);
  return col.orderBy("createdAt").onSnapshot(
    (snap) => {
      const rows = snap.docs.map((d) => d.data());
      rows.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      state.registrations = rows;
      state.error = null;
      state.ready = true;
      render();
    },
    () => {
      // fallback without orderBy
      col.onSnapshot(
        (snap) => {
          const rows = snap.docs.map((d) => d.data());
          rows.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
          state.registrations = rows;
          state.error = null;
          state.ready = true;
          render();
        },
        (err) => {
          state.error = err.message;
          state.ready = true;
          render();
        }
      );
    }
  );
}

function subscribeSettings() {
  return db
    .collection(SETTINGS_COL)
    .doc(SETTINGS_ID)
    .onSnapshot(
      (snap) => {
        const data = snap.exists ? snap.data() : {};
        const vm = data.vsMatch || {};
        const nextSettings = {
          closed: !!data.closed,
          rooms: Object.assign({}, EMPTY_ROOMS, data.rooms || {}),
          revealPublic: !!data.revealPublic,
          vsPublic: !!data.vsPublic,
          revealPlaying: !!data.revealPlaying,
          revealIdx: typeof data.revealIdx === "number" ? data.revealIdx : 0,
          vsMatch: {
            aId: vm.aId || "",
            bId: vm.bId || "",
            date: vm.date || "",
            time: vm.time || "",
          },
        };
        // Keep admin form fields in sync when match published
        if (nextSettings.vsMatch.aId) state.vsA = nextSettings.vsMatch.aId;
        if (nextSettings.vsMatch.bId) state.vsB = nextSettings.vsMatch.bId;
        if (nextSettings.vsMatch.date) state.vsDate = nextSettings.vsMatch.date;
        if (nextSettings.vsMatch.time) state.vsTime = nextSettings.vsMatch.time;
        state.settings = nextSettings;
        state.adminRooms = JSON.parse(JSON.stringify(nextSettings.rooms));
        state.adminAuthed = isAdminLoggedIn();

        // Sync public reveal stage from admin (Firebase is source of truth)
        const n = state.registrations.length;
        const idx = n > 0 ? Math.min(Math.max(0, nextSettings.revealIdx), n - 1) : 0;
        if (state.revealIdx !== idx) {
          state.revealCurtain = true;
          state.revealIdx = idx;
          setTimeout(() => {
            state.revealCurtain = false;
            if (state.route === "/reveal" || state.route === "/admin") render();
          }, 280);
        }
        state.revealPlaying = nextSettings.revealPlaying;
        syncRevealTimer();

        state.ready = true;
        render();
      },
      (err) => {
        state.error = err.message;
        render();
      }
    );
}

async function saveRegistration(entry) {
  const id = "FF-" + Date.now().toString(36).toUpperCase();
  const payload = clean({
    ...entry,
    logoDataUrl: entry.logoDataUrl || "",
    tagline: entry.tagline || "",
    id,
    createdAt: new Date().toISOString(),
    status: "pending",
  });
  try {
    await db.collection(REGISTRATIONS_COL).doc(id).set(payload);
  } catch (err) {
    throw new Error(firestoreMessage(err));
  }
  return id;
}

async function updateRegistrationStatus(id, status) {
  await db.collection(REGISTRATIONS_COL).doc(id).update({ status });
}

async function updateRegistrationLogo(id, logoDataUrl) {
  try {
    await db.collection(REGISTRATIONS_COL).doc(id).update({ logoDataUrl });
  } catch (err) {
    throw new Error(firestoreMessage(err));
  }
}

async function deleteRegistration(id) {
  await db.collection(REGISTRATIONS_COL).doc(id).delete();
}

async function clearAllRegistrations(ids) {
  await Promise.all(ids.map((id) => deleteRegistration(id)));
}

async function setManuallyClosed(val) {
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set({ closed: val }, { merge: true });
}

async function saveRoomSettings(mode, id, pass) {
  const next = { ...state.settings.rooms, [mode]: { id, pass } };
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set({ rooms: next }, { merge: true });
}

async function updateVsPublic(val) {
  const payload = { vsPublic: !!val };
  if (val) {
    payload.vsMatch = {
      aId: state.vsA || "",
      bId: state.vsB || "",
      date: state.vsDate || "",
      time: state.vsTime || "",
    };
    // When publishing VS, hide reveal takeover so poster owns the screen
    payload.revealPublic = false;
    payload.revealPlaying = false;
  }
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set(payload, { merge: true });
}

async function updateRevealPublic(val) {
  const payload = { revealPublic: !!val };
  if (val) {
    // Reveal LIVE takes full public screen — unpublish VS
    payload.vsPublic = false;
  }
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set(payload, { merge: true });
}

async function updateRevealLive(playing, idx) {
  const payload = { revealPlaying: !!playing };
  if (typeof idx === "number") payload.revealIdx = idx;
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set(payload, { merge: true });
}

// One-click: go LIVE on the public page and start auto-play immediately
async function startRevealShow() {
  await db
    .collection(SETTINGS_COL)
    .doc(SETTINGS_ID)
    .set({ revealPublic: true, vsPublic: false, revealPlaying: true, revealIdx: 0 }, { merge: true });
}
// Stop the reveal auto-play (leaves the last card up until admin hides it)
async function stopRevealShow() {
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set({ revealPlaying: false }, { merge: true });
}

function syncRevealTimer() {
  if (state.revealTimer) {
    clearInterval(state.revealTimer);
    state.revealTimer = null;
  }
  // Only the admin browser advances the index when playing, so public stays in sync via Firebase
  if (!state.revealPlaying || !state.adminAuthed) return;
  state.revealTimer = setInterval(async () => {
    const n = state.registrations.length;
    if (!n) return;
    if (state.revealIdx >= n - 1) {
      // Last team shown — stop cycling and auto-reveal the VS poster if it's set up
      clearInterval(state.revealTimer);
      state.revealTimer = null;
      try {
        await updateRevealLive(false, state.revealIdx);
        const m = state.settings.vsMatch || {};
        if (m.aId && m.bId) {
          await updateVsPublic(true);
        }
      } catch (e) {
        console.error(e);
      }
      return;
    }
    const next = state.revealIdx + 1;
    try {
      await updateRevealLive(true, next);
    } catch (e) {
      console.error(e);
    }
  }, 4200);
}

// ── Utils ──────────────────────────────────────────────
function teamInitials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "FF";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function rosterFor(t) {
  const list = [{ name: (t.captain && t.captain.name) || "", uid: (t.captain && t.captain.uid) || "" }];
  if (t.mode === "SOLO") return list.filter((p) => p.name);
  if (t.teammate2) list.push(t.teammate2);
  if (t.mode === "DUO") return list.filter((p) => p.name);
  if (t.teammate3) list.push(t.teammate3);
  if (t.teammate4 && t.teammate4.name) list.push(t.teammate4);
  return list.filter((p) => p.name);
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slotsLeft() {
  return Math.max(TOTAL_SLOTS - state.registrations.length, 0);
}

function isClosed() {
  return state.settings.closed || slotsLeft() === 0;
}

// Admin session
function isAdminLoggedIn() {
  try {
    return localStorage.getItem(ADMIN_SESSION_KEY) === "true" || sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}
function loginAdmin() {
  try {
    localStorage.setItem(ADMIN_SESSION_KEY, "true");
    sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
  } catch {}
  state.adminAuthed = true;
}
function logoutAdmin() {
  try {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {}
  state.adminAuthed = false;
}
function credentialsMatch(id, pass) {
  return id.trim().toLowerCase() === ADMIN_ID.toLowerCase() && pass.trim() === ADMIN_PASSWORD;
}

// Logo compress
const MAX_SIZE = 256;
const MAX_DATA_URL = 650000;

async function compressLogo(file) {
  if (!file) throw new Error("No file");
  if (file.size > 12 * 1024 * 1024) throw new Error("Image too large (max 12MB)");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not read that image. Try a JPG or PNG."));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_SIZE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  let quality = 0.85;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > MAX_DATA_URL && quality > 0.4) {
    quality -= 0.1;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  if (out.length > MAX_DATA_URL) throw new Error("Logo is still too large after compression.");
  return out;
}

// VS Poster — improved theme
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLogo(ctx, img, name, cx, cy, size) {
  const x = cx - size / 2;
  const y = cy - size / 2;
  ctx.save();
  roundRect(ctx, x, y, size, size, 28);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, size, size);
  } else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, "#FF5A1F");
    g.addColorStop(1, "#FFB627");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#0E0B08";
    ctx.font = "700 72px Rajdhani, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(teamInitials(name), cx, cy + 4);
  }
  ctx.restore();
  // gold ring
  ctx.strokeStyle = "rgba(255,182,39,0.7)";
  ctx.lineWidth = 5;
  roundRect(ctx, x, y, size, size, 28);
  ctx.stroke();
  // outer glow ring
  ctx.strokeStyle = "rgba(255,90,31,0.35)";
  ctx.lineWidth = 2;
  roundRect(ctx, x - 6, y - 6, size + 12, size + 12, 32);
  ctx.stroke();
}

async function renderVsPoster(a, b, matchDate, matchTime) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const [imgA, imgB] = await Promise.all([loadImg(a.logoDataUrl || ""), loadImg(b.logoDataUrl || "")]);

  // Deep ember / charcoal gradient background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1a0c06");
  bg.addColorStop(0.35, "#0E0B08");
  bg.addColorStop(0.65, "#120d08");
  bg.addColorStop(1, "#1f1008");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Diagonal accent stripe
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.35);
  const stripe = ctx.createLinearGradient(-800, 0, 800, 0);
  stripe.addColorStop(0, "transparent");
  stripe.addColorStop(0.4, "rgba(255,90,31,0.08)");
  stripe.addColorStop(0.5, "rgba(255,182,39,0.14)");
  stripe.addColorStop(0.6, "rgba(255,90,31,0.08)");
  stripe.addColorStop(1, "transparent");
  ctx.fillStyle = stripe;
  ctx.fillRect(-900, -40, 1800, 80);
  ctx.restore();

  // Soft orbs
  ctx.fillStyle = "rgba(255,90,31,0.18)";
  ctx.beginPath();
  ctx.ellipse(160, -20, 380, 260, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,182,39,0.12)";
  ctx.beginPath();
  ctx.ellipse(960, 1380, 360, 240, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(110,168,254,0.06)";
  ctx.beginPath();
  ctx.ellipse(540, 700, 200, 120, 0, 0, Math.PI * 2);
  ctx.fill();

  // Top brand bar
  ctx.fillStyle = "rgba(255,182,39,0.9)";
  ctx.font = "700 26px Rajdhani, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("KHATRI  ×  ESP7", W / 2, 72);
  ctx.fillStyle = "#F2EDE6";
  ctx.font = "700 56px Rajdhani, sans-serif";
  ctx.fillText("MATCHDAY", W / 2, 138);
  ctx.fillStyle = "#B8AFA4";
  ctx.font = "500 20px Inter, sans-serif";
  ctx.fillText("1K SPECIAL  ·  FREE FIRE  ·  CLASH SQUAD", W / 2, 176);

  // Match date & time
  const dtParts = [];
  if (matchDate) {
    try {
      const d = new Date(matchDate + "T12:00:00");
      dtParts.push(d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
    } catch {
      dtParts.push(matchDate);
    }
  }
  if (matchTime) {
    try {
      const [hh, mm] = matchTime.split(":");
      const h = parseInt(hh, 10);
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = ((h + 11) % 12) + 1;
      dtParts.push(h12 + ":" + (mm || "00") + " " + ampm);
    } catch {
      dtParts.push(matchTime);
    }
  }
  if (dtParts.length) {
    ctx.fillStyle = "#FFB627";
    ctx.font = "700 24px Rajdhani, sans-serif";
    ctx.fillText(dtParts.join("  ·  ").toUpperCase(), W / 2, 210);
  }

  // Decorative line under header
  const lineGrad = ctx.createLinearGradient(200, 0, 880, 0);
  lineGrad.addColorStop(0, "transparent");
  lineGrad.addColorStop(0.5, "rgba(255,182,39,0.5)");
  lineGrad.addColorStop(1, "transparent");
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(200, 230);
  ctx.lineTo(880, 230);
  ctx.stroke();

  // Team A
  drawLogo(ctx, imgA, a.teamName, W / 2, 420, 250);
  ctx.fillStyle = "#F2EDE6";
  ctx.font = "700 40px Rajdhani, sans-serif";
  ctx.fillText((a.teamName || "").toUpperCase(), W / 2, 595);
  ctx.fillStyle = "#FFB627";
  ctx.font = "600 18px Inter, sans-serif";
  ctx.fillText(((a.tagline || MODE_LABELS[a.mode] || "CLASH SQUAD")).toUpperCase(), W / 2, 625);

  // VS badge
  ctx.save();
  const vsY = 700;
  // hexagon-ish badge
  ctx.fillStyle = "rgba(255,90,31,0.15)";
  roundRect(ctx, W / 2 - 70, vsY - 48, 140, 70, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,90,31,0.6)";
  ctx.lineWidth = 2;
  roundRect(ctx, W / 2 - 70, vsY - 48, 140, 70, 16);
  ctx.stroke();
  ctx.fillStyle = "#FF5A1F";
  ctx.font = "700 56px Rajdhani, sans-serif";
  ctx.fillText("VS", W / 2, vsY + 8);
  ctx.restore();

  // Team B
  drawLogo(ctx, imgB, b.teamName, W / 2, 920, 260);
  ctx.fillStyle = "#F2EDE6";
  ctx.font = "700 40px Rajdhani, sans-serif";
  ctx.fillText((b.teamName || "").toUpperCase(), W / 2, 1095);
  ctx.fillStyle = "#FFB627";
  ctx.font = "600 18px Inter, sans-serif";
  ctx.fillText(((b.tagline || MODE_LABELS[b.mode] || "CLASH SQUAD")).toUpperCase(), W / 2, 1127);

  // Rosters
  ctx.fillStyle = "#565D67";
  ctx.font = "500 15px Inter, sans-serif";
  const ra = rosterFor(a).map((p) => p.name).join("  ·  ");
  const rb = rosterFor(b).map((p) => p.name).join("  ·  ");
  ctx.fillText(ra.slice(0, 72), W / 2, 1220);
  ctx.fillText(rb.slice(0, 72), W / 2, 1246);

  // Footer bar
  ctx.fillStyle = "rgba(255,90,31,0.12)";
  ctx.fillRect(0, 1285, W, 65);
  ctx.fillStyle = "#B8AFA4";
  ctx.font = "500 16px Inter, sans-serif";
  ctx.fillText(dtParts.length ? dtParts.join("  ·  ") + "  ·  Stream live" : "Stream live · Room ID on YouTube", W / 2, 1325);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export poster"));
    }, "image/png");
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Team card HTML ─────────────────────────────────────
function teamCardHtml(team, index, featured) {
  const players = rosterFor(team);
  const mode = team.mode || "SQUAD";
  const modeClass =
    mode === "CS" ? "mode-cs" : mode === "SOLO" ? "mode-solo" : mode === "DUO" ? "mode-duo" : "mode-squad";
  const logo = team.logoDataUrl
    ? `<img src="${escapeHtml(team.logoDataUrl)}" alt="${escapeHtml(team.teamName)} logo" />`
    : `<div class="mono">${escapeHtml(teamInitials(team.teamName))}</div>`;
  const idxBadge = typeof index === "number" ? `<span class="idx">#${String(index + 1).padStart(2, "0")}</span>` : "";
  const roster = players
    .map(
      (p, i) =>
        `<li><span class="dot"></span><span class="name">${escapeHtml(p.name)}</span>${
          i === 0 ? '<span class="cap">Captain</span>' : ""
        }</li>`
    )
    .join("");
  return `
    <article class="team-card${featured ? " featured" : ""}">
      <div class="thumb">${logo}${idxBadge}<span class="mode-tag ${modeClass}">${escapeHtml(MODE_LABELS[mode] || mode)}</span></div>
      <div class="body">
        <h3>${escapeHtml(team.teamName)}</h3>
        ${team.tagline ? `<p class="tagline">${escapeHtml(team.tagline)}</p>` : ""}
        <ul class="roster">${roster}</ul>
      </div>
    </article>`;
}

// ── Pages ──────────────────────────────────────────────
function renderHome() {
  const regs = state.registrations;
  const rooms = state.settings.rooms;
  const left = slotsLeft();
  const full = isClosed();
  const activeModes = ["CS"].filter((m) => rooms[m] && rooms[m].id);

  const roomBlock =
    activeModes.length > 0
      ? `<div class="room-panel">
          <h4>Room details</h4>
          <div class="room-grid">
            ${activeModes
              .map(
                (m) => `
              <div class="room-item">
                <div class="lbl">${MODE_LABELS[m]} — Room ID</div>
                <div class="val">${escapeHtml(rooms[m].id)}</div>
                <div class="lbl">Password</div>
                <div class="val">${escapeHtml(rooms[m].pass || "—")}</div>
              </div>`
              )
              .join("")}
          </div>
          <div class="team-room-select">
            <label>Select your team (with room ID & password)
              <select id="publicTeamSelect">
                <option value="">— Choose team —</option>
                ${regs.map((t) => `<option value="${escapeHtml(t.id)}" ${state.selectedTeamId === t.id ? "selected" : ""}>${escapeHtml(t.teamName)}</option>`).join("")}
              </select>
            </label>
            ${
              state.selectedTeamId
                ? (() => {
                    const t = regs.find((r) => r.id === state.selectedTeamId);
                    if (!t) return "";
                    const modeRoom = rooms.CS || { id: "", pass: "" };
                    return `<div class="room-item" style="margin-top:0.5rem;padding:0.75rem;border:1px solid var(--line);border-radius:0.5rem;background:var(--bg)">
                      <div class="lbl">Team</div><div class="val">${escapeHtml(t.teamName)}</div>
                      <div class="lbl">Mode</div><div class="val">${escapeHtml(MODE_LABELS[t.mode] || t.mode)}</div>
                      <div class="lbl">Room ID</div><div class="val">${escapeHtml(modeRoom.id || "—")}</div>
                      <div class="lbl">Password</div><div class="val">${escapeHtml(modeRoom.pass || "—")}</div>
                    </div>`;
                  })()
                : ""
            }
          </div>
        </div>`
      : "";

  return `
    <div class="page">
      <header class="hero">
        <div class="hero-clip"></div>
        <div class="container" style="position:relative">
          <a href="${YT_URL}" target="_blank" rel="noopener" class="yt-badge">
            <span class="yt-play">▶</span>
            Khatri x ESP7
            <small style="font-weight:400;color:var(--muted)">@VIHAAN_ESPx</small>
          </a>
          <div class="badge-gold">1K SPECIAL TOURNAMENT</div>
          <p style="font-size:0.875rem;font-weight:600;letter-spacing:0.04em;color:var(--gold)">CLASH SQUAD REGISTRATION · FREE FIRE</p>
          <h1>Khatri x ESP7<br /><em>Free Fire</em> Tournament</h1>
          <p class="hero-sub">Upload your squad logo, lock your IGNs, and get a professional reveal card. Room ID & password drop here and on the live stream.</p>
          <div class="stats-row">
            <div class="stat-box"><div class="num">${regs.length}</div><div class="lbl">Teams registered</div></div>
            <div class="stat-box"><div class="num">${left}</div><div class="lbl">Slots remaining</div></div>
            <span class="status-dot ${full ? "status-closed" : "status-open"}">
              <span class="dot"></span>
              ${state.settings.closed ? "Registration closed" : left === 0 ? "Slots full" : "Registration open"}
            </span>
          </div>
          ${roomBlock}
        </div>
      </header>

      <section class="section">
        <div class="container">
          <h2 style="font-size:1.625rem">Tournament details</h2>
          <p class="text-muted" style="margin-top:0.25rem;font-size:0.875rem">Everything you need before you register.</p>
          <div class="details-grid">
            ${[
              ["Game", "Free Fire"],
              ["Format", "Clash Squad (CS)"],
              ["Prize pool", "₹1,000"],
              ["Entry fee", "Free"],
              ["Total slots", TOTAL_SLOTS + " teams"],
              ["Match date", "Announced on YouTube live"],
            ]
              .map(([l, v]) => `<div class="details-cell"><div class="lbl">${l}</div><div class="val">${v}</div></div>`)
              .join("")}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2 style="font-size:1.625rem">Rules</h2>
          <ol class="rules-list">
            <li><strong>One entry per team.</strong> Duplicates from the same squad will be removed.</li>
            <li><strong>IGN and UID must match</strong> your in-game profile exactly.</li>
            <li><strong>No hacking, teaming, or emulator abuse.</strong> Fair play is enforced.</li>
            <li><strong>Be online 15 minutes before</strong> match time. Room ID is posted above and on stream.</li>
            <li><strong>Results and clips</strong> go on the Khatri x ESP7 YouTube channel.</li>
            <li>Host decisions during the tournament are final.</li>
          </ol>
        </div>
      </section>

      <section class="section" id="register">
        <div class="container">
          <h2 style="font-size:1.625rem">Register your squad</h2>
          <p class="text-muted" style="margin-top:0.25rem;font-size:0.875rem">Clash Squad only · Add a logo and motto — they power your reveal card and VS poster.</p>
          <div class="mt-6">${renderRegisterForm()}</div>
          <p class="mt-4 text-muted" style="font-size:0.875rem">Need help? Customer support: <a href="tel:${SUPPORT_TEL}" class="text-gold" style="font-weight:600">${SUPPORT_TEL}</a></p>
        </div>
      </section>

      <footer class="site-footer">
        <p>Khatri x ESP7 Free Fire Tournament · community-run event, not affiliated with Garena.</p>
        <p><a href="${YT_URL}" target="_blank" rel="noopener">Watch live on YouTube</a></p>
        <p>Customer support: <a href="tel:${SUPPORT_TEL}">${SUPPORT_TEL}</a></p>
        <p style="letter-spacing:0.06em">Developed by Lord Plays</p>
      </footer>
    </div>
    ${state.modalOpen ? renderModal() : ""}
    ${state.confirmId ? renderConfirm() : ""}
  `;
}

function renderRegisterForm() {
  if (isClosed()) {
    return `<div class="empty-state">Registration is closed. Check back on the stream for updates.</div>`;
  }
  return `
    <form id="regForm" class="form-stack" novalidate>
      <fieldset>
        <legend>Team</legend>
        <div class="field-grid cols-2">
          <div class="field">
            <label for="teamName">Team name</label>
            <input id="teamName" placeholder="e.g. Ember Squad" required />
            <div class="err-msg" id="err-teamName"></div>
          </div>
          <div class="field">
            <label>Mode</label>
            <div class="mode-locked">⚔ Clash Squad (CS) — only mode open</div>
            <input type="hidden" id="modeSelect" value="CS" />
          </div>
        </div>
        <div class="field">
          <label for="tagline">Tagline / motto <span class="opt">(optional)</span></label>
          <input id="tagline" placeholder="e.g. Born to clutch" maxlength="48" />
        </div>
        <div class="field">
          <label>Team logo <span class="opt">(optional, square works best)</span></label>
          <div class="logo-picker" id="logoPicker">
            ${state.logoDataUrl ? `<img src="${escapeHtml(state.logoDataUrl)}" alt="logo" />` : ""}
            <div>${state.logoDataUrl ? "Tap to replace" : "Tap, drop, or paste logo"}</div>
            <div class="hint">JPG, PNG, or WebP</div>
            <input type="file" id="logoFile" accept="image/*" class="sr-only" />
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Captain</legend>
        <div class="field-grid cols-2">
          <div class="field"><label for="capName">IGN</label><input id="capName" required /><div class="err-msg" id="err-capName"></div></div>
          <div class="field"><label for="capUid">UID</label><input id="capUid" required /><div class="err-msg" id="err-capUid"></div></div>
          <div class="field"><label for="capWhatsapp">WhatsApp (10 digit)</label><input id="capWhatsapp" inputmode="numeric" required /><div class="err-msg" id="err-capWhatsapp"></div></div>
          <div class="field"><label for="capEmail">Email <span class="opt">(optional)</span></label><input id="capEmail" type="email" /><div class="err-msg" id="err-capEmail"></div></div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Teammates (CS — up to 3 more)</legend>
        <div class="field-grid cols-2">
          <div class="field"><label for="p2Name">Player 2 IGN</label><input id="p2Name" required /><div class="err-msg" id="err-p2Name"></div></div>
          <div class="field"><label for="p2Uid">Player 2 UID</label><input id="p2Uid" required /><div class="err-msg" id="err-p2Uid"></div></div>
          <div class="field"><label for="p3Name">Player 3 IGN</label><input id="p3Name" required /><div class="err-msg" id="err-p3Name"></div></div>
          <div class="field"><label for="p3Uid">Player 3 UID</label><input id="p3Uid" required /><div class="err-msg" id="err-p3Uid"></div></div>
          <div class="field"><label for="p4Name">Player 4 IGN <span class="opt">(optional)</span></label><input id="p4Name" /></div>
          <div class="field"><label for="p4Uid">Player 4 UID <span class="opt">(optional)</span></label><input id="p4Uid" /></div>
        </div>
      </fieldset>
      <button type="submit" class="btn-primary" ${state.regBusy ? "disabled" : ""}>${state.regBusy ? "Saving…" : "Register squad"}</button>
    </form>
  `;
}

function renderModal() {
  return `
    <div class="modal-overlay" id="regModal">
      <div class="modal">
        <h3>Confirm registration</h3>
        <p>Subscribe to the YouTube channel, then confirm below.</p>
        <a href="${YT_URL}" target="_blank" rel="noopener" class="btn-primary" style="width:100%;margin-bottom:1rem">Open YouTube channel</a>
        <label class="check">
          <input type="checkbox" id="subCheck" ${state.subscribed ? "checked" : ""} />
          <span>I have subscribed to Khatri x ESP7 / @VIHAAN_ESPx</span>
        </label>
        ${state.modalErr ? `<p class="text-danger" style="font-size:0.8rem">${escapeHtml(state.modalErr)}</p>` : ""}
        <div class="actions">
          <button type="button" class="btn-ghost" id="modalCancel">Cancel</button>
          <button type="button" class="btn-primary" id="modalConfirm" ${state.regBusy ? "disabled" : ""}>${state.regBusy ? "Saving…" : "Confirm & register"}</button>
        </div>
      </div>
    </div>
  `;
}

function renderConfirm() {
  return `
    <div class="modal-overlay" id="confirmModal">
      <div class="modal">
        <h3>You're in! 🔥</h3>
        <p><strong>${escapeHtml(state.confirmName)}</strong> is registered.</p>
        <p>Entry ID: <span class="text-gold">${escapeHtml(state.confirmId)}</span></p>
        <p class="text-muted" style="font-size:0.8rem">Room ID & password will appear on this page and on the live stream when the host opens them.</p>
        <div class="actions">
          <button type="button" class="btn-primary" id="confirmClose">Done</button>
        </div>
      </div>
    </div>
  `;
}

function renderReveal() {
  const isAdmin = state.adminAuthed;
  const publicOk = state.settings.revealPublic;

  if (!isAdmin && !publicOk) {
    return `
    <div class="reveal-stage">
      <div style="max-width:32rem;margin:0 auto;text-align:center;padding-top:4rem">
        <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;letter-spacing:0.2em">SQUAD REVEAL</p>
        <h1 style="font-size:2.25rem;margin-top:0.5rem">Team Showcase</h1>
        <div class="empty-state" style="margin-top:2rem">
          Reveal stage is not live yet.<br />
          <span style="font-size:0.8rem">Host will open it from Admin when the show starts.</span>
        </div>
      </div>
    </div>`;
  }

  const regs = state.registrations;
  const team = regs[state.revealIdx];
  const liveBadge = publicOk
    ? `<span style="display:inline-flex;align-items:center;gap:0.4rem;margin-top:0.75rem;border-radius:9999px;border:1px solid var(--success);background:rgba(76,175,125,0.12);padding:0.25rem 0.75rem;font-size:0.75rem;font-weight:600;color:var(--success)"><span style="width:0.45rem;height:0.45rem;border-radius:9999px;background:var(--success)"></span> LIVE</span>`
    : `<span style="display:inline-flex;margin-top:0.75rem;border-radius:9999px;border:1px solid var(--line);padding:0.25rem 0.75rem;font-size:0.75rem;color:var(--muted)">Private (admin only)</span>`;

  return `
    <div class="reveal-stage">
      <div style="max-width:32rem;margin:0 auto;text-align:center">
        <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;letter-spacing:0.2em">SQUAD REVEAL</p>
        <h1 style="font-size:2.25rem;margin-top:0.5rem">Team Showcase</h1>
        <p class="text-muted" style="margin-top:0.5rem;font-size:0.875rem">One card at a time — share-ready for stream and status.</p>
        ${liveBadge}
      </div>
      ${
        regs.length === 0
          ? `<p class="text-muted" style="text-align:center;margin-top:4rem">No squads to reveal yet. Register first.</p>`
          : `
        <p class="text-gold" style="text-align:center;margin-top:2rem;font-family:var(--font-display)">
          ${String(state.revealIdx + 1).padStart(2, "0")} / ${String(regs.length).padStart(2, "0")}
        </p>
        <div class="reveal-card-wrap ${state.revealCurtain ? "curtain" : ""}">
          ${team ? teamCardHtml(team, state.revealIdx, true) : ""}
        </div>
        ${
          isAdmin && team
            ? `<div style="max-width:24rem;margin:1.25rem auto 0;border-radius:0.75rem;border:1px solid var(--line);background:rgba(23,18,13,0.8);padding:1rem">
                <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;margin-bottom:0.75rem">Logo for ${escapeHtml(team.teamName)}</p>
                <div class="logo-picker" id="revealLogoPicker" data-team-id="${escapeHtml(team.id)}">
                  ${team.logoDataUrl ? `<img src="${escapeHtml(team.logoDataUrl)}" alt="" />` : ""}
                  <div>${team.logoDataUrl ? "Replace logo" : "Upload logo"}</div>
                  <div class="hint">Shows on reveal, gallery, and VS poster</div>
                  <input type="file" id="revealLogoFile" accept="image/*" class="sr-only" />
                </div>
              </div>`
            : ""
        }
        ${
          isAdmin
            ? `<div class="reveal-controls">
          <button class="reveal-btn" id="revealPrev" aria-label="Previous">‹</button>
          <button class="reveal-play" id="revealPlay">${state.revealPlaying ? "⏸ Pause" : "▶ Auto-play"}</button>
          <button class="reveal-btn" id="revealNext" aria-label="Next">›</button>
        </div>
        <p class="text-muted" style="text-align:center;margin-top:1rem;font-size:0.75rem">Admin controls · public viewers follow this stage when LIVE</p>`
            : state.revealPlaying
              ? `<p class="text-muted" style="text-align:center;margin-top:1.5rem;font-size:0.8rem">Auto-playing · controlled by host</p>`
              : ""
        }
      `
      }
    </div>
  `;
}

function renderVs() {
  const isAdmin = state.adminAuthed;
  const publicOk = state.settings.vsPublic;

  if (!isAdmin && !publicOk) {
    return `
    <div class="vs-page">
      <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;letter-spacing:0.18em">MATCHDAY HYPE</p>
      <h1 style="font-size:2.25rem;margin-top:0.5rem">VS Poster</h1>
      <div class="empty-state" style="margin-top:2rem">
        VS Poster is not public yet.<br />
        <span style="font-size:0.8rem">Host will publish it from Admin when ready.</span>
      </div>
    </div>`;
  }

  const regs = state.registrations;
  const a = regs.find((t) => t.id === state.vsA);
  const b = regs.find((t) => t.id === state.vsB);
  function opts(selected) {
    return regs
      .map(
        (t) =>
          `<option value="${escapeHtml(t.id)}"${t.id === selected ? " selected" : ""}>${escapeHtml(t.teamName)}</option>`
      )
      .join("");
  }

  const statusBadge = publicOk
    ? `<span style="display:inline-flex;align-items:center;gap:0.4rem;margin-top:0.5rem;border-radius:9999px;border:1px solid var(--success);background:rgba(76,175,125,0.12);padding:0.25rem 0.75rem;font-size:0.75rem;font-weight:600;color:var(--success)">Public</span>`
    : `<span style="display:inline-flex;margin-top:0.5rem;border-radius:9999px;border:1px solid var(--line);padding:0.25rem 0.75rem;font-size:0.75rem;color:var(--muted)">Private (admin only)</span>`;

  return `
    <div class="vs-page">
      <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;letter-spacing:0.18em">MATCHDAY HYPE</p>
      <h1 style="font-size:2.25rem;margin-top:0.5rem">VS Poster</h1>
      <p class="text-muted" style="margin-top:0.5rem;font-size:0.875rem">Combine two squad logos into a shareable matchup poster for stream and WhatsApp status.</p>
      ${statusBadge}
      ${
        regs.length < 2
          ? `<p class="text-muted" style="margin-top:2.5rem">Need at least two registered teams to generate a poster.</p>`
          : `
        <div class="vs-picks">
          <div class="field">
            <label>Team A</label>
            <select id="vsA"><option value="">Select team</option>${opts(state.vsA)}</select>
          </div>
          <div class="field">
            <label>Team B</label>
            <select id="vsB"><option value="">Select team</option>${opts(state.vsB)}</select>
          </div>
          <div class="field">
            <label>Match date</label>
            <input type="date" id="vsDate" value="${escapeHtml(state.vsDate)}" />
          </div>
          <div class="field">
            <label>Match time</label>
            <input type="time" id="vsTime" value="${escapeHtml(state.vsTime)}" />
          </div>
        </div>
        ${state.vsErr ? `<p class="text-danger mt-2" style="font-size:0.875rem">${escapeHtml(state.vsErr)}</p>` : ""}
        <div class="flex flex-wrap gap-2 mt-4">
          <button class="btn-primary" id="vsGenerate" ${state.vsBusy ? "disabled" : ""}>${state.vsBusy ? "Building…" : "Generate poster"}</button>
          ${state.vsPreview ? `<button class="btn-ghost" id="vsDownload">Download PNG</button>` : ""}
        </div>
        ${
          state.vsPreview
            ? `<img class="vs-poster-img" src="${state.vsPreview}" alt="VS poster preview" />`
            : a && b
              ? `<div class="vs-preview-row">
                  <div class="vs-mono">${a.logoDataUrl ? `<img src="${escapeHtml(a.logoDataUrl)}" alt="" />` : escapeHtml(teamInitials(a.teamName))}</div>
                  <span class="vs-text">VS</span>
                  <div class="vs-mono">${b.logoDataUrl ? `<img src="${escapeHtml(b.logoDataUrl)}" alt="" />` : escapeHtml(teamInitials(b.teamName))}</div>
                </div>`
              : ""
        }
      `
      }
    </div>
  `;
}

function renderHall() {
  const regs = state.registrations;
  return `
    <div class="page">
      <main class="container-wide" style="padding-top:3rem;padding-bottom:3rem">
        <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;letter-spacing:0.18em">PERMANENT RECORD</p>
        <h1 style="font-size:2.25rem;margin-top:0.5rem">Hall of Fame</h1>
        <p class="text-muted" style="margin-top:0.5rem;max-width:28rem;font-size:0.875rem">Every squad that locked a slot stays here — even after elimination. This is your esports card for the next cup.</p>
        ${
          regs.length === 0
            ? `<div class="empty-state mt-6">The hall is empty. First team in writes history.</div>`
            : `<div class="team-grid mt-6">${regs.map((t, i) => teamCardHtml(t, i)).join("")}</div>`
        }
      </main>
    </div>
  `;
}

function renderAdmin() {
  if (!state.adminAuthed) {
    return `
      <div class="admin-login">
        <h2 style="font-size:1.5rem">Admin login</h2>
        <p class="text-muted" style="margin-top:0.25rem;font-size:0.875rem">Khatri x ESP7 — 1K Special Tournament</p>
        <form id="adminLoginForm" class="form-stack" style="margin-top:1.5rem" autocomplete="off">
          <div class="field">
            <label>Admin ID</label>
            <input id="adminId" name="admin-id" autocomplete="off" autocapitalize="none" spellcheck="false" />
          </div>
          <div class="field">
            <label>Password</label>
            <input id="adminPass" name="admin-pass" type="password" autocomplete="off" />
          </div>
          <p class="text-danger" style="min-height:1rem;font-size:0.875rem">${escapeHtml(state.adminErr)}</p>
          <button type="submit" class="btn-primary">Log in</button>
        </form>
        <a href="#/" class="text-muted" style="display:block;text-align:center;margin-top:1rem;font-size:0.875rem">← Back to registration</a>
      </div>
    `;
  }

  const regs = state.registrations;
  const q = (state.adminQ || "").toLowerCase();
  const filtered = !q
    ? regs
    : regs.filter((t) => {
        const hay = [
          t.teamName,
          t.mode,
          t.captain && t.captain.name,
          t.captain && t.captain.uid,
          t.captain && t.captain.whatsapp,
          t.teammate2 && t.teammate2.name,
          t.teammate3 && t.teammate3.name,
          t.teammate4 && t.teammate4.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });

  const counts = {
    total: regs.length,
    left: TOTAL_SLOTS - regs.length,
    solo: regs.filter((t) => t.mode === "SOLO").length,
    duo: regs.filter((t) => t.mode === "DUO").length,
    squad: regs.filter((t) => (t.mode || "SQUAD") === "SQUAD").length,
    cs: regs.filter((t) => t.mode === "CS").length,
    conf: regs.filter((t) => t.status === "confirmed").length,
    inn: regs.filter((t) => t.status === "checked-in").length,
  };

  const rooms = state.adminRooms || state.settings.rooms;

  return `
    <div class="container-wide" style="padding:2.5rem 1rem">
      <div class="flex flex-wrap items-center justify-between mb-4">
        <h1 style="font-size:1.875rem">Admin dashboard</h1>
        <div class="flex gap-2">
          <a href="#/" class="btn-ghost" style="min-height:auto;padding:0.5rem 0.75rem;font-size:0.875rem">← Back to site</a>
          <button class="btn-ghost" id="adminLogout" style="min-height:auto;padding:0.5rem 0.75rem;font-size:0.875rem">Log out</button>
        </div>
      </div>
      ${state.error ? `<p class="text-danger mb-4" style="font-size:0.875rem">${escapeHtml(state.error)}</p>` : ""}

      <div class="admin-stats">
        ${[
          [counts.total, "Total"],
          [counts.left, "Slots left"],
          [counts.solo, "Solo"],
          [counts.duo, "Duo"],
          [counts.squad, "Squad"],
          [counts.cs, "CS"],
          [counts.conf, "Confirmed"],
          [counts.inn, "Checked in"],
        ]
          .map(([n, l]) => `<div class="admin-stat"><div class="n">${n}</div><div class="l">${l}</div></div>`)
          .join("")}
      </div>

      <div class="flex flex-wrap items-center justify-between mb-4" style="gap:0.75rem">
        <input id="adminSearch" value="${escapeHtml(state.adminQ)}" placeholder="Search team, captain, UID…" style="min-width:14rem;border-radius:0.5rem;border:1px solid var(--line);background:var(--raised);padding:0.5rem 0.75rem;color:var(--fg)" />
        <div class="flex gap-2">
          <button class="btn-ghost" id="exportCsv" style="min-height:auto;padding:0.5rem 0.75rem;font-size:0.875rem">Export CSV</button>
          <button class="btn-ghost" id="clearAll" style="min-height:auto;padding:0.5rem 0.75rem;font-size:0.875rem;color:var(--danger)">Clear all</button>
        </div>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>#</th><th>Team</th><th>Mode</th><th>Captain</th><th>Squad</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${
              filtered.length === 0
                ? `<tr><td colspan="7" style="text-align:center;padding:2.5rem;color:var(--muted)">No registrations match.</td></tr>`
                : filtered
                    .map((t, i) => {
                      const squad = rosterFor(t)
                        .slice(1)
                        .map((p) => `${p.name} (${p.uid || "—"})`)
                        .join(" · ");
                      return `<tr>
                        <td>${i + 1}</td>
                        <td>
                          <div style="display:flex;align-items:center;gap:0.5rem">
                            <div class="logo-compact admin-logo" data-id="${escapeHtml(t.id)}" title="Upload logo">
                              ${t.logoDataUrl ? `<img src="${escapeHtml(t.logoDataUrl)}" alt="" />` : `<span style="font-size:0.65rem;color:var(--muted);display:flex;align-items:center;justify-content:center;height:100%">+</span>`}
                            </div>
                            <div><b>${escapeHtml(t.teamName)}</b><div class="text-muted" style="font-size:0.75rem">${escapeHtml(t.id)}</div></div>
                          </div>
                        </td>
                        <td class="text-gold">${escapeHtml(MODE_LABELS[t.mode] || t.mode)}</td>
                        <td style="font-size:0.75rem;color:var(--muted)">
                          <b style="color:var(--fg)">${escapeHtml((t.captain && t.captain.name) || "")}</b> (${escapeHtml((t.captain && t.captain.uid) || "")})
                          <div>${escapeHtml((t.captain && t.captain.whatsapp) || "")}</div>
                        </td>
                        <td style="font-size:0.75rem;color:var(--muted)">${escapeHtml(squad || "—")}</td>
                        <td>
                          <select class="status-select" data-id="${escapeHtml(t.id)}">
                            <option value="pending" ${t.status === "pending" ? "selected" : ""}>Pending</option>
                            <option value="confirmed" ${t.status === "confirmed" ? "selected" : ""}>Confirmed</option>
                            <option value="checked-in" ${t.status === "checked-in" ? "selected" : ""}>Checked in</option>
                          </select>
                        </td>
                        <td><button class="btn-danger remove-team" data-id="${escapeHtml(t.id)}">Remove</button></td>
                      </tr>`;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>

      <section class="admin-section">
        <h3>Tournament settings</h3>
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.75rem;border-bottom:1px solid var(--line);padding:0.75rem 0">
          <div class="text-muted" style="font-size:0.875rem">
            Registration status
            <small style="display:block;margin-top:0.125rem;color:var(--steel-light)">Closes / opens the public form</small>
          </div>
          <button class="btn-ghost" id="toggleClosed" style="min-height:auto;padding:0.5rem 0.75rem;font-size:0.875rem">
            ${state.settings.closed ? "Reopen registration" : "Close registration"}
          </button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 0;font-size:0.875rem;color:var(--muted)">
          Total slots <span style="color:var(--fg)">${TOTAL_SLOTS}</span>
        </div>
      </section>

      <section class="admin-section">
        <h3>Room ID & password</h3>
        <div class="room-edit-grid">
          ${["CS"]
            .map(
              (mode) => `
            <div class="room-edit-card">
              <h4>${MODE_LABELS[mode]}</h4>
              <label>Room ID
                <input class="room-id" data-mode="${mode}" value="${escapeHtml((rooms[mode] && rooms[mode].id) || "")}" />
              </label>
              <label>Password
                <input class="room-pass" data-mode="${mode}" value="${escapeHtml((rooms[mode] && rooms[mode].pass) || "")}" />
              </label>
              <button class="btn-ghost save-room" data-mode="${mode}" style="margin-top:0.75rem;min-height:auto;padding:0.375rem 0.75rem;font-size:0.75rem">
                Save ${MODE_LABELS[mode]}
              </button>
              ${state.adminSaved === mode ? '<span class="text-success" style="margin-left:0.5rem;font-size:0.75rem">Saved</span>' : ""}
            </div>`
            )
            .join("")}
        </div>
      </section>

      <!-- Team Reveal & VS inside Admin -->
      <section class="admin-section">
        <h3>Team Reveal (admin control)</h3>
        <p class="text-muted" style="font-size:0.875rem;margin-bottom:1rem">
          One click goes <strong style="color:var(--fg)">LIVE</strong> on the public page and starts auto-play.
          When the last team is shown, the VS poster reveals automatically (set up Team A/B below first).
        </p>
        <div class="flex flex-wrap gap-2" style="margin-bottom:1rem">
          <button class="btn-primary" id="toggleRevealPublic" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">
            ${state.settings.revealPublic && state.revealPlaying ? "⏸ Stop Reveal" : "▶ Reveal & Play (public)"}
          </button>
          ${
            state.settings.revealPublic
              ? `<button class="btn-ghost" id="adminRevealPlay" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">
                   ${state.revealPlaying ? "Pause auto-play" : "Resume auto-play"}
                 </button>
                 <button class="btn-ghost" id="adminRevealHide" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">Hide from public</button>`
              : ""
          }
          <a href="#/reveal" class="btn-ghost" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">Preview stage →</a>
        </div>
        <p style="font-size:0.8rem;margin-bottom:0.75rem">
          Status:
          ${state.settings.revealPublic
            ? '<span class="text-success">Public can see Reveal</span>'
            : '<span class="text-muted">Hidden from public</span>'}
          · Auto-play: ${state.revealPlaying ? '<span class="text-gold">ON</span>' : '<span class="text-muted">OFF</span>'}
        </p>
        ${
          regs.length
            ? `<p class="text-muted" style="font-size:0.8rem">${regs.length} teams · showing #${state.revealIdx + 1}</p>
               <div class="flex flex-wrap gap-2" style="margin:0.75rem 0">
                 <button class="reveal-btn" id="adminRevealPrev">‹</button>
                 <button class="reveal-btn" id="adminRevealNext">›</button>
               </div>
               <div style="margin-top:0.5rem;max-width:20rem">${teamCardHtml(regs[state.revealIdx] || regs[0], state.revealIdx, true)}</div>`
            : `<p class="text-muted mt-2" style="font-size:0.875rem">No teams yet.</p>`
        }
      </section>

      <section class="admin-section">
        <h3>VS Poster (admin)</h3>
        <p class="text-muted" style="font-size:0.875rem;margin-bottom:1rem">
          Generate posters anytime here. Public VS page only opens after you publish it.
        </p>
        <div class="flex flex-wrap gap-2" style="margin-bottom:1rem">
          <button class="btn-primary" id="toggleVsPublic" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">
            ${state.settings.vsPublic ? "● Public — hide from public" : "Publish VS page (public)"}
          </button>
          <a href="#/vs" class="btn-ghost" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">Open VS page →</a>
        </div>
        <p style="font-size:0.8rem;margin-bottom:1rem">
          Status:
          ${state.settings.vsPublic
            ? '<span class="text-success">Public can use VS Poster</span>'
            : '<span class="text-muted">Hidden from public</span>'}
        </p>
        ${
          regs.length < 2
            ? `<p class="text-muted" style="font-size:0.875rem">Need at least 2 teams.</p>`
            : `
          <div class="vs-picks">
            <div class="field">
              <label>Team A</label>
              <select id="adminVsA"><option value="">Select</option>${regs.map((t) => `<option value="${escapeHtml(t.id)}" ${state.vsA === t.id ? "selected" : ""}>${escapeHtml(t.teamName)}</option>`).join("")}</select>
            </div>
            <div class="field">
              <label>Team B</label>
              <select id="adminVsB"><option value="">Select</option>${regs.map((t) => `<option value="${escapeHtml(t.id)}" ${state.vsB === t.id ? "selected" : ""}>${escapeHtml(t.teamName)}</option>`).join("")}</select>
            </div>
            <div class="field">
              <label>Match date</label>
              <input type="date" id="adminVsDate" value="${escapeHtml(state.vsDate)}" />
            </div>
            <div class="field">
              <label>Match time</label>
              <input type="time" id="adminVsTime" value="${escapeHtml(state.vsTime)}" />
            </div>
          </div>
          ${state.vsErr ? `<p class="text-danger mt-2" style="font-size:0.875rem">${escapeHtml(state.vsErr)}</p>` : ""}
          <div class="flex flex-wrap gap-2 mt-4">
            <button class="btn-primary" id="adminVsGenerate" ${state.vsBusy ? "disabled" : ""}>${state.vsBusy ? "Building…" : "Generate poster"}</button>
            ${state.vsPreview ? `<button class="btn-ghost" id="adminVsDownload">Download PNG</button>` : ""}
            <a href="#/vs" class="btn-ghost" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">Public VS page →</a>
          </div>
          ${state.vsPreview ? `<img class="vs-poster-img" src="${state.vsPreview}" alt="VS preview" />` : ""}
        `
        }
      </section>
    </div>
  `;
}

// ── Router & render ────────────────────────────────────
function getRoute() {
  const hash = (location.hash || "#/").replace(/^#/, "") || "/";
  return hash.split("?")[0] || "/";
}

function render() {
  const app = document.getElementById("app");
  if (!app) return;
  state.route = getRoute();
  state.adminAuthed = isAdminLoggedIn();

  // nav active
  document.querySelectorAll(".nav-link").forEach((el) => {
    const nav = el.getAttribute("data-nav");
    el.classList.toggle("active", nav === state.route);
  });

  // Hide site nav on public full-screen takeover
  const navEl = document.querySelector(".site-nav");
  const isAdminRoute = state.route === "/admin";
  const takeover =
    !isAdminRoute &&
    !state.adminAuthed &&
    (state.settings.revealPublic || state.settings.vsPublic);
  if (navEl) navEl.style.display = takeover ? "none" : "";

  let html = "";
  if (state.route === "/admin") {
    html = renderAdmin();
  } else if (state.adminAuthed && state.route === "/reveal") {
    html = renderReveal();
  } else if (state.adminAuthed && state.route === "/vs") {
    html = renderVs();
  } else if (!state.adminAuthed && state.settings.revealPublic) {
    // Public full-screen reveal (admin LIVE)
    html = renderRevealFullscreen();
  } else if (!state.adminAuthed && state.settings.vsPublic) {
    // Public full-screen VS poster (admin published)
    html = renderVsFullscreen();
  } else if (state.route === "/hall") {
    html = renderHall();
  } else if (state.route === "/reveal" || state.route === "/vs") {
    // Direct links when not live → soft message
    html = state.route === "/reveal" ? renderReveal() : renderVs();
  } else {
    html = renderHome();
  }

  app.innerHTML = html;
  bindEvents();
}

function renderRevealFullscreen() {
  const regs = state.registrations;
  const team = regs[state.revealIdx];
  return `
    <div class="reveal-stage" style="min-height:100vh;padding:2rem 1rem">
      <div style="max-width:28rem;margin:0 auto;text-align:center">
        <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;letter-spacing:0.2em">SQUAD REVEAL · LIVE</p>
        <h1 style="font-size:clamp(1.8rem,5vw,2.5rem);margin-top:0.5rem">Team Showcase</h1>
        <span style="display:inline-flex;align-items:center;gap:0.4rem;margin-top:0.75rem;border-radius:9999px;border:1px solid var(--success);background:rgba(76,175,125,0.12);padding:0.25rem 0.75rem;font-size:0.75rem;font-weight:600;color:var(--success)">
          <span style="width:0.45rem;height:0.45rem;border-radius:9999px;background:var(--success)"></span> LIVE
        </span>
      </div>
      ${
        regs.length === 0
          ? `<p class="text-muted" style="text-align:center;margin-top:4rem">Waiting for teams…</p>`
          : `
        <p class="text-gold" style="text-align:center;margin-top:2rem;font-family:var(--font-display);font-size:1.25rem">
          ${String(state.revealIdx + 1).padStart(2, "0")} / ${String(regs.length).padStart(2, "0")}
        </p>
        <div class="reveal-card-wrap ${state.revealCurtain ? "curtain" : ""}" style="max-width:26rem">
          ${team ? teamCardHtml(team, state.revealIdx, true) : ""}
        </div>
        ${state.revealPlaying ? `<p class="text-muted" style="text-align:center;margin-top:1.5rem;font-size:0.8rem">Auto-playing · host controlled</p>` : ""}
      `
      }
    </div>`;
}

function renderVsFullscreen() {
  const regs = state.registrations;
  const m = state.settings.vsMatch || {};
  const a = regs.find((t) => t.id === m.aId) || regs.find((t) => t.id === state.vsA);
  const b = regs.find((t) => t.id === m.bId) || regs.find((t) => t.id === state.vsB);
  const dateStr = m.date || state.vsDate || "";
  const timeStr = m.time || state.vsTime || "";
  let when = "";
  if (dateStr) {
    try {
      const d = new Date(dateStr + "T12:00:00");
      when = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    } catch { when = dateStr; }
  }
  if (timeStr) {
    try {
      const [hh, mm] = timeStr.split(":");
      const h = parseInt(hh, 10);
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = ((h + 11) % 12) + 1;
      when = (when ? when + " · " : "") + h12 + ":" + (mm || "00") + " " + ampm;
    } catch { when = (when ? when + " · " : "") + timeStr; }
  }

  if (!a || !b) {
    return `<div class="vs-page" style="min-height:100vh;display:flex;align-items:center;justify-content:center">
      <div class="empty-state">Matchup loading…</div>
    </div>`;
  }

  return `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 1rem;background:
      radial-gradient(ellipse 70% 50% at 50% 30%, rgba(255,90,31,0.2), transparent 70%), #0a0806">
      <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;letter-spacing:0.2em">MATCHDAY · LIVE</p>
      <h1 style="font-size:clamp(2rem,6vw,3rem);margin-top:0.5rem;text-align:center">VS</h1>
      ${when ? `<p style="margin-top:0.5rem;font-family:var(--font-display);font-size:1.25rem;font-weight:700;color:var(--gold)">${escapeHtml(when)}</p>` : ""}
      <div class="vs-preview-row" style="margin-top:2.5rem;flex-wrap:wrap">
        <div style="text-align:center">
          <div class="vs-mono" style="width:7.5rem;height:7.5rem;margin:0 auto">
            ${a.logoDataUrl ? `<img src="${escapeHtml(a.logoDataUrl)}" alt="" />` : escapeHtml(teamInitials(a.teamName))}
          </div>
          <p style="margin-top:0.75rem;font-family:var(--font-display);font-size:1.35rem;font-weight:700">${escapeHtml(a.teamName)}</p>
        </div>
        <span class="vs-text">VS</span>
        <div style="text-align:center">
          <div class="vs-mono" style="width:7.5rem;height:7.5rem;margin:0 auto">
            ${b.logoDataUrl ? `<img src="${escapeHtml(b.logoDataUrl)}" alt="" />` : escapeHtml(teamInitials(b.teamName))}
          </div>
          <p style="margin-top:0.75rem;font-family:var(--font-display);font-size:1.35rem;font-weight:700">${escapeHtml(b.teamName)}</p>
        </div>
      </div>
      <p class="text-muted" style="margin-top:2rem;font-size:0.8rem">Khatri × ESP7 · Free Fire</p>
    </div>`;
}

function bindEvents() {
  async function stepReveal(delta) {
    const n = state.registrations.length;
    if (!n) return;
    const next = (state.revealIdx + delta + n) % n;
    await updateRevealLive(state.revealPlaying, next);
  }

  // Public team select
  const pts = document.getElementById("publicTeamSelect");
  if (pts) {
    pts.addEventListener("change", (e) => {
      state.selectedTeamId = e.target.value;
      render();
    });
  }

  // Register form
  const form = document.getElementById("regForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const required = ["teamName", "capName", "capUid", "capWhatsapp", "p2Name", "p2Uid", "p3Name", "p3Uid"];
      let ok = true;
      required.forEach((id) => {
        const el = document.getElementById(id);
        const err = document.getElementById("err-" + id);
        if (!el || !el.value.trim()) {
          if (err) err.textContent = "Required";
          if (el) el.classList.add("err");
          ok = false;
        } else {
          if (err) err.textContent = "";
          if (el) el.classList.remove("err");
        }
      });
      const wa = (document.getElementById("capWhatsapp") || {}).value || "";
      const digits = wa.replace(/\D/g, "");
      if (digits && !/^\d{10}$/.test(digits)) {
        const err = document.getElementById("err-capWhatsapp");
        if (err) err.textContent = "Enter a valid 10-digit number";
        ok = false;
      }
      const email = (document.getElementById("capEmail") || {}).value || "";
      if (email && !/^\S+@\S+\.\S+$/.test(email)) {
        const err = document.getElementById("err-capEmail");
        if (err) err.textContent = "Enter a valid email";
        ok = false;
      }
      if (!ok) return;
      state.draft = {
        teamName: val("teamName"),
        tagline: val("tagline"),
        capName: val("capName"),
        capUid: val("capUid"),
        capWhatsapp: val("capWhatsapp"),
        capEmail: val("capEmail"),
        p2Name: val("p2Name"),
        p2Uid: val("p2Uid"),
        p3Name: val("p3Name"),
        p3Uid: val("p3Uid"),
        p4Name: val("p4Name"),
        p4Uid: val("p4Uid"),
      };
      state.subscribed = false;
      state.modalErr = "";
      state.modalOpen = true;
      render();
    });
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  // Logo picker (register)
  const lp = document.getElementById("logoPicker");
  const lf = document.getElementById("logoFile");
  if (lp && lf) {
    lp.addEventListener("click", () => lf.click());
    lf.addEventListener("change", async () => {
      const file = lf.files && lf.files[0];
      if (!file) return;
      try {
        state.logoDataUrl = await compressLogo(file);
        render();
      } catch (err) {
        alert(err.message || "Upload failed");
      }
    });
    lp.addEventListener("dragover", (e) => e.preventDefault());
    lp.addEventListener("drop", async (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      try {
        state.logoDataUrl = await compressLogo(file);
        render();
      } catch (err) {
        alert(err.message || "Upload failed");
      }
    });
  }

  // Modal
  const modalCancel = document.getElementById("modalCancel");
  if (modalCancel) modalCancel.addEventListener("click", () => { state.modalOpen = false; render(); });
  const subCheck = document.getElementById("subCheck");
  if (subCheck) subCheck.addEventListener("change", (e) => { state.subscribed = e.target.checked; });
  const modalConfirm = document.getElementById("modalConfirm");
  if (modalConfirm) {
    modalConfirm.addEventListener("click", async () => {
      if (!state.subscribed) {
        state.modalErr = "Please subscribe and check the box to confirm.";
        render();
        return;
      }
      state.regBusy = true;
      render();
      try {
        const id = await saveRegistration({
          teamName: state.draft.teamName || "",
          mode: "CS",
          tagline: state.draft.tagline || "",
          logoDataUrl: state.logoDataUrl,
          captain: {
            name: state.draft.capName || "",
            uid: state.draft.capUid || "",
            whatsapp: state.draft.capWhatsapp || "",
            email: state.draft.capEmail || "",
          },
          teammate2: { name: state.draft.p2Name || "", uid: state.draft.p2Uid || "" },
          teammate3: { name: state.draft.p3Name || "", uid: state.draft.p3Uid || "" },
          teammate4: { name: state.draft.p4Name || "", uid: state.draft.p4Uid || "" },
        });
        state.confirmId = id;
        state.confirmName = state.draft.teamName || "";
        state.modalOpen = false;
        state.logoDataUrl = "";
        state.draft = {};
      } catch (err) {
        state.modalErr = err.message || "Could not save. Check your connection.";
      } finally {
        state.regBusy = false;
        render();
      }
    });
  }
  const confirmClose = document.getElementById("confirmClose");
  if (confirmClose) confirmClose.addEventListener("click", () => { state.confirmId = ""; state.confirmName = ""; render(); });

  // Reveal controls (admin only — writes to Firebase so public stays in sync)
  const prev = document.getElementById("revealPrev");
  const next = document.getElementById("revealNext");
  const play = document.getElementById("revealPlay");
  if (prev) prev.addEventListener("click", () => void stepReveal(-1));
  if (next) next.addEventListener("click", () => void stepReveal(1));
  if (play) play.addEventListener("click", async () => {
    const going = !state.revealPlaying;
    await updateRevealLive(going, state.revealIdx);
  });

  // Reveal logo
  const rlp = document.getElementById("revealLogoPicker");
  const rlf = document.getElementById("revealLogoFile");
  if (rlp && rlf) {
    rlp.addEventListener("click", () => rlf.click());
    rlf.addEventListener("change", async () => {
      const file = rlf.files && rlf.files[0];
      const teamId = rlp.getAttribute("data-team-id");
      if (!file || !teamId) return;
      try {
        const data = await compressLogo(file);
        await updateRegistrationLogo(teamId, data);
      } catch (err) {
        alert(err.message || "Could not save logo");
      }
    });
  }

  // VS
  const vsA = document.getElementById("vsA");
  const vsB = document.getElementById("vsB");
  if (vsA) vsA.addEventListener("change", (e) => { state.vsA = e.target.value; state.vsPreview = ""; render(); });
  if (vsB) vsB.addEventListener("change", (e) => { state.vsB = e.target.value; state.vsPreview = ""; render(); });
  const vsDate = document.getElementById("vsDate");
  const vsTime = document.getElementById("vsTime");
  if (vsDate) vsDate.addEventListener("change", (e) => { state.vsDate = e.target.value; state.vsPreview = ""; });
  if (vsTime) vsTime.addEventListener("change", (e) => { state.vsTime = e.target.value; state.vsPreview = ""; });
  const vsGen = document.getElementById("vsGenerate");
  if (vsGen) vsGen.addEventListener("click", () => generateVs());
  const vsDl = document.getElementById("vsDownload");
  if (vsDl) vsDl.addEventListener("click", () => downloadVs());

  // Admin login
  const adminForm = document.getElementById("adminLoginForm");
  if (adminForm) {
    adminForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = (document.getElementById("adminId") || {}).value || "";
      const pass = (document.getElementById("adminPass") || {}).value || "";
      if (credentialsMatch(id, pass)) {
        loginAdmin();
        state.adminErr = "";
      } else {
        state.adminErr = "Incorrect admin ID or password.";
      }
      render();
    });
  }
  const adminLogout = document.getElementById("adminLogout");
  if (adminLogout) adminLogout.addEventListener("click", () => { logoutAdmin(); render(); });

  const adminSearch = document.getElementById("adminSearch");
  if (adminSearch) {
    adminSearch.addEventListener("input", (e) => {
      state.adminQ = e.target.value;
      // debounce light re-render
      clearTimeout(state._searchT);
      state._searchT = setTimeout(() => render(), 200);
    });
  }

  document.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      await updateRegistrationStatus(e.target.getAttribute("data-id"), e.target.value);
    });
  });
  document.querySelectorAll(".remove-team").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this team?")) return;
      await deleteRegistration(btn.getAttribute("data-id"));
    });
  });
  document.querySelectorAll(".admin-logo").forEach((el) => {
    el.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const data = await compressLogo(file);
          await updateRegistrationLogo(el.getAttribute("data-id"), data);
        } catch (err) {
          alert(err.message || "Upload failed");
        }
      };
      input.click();
    });
  });

  const exportCsv = document.getElementById("exportCsv");
  if (exportCsv) {
    exportCsv.addEventListener("click", () => {
      const regs = state.registrations;
      if (!regs.length) return;
      const header = ["ID","Team","Mode","Tagline","Status","Registered At","Captain Name","Captain UID","Captain WhatsApp","Captain Email","P2 Name","P2 UID","P3 Name","P3 UID","P4 Name","P4 UID"];
      const rows = regs.map((t) => [
        t.id, t.teamName, t.mode, t.tagline || "", t.status, t.createdAt,
        (t.captain && t.captain.name) || "", (t.captain && t.captain.uid) || "", (t.captain && t.captain.whatsapp) || "", (t.captain && t.captain.email) || "",
        (t.teammate2 && t.teammate2.name) || "", (t.teammate2 && t.teammate2.uid) || "",
        (t.teammate3 && t.teammate3.name) || "", (t.teammate3 && t.teammate3.uid) || "",
        (t.teammate4 && t.teammate4.name) || "", (t.teammate4 && t.teammate4.uid) || "",
      ]);
      const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "khatri_esp7_registrations.csv");
    });
  }
  const clearAll = document.getElementById("clearAll");
  if (clearAll) {
    clearAll.addEventListener("click", async () => {
      if (!confirm("Clear ALL registrations?")) return;
      await clearAllRegistrations(state.registrations.map((r) => r.id));
    });
  }
  const toggleClosed = document.getElementById("toggleClosed");
  if (toggleClosed) {
    toggleClosed.addEventListener("click", async () => {
      await setManuallyClosed(!state.settings.closed);
    });
  }

  // Room saves
  if (!state.adminRooms) state.adminRooms = JSON.parse(JSON.stringify(state.settings.rooms));
  document.querySelectorAll(".room-id").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const mode = e.target.getAttribute("data-mode");
      if (!state.adminRooms[mode]) state.adminRooms[mode] = { id: "", pass: "" };
      state.adminRooms[mode].id = e.target.value;
    });
  });
  document.querySelectorAll(".room-pass").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const mode = e.target.getAttribute("data-mode");
      if (!state.adminRooms[mode]) state.adminRooms[mode] = { id: "", pass: "" };
      state.adminRooms[mode].pass = e.target.value;
    });
  });
  document.querySelectorAll(".save-room").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.getAttribute("data-mode");
      const r = state.adminRooms[mode] || { id: "", pass: "" };
      await saveRoomSettings(mode, (r.id || "").trim(), (r.pass || "").trim());
      state.adminSaved = mode;
      render();
      setTimeout(() => { state.adminSaved = ""; render(); }, 1600);
    });
  });

  // Admin reveal play / step / public toggles
  const arp = document.getElementById("adminRevealPlay");
  if (arp) {
    arp.addEventListener("click", async () => {
      await updateRevealLive(!state.revealPlaying, state.revealIdx);
    });
  }
  const arpPrev = document.getElementById("adminRevealPrev");
  const arpNext = document.getElementById("adminRevealNext");
  if (arpPrev) arpPrev.addEventListener("click", () => void stepReveal(-1));
  if (arpNext) arpNext.addEventListener("click", () => void stepReveal(1));

  const trp = document.getElementById("toggleRevealPublic");
  if (trp) {
    trp.addEventListener("click", async () => {
      const isLive = state.settings.revealPublic && state.revealPlaying;
      if (isLive) {
        await stopRevealShow();
      } else {
        await startRevealShow();
      }
    });
  }
  const arh = document.getElementById("adminRevealHide");
  if (arh) {
    arh.addEventListener("click", async () => {
      await updateRevealPublic(false);
    });
  }
  const tvp = document.getElementById("toggleVsPublic");
  if (tvp) {
    tvp.addEventListener("click", async () => {
      const goingPublic = !state.settings.vsPublic;
      if (goingPublic) {
        if (!state.vsA || !state.vsB || state.vsA === state.vsB) {
          state.vsErr = "Select two different teams before publishing.";
          render();
          return;
        }
      }
      state.vsErr = "";
      await updateVsPublic(goingPublic);
    });
  }

  // Admin VS
  const ava = document.getElementById("adminVsA");
  const avb = document.getElementById("adminVsB");
  if (ava) ava.addEventListener("change", (e) => { state.vsA = e.target.value; state.vsPreview = ""; render(); });
  if (avb) avb.addEventListener("change", (e) => { state.vsB = e.target.value; state.vsPreview = ""; render(); });
  const avDate = document.getElementById("adminVsDate");
  const avTime = document.getElementById("adminVsTime");
  if (avDate) avDate.addEventListener("change", (e) => { state.vsDate = e.target.value; state.vsPreview = ""; });
  if (avTime) avTime.addEventListener("change", (e) => { state.vsTime = e.target.value; state.vsPreview = ""; });
  const avg = document.getElementById("adminVsGenerate");
  if (avg) avg.addEventListener("click", () => generateVs());
  const avDl = document.getElementById("adminVsDownload");
  if (avDl) avDl.addEventListener("click", () => downloadVs());
}

async function generateVs() {
  const a = state.registrations.find((t) => t.id === state.vsA);
  const b = state.registrations.find((t) => t.id === state.vsB);
  if (!a || !b || a.id === b.id) {
    state.vsErr = "Pick two different teams.";
    render();
    return;
  }
  state.vsErr = "";
  state.vsBusy = true;
  render();
  try {
    const blob = await renderVsPoster(a, b, state.vsDate, state.vsTime);
    if (state.vsPreview) URL.revokeObjectURL(state.vsPreview);
    state.vsPreview = URL.createObjectURL(blob);
  } catch (e) {
    state.vsErr = e.message || "Could not build poster";
  } finally {
    state.vsBusy = false;
    render();
  }
}

async function downloadVs() {
  const a = state.registrations.find((t) => t.id === state.vsA);
  const b = state.registrations.find((t) => t.id === state.vsB);
  if (!a || !b) return;
  const blob = await renderVsPoster(a, b, state.vsDate, state.vsTime);
  downloadBlob(blob, `${a.teamName}_vs_${b.teamName}.png`);
}

// Boot
window.addEventListener("hashchange", () => {
  if (state.revealTimer && getRoute() !== "/reveal" && getRoute() !== "/admin") {
    // keep playing if on admin too
  }
  render();
});

state.adminAuthed = isAdminLoggedIn();
subscribeRegistrations();
subscribeSettings();
render();
