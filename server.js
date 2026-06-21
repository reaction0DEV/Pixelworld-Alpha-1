/* ═══════════════════════════════════════════════════════════
   PIXELWORLD SERVER v3
   + Connexion Discord obligatoire
   + Menu Admin (liste sécurisée)
   + Anti-spam amélioré
   + Ban de salon (fondateur/admin)
   + Changement de pseudo
   + Fix sync suppression pixel
═══════════════════════════════════════════════════════════ */
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { maxHttpBufferSize: 5e6 });

const PORT       = process.env.PORT || 3000;
const DATA_DIR   = path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const BANS_FILE  = path.join(DATA_DIR, 'banned_ips.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

/* ══════════════════════════════════════════
   CONFIG ADMIN — Discord IDs autorisés
   Remplacer par les vrais Discord User IDs
══════════════════════════════════════════ */
const ADMIN_DISCORD_IDS = new Set(
  (process.env.ADMIN_DISCORD_IDS || 'VOTRE_DISCORD_ID_ICI').split(',').filter(id => id.trim())
);

/* OAuth Discord Config */
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || 'VOTRE_CLIENT_ID';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'VOTRE_CLIENT_SECRET';
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI  || `https://pixelworld.gd-verse.duckdns.org/auth/discord/callback`;

const SECURITY = {
  MAX_PIXELS_PER_SEC: 600, MAX_BATCH_SIZE: 512,
  CHAT_MIN_INTERVAL: 800,          // anti-spam: 800ms entre messages
  CHAT_MAX_SAME_MSG: 3,            // anti-spam: max 3 messages identiques
  MAX_CHAT_HISTORY: 10,            // anti-spam: fenêtre historique
  MAX_PSEUDO_LEN: 18, MIN_PSEUDO_LEN: 2, MAX_ROOM_NAME_LEN: 32, MIN_ROOM_NAME_LEN: 2,
  HEX_RE: /^#[0-9a-fA-F]{6}$/, PSEUDO_RE: /^[a-zA-Z0-9_\-\.éèêëàâùûüîïôœçÉÈÊËÀÂÙÛÜÎÏÔŒÇ]+$/,
  MAX_CANVAS_W: 2000, MAX_CANVAS_H: 2000, REPORT_THRESHOLD: 3,
};

/* ── IP Banning ── */
const bannedIPs = new Set();
function loadBannedIPs() {
  try { JSON.parse(fs.readFileSync(BANS_FILE,'utf8')).forEach(h=>bannedIPs.add(h)); } catch{}
}
function saveBannedIPs() { fs.writeFileSync(BANS_FILE, JSON.stringify([...bannedIPs],null,2)); }
function hashIP(ip) { return crypto.createHash('sha256').update('pw_salt_2024:'+ip).digest('hex').slice(0,24); }
function getSocketIP(socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : socket.handshake.address;
}
loadBannedIPs();

/* ── Accounts (Discord sessions) ── */
const discordSessions = new Map(); // token → { discordId, username, avatar, pseudo, color }

function loadAccounts() {
  try {
    const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE,'utf8'));
    // On ne reload pas les sessions (elles sont en mémoire seulement)
    return data;
  } catch { return {}; }
}
const accountStats = loadAccounts(); // { discordId: { lastSeen, pseudo, loginCount } }

function saveAccounts() {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accountStats, null, 2));
}

/* ── Rate limiters ── */
const pixelBuckets   = new Map();
const chatTimestamps = new Map();
const chatHistory    = new Map(); // sid → string[]
const cursorThrottle = new Map();
const spamWarnings   = new Map(); // sid → count

function checkPixelRate(sid,n){const now=Date.now();let b=pixelBuckets.get(sid);if(!b||now-b.windowStart>1000)b={count:0,windowStart:now};b.count+=n;pixelBuckets.set(sid,b);return b.count<=SECURITY.MAX_PIXELS_PER_SEC;}

function checkChatRate(sid, text) {
  const now = Date.now();
  const last = chatTimestamps.get(sid) || 0;
  if (now - last < SECURITY.CHAT_MIN_INTERVAL) return { ok: false, reason: 'trop_vite' };
  chatTimestamps.set(sid, now);
  // Vérifier répétition
  if (!chatHistory.has(sid)) chatHistory.set(sid, []);
  const hist = chatHistory.get(sid);
  hist.push(text);
  if (hist.length > SECURITY.MAX_CHAT_HISTORY) hist.shift();
  const sameCount = hist.filter(m => m === text).length;
  if (sameCount > SECURITY.CHAT_MAX_SAME_MSG) return { ok: false, reason: 'spam' };
  return { ok: true };
}

function checkCursorRate(sid){const now=Date.now(),last=cursorThrottle.get(sid)||0;if(now-last<40)return false;cursorThrottle.set(sid,now);return true;}
function validateHex(c){return typeof c==='string'&&SECURITY.HEX_RE.test(c);}
function validatePseudo(p){return typeof p==='string'&&p.length>=SECURITY.MIN_PSEUDO_LEN&&p.length<=SECURITY.MAX_PSEUDO_LEN&&SECURITY.PSEUDO_RE.test(p);}
setInterval(()=>{const now=Date.now();for(const[s,b]of pixelBuckets)if(now-b.windowStart>5000)pixelBuckets.delete(s);for(const[s,t]of chatTimestamps)if(now-t>5000)chatTimestamps.delete(s);for(const[s,t]of cursorThrottle)if(now-t>5000)cursorThrottle.delete(s);},60000);

/* ── STATE ── */
const rooms = new Map(), sockets = new Map();
const recentLeft = new Map();

/* ── LOAD / SAVE ROOMS ── */
function loadRooms() {
  try {
    JSON.parse(fs.readFileSync(ROOMS_FILE,'utf8')).forEach(r=>{
      r.members=new Map(); r.bannedSet=new Set(r.banned||[]);
      r.isGeneral=r.isGeneral||false; r.protectedZones=r.protectedZones||[];
      r.reports=r.reports||{}; r.chatLog=r.chatLog||[];
      r.antiSpam=r.antiSpam||false;
      rooms.set(r.id,r);
    });
    console.log(`[boot] ${rooms.size} room(s) chargée(s)`);
  } catch{}
}
function saveRooms() {
  const arr=[];
  for(const[,r]of rooms) arr.push({
    id:r.id,name:r.name,owner:r.owner,ownerId:r.ownerId,ownerDiscordId:r.ownerDiscordId||null,
    passwordHash:r.passwordHash||null,maxPlayers:r.maxPlayers||50,
    canvas:r.canvas,banned:[...r.bannedSet],mods:r.mods||[],
    createdAt:r.createdAt,canvasW:r.canvasW,canvasH:r.canvasH,
    isGeneral:r.isGeneral||false,protectedZones:r.protectedZones||[],
    reports:r.reports||{},chatLog:(r.chatLog||[]).slice(-100),
    antiSpam:r.antiSpam||false,
  });
  fs.writeFileSync(ROOMS_FILE,JSON.stringify(arr,null,2));
}
loadRooms(); setInterval(saveRooms,15000);

/* ── GENERAL LOBBIES ── */
function createDefaultRooms(){
  const defs=[{id:'GENERAL1',name:'🌍 Général #1'},{id:'GENERAL2',name:'🌎 Général #2'},{id:'GENERAL3',name:'🌏 Général #3'}];
  let c=0;
  for(const d of defs) if(!rooms.has(d.id)){
    rooms.set(d.id,{id:d.id,name:d.name,owner:'Système',ownerId:null,ownerDiscordId:null,
      passwordHash:null,maxPlayers:200,canvas:{},members:new Map(),bannedSet:new Set(),
      mods:[],canvasW:800,canvasH:600,createdAt:Date.now(),isGeneral:true,protectedZones:[],
      reports:{},chatLog:[],antiSpam:false});c++;
  }
  if(c>0){saveRooms();console.log(`[boot] ${c} lobby(s) créé(s)`);}
}
createDefaultRooms();

/* ── HELPERS ── */
function roomInfo(r){
  const ml=[];
  for(const[,m]of r.members)ml.push({pseudo:m.pseudo,color:m.color,pfp:m.pfp,discordId:m.discordId,
    isOwner:m.pseudo===r.owner,isMod:(r.mods||[]).includes(m.pseudo)});
  return {id:r.id,name:r.name,owner:r.owner,hasPassword:!!r.passwordHash,maxPlayers:r.maxPlayers,
    playerCount:r.members.size,members:ml,mods:r.mods||[],banned:[...r.bannedSet],
    canvasW:r.canvasW,canvasH:r.canvasH,createdAt:r.createdAt,isGeneral:r.isGeneral||false,
    protectedZones:r.protectedZones||[],antiSpam:r.antiSpam||false};
}
function broadcastRoomList(){const list=[];for(const[,r]of rooms)list.push(roomInfo(r));io.emit('room:list',list);}
function isModOrOwner(r,p){return p===r.owner||(r.mods||[]).includes(p);}
function isInProtectedZone(r,x,y){return(r.protectedZones||[]).some(z=>x>=z.x1&&x<=z.x2&&y>=z.y1&&y<=z.y2);}
function getReportsList(r){return Object.values(r.reports||{}).filter(rep=>rep.voters.length>0).sort((a,b)=>b.voters.length-a.voters.length).slice(0,20);}
function countPixelsByPlayer(room){const counts={};for(const v of Object.values(room.canvas)){if(v.owner)counts[v.owner]=(counts[v.owner]||0)+1;}return counts;}

/* ══════════════════════════════════════════
   DISCORD OAUTH
══════════════════════════════════════════ */
app.use(express.json());
app.use(cookieParser());

/* Middleware pour vérifier les cookies de session */
app.use((req, res, next) => {
  if (req.cookies.pw_session && discordSessions.has(req.cookies.pw_session)) {
    // Session valide - l'utilisateur est connecté
    req.session = discordSessions.get(req.cookies.pw_session);
  }
  next();
});

/* Étape 1 : Rediriger vers Discord */
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

/* Étape 2 : Callback Discord */
app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/?error=no_code');

  try {
    // Échanger le code contre un token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token');

    // Récupérer le profil Discord
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();
    if (!user.id) throw new Error('No user id');

    // Créer une session locale
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const avatar = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;

    const savedPseudo = accountStats[user.id]?.pseudo || user.username.slice(0, 18);
    const savedColor  = accountStats[user.id]?.color  || null;

    discordSessions.set(sessionToken, {
      discordId: user.id,
      username: user.username,
      avatar,
      pseudo: savedPseudo,
      color: savedColor,
      isAdmin: ADMIN_DISCORD_IDS.has(user.id),
    });

    // Mettre à jour les stats du compte
    accountStats[user.id] = {
      ...(accountStats[user.id] || {}),
      discordId: user.id,
      username: user.username,
      pseudo: savedPseudo,
      color: savedColor,
      lastSeen: Date.now(),
      loginCount: ((accountStats[user.id]?.loginCount) || 0) + 1,
    };
    saveAccounts();

    console.log(`[discord] ${user.username} (${user.id}) connecté`);
    
    // Set persistent cookie for 30 days
    res.cookie('pw_session', sessionToken, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    res.redirect(`/?token=${sessionToken}`);
  } catch (err) {
    console.error('[discord] OAuth error:', err.message);
    res.redirect('/?error=oauth_failed');
  }
});

/* Valider un token de session */
app.get('/auth/session', (req, res) => {
  const token = req.query.token;
  if (!token || !discordSessions.has(token)) return res.json({ valid: false });
  const session = discordSessions.get(token);
  res.json({ valid: true, ...session });
});

/* Vérifier la session actuelle (via cookie) */
app.get('/auth/current-session', (req, res) => {
  if (req.session) {
    res.json({ valid: true, ...req.session });
  } else {
    res.json({ valid: false });
  }
});

/* Déconnexion */
app.get('/auth/logout', (req, res) => {
  if (req.cookies.pw_session) {
    discordSessions.delete(req.cookies.pw_session);
    res.clearCookie('pw_session');
  }
  res.redirect('/');
});

/* ══════════════════════════════════════════
   API ADMIN
══════════════════════════════════════════ */
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  const session = discordSessions.get(token);
  if (!session || !ADMIN_DISCORD_IDS.has(session.discordId)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  req.adminSession = session;
  next();
}

/* Stats globales */
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const activeRooms = [];
  for (const [, r] of rooms) {
    const members = [];
    for (const [, m] of r.members) {
      members.push({
        pseudo: m.pseudo,
        color: m.color,
        discordId: m.discordId || null,
        discordUsername: m.discordUsername || null,
        joinedAt: m.joinedAt || null,
      });
    }
    activeRooms.push({
      id: r.id,
      name: r.name,
      owner: r.owner,
      playerCount: r.members.size,
      maxPlayers: r.maxPlayers,
      isGeneral: r.isGeneral,
      pixelCount: Object.keys(r.canvas).length,
      antiSpam: r.antiSpam,
      chatLogCount: (r.chatLog || []).length,
      members,
      chatLog: (r.chatLog || []).slice(-50),
    });
  }

  const connectedAccounts = [];
  for (const [token, session] of discordSessions) {
    connectedAccounts.push({
      discordId: session.discordId,
      username: session.username,
      pseudo: session.pseudo,
      isAdmin: session.isAdmin,
    });
  }

  res.json({
    totalRooms: rooms.size,
    totalConnected: connectedAccounts.length,
    totalAccounts: Object.keys(accountStats).length,
    activeRooms,
    connectedAccounts,
    accountStats: Object.values(accountStats).sort((a,b) => (b.lastSeen||0) - (a.lastSeen||0)),
    bannedIPsCount: bannedIPs.size,
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

/* Ban global d'un compte Discord */
app.post('/api/admin/ban-discord', requireAdmin, (req, res) => {
  const { discordId, reason } = req.body;
  if (!discordId) return res.status(400).json({ error: 'discordId requis' });
  // Marquer comme banni dans les stats
  if (!accountStats[discordId]) accountStats[discordId] = {};
  accountStats[discordId].globalBanned = true;
  accountStats[discordId].banReason = reason || 'Banni par admin';
  accountStats[discordId].bannedAt = Date.now();
  // Déconnecter ses sessions actives
  for (const [token, session] of discordSessions) {
    if (session.discordId === discordId) discordSessions.delete(token);
  }
  // Kick de toutes les rooms
  for (const [, room] of rooms) {
    for (const [sid, m] of room.members) {
      if (m.discordId === discordId) {
        const s = io.sockets.sockets.get(sid);
        if (s) { s.emit('room:kicked', { reason: 'Banni par un administrateur' }); handleLeave(s); }
      }
    }
  }
  saveAccounts();
  res.json({ ok: true });
});

/* Ajouter un admin */
app.post('/api/admin/add-admin', requireAdmin, (req, res) => {
  const { discordId } = req.body;
  if (!discordId) return res.status(400).json({ error: 'discordId requis' });
  ADMIN_DISCORD_IDS.add(discordId);
  // Mettre à jour session active si présente
  for (const [, session] of discordSessions) {
    if (session.discordId === discordId) session.isAdmin = true;
  }
  res.json({ ok: true });
});

/* ══════════════════════════════════════════
   SOCKET HANDLERS
══════════════════════════════════════════ */
io.on('connection', socket => {
  const ip = getSocketIP(socket);
  const ipHash = hashIP(ip);
  if (bannedIPs.has(ipHash)) { socket.disconnect(true); return; }
  console.log(`[+] ${socket.id}`);

  socket.on('lobby:list', () => {
    const list=[]; for(const[,r]of rooms)list.push(roomInfo(r)); socket.emit('room:list',list);
  });

  /* ── VALIDATE SESSION ── */
  socket.on('auth:validate', (data, cb) => {
    const { token } = data || {};
    if (!token || !discordSessions.has(token)) return cb({ valid: false });
    const session = discordSessions.get(token);
    // Vérifier que le compte n'est pas globalement banni
    if (accountStats[session.discordId]?.globalBanned) {
      discordSessions.delete(token);
      return cb({ valid: false, error: 'Compte banni' });
    }
    cb({ valid: true, ...session });
  });

  /* ── CHANGER PSEUDO ── */
  socket.on('user:rename', (data, cb) => {
    const info = sockets.get(socket.id);
    if (!info) return cb?.({ error: 'Non connecté' });
    const newPseudo = String(data.pseudo || '').trim();
    if (!validatePseudo(newPseudo)) return cb?.({ error: 'Pseudo invalide (2-18 caractères alphanumériques)' });

    const oldPseudo = info.pseudo;
    info.pseudo = newPseudo;

    // Mettre à jour dans la room
    if (info.roomId) {
      const room = rooms.get(info.roomId);
      if (room) {
        const member = room.members.get(socket.id);
        if (member) member.pseudo = newPseudo;
        // Mettre à jour owner si c'était lui
        if (room.owner === oldPseudo) room.owner = newPseudo;
        // Mettre à jour mods
        const modIdx = (room.mods || []).indexOf(oldPseudo);
        if (modIdx >= 0) room.mods[modIdx] = newPseudo;
        io.to(info.roomId).emit('room:info', roomInfo(room));
        io.to(info.roomId).emit('chat:msg', {
          pseudo: '✏️ Système', color: '#0066ff',
          text: `${oldPseudo} → ${newPseudo}`, ts: Date.now(), system: true,
        });
      }
    }

    // Sauvegarder le pseudo dans la session Discord
    if (info.discordId) {
      const session = [...discordSessions.values()].find(s => s.discordId === info.discordId);
      if (session) session.pseudo = newPseudo;
      if (accountStats[info.discordId]) accountStats[info.discordId].pseudo = newPseudo;
      saveAccounts();
    }

    cb?.({ ok: true });
  });

  /* ── CREATE ROOM ── */
  socket.on('room:create', async(data,cb)=>{
    const {pseudo,color,pfp,name,password,maxPlayers,canvasW,canvasH,discordId,discordUsername}=data;
    if(!validatePseudo(pseudo))return cb({error:'Pseudo invalide'});
    if(!name||name.length<SECURITY.MIN_ROOM_NAME_LEN)return cb({error:'Nom trop court'});
    if(name.length>SECURITY.MAX_ROOM_NAME_LEN)return cb({error:`Nom trop long`});
    if(color&&!validateHex(color))return cb({error:'Couleur invalide'});
    const id=uuidv4().slice(0,8).toUpperCase();
    let passwordHash=null;
    if(password&&password.length>0)passwordHash=await bcrypt.hash(password,8);
    const W=Math.min(Math.max(canvasW||800,100),2000),H=Math.min(Math.max(canvasH||600,100),2000);
    const room={id,name,owner:pseudo,ownerId:socket.id,ownerDiscordId:discordId||null,
      passwordHash,maxPlayers:Math.min(maxPlayers||50,200),canvas:{},members:new Map(),
      bannedSet:new Set(),mods:[],canvasW:W,canvasH:H,createdAt:Date.now(),
      protectedZones:[],reports:{},chatLog:[],antiSpam:false};
    rooms.set(id,room);
    socket.join(id);
    room.members.set(socket.id,{pseudo,color,pfp:pfp||null,discordId:discordId||null,discordUsername:discordUsername||null,joinedAt:Date.now()});
    sockets.set(socket.id,{pseudo,roomId:id,color,pfp:pfp||null,ipHash,discordId:discordId||null,discordUsername:discordUsername||null});
    saveRooms(); broadcastRoomList(); cb({ok:true});
    socket.emit('room:joined',{room:roomInfo(room),canvas:room.canvas,isOwner:true});
  });

  /* ── JOIN ROOM ── */
  socket.on('room:join', async(data,cb)=>{
    const {roomId,pseudo,color,pfp,password,discordId,discordUsername}=data;
    if(!validatePseudo(pseudo))return cb({error:'Pseudo invalide'});
    if(color&&!validateHex(color))return cb({error:'Couleur invalide'});
    const room=rooms.get(roomId);
    if(!room)return cb({error:'Room introuvable'});
    if(room.bannedSet.has(pseudo))return cb({error:'Tu es banni de cette room'});
    // Vérifier ban Discord dans cette room
    if(discordId&&room.bannedDiscordIds&&room.bannedDiscordIds.has(discordId))return cb({error:'Ton compte Discord est banni de cette room'});
    if(room.members.size>=room.maxPlayers)return cb({error:'Room pleine'});
    if(room.passwordHash){const ok=password&&await bcrypt.compare(password,room.passwordHash);if(!ok)return cb({error:'Mot de passe incorrect'});}
    socket.join(roomId);
    room.members.set(socket.id,{pseudo,color,pfp:pfp||null,discordId:discordId||null,discordUsername:discordUsername||null,joinedAt:Date.now()});
    sockets.set(socket.id,{pseudo,roomId,color,pfp:pfp||null,ipHash,discordId:discordId||null,discordUsername:discordUsername||null});
    io.to(roomId).emit('room:member_joined',{pseudo,color,pfp:pfp||null});
    io.to(roomId).emit('room:info',roomInfo(room)); broadcastRoomList();
    cb({ok:true});
    const isOwnerJoin=pseudo===room.owner, isModJoin=(room.mods||[]).includes(pseudo);
    const pixCounts=countPixelsByPlayer(room);
    socket.emit('room:joined',{room:roomInfo(room),canvas:room.canvas,isOwner:isOwnerJoin,isMod:isModJoin});
    if(isOwnerJoin||isModJoin){
      const rl=recentLeft.get(roomId)||new Map();
      const list=[...rl.values()].map(e=>({...e,pixelCount:pixCounts[e.pseudo]||0}));
      socket.emit('offline:list',list);
    }
  });

  socket.on('room:leave',()=>handleLeave(socket));

  /* ── CURSEUR ── */
  socket.on('cursor:move',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    if(!checkCursorRate(socket.id))return;
    const x=Number(data.x),y=Number(data.y);
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    socket.to(info.roomId).emit('cursor:update',{pseudo:info.pseudo,color:info.color,x:Math.round(x),y:Math.round(y)});
  });

  /* ── PIXEL DRAW — FIX SYNC SUPPRESSION ── */
  socket.on('pixel:set',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room)return;
    const {pixels}=data; if(!Array.isArray(pixels))return;
    if(pixels.length>SECURITY.MAX_BATCH_SIZE)return;
    if(!checkPixelRate(socket.id,pixels.length))return;
    const changes=[];
    for(const p of pixels){
      const {x,y,color}=p;
      if(!Number.isInteger(x)||!Number.isInteger(y))continue;
      if(x<0||y<0||x>=room.canvasW||y>=room.canvasH)continue;
      if(isInProtectedZone(room,x,y)&&!isModOrOwner(room,info.pseudo))continue;
      const k=`${x}_${y}`;
      if(color===null){
        const existing=room.canvas[k];
        if(existing&&existing.owner!==info.pseudo&&!isModOrOwner(room,info.pseudo))continue;
        delete room.canvas[k]; delete room.reports[k];
      } else {
        if(!validateHex(color))continue;
        room.canvas[k]={color,owner:info.pseudo,ownerColor:info.color};
      }
      // Pour une suppression on envoie color:null sans owner pour eviter confusion cote client
      if(color===null) changes.push({x,y,color:null});
      else changes.push({x,y,color,owner:info.pseudo,ownerColor:info.color});
    }
    if(changes.length){
      // Broadcaster a tout le monde dans la room (y compris l'emetteur)
      io.to(info.roomId).emit('pixel:batch', changes);
    }
  });

  /* ── SIGNALEMENT ── */
  socket.on('pixel:report',(data,cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return cb?.({error:'Non connecté'});
    const room=rooms.get(info.roomId); if(!room)return cb?.({error:'Room introuvable'});
    const x=Number(data.x),y=Number(data.y);
    if(!Number.isInteger(x)||!Number.isInteger(y))return cb?.({error:'Coords invalides'});
    if(x<0||y<0||x>=room.canvasW||y>=room.canvasH)return cb?.({error:'Hors limites'});
    const k=`${x}_${y}`;
    if(!room.canvas[k])return cb?.({error:'Aucun pixel ici'});
    if(!room.reports)room.reports={};
    if(!room.reports[k])room.reports[k]={x,y,owner:room.canvas[k].owner,voters:[]};
    if(room.reports[k].voters.includes(info.pseudo))return cb?.({error:'Déjà signalé'});
    room.reports[k].voters.push(info.pseudo);
    const count=room.reports[k].voters.length;
    cb?.({ok:true,count});
    const repList=getReportsList(room);
    for(const[sid,m]of room.members)if(isModOrOwner(room,m.pseudo))io.to(sid).emit('mod:reports_update',repList);
    if(count>=SECURITY.REPORT_THRESHOLD)
      for(const[sid,m]of room.members)if(isModOrOwner(room,m.pseudo))io.to(sid).emit('pixel:flagged',{x,y,count,owner:room.canvas[k]?.owner});
  });

  socket.on('mod:get_reports',(_, cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return cb?.([]);
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return cb?.([]);
    cb?.(getReportsList(room));
  });

  socket.on('mod:clear_report',(data,cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return;
    delete room.reports[`${data.x}_${data.y}`];
    const repList=getReportsList(room);
    for(const[sid,m]of room.members)if(isModOrOwner(room,m.pseudo))io.to(sid).emit('mod:reports_update',repList);
    cb?.({ok:true});
  });

  /* ── ZONES PROTÉGÉES ── */
  socket.on('zone:add',(data,cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return cb?.({error:'Non connecté'});
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return cb?.({error:'Permission refusée'});
    const x1=Math.max(0,Math.min(room.canvasW-1,Number(data.x1)|0));
    const y1=Math.max(0,Math.min(room.canvasH-1,Number(data.y1)|0));
    const x2=Math.max(0,Math.min(room.canvasW-1,Number(data.x2)|0));
    const y2=Math.max(0,Math.min(room.canvasH-1,Number(data.y2)|0));
    const label=String(data.label||'Zone protégée').slice(0,30);
    const zone={id:uuidv4().slice(0,8),x1:Math.min(x1,x2),y1:Math.min(y1,y2),x2:Math.max(x1,x2),y2:Math.max(y1,y2),label,createdBy:info.pseudo};
    if(!room.protectedZones)room.protectedZones=[];
    room.protectedZones.push(zone); saveRooms();
    io.to(info.roomId).emit('zones:update',room.protectedZones);
    cb?.({ok:true,zone});
  });

  socket.on('zone:remove',(data,cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return;
    room.protectedZones=(room.protectedZones||[]).filter(z=>z.id!==data.id); saveRooms();
    io.to(info.roomId).emit('zones:update',room.protectedZones); cb?.({ok:true});
  });

  /* ── ANTI-SPAM (toggle par fondateur/admin) ── */
  socket.on('room:toggle_antispam', (data, cb) => {
    const info = sockets.get(socket.id); if (!info || !info.roomId) return cb?.({ error: 'Non connecté' });
    const room = rooms.get(info.roomId); if (!room) return cb?.({ error: 'Room introuvable' });
    if (!isModOrOwner(room, info.pseudo)) return cb?.({ error: 'Permission refusée' });
    room.antiSpam = !room.antiSpam;
    saveRooms();
    io.to(info.roomId).emit('room:info', roomInfo(room));
    io.to(info.roomId).emit('chat:msg', {
      pseudo: '🛡 Anti-spam', color: '#8b5cf6',
      text: `Mode anti-spam ${room.antiSpam ? 'activé 🟢' : 'désactivé 🔴'} par ${info.pseudo}`,
      ts: Date.now(), system: true,
    });
    cb?.({ ok: true, antiSpam: room.antiSpam });
  });

  /* ── BAN DE SALON (kick + ban Discord ID) ── */
  socket.on('mod:ban_from_room', (data, cb) => {
    const info = sockets.get(socket.id); if (!info || !info.roomId) return cb?.({ error: 'Non connecté' });
    const room = rooms.get(info.roomId); if (!room) return cb?.({ error: 'Room introuvable' });
    if (!isModOrOwner(room, info.pseudo)) return cb?.({ error: 'Permission refusée' });
    if (data.pseudo === room.owner) return cb?.({ error: 'Impossible de bannir le propriétaire' });

    // Ban par pseudo
    room.bannedSet.add(data.pseudo);

    // Ban aussi par Discord ID si dispo
    for (const [sid, m] of room.members) {
      if (m.pseudo === data.pseudo) {
        if (m.discordId) {
          if (!room.bannedDiscordIds) room.bannedDiscordIds = new Set();
          room.bannedDiscordIds.add(m.discordId);
        }
        // Ban IP si demandé
        if (data.banIP) {
          const ti = sockets.get(sid);
          if (ti?.ipHash) { bannedIPs.add(ti.ipHash); saveBannedIPs(); }
        }
        const s = io.sockets.sockets.get(sid);
        if (s) { s.emit('room:kicked', { reason: data.reason || 'Tu as été banni de ce salon' }); handleLeave(s); }
        break;
      }
    }
    saveRooms();
    io.to(info.roomId).emit('chat:msg', {
      pseudo: '🛡 Modération', color: '#ff2d78',
      text: `${data.pseudo} a été banni du salon${data.reason ? ` (${data.reason})` : ''}.`,
      ts: Date.now(), system: true,
    });
    io.to(info.roomId).emit('room:info', roomInfo(room));
    cb?.({ ok: true });
  });

  /* ── EXPORT / IMPORT ── */
  socket.on('room:export', (_, cb) => {
    const info = sockets.get(socket.id);
    if (!info || !info.roomId) return cb?.({ error: 'Non connecté' });
    const room = rooms.get(info.roomId);
    if (!room) return cb?.({ error: 'Room introuvable' });
    const exportData = {
      version: 2, exportedAt: Date.now(), exportedBy: info.pseudo,
      name: room.name, canvasW: room.canvasW, canvasH: room.canvasH,
      canvas: room.canvas, protectedZones: room.protectedZones || [],
    };
    cb?.({ ok: true, data: exportData });
  });

  socket.on('room:import', (data, cb) => {
    const info = sockets.get(socket.id);
    if (!info || !info.roomId) return cb?.({ error: 'Non connecté' });
    const room = rooms.get(info.roomId);
    if (!room) return cb?.({ error: 'Room introuvable' });
    if (info.pseudo !== room.owner) return cb?.({ error: 'Réservé au propriétaire' });
    const importData = data.importData;
    if (!importData || importData.version !== 2) return cb?.({ error: 'Format invalide (version 2 requise)' });
    if (!importData.canvas || typeof importData.canvas !== 'object') return cb?.({ error: 'Canvas manquant' });
    const newCanvas = {};
    let count = 0, skipped = 0;
    for (const [k, v] of Object.entries(importData.canvas)) {
      const m = k.match(/^(\d+)_(\d+)$/);
      if (!m) { skipped++; continue; }
      const x = parseInt(m[1]), y = parseInt(m[2]);
      if (x < 0 || y < 0 || x >= room.canvasW || y >= room.canvasH) { skipped++; continue; }
      if (!v.color || !validateHex(v.color)) { skipped++; continue; }
      newCanvas[k] = { color: v.color, owner: validatePseudo(v.owner||'') ? v.owner : info.pseudo, ownerColor: validateHex(v.ownerColor||'') ? v.ownerColor : info.color };
      count++;
    }
    if (data.merge) { Object.assign(room.canvas, newCanvas); } else { room.canvas = newCanvas; }
    if (Array.isArray(importData.protectedZones)) {
      room.protectedZones = importData.protectedZones.map(z => ({
        id: uuidv4().slice(0, 8),
        x1: Math.max(0, Number(z.x1)|0), y1: Math.max(0, Number(z.y1)|0),
        x2: Math.min(room.canvasW-1, Number(z.x2)|0), y2: Math.min(room.canvasH-1, Number(z.y2)|0),
        label: String(z.label||'Zone').slice(0,30), createdBy: info.pseudo,
      })).filter(z => z.x1 < room.canvasW && z.y1 < room.canvasH);
    }
    saveRooms();
    io.to(info.roomId).emit('canvas:full', room.canvas);
    io.to(info.roomId).emit('zones:update', room.protectedZones);
    io.to(info.roomId).emit('chat:msg', { pseudo: '📦 Import', color: '#0066ff', text: `Canvas importé par ${info.pseudo} — ${count} pixels (${skipped} ignorés).`, ts: Date.now(), system: true });
    cb?.({ ok: true, count, skipped });
  });

  /* ── JOUEURS HORS-LIGNE ── */
  socket.on('mod:offline_list', (_, cb) => {
    const info = sockets.get(socket.id);
    if (!info || !info.roomId) return cb?.([]);
    const room = rooms.get(info.roomId);
    if (!room || !isModOrOwner(room, info.pseudo)) return cb?.([]);
    const rl = recentLeft.get(info.roomId) || new Map();
    const pixCounts = countPixelsByPlayer(room);
    cb?.([...rl.values()].map(e => ({ ...e, pixelCount: pixCounts[e.pseudo] || 0 })));
  });

  socket.on('mod:clear_offline', (data, cb) => {
    const info = sockets.get(socket.id);
    if (!info || !info.roomId) return cb?.({ error: 'Non connecté' });
    const room = rooms.get(info.roomId);
    if (!room || !isModOrOwner(room, info.pseudo)) return cb?.({ error: 'Permission refusée' });
    const target = String(data.pseudo || '').trim();
    if (!target) return cb?.({ error: 'Pseudo manquant' });
    let count = 0;
    for (const k of Object.keys(room.canvas)) {
      if (room.canvas[k].owner === target) { delete room.canvas[k]; count++; }
    }
    const rl = recentLeft.get(info.roomId);
    if (rl) rl.delete(target);
    io.to(info.roomId).emit('canvas:full', room.canvas);
    io.to(info.roomId).emit('chat:msg', { pseudo: '🛡 Modération', color: '#ff2d78', text: `${count} pixels de ${target} effacés (hors-ligne).`, ts: Date.now(), system: true });
    const rlMap = recentLeft.get(info.roomId) || new Map();
    const pixCounts = countPixelsByPlayer(room);
    const offlineList = [...rlMap.values()].map(e => ({ ...e, pixelCount: pixCounts[e.pseudo] || 0 }));
    for (const [sid, m] of room.members) {
      if (isModOrOwner(room, m.pseudo)) io.to(sid).emit('offline:list', offlineList);
    }
    cb?.({ ok: true, count });
  });

  /* ── MODERATION ── */
  socket.on('mod:kick',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return;
    if(data.pseudo===room.owner)return;
    for(const[sid,m]of room.members)if(m.pseudo===data.pseudo){
      const s=io.sockets.sockets.get(sid);
      if(s){s.emit('room:kicked',{reason:'Exclu par le modérateur'});handleLeave(s);}break;
    }
    io.to(info.roomId).emit('chat:msg',{pseudo:'🛡 Modération',color:'#ff6600',text:`${data.pseudo} a été expulsé.`,ts:Date.now(),system:true});
  });

  socket.on('mod:ban',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return;
    if(data.pseudo===room.owner)return;
    room.bannedSet.add(data.pseudo);
    for(const[sid,m]of room.members)if(m.pseudo===data.pseudo){
      const s=io.sockets.sockets.get(sid);
      if(s){s.emit('room:kicked',{reason:'Tu as été banni'});handleLeave(s);}break;
    }
    saveRooms(); io.to(info.roomId).emit('chat:msg',{pseudo:'🛡 Modération',color:'#ff2d78',text:`${data.pseudo} a été banni.`,ts:Date.now(),system:true});
    io.to(info.roomId).emit('room:info',roomInfo(room));
  });

  socket.on('mod:ban_ip',(data,cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return cb?.({error:'Non connecté'});
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return cb?.({error:'Permission refusée'});
    if(data.pseudo===room.owner)return cb?.({error:'Impossible de bannir le propriétaire'});
    for(const[sid,m]of room.members)if(m.pseudo===data.pseudo){
      const ti=sockets.get(sid);
      if(ti?.ipHash){bannedIPs.add(ti.ipHash);saveBannedIPs();}
      room.bannedSet.add(data.pseudo);
      const s=io.sockets.sockets.get(sid);
      if(s){s.emit('room:kicked',{reason:'Tu as été banni (IP)'});handleLeave(s);}break;
    }
    saveRooms(); io.to(info.roomId).emit('chat:msg',{pseudo:'🛡 Modération',color:'#ff2d78',text:`${data.pseudo} banni par IP.`,ts:Date.now(),system:true});
    io.to(info.roomId).emit('room:info',roomInfo(room)); cb?.({ok:true});
  });

  socket.on('mod:unban',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return;
    room.bannedSet.delete(data.pseudo);
    if (room.bannedDiscordIds) room.bannedDiscordIds.delete(data.pseudo);
    saveRooms();
    socket.emit('chat:msg',{pseudo:'🛡 Modération',color:'#00cc66',text:`${data.pseudo} débanni.`,ts:Date.now(),system:true});
    socket.emit('room:info',roomInfo(room));
  });

  socket.on('mod:promote',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room||info.pseudo!==room.owner)return;
    if(!room.mods)room.mods=[];
    if(!room.mods.includes(data.pseudo))room.mods.push(data.pseudo); saveRooms();
    io.to(info.roomId).emit('room:info',roomInfo(room));
    io.to(info.roomId).emit('chat:msg',{pseudo:'🛡 Modération',color:'#8b5cf6',text:`${data.pseudo} est modérateur.`,ts:Date.now(),system:true});
  });

  socket.on('mod:demote',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room||info.pseudo!==room.owner)return;
    room.mods=(room.mods||[]).filter(m=>m!==data.pseudo); saveRooms();
    io.to(info.roomId).emit('room:info',roomInfo(room));
    io.to(info.roomId).emit('chat:msg',{pseudo:'🛡 Modération',color:'#ff6600',text:`${data.pseudo} n'est plus mod.`,ts:Date.now(),system:true});
  });

  socket.on('room:set_password',async(data,cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return cb?.({error:'Non connecté'});
    const room=rooms.get(info.roomId); if(!room||info.pseudo!==room.owner)return cb?.({error:'Réservé au propriétaire'});
    room.passwordHash=data.password?await bcrypt.hash(data.password,8):null; saveRooms();
    io.to(info.roomId).emit('room:info',roomInfo(room)); broadcastRoomList(); cb?.({ok:true});
    io.to(info.roomId).emit('chat:msg',{pseudo:'🔒 Room',color:'#0066ff',text:data.password?'Mot de passe mis à jour.':'Mot de passe supprimé.',ts:Date.now(),system:true});
  });

  socket.on('room:clear_canvas',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room||!isModOrOwner(room,info.pseudo))return;
    if(data.onlyOwn){const t=data.target||info.pseudo;for(const k of Object.keys(room.canvas))if(room.canvas[k].owner===t)delete room.canvas[k];}
    else room.canvas={};
    io.to(info.roomId).emit('canvas:full',room.canvas);
    io.to(info.roomId).emit('chat:msg',{pseudo:'🎨 Canvas',color:'#0066ff',text:data.onlyOwn?`Pixels de ${data.target} effacés.`:'Canvas effacé.',ts:Date.now(),system:true});
  });

  socket.on('room:resize_canvas',(data,cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return cb?.({error:'Non connecté'});
    const room=rooms.get(info.roomId); if(!room||info.pseudo!==room.owner)return cb?.({error:'Réservé au propriétaire'});
    const W=Math.min(Math.max(data.w||800,100),2000),H=Math.min(Math.max(data.h||600,100),2000);
    room.canvasW=W; room.canvasH=H;
    for(const k of Object.keys(room.canvas)){const[x,y]=k.split('_').map(Number);if(x>=W||y>=H)delete room.canvas[k];}
    room.protectedZones=(room.protectedZones||[]).map(z=>({...z,x2:Math.min(z.x2,W-1),y2:Math.min(z.y2,H-1)})).filter(z=>z.x1<W&&z.y1<H);
    saveRooms(); io.to(info.roomId).emit('room:info',roomInfo(room)); io.to(info.roomId).emit('canvas:full',room.canvas); cb?.({ok:true});
  });

  socket.on('room:delete',(cb)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return cb?.({error:'Non connecté'});
    const room=rooms.get(info.roomId); if(!room||info.pseudo!==room.owner)return cb?.({error:'Réservé au propriétaire'});
    io.to(info.roomId).emit('room:deleted',{reason:'La room a été supprimée.'});
    for(const[sid]of room.members){const s=io.sockets.sockets.get(sid);if(s){s.leave(info.roomId);sockets.delete(sid);}}
    rooms.delete(info.roomId); recentLeft.delete(info.roomId); saveRooms(); broadcastRoomList(); cb?.({ok:true});
  });

  /* ── CHAT avec anti-spam ── */
  socket.on('chat:send',(data)=>{
    const info=sockets.get(socket.id); if(!info||!info.roomId)return;
    const room=rooms.get(info.roomId); if(!room)return;
    const text=String(data.text||'').slice(0,300).trim(); if(!text)return;

    const rateCheck = checkChatRate(socket.id, text);
    if (!rateCheck.ok) {
      if (room.antiSpam) {
        // En mode anti-spam, avertir puis mute temporaire
        const warns = (spamWarnings.get(socket.id) || 0) + 1;
        spamWarnings.set(socket.id, warns);
        if (rateCheck.reason === 'spam') {
          socket.emit('chat:msg', { pseudo: '🤖 Anti-spam', color: '#ff2d78', text: `⚠️ Spam détecté ! Avertissement ${warns}/3`, ts: Date.now(), system: true });
          if (warns >= 3) {
            // Notifier les mods
            for (const [sid, m] of room.members) {
              if (isModOrOwner(room, m.pseudo)) {
                io.to(sid).emit('chat:msg', { pseudo: '🤖 Anti-spam', color: '#ff2d78', text: `${info.pseudo} a atteint 3 avertissements spam`, ts: Date.now(), system: true });
              }
            }
          }
        } else {
          socket.emit('chat:msg', { pseudo: '🤖 Anti-spam', color: '#ff6600', text: '⏱ Envoie un peu moins vite !', ts: Date.now(), system: true });
        }
        return;
      }
      return; // Sans anti-spam actif, juste ignorer
    }
    spamWarnings.delete(socket.id);

    const msg = { pseudo: info.pseudo, color: info.color, text, ts: Date.now() };
    // Sauvegarder dans le log du salon
    if (!room.chatLog) room.chatLog = [];
    room.chatLog.push(msg);
    if (room.chatLog.length > 500) room.chatLog.splice(0, room.chatLog.length - 500);

    io.to(info.roomId).emit('chat:msg', msg);
  });

  socket.on('disconnect',()=>{ console.log(`[-] ${socket.id}`); handleLeave(socket); sockets.delete(socket.id); });
});

/* ── LEAVE HELPER ── */
function handleLeave(socket) {
  const info = sockets.get(socket.id);
  if (!info || !info.roomId) return;
  const room = rooms.get(info.roomId);
  if (!room) { sockets.delete(socket.id); return; }
  room.members.delete(socket.id);
  socket.leave(info.roomId);
  sockets.delete(socket.id);
  socket.to(info.roomId).emit('cursor:remove', { pseudo: info.pseudo });
  if (!recentLeft.has(info.roomId)) recentLeft.set(info.roomId, new Map());
  const rl = recentLeft.get(info.roomId);
  const pixCounts = countPixelsByPlayer(room);
  rl.set(info.pseudo, { pseudo: info.pseudo, color: info.color, ts: Date.now(), pixelCount: pixCounts[info.pseudo] || 0 });
  if (rl.size > 20) { const oldest = [...rl.keys()][0]; rl.delete(oldest); }
  const offlineList = [...rl.values()].map(e => ({ ...e, pixelCount: pixCounts[e.pseudo] || 0 }));
  for (const [sid, m] of room.members) {
    if (isModOrOwner(room, m.pseudo)) io.to(sid).emit('offline:list', offlineList);
  }
  io.to(info.roomId).emit('room:member_left', { pseudo: info.pseudo });
  io.to(info.roomId).emit('room:info', roomInfo(room));
  broadcastRoomList();
  if (!room.isGeneral && info.pseudo === room.owner && room.members.size > 0) {
    let newOwner = null;
    for (const [,m] of room.members) { if ((room.mods||[]).includes(m.pseudo)){newOwner=m;break;} }
    if (!newOwner) newOwner = room.members.values().next().value;
    room.owner = newOwner.pseudo; room.mods = (room.mods||[]).filter(m=>m!==newOwner.pseudo); saveRooms();
    io.to(info.roomId).emit('room:owner_changed', { newOwner: newOwner.pseudo });
    io.to(info.roomId).emit('room:info', roomInfo(room));
    io.to(info.roomId).emit('chat:msg', {pseudo:'🏠 Room',color:'#0066ff',text:`${newOwner.pseudo} est le nouveau propriétaire.`,ts:Date.now(),system:true});
    broadcastRoomList();
  }
  if (room.members.size === 0 && !room.isGeneral) { rooms.delete(info.roomId); recentLeft.delete(info.roomId); saveRooms(); broadcastRoomList(); }
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [roomId, rl] of recentLeft) {
    for (const [pseudo, e] of rl) if (e.ts < cutoff) rl.delete(pseudo);
    if (rl.size === 0) recentLeft.delete(roomId);
  }
}, 5 * 60 * 1000);

// Nettoyer les sessions Discord après 24h d'inactivité
setInterval(() => {
  // Sessions gardées en mémoire, pas de TTL pour l'instant
}, 60 * 60 * 1000);

/* ── STATIC ── */
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('X-XSS-Protection','1; mode=block');
  res.setHeader('Referrer-Policy','no-referrer');
  next();
});
app.use(express.static(path.join(__dirname,'public')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

server.listen(PORT,()=>console.log(`\n🎨 PixelWorld → http://localhost:${PORT}\n`));
