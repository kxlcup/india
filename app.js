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

const MODE_LABELS = { SOLO: "Solo", DUO: "Duo", SQUAD: "Squad", CS: "CS Mac 4v4" };
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
    revealPlaying: false,
    revealIdx: 0,
    vsPosterPublic: false,
    vsTeamA: "",
    vsTeamB: "",
    vsMatchDate: "",
    vsMatchTime: "",
    matches: [],
  },
  ready: false,
  error: null,
  route: "/",
  // vs poster
  vsPickA: null,
  vsPickB: null,
  vsPickDate: null,
  vsPickTime: null,
  vsPoster: {},
  vsPosterBusy: {},
  // reveal
  revealIdx: 0,
  revealPlaying: false,
  revealCurtain: false,
  revealTimer: null,
  // admin
  adminAuthed: false,
  adminErr: "",
  adminQ: "",
  adminRooms: null,
  adminSaved: "",
  adminTeamRooms: {},
  adminTeamRoomSaved: "",
  adminMatchDraft: { aId: "", bId: "", roomId: "", roomPass: "" },
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
        const nextSettings = {
          closed: !!data.closed,
          rooms: Object.assign({}, EMPTY_ROOMS, data.rooms || {}),
          revealPublic: !!data.revealPublic,
          revealPlaying: !!data.revealPlaying,
          revealIdx: typeof data.revealIdx === "number" ? data.revealIdx : 0,
          vsPosterPublic: !!data.vsPosterPublic,
          vsTeamA: data.vsTeamA || "",
          vsTeamB: data.vsTeamB || "",
          vsMatchDate: data.vsMatchDate || "",
          vsMatchTime: data.vsMatchTime || "",
          matches: Array.isArray(data.matches) ? data.matches : [],
        };
        state.settings = nextSettings;
        state.adminRooms = JSON.parse(JSON.stringify(nextSettings.rooms));
        state.adminAuthed = isAdminLoggedIn();

        // Sync public reveal stage from admin (Firebase is source of truth)
        const n = state.registrations.length;
        const idx = n > 0 ? Math.min(Math.max(0, nextSettings.revealIdx), n - 1) : 0;
        const idxChanged = state.revealIdx !== idx;
        if (idxChanged) {
          state.revealCurtain = true;
          state.revealIdx = idx;
        }
        state.revealPlaying = nextSettings.revealPlaying;
        syncRevealTimer();

        state.ready = true;
        render();
        if (idxChanged) {
          setTimeout(() => {
            state.revealCurtain = false;
            render();
          }, 300);
        }
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

async function saveTeamRoom(teamId, roomId, roomPass) {
  await db.collection(REGISTRATIONS_COL).doc(teamId).update({ roomId, roomPass });
}

async function addMatch(aId, bId, roomId, roomPass) {
  const id = "M-" + Date.now().toString(36).toUpperCase();
  const next = [...state.settings.matches, { id, aId, bId, roomId, roomPass }];
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set({ matches: next }, { merge: true });
}

async function removeMatch(matchId) {
  const next = state.settings.matches.filter((m) => m.id !== matchId);
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set({ matches: next }, { merge: true });
}

async function updateRevealPublic(val) {
  const payload = { revealPublic: !!val };
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set(payload, { merge: true });
}

async function saveVsPair(aId, bId, when) {
  await db
    .collection(SETTINGS_COL)
    .doc(SETTINGS_ID)
    .set(
      { vsTeamA: aId, vsTeamB: bId, vsMatchDate: (when && when.date) || "", vsMatchTime: (when && when.time) || "" },
      { merge: true }
    );
}

async function updateVsPosterPublic(val, aId, bId, when) {
  const payload = { vsPosterPublic: !!val };
  if (aId && bId) {
    payload.vsTeamA = aId;
    payload.vsTeamB = bId;
    payload.vsMatchDate = (when && when.date) || "";
    payload.vsMatchTime = (when && when.time) || "";
  }
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set(payload, { merge: true });
}

async function deleteVsPoster() {
  await db
    .collection(SETTINGS_COL)
    .doc(SETTINGS_ID)
    .set(
      { vsPosterPublic: false, vsTeamA: "", vsTeamB: "", vsMatchDate: "", vsMatchTime: "" },
      { merge: true }
    );
  state.vsPickA = "";
  state.vsPickB = "";
  state.vsPickDate = "";
  state.vsPickTime = "";
}

async function updateRevealLive(playing, idx) {
  const payload = { revealPlaying: !!playing };
  if (typeof idx === "number") payload.revealIdx = idx;
  await db.collection(SETTINGS_COL).doc(SETTINGS_ID).set(payload, { merge: true });
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
    const next = (state.revealIdx + 1) % n;
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
  const left = slotsLeft();
  const full = isClosed();

  const roomBlock =
    regs.length > 0
      ? `<div class="room-panel">
          <h4>Room details</h4>
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
                    return `<div class="room-item" style="margin-top:0.5rem;padding:0.75rem;border:1px solid var(--line);border-radius:0.5rem;background:var(--bg)">
                      <div class="lbl">Team</div><div class="val">${escapeHtml(t.teamName)}</div>
                      <div class="lbl">Room ID</div><div class="val">${escapeHtml(t.roomId || "—")}</div>
                      <div class="lbl">Password</div><div class="val">${escapeHtml(t.roomPass || "—")}</div>
                    </div>`;
                  })()
                : ""
            }
          </div>
          ${
            state.settings.matches.length > 0
              ? `<div style="margin-top:1rem">
                  <h5 style="font-size:0.9375rem;margin-bottom:0.5rem">Match pairings</h5>
                  <div style="display:flex;flex-direction:column;gap:0.5rem">
                    ${state.settings.matches
                      .map((m) => {
                        const a = regs.find((t) => t.id === m.aId);
                        const b = regs.find((t) => t.id === m.bId);
                        return `<div class="room-item" style="padding:0.75rem;border:1px solid var(--line);border-radius:0.5rem;background:var(--bg)">
                          <div class="val" style="font-weight:600">${escapeHtml((a && a.teamName) || "?")} <span class="text-gold">vs</span> ${escapeHtml((b && b.teamName) || "?")}</div>
                          <div class="lbl" style="margin-top:0.375rem">Room ID</div><div class="val">${escapeHtml(m.roomId || "—")}</div>
                          <div class="lbl">Password</div><div class="val">${escapeHtml(m.roomPass || "—")}</div>
                        </div>`;
                      })
                      .join("")}
                  </div>
                </div>`
              : ""
          }
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
              ["Format", "CS Mac 4v4"],
              ["Prize pool", "₹1,000"],
              ["Entry fee", "Free"],
              ["Total slots", TOTAL_SLOTS + " teams"],
              ["Match date & time", vsWhenText({ date: state.settings.vsMatchDate, time: state.settings.vsMatchTime }) || "Announced on YouTube live"],
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

      <section class="section" id="wildcard">
        <div class="container">
          <div style="border:1px solid var(--gold, #c9a227);border-radius:0.75rem;padding:1.5rem">
            <h2 style="font-size:1.625rem">🃏 Wild Card Entry</h2>
            <p class="text-muted" style="margin-top:0.25rem;font-size:0.875rem">Missed the slots or regular registration? Grab a direct entry with a Wild Card.</p>
            <div class="stats-row" style="margin-top:1rem">
              <div class="stat-box"><div class="num">₹150</div><div class="lbl">Wild Card fee</div></div>
            </div>
            <a
              href="https://wa.me/91${SUPPORT_TEL}?text=${encodeURIComponent("Hi, I want a Wild Card entry for Khatri x ESP7 Free Fire Tournament.")}"
              target="_blank"
              rel="noopener"
              class="btn-primary"
              style="display:block;width:100%;text-align:center;margin-top:1rem;box-sizing:border-box"
            >
              💬 Message on WhatsApp for entry
            </a>
          </div>
        </div>
      </section>

      <section class="section" id="register">
        <div class="container">
          <h2 style="font-size:1.625rem">Register your squad</h2>
          <p class="text-muted" style="margin-top:0.25rem;font-size:0.875rem">Clash Squad only · Add a logo and motto — they power your reveal card.</p>
          <div class="mt-6">${renderRegisterForm()}</div>
          <p class="mt-4 text-muted" style="font-size:0.875rem">Need help? Customer support: <a href="tel:${SUPPORT_TEL}" class="text-gold" style="font-weight:600">${SUPPORT_TEL}</a></p>
        </div>
      </section>

      <section class="section">
        <div class="container-wide">
          <div class="flex flex-wrap items-center justify-between mb-4">
            <div>
              <h2 style="font-size:1.625rem">Squad gallery</h2>
            </div>
            
          </div>
          ${
            regs.length === 0
              ? `<div class="empty-state">No teams registered yet — be the first to lock a slot.</div>`
              : `<div class="team-grid">${regs.map((t, i) => teamCardHtml(t, i)).join("")}</div>`
          }
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
            <div class="mode-locked">⚔ CS Mac 4v4</div>
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
        <legend>Teammates (CS Mac 4v4 — up to 3 more)</legend>
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
          isAdmin
            ? `<div class="reveal-controls">
          <button class="reveal-btn" id="revealPrev" aria-label="Previous">‹</button>
          <button class="reveal-play" id="revealPlay">${state.revealPlaying ? "⏸ Pause" : "▶ Auto-play"}</button>
          <button class="reveal-btn" id="revealNext" aria-label="Next">›</button>
        </div>
        <p class="text-muted" style="text-align:center;margin-top:1rem;font-size:0.75rem">Admin controls · public viewers follow this stage when LIVE</p>`
            : `${
                state.revealPlaying
                  ? `<p class="text-muted" style="text-align:center;margin-top:1.5rem;font-size:0.8rem">Auto-playing · controlled by host</p>`
                  : ""
              }
              <p style="text-align:center;margin-top:1rem;font-size:0.8rem"><a href="#/admin" class="text-muted">Admin login →</a></p>`
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

  const rooms = state.adminRooms || state.settings.rooms; // legacy mode-level rooms (kept for saveRoomSettings compat)

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
          [counts.cs, "CS Mac 4v4"],
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
        <p class="text-muted" style="font-size:0.875rem;margin-bottom:1rem">CS Mac 4v4 — set a Room ID & password for each team so it's clear whose room is whose.</p>
        <div class="room-edit-grid">
          ${
            regs.length === 0
              ? `<p class="text-muted" style="font-size:0.875rem">No teams registered yet.</p>`
              : regs
                  .map((t) => {
                    const draft = state.adminTeamRooms[t.id] || {};
                    const idVal = draft.id != null ? draft.id : t.roomId || "";
                    const passVal = draft.pass != null ? draft.pass : t.roomPass || "";
                    return `
            <div class="room-edit-card">
              <h4>${escapeHtml(t.teamName)}</h4>
              <label>Room ID
                <input class="team-room-id" data-team-id="${escapeHtml(t.id)}" value="${escapeHtml(idVal)}" />
              </label>
              <label>Password
                <input class="team-room-pass" data-team-id="${escapeHtml(t.id)}" value="${escapeHtml(passVal)}" />
              </label>
              <button class="btn-ghost save-team-room" data-team-id="${escapeHtml(t.id)}" style="margin-top:0.75rem;min-height:auto;padding:0.375rem 0.75rem;font-size:0.75rem">
                Save for ${escapeHtml(t.teamName)}
              </button>
              ${state.adminTeamRoomSaved === t.id ? '<span class="text-success" style="margin-left:0.5rem;font-size:0.75rem">Saved</span>' : ""}
            </div>`;
                  })
                  .join("")
          }
        </div>

        <h4 style="margin-top:1.5rem;font-size:1rem">Match pairings (Team vs Team)</h4>
        <p class="text-muted" style="font-size:0.875rem;margin-bottom:0.75rem">Pick two teams and set their shared Room ID & password — same idea as the VS poster, but here it's tied to the room.</p>
        ${
          regs.length < 2
            ? `<p class="text-muted" style="font-size:0.875rem">Need at least 2 registered teams to create a pairing.</p>`
            : `
        <div class="vs-picks" style="margin-top:0">
          <div class="field"><label for="matchPickA">Team A</label>
            <select id="matchPickA" style="width:100%;border-radius:0.375rem;border:1px solid var(--line);background:var(--raised);color:inherit;padding:0.5rem">
              <option value="">— select team —</option>
              ${regs.map((t) => `<option value="${escapeHtml(t.id)}" ${state.adminMatchDraft.aId === t.id ? "selected" : ""}>${escapeHtml(t.teamName)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label for="matchPickB">Team B</label>
            <select id="matchPickB" style="width:100%;border-radius:0.375rem;border:1px solid var(--line);background:var(--raised);color:inherit;padding:0.5rem">
              <option value="">— select team —</option>
              ${regs.map((t) => `<option value="${escapeHtml(t.id)}" ${state.adminMatchDraft.bId === t.id ? "selected" : ""}>${escapeHtml(t.teamName)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="vs-picks" style="margin-top:0.75rem">
          <div class="field"><label for="matchRoomId">Room ID</label><input id="matchRoomId" value="${escapeHtml(state.adminMatchDraft.roomId)}" style="width:100%;border-radius:0.375rem;border:1px solid var(--line);background:var(--raised);color:inherit;padding:0.5rem" /></div>
          <div class="field"><label for="matchRoomPass">Password</label><input id="matchRoomPass" value="${escapeHtml(state.adminMatchDraft.roomPass)}" style="width:100%;border-radius:0.375rem;border:1px solid var(--line);background:var(--raised);color:inherit;padding:0.5rem" /></div>
        </div>
        <button class="btn-primary" id="addMatch" style="margin-top:0.75rem;min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">Add match pairing</button>
        `
        }
        ${
          state.settings.matches.length > 0
            ? `<div style="margin-top:1.25rem;display:flex;flex-direction:column;gap:0.5rem">
            ${state.settings.matches
              .map((m) => {
                const a = regs.find((t) => t.id === m.aId);
                const b = regs.find((t) => t.id === m.bId);
                return `<div class="room-item" style="border:1px solid var(--line);border-radius:0.5rem;padding:0.75rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.5rem">
                  <div>
                    <div class="val" style="font-weight:600">${escapeHtml((a && a.teamName) || "?")} <span class="text-gold">vs</span> ${escapeHtml((b && b.teamName) || "?")}</div>
                    <div class="text-muted" style="font-size:0.8rem;margin-top:0.25rem">Room ID: ${escapeHtml(m.roomId || "—")} · Password: ${escapeHtml(m.roomPass || "—")}</div>
                  </div>
                  <button class="btn-ghost remove-match" data-match-id="${escapeHtml(m.id)}" style="min-height:auto;padding:0.375rem 0.75rem;font-size:0.75rem;color:var(--danger,#e5484d);border-color:var(--danger,#e5484d)">Remove</button>
                </div>`;
              })
              .join("")}
          </div>`
            : ""
        }
      </section>

      <!-- Team Reveal inside Admin -->
      <section class="admin-section">
        <h3>Team Reveal (admin control)</h3>
        <p class="text-muted" style="font-size:0.875rem;margin-bottom:1rem">
          Public page only shows Reveal when you make it <strong style="color:var(--fg)">LIVE</strong>.
          Auto-play advances on all public screens in sync.
        </p>
        <div class="flex flex-wrap gap-2" style="margin-bottom:1rem">
          <button class="btn-primary" id="toggleRevealPublic" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">
            ${state.settings.revealPublic ? "● LIVE — hide from public" : "Make Reveal LIVE (public)"}
          </button>
          <button class="btn-ghost" id="adminRevealPlay" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">
            ${state.revealPlaying ? "Pause auto-play" : "Start auto-play"}
          </button>
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

      ${renderAdminVs(regs)}
    </div>
  `;
}

// ── VS poster ──────────────────────────────────────────
function findTeam(id) {
  return state.registrations.find((t) => t.id === id) || null;
}

function vsPairFromSettings() {
  return {
    a: findTeam(state.settings.vsTeamA),
    b: findTeam(state.settings.vsTeamB),
    when: { date: state.settings.vsMatchDate || "", time: state.settings.vsMatchTime || "" },
  };
}

// "Sat, 20 Sep 2026 · 7:30 PM" from { date: "YYYY-MM-DD", time: "HH:MM" }
function vsWhenText(when) {
  if (!when) return "";
  const parts = [];
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(when.date || "");
  if (dm) {
    parts.push(
      new Date(+dm[1], +dm[2] - 1, +dm[3]).toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    );
  }
  const tm = /^(\d{2}):(\d{2})$/.exec(when.time || "");
  if (tm) {
    let h = +tm[1];
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    parts.push(`${h}:${tm[2]} ${ap}`);
  }
  return parts.join(" · ");
}

// Admin draft (selects) falls back to what is saved in Firebase
function vsPairDraft() {
  const aId = state.vsPickA != null ? state.vsPickA : state.settings.vsTeamA;
  const bId = state.vsPickB != null ? state.vsPickB : state.settings.vsTeamB;
  const when = {
    date: state.vsPickDate != null ? state.vsPickDate : state.settings.vsMatchDate || "",
    time: state.vsPickTime != null ? state.vsPickTime : state.settings.vsMatchTime || "",
  };
  return { aId, bId, a: findTeam(aId), b: findTeam(bId), when };
}

function vsKey(a, b, when) {
  const part = (t) => [t.id, t.teamName, t.tagline || "", (t.logoDataUrl || "").length].join("~");
  return part(a) + "|" + part(b) + "|" + ((when && when.date) || "") + "T" + ((when && when.time) || "");
}

function vsLoadImage(src) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
}

function vsRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function vsFitFont(ctx, text, maxW, start, min, weight, family) {
  let s = start;
  while (s > min) {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  }
  ctx.font = `${weight} ${s}px ${family}`;
}

async function vsDrawTeam(ctx, team, cx, top, size, colors) {
  const x = cx - size / 2;
  ctx.save();
  vsRoundRect(ctx, x, top, size, size, 36);
  ctx.clip();
  const img = team.logoDataUrl ? await vsLoadImage(team.logoDataUrl) : null;
  if (img) {
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, cx - w / 2, top + size / 2 - h / 2, w, h);
  } else {
    const g = ctx.createLinearGradient(x, top, x + size, top + size);
    g.addColorStop(0, colors.ember);
    g.addColorStop(1, colors.gold);
    ctx.fillStyle = g;
    ctx.fillRect(x, top, size, size);
    ctx.fillStyle = colors.bg;
    ctx.textAlign = "center";
    ctx.font = "700 120px Rajdhani, Inter, sans-serif";
    ctx.fillText(teamInitials(team.teamName), cx, top + size / 2 + 42);
  }
  ctx.restore();
  ctx.lineWidth = 6;
  ctx.strokeStyle = colors.gold;
  vsRoundRect(ctx, x, top, size, size, 36);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = colors.fg;
  vsFitFont(ctx, String(team.teamName || "").toUpperCase(), 900, 80, 40, 700, "Rajdhani, Inter, sans-serif");
  ctx.fillText(String(team.teamName || "").toUpperCase(), cx, top + size + 70);
  if (team.tagline) {
    let tag = String(team.tagline);
    ctx.font = "500 30px Inter, sans-serif";
    while (ctx.measureText(tag).width > 860 && tag.length > 1) tag = tag.slice(0, -2);
    if (tag !== team.tagline) tag = tag.trimEnd() + "…";
    ctx.fillStyle = colors.muted;
    ctx.fillText(tag, cx, top + size + 115);
  }
}

async function buildVsPoster(a, b, when) {
  const W = 1080;
  const H = 1350;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const col = (n, f) => (css.getPropertyValue(n) || "").trim() || f;
  const colors = {
    bg: col("--bg", "#0b0b0f"),
    ember: col("--ember", "#ff5a1f"),
    gold: col("--gold", "#f5b942"),
    fg: col("--fg", "#f4f4f5"),
    muted: "rgba(255,255,255,0.6)",
  };
  try {
    await Promise.all([document.fonts.load("700 80px Rajdhani"), document.fonts.load("500 30px Inter")]);
  } catch (e) {
    /* fonts optional — fallbacks are set */
  }

  // background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, H * 0.7);
  glow.addColorStop(0, "rgba(255,90,31,0.24)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,90,31,0.10)";
  ctx.beginPath();
  ctx.moveTo(0, H * 0.42);
  ctx.lineTo(W, H * 0.30);
  ctx.lineTo(W, H * 0.46);
  ctx.lineTo(0, H * 0.58);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = colors.gold;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  // header
  ctx.textAlign = "center";
  ctx.fillStyle = colors.gold;
  ctx.font = "700 64px Rajdhani, Inter, sans-serif";
  ctx.fillText("KHATRI × ESP7", W / 2, 120);
  ctx.fillStyle = colors.fg;
  ctx.font = "600 34px Inter, sans-serif";
  ctx.fillText("CS MAC 4V4 · FREE FIRE", W / 2, 175);

  // teams + VS
  await vsDrawTeam(ctx, a, W / 2, 225, 260, colors);
  ctx.fillStyle = colors.ember;
  ctx.fillRect(90, 700, 290, 4);
  ctx.fillRect(W - 380, 700, 290, 4);
  ctx.save();
  ctx.shadowColor = colors.ember;
  ctx.shadowBlur = 40;
  ctx.fillStyle = colors.ember;
  ctx.textAlign = "center";
  ctx.font = "700 190px Rajdhani, Inter, sans-serif";
  ctx.fillText("VS", W / 2, 770);
  ctx.restore();
  await vsDrawTeam(ctx, b, W / 2, 820, 260, colors);

  // footer — chosen match date & time (falls back to the old line if not set)
  ctx.textAlign = "center";
  const whenTxt = vsWhenText(when).toUpperCase();
  if (whenTxt) {
    ctx.fillStyle = colors.muted;
    ctx.font = "600 26px Inter, sans-serif";
    ctx.fillText("MATCH DATE & TIME", W / 2, 1240);
    ctx.fillStyle = colors.gold;
    vsFitFont(ctx, whenTxt, 900, 56, 34, 700, "Rajdhani, Inter, sans-serif");
    ctx.fillText(whenTxt, W / 2, 1298);
  } else {
    ctx.fillStyle = colors.muted;
    ctx.font = "600 30px Inter, sans-serif";
    ctx.fillText("MATCH TIME · ANNOUNCED ON YOUTUBE LIVE", W / 2, 1290);
  }

  return cv.toDataURL("image/jpeg", 0.92);
}

// Returns cached poster URL, or "" while it is being generated (img is filled in when ready)
function vsPosterUrl(a, b, when) {
  if (!a || !b) return "";
  const key = vsKey(a, b, when);
  if (state.vsPoster[key]) return state.vsPoster[key];
  if (!state.vsPosterBusy[key]) {
    state.vsPosterBusy[key] = true;
    buildVsPoster(a, b, when)
      .then((url) => {
        if (Object.keys(state.vsPoster).length > 6) state.vsPoster = {};
        state.vsPoster[key] = url;
        const el = document.getElementById("vsPosterImg");
        if (el && el.getAttribute("data-key") === key) {
          el.src = url;
          const dl = document.getElementById("vsPosterDl");
          if (dl) dl.href = url;
        }
      })
      .catch((e) => console.error("VS poster failed", e))
      .finally(() => {
        delete state.vsPosterBusy[key];
      });
  }
  return "";
}

function vsPosterBlock(a, b, when) {
  const key = vsKey(a, b, when);
  const url = vsPosterUrl(a, b, when);
  return `
    <img class="vs-poster-img" id="vsPosterImg" data-key="${escapeHtml(key)}" ${url ? `src="${url}"` : ""} alt="VS poster: ${escapeHtml(a.teamName)} vs ${escapeHtml(b.teamName)}" style="display:block;margin-left:auto;margin-right:auto" />
    <p style="text-align:center;margin-top:0.75rem">
      <a class="btn-ghost" id="vsPosterDl" ${url ? `href="${url}"` : ""} download="vs-poster.jpg" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">Download poster</a>
    </p>`;
}

// Date/time inputs change the poster without re-rendering the page (keeps input focus)
function vsRefreshPreview() {
  const d = vsPairDraft();
  const el = document.getElementById("vsPosterImg");
  if (!el || !d.a || !d.b) return;
  el.setAttribute("data-key", vsKey(d.a, d.b, d.when));
  const url = vsPosterUrl(d.a, d.b, d.when);
  if (url) {
    el.src = url;
    const dl = document.getElementById("vsPosterDl");
    if (dl) dl.href = url;
  }
}

function vsSide(t) {
  const inner = t.logoDataUrl
    ? `<img src="${escapeHtml(t.logoDataUrl)}" alt="" />`
    : escapeHtml(teamInitials(t.teamName));
  return `
    <div style="text-align:center;max-width:9rem">
      <div class="vs-mono" style="margin:0 auto">${inner}</div>
      <p style="margin-top:0.5rem;font-weight:600;font-size:0.875rem;word-break:break-word">${escapeHtml(t.teamName)}</p>
    </div>`;
}

function renderVs() {
  const live = !!state.settings.vsPosterPublic;
  const isAdmin = state.adminAuthed;
  const { a, b, when } = vsPairFromSettings();
  const whenText = vsWhenText(when);
  const ready = !!(a && b);
  let body = "";
  if (!live && !isAdmin) {
    body = ""; // public: nothing is shown until admin makes the poster LIVE
  } else if (!ready) {
    body = isAdmin
      ? `<div class="empty-state mt-6">Choose both teams and save in the Admin panel's VS Poster section. <a href="#/admin" class="text-gold">Admin →</a></div>`
      : "";
  } else {
    body = `
      ${
        !live
          ? `<p class="text-muted" style="margin-top:1rem;font-size:0.8rem">Only visible to you (admin) — hidden from the public. Make it LIVE from the Admin panel. <a href="#/admin" class="text-gold">Admin →</a></p>`
          : ""
      }
      <div class="vs-preview-row">
        ${vsSide(a)}
        <span class="vs-text">VS</span>
        ${vsSide(b)}
      </div>
      ${
        whenText
          ? `<p style="text-align:center;margin-top:1rem;font-family:var(--font-display);font-size:1.25rem;font-weight:700;color:var(--gold)">${escapeHtml(whenText)}</p>`
          : ""
      }
      ${vsPosterBlock(a, b, when)}`;
  }
  return `
    <div class="page">
      <main class="vs-page">
        <p class="text-gold" style="font-family:var(--font-display);font-size:0.875rem;letter-spacing:0.18em">CS MAC 4V4</p>
        <h1 style="font-size:2.25rem;margin-top:0.5rem">⚔️ VS</h1>
        ${body}
      </main>
    </div>`;
}

function renderAdminVs(regs) {
  const d = vsPairDraft();
  const live = !!state.settings.vsPosterPublic;
  const selStyle =
    "width:100%;border-radius:0.375rem;border:1px solid var(--line);background:var(--raised);color:inherit;padding:0.5rem";
  const opts = (sel) =>
    `<option value="">— select team —</option>` +
    regs
      .map(
        (t) =>
          `<option value="${escapeHtml(t.id)}" ${t.id === sel ? "selected" : ""}>${escapeHtml(t.teamName)}</option>`
      )
      .join("");
  return `
      <!-- VS Poster inside Admin -->
      <section class="admin-section">
        <h3>VS Poster (admin control)</h3>
        <p class="text-muted" style="font-size:0.875rem;margin-bottom:1rem">
          The VS poster is only visible to the public on the VS section once you make it <strong style="color:var(--fg)">LIVE</strong>.
        </p>
        ${
          regs.length < 2
            ? `<p class="text-muted" style="font-size:0.875rem">Need at least 2 registered teams for VS.</p>`
            : `
        <div class="vs-picks" style="margin-top:0">
          <div class="field"><label for="vsPickA">Team A</label><select id="vsPickA" style="${selStyle}">${opts(d.aId)}</select></div>
          <div class="field"><label for="vsPickB">Team B</label><select id="vsPickB" style="${selStyle}">${opts(d.bId)}</select></div>
        </div>
        <div class="vs-picks" style="margin-top:0">
          <div class="field"><label for="vsDate">Match date</label><input type="date" id="vsDate" value="${escapeHtml(d.when.date)}" style="${selStyle};color-scheme:dark" /></div>
          <div class="field"><label for="vsTime">Match time</label><input type="time" id="vsTime" value="${escapeHtml(d.when.time)}" style="${selStyle};color-scheme:dark" /></div>
        </div>
        <div class="flex flex-wrap gap-2" style="margin:1rem 0">
          <button class="btn-ghost" id="vsSave" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">Save match</button>
          <button class="btn-primary" id="vsToggle" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">
            ${live ? "● LIVE — hide from public" : "Make VS Poster LIVE (public)"}
          </button>
          <a href="#/vs" class="btn-ghost" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem">Preview VS page →</a>
          ${
            d.a && d.b
              ? `<button class="btn-ghost" id="vsDelete" style="min-height:auto;padding:0.5rem 1rem;font-size:0.875rem;color:var(--danger,#e5484d);border-color:var(--danger,#e5484d)">🗑 Delete poster</button>`
              : ""
          }
        </div>
        <p style="font-size:0.8rem;margin-bottom:0.75rem">
          Status:
          ${live ? '<span class="text-success">Public can see VS poster</span>' : '<span class="text-muted">Hidden from public</span>'}
        </p>
        ${
          d.a && d.b
            ? `<div style="max-width:20rem">${vsPosterBlock(d.a, d.b, d.when)}</div>`
            : `<p class="text-muted" style="font-size:0.8rem">Select both teams — the poster preview will appear here.</p>`
        }`
        }
      </section>
`;
}

function vsDraftValid(d) {
  if (!d.a || !d.b) {
    alert("Select both teams first.");
    return false;
  }
  if (d.aId === d.bId) {
    alert("Team A and Team B must be different.");
    return false;
  }
  return true;
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

  // Site nav always visible
  const navEl = document.querySelector(".site-nav");
  if (navEl) navEl.style.display = "";

  // Reveal button in public nav — visible only while Reveal is LIVE
  const navReveal = document.getElementById("navReveal");
  if (navReveal) navReveal.style.display = "";

  let html = "";
  if (state.route === "/admin") {
    html = renderAdmin();
  } else if (state.adminAuthed && state.route === "/reveal") {
    html = renderReveal();
  } else if (state.route === "/hall") {
    html = renderHall();
  } else if (state.route === "/vs") {
    html = renderVs();
  } else if (state.route === "/reveal") {
    // Direct link when not live → soft message
    html = renderReveal();
  } else {
    html = renderHome();
  }

  app.innerHTML = html;
  bindEvents();
}

function renderRevealFullscreen() {
  const regs = state.registrations;
  const safeIdx = regs.length ? Math.min(Math.max(0, state.revealIdx), regs.length - 1) : 0;
  const team = regs[safeIdx];
  return `
    <div class="reveal-stage" style="min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5rem 1rem;box-sizing:border-box">
      <div style="width:100%;max-width:22rem;text-align:center">
        <p class="text-gold" style="font-family:var(--font-display);font-size:0.8rem;letter-spacing:0.2em;margin:0">SQUAD REVEAL</p>
        <div style="display:inline-flex;align-items:center;gap:0.4rem;margin-top:0.6rem;border-radius:9999px;border:1px solid var(--success);background:rgba(76,175,125,0.12);padding:0.25rem 0.75rem;font-size:0.7rem;font-weight:600;color:var(--success)">
          <span style="width:0.4rem;height:0.4rem;border-radius:9999px;background:var(--success);display:inline-block"></span> LIVE
        </div>
      </div>
      ${
        regs.length === 0
          ? `<p class="text-muted" style="text-align:center;margin-top:3rem">Waiting for teams…</p>`
          : `
        <p class="text-gold" style="text-align:center;margin:1.25rem 0 0;font-family:var(--font-display);font-size:1.1rem">
          ${String(safeIdx + 1).padStart(2, "0")} / ${String(regs.length).padStart(2, "0")}
        </p>
        <div class="reveal-card-wrap ${state.revealCurtain ? "curtain" : ""}" style="width:100%;max-width:20rem;margin:1rem auto 0">
          ${team ? teamCardHtml(team, safeIdx, true) : ""}
        </div>
        ${state.revealPlaying ? `<p class="text-muted" style="text-align:center;margin-top:1.25rem;font-size:0.75rem">Auto-playing · host controlled</p>` : ""}
      `
      }
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

  // Room saves (per team)
  document.querySelectorAll(".team-room-id").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const teamId = e.target.getAttribute("data-team-id");
      if (!state.adminTeamRooms[teamId]) state.adminTeamRooms[teamId] = {};
      state.adminTeamRooms[teamId].id = e.target.value;
    });
  });
  document.querySelectorAll(".team-room-pass").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const teamId = e.target.getAttribute("data-team-id");
      if (!state.adminTeamRooms[teamId]) state.adminTeamRooms[teamId] = {};
      state.adminTeamRooms[teamId].pass = e.target.value;
    });
  });
  document.querySelectorAll(".save-team-room").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const teamId = btn.getAttribute("data-team-id");
      const team = state.registrations.find((t) => t.id === teamId);
      const draft = state.adminTeamRooms[teamId] || {};
      const roomId = (draft.id != null ? draft.id : (team && team.roomId) || "").trim();
      const roomPass = (draft.pass != null ? draft.pass : (team && team.roomPass) || "").trim();
      await saveTeamRoom(teamId, roomId, roomPass);
      state.adminTeamRoomSaved = teamId;
      render();
      setTimeout(() => { state.adminTeamRoomSaved = ""; render(); }, 1600);
    });
  });

  // Match pairings (team vs team, with room id/password)
  const mpA = document.getElementById("matchPickA");
  const mpB = document.getElementById("matchPickB");
  const mrId = document.getElementById("matchRoomId");
  const mrPass = document.getElementById("matchRoomPass");
  if (mpA) mpA.addEventListener("change", (e) => { state.adminMatchDraft.aId = e.target.value; });
  if (mpB) mpB.addEventListener("change", (e) => { state.adminMatchDraft.bId = e.target.value; });
  if (mrId) mrId.addEventListener("input", (e) => { state.adminMatchDraft.roomId = e.target.value; });
  if (mrPass) mrPass.addEventListener("input", (e) => { state.adminMatchDraft.roomPass = e.target.value; });
  const addMatchBtn = document.getElementById("addMatch");
  if (addMatchBtn) {
    addMatchBtn.addEventListener("click", async () => {
      const d = state.adminMatchDraft;
      if (!d.aId || !d.bId || d.aId === d.bId) {
        alert("Choose two different teams.");
        return;
      }
      await addMatch(d.aId, d.bId, (d.roomId || "").trim(), (d.roomPass || "").trim());
      state.adminMatchDraft = { aId: "", bId: "", roomId: "", roomPass: "" };
      render();
    });
  }
  document.querySelectorAll(".remove-match").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await removeMatch(btn.getAttribute("data-match-id"));
      render();
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
      await updateRevealPublic(!state.settings.revealPublic);
    });
  }

  // VS poster (admin)
  const vsPickA = document.getElementById("vsPickA");
  const vsPickB = document.getElementById("vsPickB");
  if (vsPickA) vsPickA.addEventListener("change", (e) => { state.vsPickA = e.target.value; render(); });
  if (vsPickB) vsPickB.addEventListener("change", (e) => { state.vsPickB = e.target.value; render(); });
  const vsDate = document.getElementById("vsDate");
  const vsTime = document.getElementById("vsTime");
  if (vsDate) vsDate.addEventListener("change", (e) => { state.vsPickDate = e.target.value; vsRefreshPreview(); });
  if (vsTime) vsTime.addEventListener("change", (e) => { state.vsPickTime = e.target.value; vsRefreshPreview(); });
  const vsSave = document.getElementById("vsSave");
  if (vsSave) {
    vsSave.addEventListener("click", async () => {
      const d = vsPairDraft();
      if (!vsDraftValid(d)) return;
      await saveVsPair(d.aId, d.bId, d.when);
      state.vsPickA = null;
      state.vsPickB = null;
      state.vsPickDate = null;
      state.vsPickTime = null;
    });
  }
  const vsToggle = document.getElementById("vsToggle");
  if (vsToggle) {
    vsToggle.addEventListener("click", async () => {
      if (state.settings.vsPosterPublic) {
        await updateVsPosterPublic(false);
        return;
      }
      const d = vsPairDraft();
      if (!vsDraftValid(d)) return;
      await updateVsPosterPublic(true, d.aId, d.bId, d.when);
      state.vsPickA = null;
      state.vsPickB = null;
      state.vsPickDate = null;
      state.vsPickTime = null;
    });
  }
  const vsDelete = document.getElementById("vsDelete");
  if (vsDelete) {
    vsDelete.addEventListener("click", async () => {
      if (!confirm("Delete the VS poster? This clears the teams, date, and time.")) return;
      await deleteVsPoster();
      render();
    });
  }
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
