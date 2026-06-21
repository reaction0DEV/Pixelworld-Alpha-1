/* ═══════════════════════════════════════════════════════════
   PIXELWORLD CLIENT v3
   + Connexion Discord obligatoire
   + Admin panel
   + Anti-spam
   + Ban de salon
   + Changer pseudo
   + Fix sync suppression pixel (pixel:batch:ack)
═══════════════════════════════════════════════════════════ */

/* ── PALETTE ── */
const PAL = [
  '#000000','#111111','#333333','#555555','#777777','#999999','#bbbbbb','#dddddd','#eeeeee','#ffffff',
  '#ff0000','#ff3333','#cc0000','#990000','#660000','#ff6666','#ff9999','#ffcccc','#ff4444','#dd2222',
  '#ff6600','#ff8800','#ffaa00','#cc5500','#993300','#ffbb66','#ffdd99','#ff7733','#dd5500','#ffcc88',
  '#ffee00','#ffff00','#cccc00','#999900','#666600','#ffff66','#ffff99','#ffee66','#eecc00','#fff0aa',
  '#88ff00','#aaee00','#66cc00','#449900','#336600','#ccff66','#eeff99','#aabb00','#88cc00','#ddff88',
  '#00cc00','#00ff00','#009900','#006600','#003300','#66ff66','#99ff99','#00ee44','#00bb33','#ccffcc',
  '#00ff88','#00ee66','#00cc55','#009944','#006633','#66ffbb','#99ffcc','#00ffaa','#00dd77','#aaffdd',
  '#00ffff','#00eeee','#00cccc','#009999','#006666','#66ffff','#99ffff','#00dddd','#00aaaa','#ccffff',
  '#0099ff','#00aaff','#0066cc','#004499','#002266','#66bbff','#99ccff','#00bbff','#0077dd','#ccddff',
  '#0044ff','#0066ff','#0022cc','#001199','#000066','#4477ff','#8899ff','#0033ee','#0055cc','#aabbff',
  '#4400ff','#5522ff','#3300cc','#220099','#110066','#7755ff','#9988ff','#4422ee','#3311cc','#bbaaff',
  '#8800ff','#9922ff','#6600cc','#440099','#220066','#aa55ff','#cc88ff','#9933ff','#7700dd','#ddaaff',
  '#ff00ff','#ff22ee','#cc00cc','#990099','#660066','#ff66ff','#ff99ff','#ee00ee','#dd00cc','#ffccff',
  '#ff2d78','#ff0055','#cc0044','#990033','#660022','#ff6699','#ff99bb','#ff44aa','#dd2266','#ffbbcc',
  '#ff88aa','#ff99bb','#ffbbcc','#ffaabb','#dd6688','#ee4477','#cc3366','#bb2255','#ff3366','#ffddee',
  '#4a2008','#6b3410','#8b4513','#a0522d','#c17a45','#d2935f','#e8b080','#f0c898','#f8ddb8','#fff0e0',
  '#008080','#006666','#004d4d','#20b2aa','#40e0d0','#48d1cc','#00ced1','#5f9ea0','#2f8080','#7fffd4',
  '#ff6347','#ffa500','#ffd700','#adff2f','#7fff00','#00fa9a','#00bfff','#1e90ff','#da70d6','#ff69b4',
];
const UCOLS = ['#0066ff','#ff2d78','#ffee00','#00cc66','#8b5cf6','#ff6600','#00ccff','#ff2200','#44ff88','#ff44cc'];
const PIXEL_SIZE = 10;

/* ── STATE ── */
let pseudo = '', myColor = '', myDiscordId = null, myDiscordUser = null, sessionToken = null;
let isAdmin = false;
let roomInfo = null, isOwner = false, isMod = false;
let WORLD_W = 800, WORLD_H = 600;
const pixels = new Map();
let col = '#0066ff', tool = 'draw', brush = 1, showGrid = true;
let zoom = 1, camX = 0, camY = 0;
let drawing = false, stroke = {}, undoSt = [], redoSt = [];
let lineStart = null, linePrev = [];
let panning = false, panStartX = 0, panStartY = 0, panCamX = 0, panCamY = 0;
let spaceHeld = false, mmDirty = true;
let pendingJoinRoomId = null;
const remoteCursors = new Map();
let lastCursorEmit = 0;
let zoneSelectMode = false, zoneStart = null;
let protectedZones = [], offlinePlayers = [], reportsList = [];
let adminData = null, adminTab = 'overview';

/* ── SOCKET ── */
const socket = io();

/* ── DOM ── */
const vp    = document.getElementById('vp');
const cvs   = document.getElementById('cvs');
const ctx   = cvs.getContext('2d');
const mm    = document.getElementById('minimap');
const mmCtx = mm.getContext('2d');

/* ══════════════════════════════════════════
   DISCORD AUTH
══════════════════════════════════════════ */
function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function initAuth() {
  // 1. Vérifier d'abord les cookies (session persistante)
  try {
    const cookieRes = await fetch('/auth/current-session');
    const cookieData = await cookieRes.json();
    if (cookieData.valid) {
      // Session cookie valide - connexion automatique
      sessionToken = 'cookie_session'; // Marqueur spécial pour les cookies
      currentUser = cookieData;
      showLoginSuccess(cookieData.username, cookieData.avatar);
      initSocket();
      loadThemePreference();
      return;
    }
  } catch (err) {
    console.error('Erreur vérification cookie:', err);
  }

  // 2. Récupérer le token depuis l'URL si présent
  const tokenFromUrl = getUrlParam('token');
  const errorFromUrl = getUrlParam('error');

  if (errorFromUrl) {
    showLoginErr('Erreur de connexion Discord. Réessaie.');
    return;
  }

  if (tokenFromUrl) {
    // Nettoyer l'URL
    window.history.replaceState({}, document.title, '/');
    localStorage.setItem('pw_discord_token', tokenFromUrl);
    sessionToken = tokenFromUrl;
  } else {
    sessionToken = localStorage.getItem('pw_discord_token');
  }

  if (!sessionToken) return; // Pas de token → rester sur la page login

  // 2. Valider le token
  try {
    const res = await fetch(`/auth/session?token=${sessionToken}`);
    const data = await res.json();
    if (!data.valid) {
      localStorage.removeItem('pw_discord_token');
      sessionToken = null;
      if (errorFromUrl || tokenFromUrl) showLoginErr('Session expirée. Reconnecte-toi.');
      return;
    }
    onDiscordLogin(data);
  } catch(e) {
    showLoginErr('Erreur réseau. Vérifie ta connexion.');
  }
}

function onDiscordLogin(session) {
  pseudo       = session.pseudo || session.username;
  myDiscordId  = session.discordId;
  myDiscordUser= session.username;
  isAdmin      = session.isAdmin || false;
  myColor      = localStorage.getItem('pw_color') || UCOLS[Math.floor(Math.random() * UCOLS.length)];
  localStorage.setItem('pw_color', myColor);

  // Mettre à jour la nav
  document.getElementById('nav-name').textContent    = pseudo;
  document.getElementById('nav-discord').textContent = `@${session.username}`;
  document.getElementById('nav-dot').style.background = myColor;

  const avatar = document.getElementById('nav-avatar');
  if (session.avatar) { avatar.src = session.avatar; avatar.style.display = 'block'; }

  if (isAdmin) {
    document.getElementById('btn-admin').style.display = 'inline-flex';
  }

  // Masquer login, afficher lobby
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-lobby').classList.add('on');

  // Charger la préférence de thème (avec détection système)
  loadThemePreference();
  socket.emit('lobby:list');

  // Valider aussi via socket pour que le serveur sache qu'on est connecté
  socket.emit('auth:validate', { token: sessionToken }, (res) => {
    if (!res.valid) {
      toast('⚠️ Session invalide, reconnecte-toi.');
      doLogout();
    }
  });
}

function showLoginErr(m) {
  const el = document.getElementById('lerr');
  el.textContent = m; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
}

function doLogout() {
  localStorage.removeItem('pw_discord_token');
  sessionToken = null; pseudo = ''; myDiscordId = null; isAdmin = false;
  location.reload();
}

/* ── CHANGER PSEUDO ── */
function openRenameModal() {
  const input = document.getElementById('rename-input');
  input.value = pseudo;
  document.getElementById('rename-err').style.display = 'none';
  document.getElementById('rename-ok').style.display = 'none';

  // Afficher info Discord
  if (myDiscordId) {
    document.getElementById('rename-discord-info').style.display = 'flex';
    document.getElementById('rename-discord-name').textContent = myDiscordUser || myDiscordId;
    const navAvatar = document.getElementById('nav-avatar');
    if (navAvatar.src) document.getElementById('rename-avatar').src = navAvatar.src;
  }
  openModal('modal-rename');
  setTimeout(() => input.focus(), 100);
}

function doRename() {
  const input = document.getElementById('rename-input');
  const newPseudo = input.value.trim();
  const errEl = document.getElementById('rename-err');
  const okEl  = document.getElementById('rename-ok');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  if (!newPseudo || newPseudo.length < 2) {
    errEl.textContent = 'Pseudo trop court (2 min)'; errEl.style.display = 'block'; return;
  }
  if (newPseudo.length > 18) {
    errEl.textContent = 'Pseudo trop long (18 max)'; errEl.style.display = 'block'; return;
  }

  socket.emit('user:rename', { pseudo: newPseudo }, (res) => {
    if (res?.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
    pseudo = newPseudo;
    document.getElementById('nav-name').textContent = pseudo;
    okEl.textContent = `✓ Pseudo changé en "${pseudo}"`; okEl.style.display = 'block';
    toast(`✏️ Pseudo → ${pseudo}`);
    setTimeout(() => closeModal('modal-rename'), 1200);
  });
}

/* ══════════════════════════════════════════
   SOCKET EVENTS
══════════════════════════════════════════ */
socket.on('connect', () => { socket.emit('lobby:list'); });
socket.on('room:list', renderRooms);

socket.on('room:joined', (data) => {
  roomInfo = data.room;
  isOwner  = data.isOwner || false;
  isMod    = data.isMod   || false;
  WORLD_W  = roomInfo.canvasW || 800;
  WORLD_H  = roomInfo.canvasH || 600;
  protectedZones = roomInfo.protectedZones || [];

  pixels.clear();
  for (const [k, v] of Object.entries(data.canvas || {})) pixels.set(k, v);
  mmDirty = true;
  showGame();
  updateMinimap(true);
  toast(`Room "${roomInfo.name}" rejointe !${isOwner ? ' 👑 Propriétaire' : ''}`);

  if (isOwner || isMod) {
    socket.emit('mod:offline_list', null, (list) => { offlinePlayers = list || []; renderOfflineList(); });
    socket.emit('mod:get_reports', null, (list) => { reportsList = list || []; updateReportBadge(); renderReportsList(); });
  }
  updateAntiSpamBadge();
});

socket.on('room:info', (info) => {
  roomInfo = info;
  WORLD_W  = info.canvasW || WORLD_W;
  WORLD_H  = info.canvasH || WORLD_H;
  isOwner  = info.owner === pseudo;
  isMod    = (info.mods || []).includes(pseudo);
  protectedZones = info.protectedZones || [];
  renderGameInfo(); renderModPanel(); render();
  updateAntiSpamBadge();
});

socket.on('room:member_joined', (m) => { toast(`${m.pseudo} a rejoint la room`); renderGameInfo(); });
socket.on('room:member_left', (m) => {
  toast(`${m.pseudo} a quitté la room`);
  renderGameInfo();
  const cur = remoteCursors.get(m.pseudo);
  if (cur?.el) cur.el.remove();
  remoteCursors.delete(m.pseudo);
});
socket.on('room:owner_changed', (data) => {
  if (data.newOwner === pseudo) { isOwner = true; toast('🏠 Tu es maintenant propriétaire !'); }
});
socket.on('room:kicked', (data) => { alert(data.reason || 'Expulsé de la room'); doLeaveRoom(); });
socket.on('room:deleted', (data) => { alert(data.reason || 'Room supprimée'); doLeaveRoom(); });

/* ── PIXELS — FIX SYNC SUPPRESSION ── */
socket.on('pixel:batch', (changes) => {
  for (const p of changes) {
    const k = `${p.x}_${p.y}`;
    if (p.color === null) pixels.delete(k);
    else pixels.set(k, { color: p.color, owner: p.owner, ownerColor: p.ownerColor });
  }
  mmDirty = true; render();
});

socket.on('canvas:full', (canvas) => {
  pixels.clear();
  for (const [k, v] of Object.entries(canvas)) pixels.set(k, v);
  mmDirty = true; render(); toast('Canvas mis à jour');
});

socket.on('cursor:update', (data) => {
  let cur = remoteCursors.get(data.pseudo);
  if (!cur) {
    const el = document.createElement('div');
    el.className = 'cursor-label';
    el.innerHTML = `<span class="cursor-dot" style="background:${data.color}"></span><span class="cursor-name">${esc(data.pseudo)}</span>`;
    document.getElementById('cursor-overlay').appendChild(el);
    cur = { x: data.x, y: data.y, color: data.color, el };
    remoteCursors.set(data.pseudo, cur);
  }
  cur.x = data.x; cur.y = data.y; updateCursorEl(cur);
});

socket.on('cursor:remove', (data) => {
  const cur = remoteCursors.get(data.pseudo);
  if (cur?.el) cur.el.remove();
  remoteCursors.delete(data.pseudo);
});

socket.on('zones:update', (zones) => { protectedZones = zones || []; render(); renderZonesList(); });
socket.on('mod:reports_update', (list) => { reportsList = list || []; updateReportBadge(); renderReportsList(); });
socket.on('pixel:flagged', (data) => { toast(`🚨 Pixel signalé (${data.count}×) en (${data.x},${data.y})`); updateReportBadge(); });
socket.on('offline:list', (list) => { offlinePlayers = list || []; renderOfflineList(); });
socket.on('chat:msg', appendChat);

/* ══════════════════════════════════════════
   LOBBY ROOMS
══════════════════════════════════════════ */
function renderRooms(list) {
  const grid = document.getElementById('rooms-grid');
  if (!list || list.length === 0) {
    grid.innerHTML = '<div class="room-empty">Aucune room — crée la première !</div>'; return;
  }
  list = [...list].sort((a,b) => (b.isGeneral||0) - (a.isGeneral||0));
  grid.innerHTML = '';
  list.forEach(r => {
    const card = document.createElement('div');
    card.className = 'room-card' + (r.isGeneral ? ' general' : '');
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
        <div class="rc-name">${esc(r.name)}</div>
        <div class="rc-lock">${r.isGeneral ? '' : (r.hasPassword ? '🔒' : '🌐')}</div>
      </div>
      ${r.isGeneral ? '' : `<div class="rc-owner">👑 ${esc(r.owner)}</div>`}
      <div class="rc-meta">
        <span>👥 ${r.playerCount}/${r.maxPlayers}</span>
        <span>🎨 ${r.canvasW}×${r.canvasH}</span>
        ${r.isGeneral ? '<span style="color:var(--accent);font-weight:700">PUBLIC</span>' : ''}
        ${r.antiSpam ? '<span style="color:var(--purple)">🛡spam</span>' : ''}
      </div>
    `;
    card.onclick = () => joinRoom(r);
    grid.appendChild(card);
  });
}

function joinRoom(r) {
  if (r.hasPassword) {
    pendingJoinRoomId = r.id;
    openModal('modal-pw');
    document.getElementById('modal-pw-input').value = '';
    document.getElementById('modal-pw-err').style.display = 'none';
    document.getElementById('modal-pw-ok').onclick = () => {
      const pw = document.getElementById('modal-pw-input').value;
      closeModal('modal-pw'); doJoinRoom(r.id, pw);
    };
    document.getElementById('modal-pw-input').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('modal-pw-ok').click(); };
  } else { doJoinRoom(r.id, ''); }
}

function doJoinRoom(roomId, password) {
  socket.emit('room:join', {
    roomId, pseudo, color: myColor, pfp: null, password,
    discordId: myDiscordId, discordUsername: myDiscordUser,
  }, (res) => {
    if (res.error) {
      toast('❌ ' + res.error);
      if (res.error.includes('Mot de passe')) {
        openModal('modal-pw');
        document.getElementById('modal-pw-err').textContent = res.error;
        document.getElementById('modal-pw-err').style.display = 'block';
      }
    }
  });
}

document.getElementById('cr-btn').onclick = createRoom;
function createRoom() {
  const name = document.getElementById('cr-name').value.trim();
  const pass = document.getElementById('cr-pass').value;
  const w    = parseInt(document.getElementById('cr-w').value) || 800;
  const h    = parseInt(document.getElementById('cr-h').value) || 600;
  const maxP = parseInt(document.getElementById('cr-max').value) || 50;
  const errEl = document.getElementById('cr-err');
  if (!name || name.length < 2) { errEl.textContent = 'Nom trop court'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  socket.emit('room:create', {
    pseudo, color: myColor, pfp: null, name, password: pass,
    maxPlayers: maxP, canvasW: w, canvasH: h,
    discordId: myDiscordId, discordUsername: myDiscordUser,
  }, (res) => {
    if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; }
    else { document.getElementById('cr-name').value = ''; document.getElementById('cr-pass').value = ''; }
  });
}

/* ══════════════════════════════════════════
   GAME SCREEN
══════════════════════════════════════════ */
function showGame() {
  document.getElementById('screen-lobby').classList.remove('on');
  document.getElementById('screen-game').classList.add('on');
  document.getElementById('zc').style.display = 'flex';
  const MM_W = 176, MM_H = Math.round(176 * WORLD_H / WORLD_W);
  mm.width = WORLD_W; mm.height = WORLD_H;
  mm.style.width = MM_W + 'px'; mm.style.height = MM_H + 'px';
  buildPal(); pickCol('#0066ff'); resizeViewport(); goHome();
  renderGameInfo(); renderModPanel();
  setTimeout(buildColorWheel, 50);
}

function renderGameInfo() {
  if (!roomInfo) return;
  document.getElementById('gh-room').textContent = roomInfo.name + (roomInfo.hasPassword ? ' 🔒' : '');
  document.getElementById('gh-info').textContent = `${roomInfo.playerCount || 0}/${roomInfo.maxPlayers} joueurs`;
  document.getElementById('btn-mod').style.display = (isOwner || isMod) ? 'flex' : 'none';
  const el = document.getElementById('gpl-list');
  el.innerHTML = '';
  (roomInfo.members || []).forEach(m => {
    const row = document.createElement('div');
    row.className = 'gpl-row';
    row.innerHTML = `<div class="gpl-dot" style="background:${m.color}"></div><span style="font-size:9px;flex:1">${esc(m.pseudo)}${m.pseudo === pseudo ? ' <span style="color:var(--muted)">(moi)</span>' : ''}</span>${m.isOwner ? '<span style="font-size:8px;color:var(--accent)">👑</span>' : m.isMod ? '<span style="font-size:8px;color:var(--purple)">🛡</span>' : ''}`;
    el.appendChild(row);
  });
}

function updateAntiSpamBadge() {
  const badge = document.getElementById('chat-antispam-badge');
  const statusEl = document.getElementById('antispam-status');
  if (!badge) return;
  const active = roomInfo?.antiSpam;
  badge.style.display = active ? 'inline-flex' : 'none';
  if (statusEl) statusEl.textContent = `Mode anti-spam : ${active ? 'activé 🟢' : 'désactivé 🔴'}`;
}

function leaveRoom() { if (!confirm('Quitter la room ?')) return; doLeaveRoom(); }

function doLeaveRoom() {
  socket.emit('room:leave');
  pixels.clear(); roomInfo = null; isOwner = false; isMod = false;
  undoSt = []; redoSt = []; protectedZones = [];
  for (const [, cur] of remoteCursors) if (cur.el) cur.el.remove();
  remoteCursors.clear();
  document.getElementById('screen-game').classList.remove('on');
  document.getElementById('screen-lobby').classList.add('on');
  document.getElementById('zc').style.display = 'none';
  document.getElementById('mod-panel').classList.remove('on');
  document.getElementById('chat-msgs').innerHTML = '';
  hideContextMenu();
  socket.emit('lobby:list');
}

/* ══════════════════════════════════════════
   MODERATION PANEL
══════════════════════════════════════════ */
function toggleMod() {
  document.getElementById('mod-panel').classList.toggle('on');
  renderModPanel();
  if (isOwner || isMod) {
    socket.emit('mod:offline_list', null, (list) => { offlinePlayers = list || []; renderOfflineList(); });
    socket.emit('mod:get_reports', null, (list) => { reportsList = list || []; updateReportBadge(); renderReportsList(); });
  }
}

function updateReportBadge() {
  const count = reportsList.length;
  ['report-badge','report-badge-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.style.display = 'inline-flex'; }
    else el.style.display = 'none';
  });
}

/* ── Anti-spam toggle ── */
function toggleAntiSpam() {
  socket.emit('room:toggle_antispam', {}, (res) => {
    if (res?.error) return toast('❌ ' + res.error);
    toast(`Anti-spam ${res.antiSpam ? 'activé 🟢' : 'désactivé 🔴'}`);
  });
}

/* ── Ban de salon ── */
function banFromRoom() {
  const targetPseudo = document.getElementById('ban-room-pseudo').value.trim();
  const reason       = document.getElementById('ban-room-reason').value.trim();
  const banIP        = document.getElementById('ban-room-ip').checked;
  if (!targetPseudo) return toast('Pseudo requis');
  if (!confirm(`Bannir ${targetPseudo} de ce salon ?`)) return;
  socket.emit('mod:ban_from_room', { pseudo: targetPseudo, reason, banIP }, (res) => {
    if (res?.error) toast('❌ ' + res.error);
    else { toast(`🔨 ${targetPseudo} banni du salon`); document.getElementById('ban-room-pseudo').value = ''; }
  });
}

function renderModPanel() {
  if (!roomInfo || (!isOwner && !isMod)) return;

  const playersEl = document.getElementById('mod-players');
  playersEl.innerHTML = '';
  (roomInfo.members || []).forEach(m => {
    if (m.pseudo === pseudo) return;
    const row = document.createElement('div');
    row.className = 'mod-player-row';
    let actions = '';
    if (isOwner && !m.isOwner) {
      const modLabel = m.isMod ? '−Mod' : '+Mod';
      actions += `<button class="mod-act-btn ${m.isMod ? '' : 'purple'}" onclick="${m.isMod ? 'demoteMod' : 'promoteMod'}('${esc(m.pseudo)}')">${modLabel}</button>`;
    }
    if (!m.isOwner) {
      actions += `<button class="mod-act-btn warn" onclick="kickPlayer('${esc(m.pseudo)}')">Kick</button>`;
      actions += `<button class="mod-act-btn danger" onclick="banPlayer('${esc(m.pseudo)}')">Ban</button>`;
      actions += `<button class="mod-act-btn danger" onclick="banPlayerIP('${esc(m.pseudo)}')" title="Ban IP">🌐✕</button>`;
    }
    actions += `<button class="mod-act-btn" onclick="clearPlayerPixels('${esc(m.pseudo)}')">Pixels</button>`;
    row.innerHTML = `<div class="pl-dot" style="background:${m.color}"></div><div class="mod-player-name">${esc(m.pseudo)}${m.isOwner ? ' 👑' : m.isMod ? ' 🛡' : ''}</div><div class="mod-actions">${actions}</div>`;
    playersEl.appendChild(row);
  });
  if (!playersEl.children.length) playersEl.innerHTML = '<div style="font-size:9px;color:var(--muted)">Aucun autre joueur</div>';

  const bannedEl = document.getElementById('mod-banned');
  bannedEl.innerHTML = '';
  const banned = roomInfo.banned || [];
  if (!banned.length) bannedEl.innerHTML = '<div style="font-size:9px;color:var(--muted)">Aucun banni</div>';
  else banned.forEach(b => {
    const span = document.createElement('span');
    span.className = 'banned-tag';
    span.innerHTML = `${esc(b)} <button onclick="unbanPlayer('${esc(b)}')">✕</button>`;
    bannedEl.appendChild(span);
  });

  document.getElementById('mod-pw-section').style.display = isOwner ? 'flex' : 'none';
  document.getElementById('mod-resize-btn').style.display = isOwner ? 'block' : 'none';
  renderReportsList(); renderZonesList(); updateAntiSpamBadge();
}

function renderReportsList() {
  const el = document.getElementById('mod-reports-list');
  if (!el) return;
  if (!reportsList.length) { el.innerHTML = '<div style="font-size:9px;color:var(--muted)">Aucun signalement</div>'; return; }
  el.innerHTML = '';
  reportsList.forEach(rep => {
    const row = document.createElement('div');
    row.className = 'mod-report-row';
    row.innerHTML = `<div style="flex:1"><div style="font-size:9px;font-weight:600">(${rep.x},${rep.y})</div><div style="font-size:9px;color:var(--muted)">par ${esc(rep.owner)} · ${rep.voters.length} signal.</div></div><div style="display:flex;gap:4px"><button class="mod-act-btn" onclick="goToPixel(${rep.x},${rep.y})">👁</button><button class="mod-act-btn danger" onclick="eraseReportedPixel(${rep.x},${rep.y})">🗑</button><button class="mod-act-btn" onclick="clearReport(${rep.x},${rep.y})">✓</button></div>`;
    el.appendChild(row);
  });
}

function renderZonesList() {
  const el = document.getElementById('mod-zones-list');
  if (!el) return;
  if (!protectedZones.length) { el.innerHTML = '<div style="font-size:9px;color:var(--muted)">Aucune zone</div>'; return; }
  el.innerHTML = '';
  protectedZones.forEach(z => {
    const row = document.createElement('div');
    row.className = 'mod-zone-row';
    row.innerHTML = `<div style="flex:1"><div style="font-size:9px;font-weight:600">🔒 ${esc(z.label)}</div><div style="font-size:9px;color:var(--muted)">(${z.x1},${z.y1}) → (${z.x2},${z.y2})</div></div><button class="mod-act-btn danger" onclick="removeZone('${z.id}')">✕</button>`;
    el.appendChild(row);
  });
}

function renderOfflineList() {
  const el = document.getElementById('mod-offline-list');
  if (!el) return;
  if (!offlinePlayers.length) { el.innerHTML = '<div style="font-size:9px;color:var(--muted)">Aucun joueur récemment déconnecté</div>'; return; }
  el.innerHTML = '';
  offlinePlayers.forEach(p => {
    const row = document.createElement('div');
    row.className = 'mod-offline-row';
    const ago = Math.round((Date.now() - p.ts) / 1000);
    const agoStr = ago < 60 ? `${ago}s` : `${Math.round(ago/60)}min`;
    row.innerHTML = `<div class="offline-dot" style="background:${p.color}"></div><div style="flex:1"><div style="font-size:9px;font-weight:600">${esc(p.pseudo)}</div><div style="font-size:8px;color:var(--muted)">il y a ${agoStr} · ${p.pixelCount} px</div></div><div style="display:flex;gap:4px"><button class="mod-act-btn" onclick="goToPlayerPixels('${esc(p.pseudo)}')">👁</button><button class="mod-act-btn danger" onclick="clearOfflinePixels('${esc(p.pseudo)}')">🗑</button></div>`;
    el.appendChild(row);
  });
}

function goToPixel(x, y) { camX = x - cvs.width / (PIXEL_SIZE * zoom) / 2; camY = y - cvs.height / (PIXEL_SIZE * zoom) / 2; clampCam(); render(); }
function eraseReportedPixel(x, y) { if (!confirm(`Effacer le pixel (${x},${y}) ?`)) return; pixels.delete(`${x}_${y}`); socket.emit('pixel:set', { pixels: [{ x, y, color: null }] }); socket.emit('mod:clear_report', { x, y }, () => {}); mmDirty = true; render(); }
function clearReport(x, y) { socket.emit('mod:clear_report', { x, y }, () => {}); }
function removeZone(id) { if (!confirm('Supprimer cette zone ?')) return; socket.emit('zone:remove', { id }, (res) => { if (res?.error) toast('Erreur: ' + res.error); }); }
function kickPlayer(p)   { if (!confirm(`Expulser ${p} ?`)) return; socket.emit('mod:kick', { pseudo: p }); }
function banPlayer(p)    { if (!confirm(`Bannir ${p} ?`)) return; socket.emit('mod:ban', { pseudo: p }); }
function banPlayerIP(p)  { if (!confirm(`Bannir ${p} par IP ?`)) return; socket.emit('mod:ban_ip', { pseudo: p }, (res) => { if (res?.error) toast('❌ ' + res.error); }); }
function unbanPlayer(p)  { socket.emit('mod:unban', { pseudo: p }); }
function promoteMod(p)   { socket.emit('mod:promote', { pseudo: p }); }
function demoteMod(p)    { socket.emit('mod:demote', { pseudo: p }); }
function changePassword() { const pw = document.getElementById('mod-pw-input').value; socket.emit('room:set_password', { password: pw }, (res) => { if (res?.ok) { document.getElementById('mod-pw-input').value = ''; toast('Mot de passe mis à jour'); } }); }
function clearCanvasFull()    { if (!confirm('Effacer TOUT le canvas ?')) return; socket.emit('room:clear_canvas', { onlyOwn: false }); }
function clearPlayerPixels(p) { if (!confirm(`Effacer les pixels de ${p} ?`)) return; socket.emit('room:clear_canvas', { onlyOwn: true, target: p }); }
function clearOwnPixels()     { if (!confirm('Effacer tous TES pixels ?')) return; socket.emit('room:clear_canvas', { onlyOwn: true, target: pseudo }); }
function clearOfflinePixels(targetPseudo) { const p = offlinePlayers.find(x => x.pseudo === targetPseudo); if (!confirm(`Effacer ${p?.pixelCount ?? '?'} pixels de ${targetPseudo} ?`)) return; socket.emit('mod:clear_offline', { pseudo: targetPseudo }, (res) => { if (res?.error) toast('❌ ' + res.error); else toast(`✅ ${res.count} pixels effacés`); }); }
function goToPlayerPixels(targetPseudo) { for (const [k, px] of pixels) { if (px.owner === targetPseudo) { const [x, y] = k.split('_').map(Number); camX = x - cvs.width / (PIXEL_SIZE * zoom) / 2; camY = y - cvs.height / (PIXEL_SIZE * zoom) / 2; clampCam(); render(); toast(`📍 Vers les pixels de ${targetPseudo}`); return; } } toast(`Aucun pixel de ${targetPseudo}`); }
function addProtectedZone() { const label = document.getElementById('zone-label-input')?.value?.trim() || 'Zone protégée'; toast('Dessine la zone : clic + glisser'); startZoneSelect(label); document.getElementById('zone-label-input').value = ''; }
let _currentZoneLabel = 'Zone protégée';
function startZoneSelect(label) { _currentZoneLabel = label || 'Zone protégée'; zoneSelectMode = true; zoneStart = null; vp.style.cursor = 'crosshair'; }
function resizeCanvasPrompt() { document.getElementById('resize-w').value = WORLD_W; document.getElementById('resize-h').value = WORLD_H; document.getElementById('resize-err').style.display = 'none'; openModal('modal-resize'); }
function doResizeCanvas() { const w = parseInt(document.getElementById('resize-w').value), h = parseInt(document.getElementById('resize-h').value); const errEl = document.getElementById('resize-err'); if (!w || !h || w < 100 || h < 100) { errEl.textContent = 'Min 100×100'; errEl.style.display = 'block'; return; } if (w > 2000 || h > 2000) { errEl.textContent = 'Max 2000×2000'; errEl.style.display = 'block'; return; } socket.emit('room:resize_canvas', { w, h }, (res) => { if (res?.ok) { closeModal('modal-resize'); toast(`Canvas: ${w}×${h}`); } else { errEl.textContent = res?.error || '?'; errEl.style.display = 'block'; } }); }

/* ── Export / Import room ── */
function exportRoom() {
  socket.emit('room:export', null, (res) => {
    if (res.error) return toast('❌ ' + res.error);
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = `${(res.data.name || 'room').replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now()}.pwroom`;
    a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href);
    toast(`Room exportée : ${Object.keys(res.data.canvas).length} pixels ✓`);
  });
}
function triggerImport() { document.getElementById('import-file-input').click(); }
function handleImportFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const status = document.getElementById('import-status');
  status.style.display = 'block'; status.style.color = 'var(--muted)'; status.textContent = 'Lecture…';
  const reader = new FileReader();
  reader.onload = (ev) => {
    let importData;
    try { importData = JSON.parse(ev.target.result); } catch { status.style.color = 'var(--pink)'; status.textContent = '❌ JSON invalide'; return; }
    if (!importData || importData.version !== 2) { status.style.color = 'var(--pink)'; status.textContent = '❌ Format invalide (v2 requis)'; return; }
    const merge = document.getElementById('import-merge')?.checked || false;
    const pixCount = Object.keys(importData.canvas || {}).length;
    if (!merge && !confirm(`Importer ${pixCount} pixels ? Remplacera le canvas actuel.`)) { status.textContent = 'Annulé.'; return; }
    status.textContent = 'Import…';
    socket.emit('room:import', { importData, merge }, (res) => {
      if (res.error) { status.style.color = 'var(--pink)'; status.textContent = '❌ ' + res.error; return; }
      status.style.color = 'var(--green)'; status.textContent = `✅ ${res.count} pixels (${res.skipped} ignorés)`;
      toast(`Import : ${res.count} pixels ✓`);
    });
  };
  reader.readAsText(file); e.target.value = '';
}

/* ══════════════════════════════════════════
   ADMIN PANEL
══════════════════════════════════════════ */
function openAdmin() {
  if (!isAdmin) return;
  document.getElementById('screen-admin').classList.add('on');
  refreshAdminStats();
}
function closeAdmin() { document.getElementById('screen-admin').classList.remove('on'); }

async function refreshAdminStats() {
  if (!sessionToken) return;
  try {
    const res = await fetch(`/api/admin/stats?token=${sessionToken}`);
    adminData = await res.json();
    renderAdminTab(adminTab);
  } catch(e) { document.getElementById('admin-content').innerHTML = '<div style="color:#e53935">Erreur de chargement</div>'; }
}

function adminShowTab(tab) {
  adminTab = tab;
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('on'));
  document.getElementById(`atab-${tab}`)?.classList.add('on');
  renderAdminTab(tab);
}

function renderAdminTab(tab) {
  const el = document.getElementById('admin-content');
  if (!adminData) { el.innerHTML = '<div style="color:#555">Chargement…</div>'; return; }

  if (tab === 'overview') {
    el.innerHTML = `
      <div class="stat-row">
        <div class="stat-box"><div class="stat-num">${adminData.totalConnected}</div><div class="stat-label">Connectés maintenant</div></div>
        <div class="stat-box"><div class="stat-num">${adminData.totalRooms}</div><div class="stat-label">Salons actifs</div></div>
        <div class="stat-box"><div class="stat-num">${adminData.totalAccounts}</div><div class="stat-label">Comptes enregistrés</div></div>
        <div class="stat-box"><div class="stat-num">${adminData.bannedIPsCount}</div><div class="stat-label">IPs bannies</div></div>
      </div>
      <div class="stat-box" style="margin-bottom:12px">
        <div class="stat-label">Uptime serveur</div>
        <div style="font-size:13px;color:#ffd700;margin-top:4px">${Math.floor(adminData.uptime/3600)}h ${Math.floor((adminData.uptime%3600)/60)}m</div>
      </div>
      <div class="admin-card">
        <div class="admin-card-title">⚡ Comptes connectés maintenant</div>
        <table class="admin-table">
          <thead><tr><th>Discord</th><th>Pseudo</th><th>Admin</th></tr></thead>
          <tbody>
            ${adminData.connectedAccounts.map(a => `
              <tr>
                <td>${esc(a.username)}</td>
                <td>${esc(a.pseudo)}</td>
                <td>${a.isAdmin ? '<span class="admin-badge admin">⭐ Admin</span>' : ''}</td>
              </tr>
            `).join('') || '<tr><td colspan="3" style="color:#555">Aucun</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  else if (tab === 'rooms') {
    el.innerHTML = `<div class="admin-card"><div class="admin-card-title">🏠 Salons actifs (${adminData.activeRooms.length})</div>
      <table class="admin-table">
        <thead><tr><th>Nom</th><th>Propriétaire</th><th>Joueurs</th><th>Canvas</th><th>Anti-spam</th><th>Type</th></tr></thead>
        <tbody>
          ${adminData.activeRooms.map(r => `
            <tr>
              <td>${esc(r.name)}</td>
              <td>${esc(r.owner)}</td>
              <td>${r.playerCount}/${r.maxPlayers}</td>
              <td>${r.pixelCount} px</td>
              <td>${r.antiSpam ? '🟢' : '🔴'}</td>
              <td>${r.isGeneral ? '<span class="admin-badge online">PUBLIC</span>' : 'Privé'}</td>
            </tr>
          `).join('') || '<tr><td colspan="6" style="color:#555">Aucun salon actif</td></tr>'}
        </tbody>
      </table></div>
      <div class="admin-card" style="margin-top:12px">
        <div class="admin-card-title">👥 Membres par salon</div>
        ${adminData.activeRooms.filter(r => r.playerCount > 0).map(r => `
          <div style="margin-bottom:12px;border-bottom:1px solid #1a1a1a;padding-bottom:10px">
            <div style="color:#ffd700;font-size:10px;margin-bottom:6px">🏠 ${esc(r.name)}</div>
            ${r.members.map(m => `<span style="font-size:9px;color:#ccc;margin-right:12px">● ${esc(m.pseudo)}${m.discordUsername ? ` <span style="color:#555">(@${esc(m.discordUsername)})</span>` : ''}</span>`).join('')}
          </div>
        `).join('') || '<div style="color:#555;font-size:10px">Aucun joueur en ligne</div>'}
      </div>
    `;
  }

  else if (tab === 'accounts') {
    el.innerHTML = `
      <input class="admin-search" id="admin-search-accounts" placeholder="🔍 Rechercher un compte…" oninput="filterAdminAccounts()">
      <div id="admin-accounts-table">
        ${renderAccountsTable(adminData.accountStats)}
      </div>
    `;
  }

  else if (tab === 'chatlogs') {
    const allLogs = adminData.activeRooms.flatMap(r => (r.chatLog || []).map(m => ({ ...m, roomName: r.name })));
    allLogs.sort((a, b) => b.ts - a.ts);
    el.innerHTML = `
      <div class="admin-card">
        <div class="admin-card-title">💬 Logs de chat récents (${allLogs.length} messages)</div>
        <div style="max-height:60vh;overflow-y:auto">
          ${allLogs.map(m => `
            <div class="chat-log-entry">
              <span class="chat-log-time">[${new Date(m.ts).toLocaleTimeString('fr-FR')}]</span>
              <span style="color:#555;font-size:9px">[${esc(m.roomName)}]</span>
              <span style="color:${m.color || '#888'};font-size:9px;margin:0 4px">${esc(m.pseudo)}</span>
              <span>${esc(m.text)}</span>
            </div>
          `).join('') || '<div style="color:#555">Aucun message enregistré</div>'}
        </div>
      </div>
    `;
  }

  else if (tab === 'bans') {
    el.innerHTML = `
      <div class="admin-card">
        <div class="admin-card-title">🔨 Bannir un compte Discord (global)</div>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <input class="admin-search" id="admin-ban-id" placeholder="Discord ID (ex: 123456789…)" style="flex:1;margin-bottom:0">
          <input class="admin-search" id="admin-ban-reason" placeholder="Raison…" style="flex:1;margin-bottom:0">
          <button class="admin-btn danger" onclick="adminBanDiscord()">🔨 Bannir</button>
        </div>
        <div style="font-size:9px;color:#555">Le ban global expulse le compte de toutes les rooms et invalide ses sessions.</div>
      </div>
      <div class="admin-card" style="margin-top:12px">
        <div class="admin-card-title">🚫 Comptes bannis</div>
        <table class="admin-table">
          <thead><tr><th>Discord ID</th><th>Pseudo</th><th>Raison</th><th>Date</th></tr></thead>
          <tbody>
            ${Object.values(adminData.accountStats).filter(a => a.globalBanned).map(a => `
              <tr>
                <td>${a.discordId}</td>
                <td>${esc(a.pseudo || '—')}</td>
                <td>${esc(a.banReason || '—')}</td>
                <td style="font-size:9px;color:#555">${a.bannedAt ? new Date(a.bannedAt).toLocaleDateString('fr-FR') : '—'}</td>
              </tr>
            `).join('') || '<tr><td colspan="4" style="color:#555">Aucun ban global</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }
}

function renderAccountsTable(accounts) {
  const search = document.getElementById('admin-search-accounts')?.value?.toLowerCase() || '';
  const filtered = accounts.filter(a =>
    !search || (a.username||'').toLowerCase().includes(search) || (a.pseudo||'').toLowerCase().includes(search) || (a.discordId||'').includes(search)
  );
  return `
    <div class="admin-card">
      <div class="admin-card-title">👤 Comptes (${filtered.length}/${accounts.length})</div>
      <table class="admin-table">
        <thead><tr><th>Discord ID</th><th>Username</th><th>Pseudo</th><th>Connexions</th><th>Dernière visite</th><th>Status</th></tr></thead>
        <tbody>
          ${filtered.slice(0, 100).map(a => `
            <tr>
              <td style="font-size:9px;color:#555">${a.discordId}</td>
              <td>@${esc(a.username || '—')}</td>
              <td>${esc(a.pseudo || '—')}</td>
              <td>${a.loginCount || 0}</td>
              <td style="font-size:9px;color:#555">${a.lastSeen ? new Date(a.lastSeen).toLocaleDateString('fr-FR') : '—'}</td>
              <td>${a.globalBanned ? '<span class="admin-badge" style="background:rgba(229,57,53,.2);color:#e53935;border:1px solid rgba(229,57,53,.3)">🚫 Banni</span>' : adminData.connectedAccounts.some(c => c.discordId === a.discordId) ? '<span class="admin-badge online">● En ligne</span>' : ''}</td>
            </tr>
          `).join('') || '<tr><td colspan="6" style="color:#555">Aucun</td></tr>'}
        </tbody>
      </table>
      ${filtered.length > 100 ? `<div style="font-size:9px;color:#555;margin-top:8px">Affichage limité à 100 résultats sur ${filtered.length}</div>` : ''}
    </div>
  `;
}

function filterAdminAccounts() {
  document.getElementById('admin-accounts-table').innerHTML = renderAccountsTable(adminData.accountStats);
}

async function adminBanDiscord() {
  const discordId = document.getElementById('admin-ban-id')?.value?.trim();
  const reason    = document.getElementById('admin-ban-reason')?.value?.trim();
  if (!discordId) return toast('Discord ID requis');
  if (!confirm(`Bannir globalement ${discordId} ?`)) return;
  const res = await fetch('/api/admin/ban-discord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': sessionToken },
    body: JSON.stringify({ discordId, reason }),
  });
  const data = await res.json();
  if (data.ok) { toast(`🔨 ${discordId} banni`); refreshAdminStats(); }
  else toast('❌ ' + (data.error || '?'));
}

/* ══════════════════════════════════════════
   CHAT
══════════════════════════════════════════ */
document.getElementById('chat-send').onclick = sendChat;
document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); sendChat(); } });

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim(); if (!text) return;
  socket.emit('chat:send', { text }); input.value = '';
}

function appendChat(msg) {
  const el = document.getElementById('chat-msgs');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (msg.system ? ' system' : '');
  div.innerHTML = `<div class="chat-msg-name" style="color:${msg.color||'#888'}">${esc(msg.pseudo)}</div><div class="chat-msg-text">${esc(msg.text)}</div>`;
  el.appendChild(div);
  if (el.children.length > 200) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

/* ══════════════════════════════════════════
   PIXEL FLUSH
══════════════════════════════════════════ */
let pendingPixels = {}, _flushTimer = null;

function sendPendingPixels() {
  if (!Object.keys(pendingPixels).length) return;
  const batch = Object.entries(pendingPixels).map(([k, v]) => {
    const [x, y] = k.split('_').map(Number); return { x, y, color: v.color };
  });
  socket.emit('pixel:set', { pixels: batch });
  pendingPixels = {};
}
function startRealtimeFlush() { if (_flushTimer) return; _flushTimer = setInterval(() => { if (Object.keys(pendingPixels).length) sendPendingPixels(); }, 50); }
function stopRealtimeFlush()  { clearInterval(_flushTimer); _flushTimer = null; sendPendingPixels(); }

/* ══════════════════════════════════════════
   CONTEXT MENU
══════════════════════════════════════════ */
const ctxMenu = document.getElementById('ctx-menu');

function showContextMenu(e, wx, wy) {
  e.preventDefault();
  const px = pixels.get(`${wx}_${wy}`);
  document.getElementById('ctx-pixel-info').textContent = px ? `Pixel de ${px.owner} en (${wx},${wy})` : `Case vide (${wx},${wy})`;
  const repBtn = document.getElementById('ctx-report-btn');
  repBtn.style.display = px ? 'flex' : 'none';
  if (px) repBtn.onclick = () => { hideContextMenu(); reportPixel(wx, wy); };
  const pickBtn = document.getElementById('ctx-pick-btn');
  pickBtn.style.display = px ? 'flex' : 'none';
  pickBtn.onclick = () => { hideContextMenu(); if (px) pickCol(px.color); };
  const eraseBtn = document.getElementById('ctx-erase-btn');
  eraseBtn.style.display = px && px.owner === pseudo ? 'flex' : 'none';
  if (px && px.owner === pseudo) eraseBtn.onclick = () => {
    hideContextMenu();
    const k = `${wx}_${wy}`;
    pixels.delete(k); pendingPixels[k] = { color: null }; sendPendingPixels(); mmDirty = true; render();
  };
  let x = e.clientX, y = e.clientY; const w = 180;
  if (x + w > window.innerWidth) x -= w;
  ctxMenu.style.left = x + 'px'; ctxMenu.style.top = y + 'px'; ctxMenu.style.display = 'block';
}
function hideContextMenu() { ctxMenu.style.display = 'none'; }
document.addEventListener('click', e => { if (!ctxMenu.contains(e.target)) hideContextMenu(); });

function reportPixel(x, y) {
  socket.emit('pixel:report', { x, y }, (res) => {
    if (res?.error) toast('❌ ' + res.error);
    else toast(`Pixel signalé (${res.count}) ✓`);
  });
}

/* ══════════════════════════════════════════
   RENDER ENGINE
══════════════════════════════════════════ */
function resizeViewport() { cvs.width = vp.clientWidth; cvs.height = vp.clientHeight; render(); }
window.addEventListener('resize', resizeViewport);

function render() {
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  ctx.fillStyle = isDark ? '#111120' : '#ffffff'; ctx.fillRect(0, 0, W, H);
  const ps = PIXEL_SIZE * zoom;
  const wx0 = Math.floor(camX) - 1, wy0 = Math.floor(camY) - 1;
  const wx1 = Math.ceil(camX + W / ps) + 1, wy1 = Math.ceil(camY + H / ps) + 1;
  for (const [k, px] of pixels) {
    const ui = k.indexOf('_'); const wx = +k.slice(0, ui), wy = +k.slice(ui + 1);
    if (wx < wx0 || wx > wx1 || wy < wy0 || wy > wy1) continue;
    ctx.fillStyle = px.color; ctx.fillRect((wx - camX) * ps, (wy - camY) * ps, ps + 0.5, ps + 0.5);
  }
  if (showGrid && zoom >= 0.35) {
    ctx.strokeStyle = isDark ? 'rgba(100,100,180,0.1)' : 'rgba(0,0,0,0.07)'; ctx.lineWidth = 0.5;
    const offX = ((camX % 1) + 1) % 1, offY = ((camY % 1) + 1) % 1;
    for (let sx = (1 - offX) * ps % ps; sx <= W + ps; sx += ps) { ctx.beginPath(); ctx.moveTo(Math.round(sx), 0); ctx.lineTo(Math.round(sx), H); ctx.stroke(); }
    for (let sy = (1 - offY) * ps % ps; sy <= H + ps; sy += ps) { ctx.beginPath(); ctx.moveTo(0, Math.round(sy)); ctx.lineTo(W, Math.round(sy)); ctx.stroke(); }
  }
  ctx.strokeStyle = isDark ? 'rgba(0,240,255,.2)' : 'rgba(0,102,255,.15)'; ctx.lineWidth = 1.5;
  ctx.strokeRect((0 - camX) * ps, (0 - camY) * ps, WORLD_W * ps, WORLD_H * ps);
  for (const zone of protectedZones) {
    const zx = (zone.x1 - camX) * ps, zy = (zone.y1 - camY) * ps;
    const zw = (zone.x2 - zone.x1 + 1) * ps, zh = (zone.y2 - zone.y1 + 1) * ps;
    ctx.save(); ctx.beginPath(); ctx.rect(zx, zy, zw, zh); ctx.clip();
    ctx.globalAlpha = 0.18; ctx.strokeStyle = '#ff2d78'; ctx.lineWidth = 2;
    for (let i = -Math.max(zw, zh); i < Math.max(zw, zh) * 2; i += 8) { ctx.beginPath(); ctx.moveTo(zx + i, zy); ctx.lineTo(zx + i + zh, zy + zh); ctx.stroke(); }
    ctx.restore();
    ctx.globalAlpha = 0.7; ctx.strokeStyle = '#ff2d78'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.strokeRect(zx, zy, zw, zh); ctx.setLineDash([]);
    if (ps > 3) { ctx.globalAlpha = 0.9; ctx.fillStyle = 'rgba(255,45,120,0.85)'; const labelW = Math.min(zw, 120); ctx.fillRect(zx, zy, labelW, 14); ctx.fillStyle = '#fff'; ctx.font = 'bold 9px JetBrains Mono, monospace'; ctx.fillText('🔒 ' + zone.label, zx + 3, zy + 10, labelW - 6); }
    ctx.globalAlpha = 1;
  }
  if (tool === 'line' && linePrev.length) { ctx.fillStyle = col; ctx.globalAlpha = 0.5; for (const [wx, wy] of linePrev) ctx.fillRect((wx - camX) * ps, (wy - camY) * ps, ps, ps); ctx.globalAlpha = 1; }
  updateMinimap(); updateAllCursors();
}

/* ── MINIMAP ── */
function updateMinimap(force) {
  if (mmDirty || force) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    mmCtx.fillStyle = isDark ? '#111120' : '#ffffff'; mmCtx.fillRect(0, 0, WORLD_W, WORLD_H);
    for (const [k, px] of pixels) { const ui = k.indexOf('_'); mmCtx.fillStyle = px.color; mmCtx.fillRect(+k.slice(0, ui), +k.slice(ui + 1), 1, 1); }
    for (const z of protectedZones) { mmCtx.globalAlpha = 0.4; mmCtx.fillStyle = '#ff2d78'; mmCtx.fillRect(z.x1, z.y1, z.x2 - z.x1 + 1, z.y2 - z.y1 + 1); mmCtx.globalAlpha = 1; }
    mmDirty = false;
  }
  const mmEl = document.getElementById('minimap'), mmRect = mmEl.getBoundingClientRect();
  const MM_W = mmRect.width, MM_H = mmRect.height;
  const scX = MM_W / WORLD_W, scY = MM_H / WORLD_H;
  const vw = cvs.width / (PIXEL_SIZE * zoom), vh = cvs.height / (PIXEL_SIZE * zoom);
  const vpEl = document.getElementById('minimap-vp');
  const sbRect = document.querySelector('.gsb').getBoundingClientRect();
  const topOff = mmRect.top - sbRect.top + document.querySelector('.gsb').scrollTop;
  vpEl.style.left   = Math.max(0, camX * scX) + 'px';
  vpEl.style.top    = (topOff + Math.max(0, camY * scY)) + 'px';
  vpEl.style.width  = Math.min(MM_W, vw * scX) + 'px';
  vpEl.style.height = Math.min(MM_H, vh * scY) + 'px';
}
mm.addEventListener('click', e => {
  const r = mm.getBoundingClientRect();
  camX = ((e.clientX - r.left) / r.width * WORLD_W) - cvs.width / (PIXEL_SIZE * zoom) / 2;
  camY = ((e.clientY - r.top) / r.height * WORLD_H) - cvs.height / (PIXEL_SIZE * zoom) / 2;
  clampCam(); render();
});

/* ── CAM ── */
function clampCam() {
  const vw = cvs.width / (PIXEL_SIZE * zoom), vh = cvs.height / (PIXEL_SIZE * zoom);
  camX = Math.max(-vw * 0.4, Math.min(WORLD_W - vw * 0.6, camX));
  camY = Math.max(-vh * 0.4, Math.min(WORLD_H - vh * 0.6, camY));
}
function screenToWorld(sx, sy) { const ps = PIXEL_SIZE * zoom; return { x: Math.floor(camX + sx / ps), y: Math.floor(camY + sy / ps) }; }
function vpCoords(e) { const r = vp.getBoundingClientRect(); return screenToWorld(e.clientX - r.left, e.clientY - r.top); }

/* ── CURSEURS ── */
function updateCursorEl(cur) {
  if (!cur.el) return;
  const ps = PIXEL_SIZE * zoom, vpRect = vp.getBoundingClientRect();
  const sx = (cur.x - camX) * ps, sy = (cur.y - camY) * ps;
  if (sx < -40 || sx > vpRect.width + 40 || sy < -40 || sy > vpRect.height + 40) { cur.el.style.display = 'none'; }
  else { cur.el.style.display = 'flex'; cur.el.style.transform = `translate(${sx}px, ${sy}px)`; }
}
function updateAllCursors() { for (const [, cur] of remoteCursors) updateCursorEl(cur); }

/* ── PALETTE ── */
function buildPal() {
  const el = document.getElementById('pal'); el.innerHTML = '';
  PAL.forEach(c => {
    const d = document.createElement('div');
    d.className = 'sw' + (c.toUpperCase() === col.toUpperCase() ? ' on' : '');
    d.style.background = c; d.title = c; d.onclick = () => pickCol(c); el.appendChild(d);
  });
}
function pickCol(c) {
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return;
  col = c.toUpperCase();
  document.getElementById('cprev').style.background = col;
  document.getElementById('cprev-dot').style.background = col;
  document.getElementById('cprev-hex').textContent = col;
  document.getElementById('hexInput').value = col;
  document.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s.title.toUpperCase() === col));
  const [h, s, l] = hexToHsl(col); cwHue = h; cwSat = s; cwLit = l;
  const slider = document.getElementById('lightnessSlider');
  if (slider) { slider.value = l; updateLightnessGradient(); }
  updateCwheelCursor();
  if (tool === 'erase') setTool('draw');
}
function applyHex() { let v = document.getElementById('hexInput').value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-fA-F]{6}$/.test(v)) pickCol(v); else toast('Hex invalide'); }
document.getElementById('hexInput').addEventListener('keydown', e => { if (e.key === 'Enter') applyHex(); });

/* ── COLOR WHEEL ── */
let cwHue = 220, cwSat = 100, cwLit = 50;
function hslToRgb(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [Math.round(f(0)*255), Math.round(f(8)*255), Math.round(f(4)*255)]; }
function rgbToHex(r, g, b) { return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase(); }
function hexToHsl(hex) { let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255; const max = Math.max(r,g,b), min = Math.min(r,g,b); let h, s, l = (max+min)/2; if (max === min) { h = s = 0; } else { const d = max-min; s = l > 0.5 ? d/(2-max-min) : d/(max+min); switch(max) { case r: h = ((g-b)/d + (g<b?6:0))/6; break; case g: h = ((b-r)/d + 2)/6; break; case b: h = ((r-g)/d + 4)/6; break; } } return [Math.round(h*360), Math.round(s*100), Math.round(l*100)]; }

function buildColorWheel() {
  const canvas = document.getElementById('colorWheel'); if (!canvas) return;
  const ctx2 = canvas.getContext('2d'); const W = canvas.width, H = canvas.height, cx = W/2, cy = H/2, r = W/2 - 2;
  const imageData = ctx2.createImageData(W, H);
  const lit = parseInt(document.getElementById('lightnessSlider')?.value || 50);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const dx = px - cx, dy = py - cy, dist = Math.sqrt(dx*dx+dy*dy), idx = (py * W + px) * 4;
    if (dist <= r) { const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360; const sat = (dist / r) * 100; const [rr,gg,bb] = hslToRgb(angle, sat, lit); imageData.data[idx]=rr; imageData.data[idx+1]=gg; imageData.data[idx+2]=bb; imageData.data[idx+3]=255; } else imageData.data[idx+3]=0;
  }
  ctx2.putImageData(imageData, 0, 0); updateCwheelCursor();
}
function updateCwheelCursor() {
  const canvas = document.getElementById('colorWheel'), cursor = document.getElementById('cwheelCursor');
  if (!canvas || !cursor) return;
  const W = canvas.width, H = canvas.height, cx = W/2, cy = H/2, r = W/2 - 2;
  const angle = cwHue * Math.PI / 180, dist = (cwSat / 100) * r;
  const x = cx + dist * Math.cos(angle), y = cy + dist * Math.sin(angle);
  const rect = canvas.getBoundingClientRect();
  cursor.style.left = (x * rect.width / W) + 'px'; cursor.style.top = (y * rect.height / H) + 'px';
  cursor.style.borderColor = cwLit < 50 ? '#fff' : '#000';
}
function cwPickFromEvent(e) {
  const canvas = document.getElementById('colorWheel'), rect = canvas.getBoundingClientRect();
  const W = canvas.width, H = canvas.height, cx = W/2, cy = H/2, r = W/2 - 2;
  const px2 = (e.clientX - rect.left) * W / rect.width, py2 = (e.clientY - rect.top) * H / rect.height;
  const dx = px2 - cx, dy = py2 - cy, dist = Math.min(Math.sqrt(dx*dx+dy*dy), r);
  cwHue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360; cwSat = (dist / r) * 100;
  const [rr,gg,bb] = hslToRgb(cwHue, cwSat, cwLit); const hex = rgbToHex(rr,gg,bb);
  col = hex;
  document.getElementById('cprev').style.background = hex; document.getElementById('cprev-dot').style.background = hex;
  document.getElementById('cprev-hex').textContent = hex; document.getElementById('hexInput').value = hex;
  document.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s.title.toUpperCase() === hex));
  updateCwheelCursor(); updateLightnessGradient();
}
function openColorWheel() {}
(function initCwheel() {
  const canvas = document.getElementById('colorWheel'); if (!canvas) return;
  let dragging = false;
  canvas.addEventListener('mousedown', e => { dragging = true; cwPickFromEvent(e); });
  window.addEventListener('mousemove', e => { if (dragging) cwPickFromEvent(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvas.addEventListener('touchstart', e => { dragging = true; cwPickFromEvent(e.touches[0]); e.preventDefault(); }, {passive:false});
  window.addEventListener('touchmove', e => { if (dragging) cwPickFromEvent(e.touches[0]); e.preventDefault(); }, {passive:false});
  window.addEventListener('touchend', () => { dragging = false; });
  const slider = document.getElementById('lightnessSlider');
  if (slider) slider.addEventListener('input', () => { cwLit = parseInt(slider.value); updateLightnessGradient(); buildColorWheel(); const [rr,gg,bb] = hslToRgb(cwHue, cwSat, cwLit); pickCol(rgbToHex(rr,gg,bb)); });
})();
function updateLightnessGradient() { const slider = document.getElementById('lightnessSlider'); if (!slider) return; const c0 = rgbToHex(...hslToRgb(cwHue, cwSat, 5)), c50 = rgbToHex(...hslToRgb(cwHue, cwSat, 50)), c95 = rgbToHex(...hslToRgb(cwHue, cwSat, 95)); slider.style.background = `linear-gradient(to right, ${c0}, ${c50}, ${c95})`; }

/* ── TOOLS ── */
function setTool(t) {
  tool = t; if (t !== 'line') { linePrev = []; lineStart = null; } if (zoneSelectMode && t !== 'zone') { zoneSelectMode = false; zoneStart = null; }
  document.querySelectorAll('.tbtn').forEach(b => b.classList.remove('on'));
  document.getElementById('t-' + t)?.classList.add('on');
  vp.style.cursor = (t === 'pick') ? 'crosshair' : (t === 'erase') ? 'cell' : 'crosshair';
}
function setBrush(s) { brush = s; document.querySelectorAll('.bd').forEach(d => d.classList.toggle('on', +d.dataset.s === s)); }

/* ── PIXEL OPS ── */
function paintPx(x, y, c) {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return;
  const k = `${x}_${y}`, before = pixels.get(k) || null;
  if (c === null) {
    // Suppression : on efface localement optimistiquement
    // Le serveur va broadcaster pixel:batch a tout le monde pour confirmer
    pixels.delete(k);
    pendingPixels[k] = { color: null };
  } else {
    pixels.set(k, { color: c, owner: pseudo, ownerColor: myColor });
    pendingPixels[k] = { color: c };
  }
  if (!stroke[k]) stroke[k] = { before };
  stroke[k].after = c ? { color: c, owner: pseudo, ownerColor: myColor } : null;
  mmDirty = true;
}
function paintBrush(x, y, c) { const h = Math.floor(brush / 2); for (let dx = 0; dx < brush; dx++) for (let dy = 0; dy < brush; dy++) paintPx(x + dx - h, y + dy - h, c); }

/* ── LINE ── */
function linePts(x0, y0, x1, y1) { const pts = []; let dx = Math.abs(x1-x0), dy = Math.abs(y1-y0), sx = x0<x1?1:-1, sy = y0<y1?1:-1, err = dx-dy; while(true) { pts.push([x0,y0]); if(x0===x1&&y0===y1)break; const e2=2*err; if(e2>-dy){err-=dy;x0+=sx;} if(e2<dx){err+=dx;y0+=sy;} } return pts; }

/* ── UNDO/REDO ── */
function commit() { sendPendingPixels(); if (!Object.keys(stroke).length) return; undoSt.push({ ...stroke }); if (undoSt.length > 150) undoSt.shift(); redoSt = []; stroke = {}; mmDirty = true; }
function undo() { if (!undoSt.length) return; const st = undoSt.pop(), rev = {}, batch = []; for (const [k, { before }] of Object.entries(st)) { if (before === null) pixels.delete(k); else pixels.set(k, before); rev[k] = { before: st[k].after, after: before }; const [x, y] = k.split('_').map(Number); batch.push({ x, y, color: before ? before.color : null }); } socket.emit('pixel:set', { pixels: batch }); redoSt.push(rev); mmDirty = true; render(); toast('Annulé ↩'); }
function redo() { if (!redoSt.length) return; const st = redoSt.pop(), fwd = {}, batch = []; for (const [k, { after }] of Object.entries(st)) { if (after === null) pixels.delete(k); else pixels.set(k, after); fwd[k] = { before: st[k].before, after }; const [x, y] = k.split('_').map(Number); batch.push({ x, y, color: after ? after.color : null }); } socket.emit('pixel:set', { pixels: batch }); undoSt.push(fwd); mmDirty = true; render(); toast('Rétabli ↪'); }

/* ── KEYBINDS ── */
document.addEventListener('keydown', e => {
  const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; vp.style.cursor = 'grab'; }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y') { e.preventDefault(); redo(); }
    if (e.key === 'e') { e.preventDefault(); exportPNG(); }
  } else {
    switch (e.key.toLowerCase()) {
      case 'b': setTool('draw'); break; case 'e': setTool('erase'); break;
      case 'p': setTool('pick'); break; case 'l': setTool('line'); break;
      case 'g': toggleGrid(); break;
      case '+': case '=': doZoom(1.2); break; case '-': doZoom(0.83); break;
      case '0': goHome(); break;
      case '1': setBrush(1); break; case '2': setBrush(2); break; case '3': setBrush(4); break;
      case '4': setBrush(8); break; case '5': setBrush(16); break;
      case 'escape': hideContextMenu(); if (zoneSelectMode) { zoneSelectMode = false; zoneStart = null; toast('Zone annulée'); render(); } break;
    }
  }
});
document.addEventListener('keyup', e => { if (e.code === 'Space') { spaceHeld = false; if (!panning) vp.style.cursor = 'crosshair'; } });

/* ── TOOLTIP ── */
const tip = document.getElementById('tip'); let tipTimer;
function showTip(e, px) { document.getElementById('tipname').textContent = px.owner; document.getElementById('tipdot').style.background = px.ownerColor || '#888'; tip.style.display = 'flex'; moveTip(e); }
function moveTip(e) { let tx = e.clientX + 14, ty = e.clientY - 38; if (tx + 200 > window.innerWidth) tx = e.clientX - 210; if (ty < 0) ty = e.clientY + 14; tip.style.left = tx + 'px'; tip.style.top = ty + 'px'; }
function hideTip() { tip.style.display = 'none'; clearTimeout(tipTimer); }

/* ── MOUSE / TOUCH ── */
vp.addEventListener('contextmenu', e => { e.preventDefault(); if (!roomInfo) return; const { x, y } = vpCoords(e); if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return; showContextMenu(e, x, y); });

vp.addEventListener('mousedown', e => {
  hideContextMenu();
  if (e.button === 2 || (e.button === 0 && spaceHeld)) { panning = true; panStartX = e.clientX; panStartY = e.clientY; panCamX = camX; panCamY = camY; vp.style.cursor = 'grabbing'; return; }
  if (e.button !== 0 || !roomInfo) return;
  const { x, y } = vpCoords(e);
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return;
  if (zoneSelectMode) { zoneStart = { x, y }; return; }
  if (tool === 'pick') { const px = pixels.get(`${x}_${y}`); if (px) pickCol(px.color); return; }
  if (tool === 'line') { if (!lineStart) { lineStart = { x, y }; linePrev = []; toast('Clic pour terminer la ligne'); } else { linePrev = []; for (const [px, py] of linePts(lineStart.x, lineStart.y, x, y)) paintPx(px, py, col); commit(); lineStart = null; render(); } return; }
  drawing = true; stroke = {}; startRealtimeFlush(); paintBrush(x, y, tool === 'erase' ? null : col); render();
});

vp.addEventListener('mousemove', e => {
  const { x, y } = vpCoords(e);
  if (x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) document.getElementById('gh-xy').textContent = `x:${x}  y:${y}  [${WORLD_W}×${WORLD_H}]`;
  if (panning) { const ps = PIXEL_SIZE * zoom; camX = panCamX - (e.clientX - panStartX) / ps; camY = panCamY - (e.clientY - panStartY) / ps; clampCam(); render(); return; }
  if (roomInfo) { const now = Date.now(); if (now - lastCursorEmit > 50 && x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) { socket.emit('cursor:move', { x, y }); lastCursorEmit = now; } }
  hideTip();
  if (!drawing && tool !== 'line' && x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) { const px = pixels.get(`${x}_${y}`); if (px) tipTimer = setTimeout(() => showTip(e, px), 300); }
  moveTip(e);
  if (tool === 'line' && lineStart && x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) { linePrev = linePts(lineStart.x, lineStart.y, x, y).filter(([px,py]) => px>=0&&px<WORLD_W&&py>=0&&py<WORLD_H); render(); return; }
  if (zoneSelectMode && zoneStart && e.buttons === 1) {
    render();
    const ps = PIXEL_SIZE * zoom;
    const ax = (Math.min(zoneStart.x, x) - camX) * ps, ay = (Math.min(zoneStart.y, y) - camY) * ps;
    const aw = (Math.abs(x - zoneStart.x) + 1) * ps, ah = (Math.abs(y - zoneStart.y) + 1) * ps;
    ctx.globalAlpha = 0.4; ctx.fillStyle = '#ff2d78'; ctx.fillRect(ax, ay, aw, ah); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ff2d78'; ctx.lineWidth = 2; ctx.setLineDash([4,3]); ctx.strokeRect(ax, ay, aw, ah); ctx.setLineDash([]);
    return;
  }
  if (!drawing) return;
  paintBrush(x, y, tool === 'erase' ? null : col); render();
});

vp.addEventListener('mouseup', e => {
  if (panning) { panning = false; vp.style.cursor = spaceHeld ? 'grab' : 'crosshair'; return; }
  if (zoneSelectMode && zoneStart) {
    const { x, y } = vpCoords(e);
    socket.emit('zone:add', { x1: zoneStart.x, y1: zoneStart.y, x2: x, y2: y, label: _currentZoneLabel }, (res) => {
      if (res?.error) toast('❌ ' + res.error); else toast('✅ Zone créée : ' + _currentZoneLabel);
    });
    zoneSelectMode = false; zoneStart = null; vp.style.cursor = 'crosshair'; return;
  }
  if (drawing) { stopRealtimeFlush(); commit(); drawing = false; }
});

vp.addEventListener('mouseleave', hideTip);
vp.addEventListener('wheel', e => {
  e.preventDefault();
  const r = vp.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const wx = camX + mx / (PIXEL_SIZE * zoom), wy = camY + my / (PIXEL_SIZE * zoom);
  const f = e.ctrlKey ? 1.06 : 1.2;
  zoom *= e.deltaY < 0 ? f : 1/f; zoom = Math.max(0.04, Math.min(25, zoom));
  camX = wx - mx / (PIXEL_SIZE * zoom); camY = wy - my / (PIXEL_SIZE * zoom);
  clampCam(); document.getElementById('zlbl').textContent = Math.round(zoom * 100) + '%'; render();
}, { passive: false });

let lastTouches = null;
vp.addEventListener('touchstart', e => { e.preventDefault(); if (e.touches.length === 2) { panning = true; lastTouches = e.touches; return; } const t = e.touches[0], r = vp.getBoundingClientRect(); const { x, y } = screenToWorld(t.clientX - r.left, t.clientY - r.top); drawing = true; stroke = {}; startRealtimeFlush(); paintBrush(x, y, tool === 'erase' ? null : col); render(); }, { passive: false });
vp.addEventListener('touchmove', e => { e.preventDefault(); if (e.touches.length === 2 && panning && lastTouches) { const dx = (e.touches[0].clientX + e.touches[1].clientX)/2 - (lastTouches[0].clientX + lastTouches[1].clientX)/2, dy = (e.touches[0].clientY + e.touches[1].clientY)/2 - (lastTouches[0].clientY + lastTouches[1].clientY)/2; camX -= dx / (PIXEL_SIZE * zoom); camY -= dy / (PIXEL_SIZE * zoom); lastTouches = e.touches; clampCam(); render(); return; } if (!drawing) return; const t = e.touches[0], r = vp.getBoundingClientRect(); const { x, y } = screenToWorld(t.clientX - r.left, t.clientY - r.top); paintBrush(x, y, tool === 'erase' ? null : col); render(); }, { passive: false });
vp.addEventListener('touchend', () => { panning = false; lastTouches = null; if (drawing) { stopRealtimeFlush(); commit(); drawing = false; } });

/* ── ZOOM / GRID / HOME ── */
function doZoom(f) { const cx = cvs.width/2, cy = cvs.height/2; const wx = camX + cx / (PIXEL_SIZE * zoom), wy = camY + cy / (PIXEL_SIZE * zoom); zoom = Math.max(0.04, Math.min(25, zoom * f)); camX = wx - cx / (PIXEL_SIZE * zoom); camY = wy - cy / (PIXEL_SIZE * zoom); clampCam(); document.getElementById('zlbl').textContent = Math.round(zoom * 100) + '%'; render(); }
function toggleGrid() { showGrid = !showGrid; const b = document.getElementById('gbtn'); b.textContent = showGrid ? '⊞ Grille' : '⊡ Grille'; b.classList.toggle('on', showGrid); render(); }
function goHome() { zoom = 1; camX = WORLD_W/2 - cvs.width/(PIXEL_SIZE*zoom)/2; camY = WORLD_H/2 - cvs.height/(PIXEL_SIZE*zoom)/2; clampCam(); document.getElementById('zlbl').textContent = '100%'; render(); }

/* ── EXPORT PNG ── */
function exportPNG() {
  const scale = parseInt(document.getElementById('export-scale')?.value || '1') || 1;
  const S = Math.max(1, Math.min(16, scale));
  toast(`Export PNG ${S}x… (${WORLD_W * S}×${WORLD_H * S})`);
  setTimeout(() => {
    const off = document.createElement('canvas'); off.width = WORLD_W * S; off.height = WORLD_H * S;
    const oc = off.getContext('2d'); oc.fillStyle = '#ffffff'; oc.fillRect(0, 0, WORLD_W * S, WORLD_H * S);
    oc.imageSmoothingEnabled = false;
    for (const [k, px] of pixels) { const ui = k.indexOf('_'); oc.fillStyle = px.color; oc.fillRect(+k.slice(0, ui) * S, +k.slice(ui + 1) * S, S, S); }
    const a = document.createElement('a');
    a.download = `pixelworld_${WORLD_W}x${WORLD_H}_${S}x_${Date.now()}.png`;
    a.href = off.toDataURL('image/png'); a.click(); toast(`PNG ${WORLD_W * S}×${WORLD_H * S} exporté ✓`);
  }, 50);
}

/* ── THEME / SETTINGS / MODAL ── */
function setTheme(t) { document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : ''); localStorage.setItem('pw_theme', t); mmDirty = true; render(); }
function toggleTheme() { setTheme((localStorage.getItem('pw_theme') || 'light') === 'dark' ? 'light' : 'dark'); }

// Charger la préférence de thème et détecter les préférences système
function loadThemePreference() {
  // Vérifier si l'utilisateur a une préférence enregistrée
  const savedTheme = localStorage.getItem('pw_theme');
  if (savedTheme) {
    setTheme(savedTheme);
    return;
  }
  
  // Sinon, utiliser les préférences système (dark mode)
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    setTheme('dark');
  } else {
    setTheme('light');
  }
  
  // Écouter les changements de préférences système
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('pw_theme')) { // Seulement si pas de préférence explicite
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
}
function setSettings(open) { if (open) openModal('modal-settings'); else closeModal('modal-settings'); }
function openModal(id)  { document.getElementById(id).classList.add('on'); }
function closeModal(id) { document.getElementById(id).classList.remove('on'); }

/* ── TOAST ── */
let tT;
function toast(m) { const el = document.getElementById('toast'); el.textContent = m; el.classList.add('on'); clearTimeout(tT); tT = setTimeout(() => el.classList.remove('on'), 2800); }

/* ── UTILS ── */
function esc(str) { const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }

/* ── MODAL RENAME ENTER KEY ── */
document.getElementById('rename-input').addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); });

/* ── INIT ── */
(function init() {
  setTheme(localStorage.getItem('pw_theme') || 'light');
  // Appliquer l'auth Discord au chargement
  initAuth();
})();
