/**
 * Racing Lagoon Web — Serverless WebRTC P2P + Self-Electing Lobby Hub Engine
 * Drop-in replacement for EmulatorJS's Socket.IO + /list Netplay backend.
 * Uses PeerJS WebRTC DataChannels (with STUN/TURN) + BroadcastChannel (same-PC fast path).
 * Works 100% on Vercel / static hosting with zero external backend servers required.
 */
(function () {
  'use strict';

  const CONFIG = window.RACING_LAGOON_CONFIG || {};
  const GAME_ID = String(CONFIG.gameId || 992038).replace(/[^a-zA-Z0-9]/g, '');
  const LOBBY_HUB_PEER_ID = `rl-${GAME_ID}-lobby-hub`;
  const LOCAL_STORAGE_KEY = `rl_netplay_rooms_${GAME_ID}`;
  const CHUNK_SIZE = 16384; // 16 KB safe WebRTC DataChannel chunk size
  const ROOM_TTL_MS = 90 * 1000; // 90s TTL

  const ICE_SERVERS = CONFIG.iceServers || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  // Capture original fetch before installing interceptor
  const originalFetch = window.fetch.bind(window);

  // =========================================================================
  // 1. PEERJS LOADER & SHARED DISCOVERY CLIENT
  // =========================================================================
  let peerJsReadyPromise = null;
  function ensurePeerJS() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (peerJsReadyPromise) return peerJsReadyPromise;

    peerJsReadyPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
      script.async = true;
      script.onload = () => resolve(window.Peer);
      script.onerror = (err) => reject(err);
      document.head.appendChild(script);
    });
    return peerJsReadyPromise;
  }

  let sharedDiscoveryPeer = null;
  let sharedDiscoveryPeerPromise = null;

  async function getDiscoveryPeer() {
    if (sharedDiscoveryPeer && !sharedDiscoveryPeer.destroyed && !sharedDiscoveryPeer.disconnected && sharedDiscoveryPeer.open) {
      return sharedDiscoveryPeer;
    }
    if (sharedDiscoveryPeerPromise) return sharedDiscoveryPeerPromise;

    sharedDiscoveryPeerPromise = (async () => {
      const PeerClass = await ensurePeerJS();
      return new Promise((resolve, reject) => {
        const peer = new PeerClass({ config: { iceServers: ICE_SERVERS } });
        const timer = setTimeout(() => {
          sharedDiscoveryPeerPromise = null;
          reject(new Error('Discovery peer timeout'));
        }, 4000);

        peer.on('open', () => {
          clearTimeout(timer);
          sharedDiscoveryPeer = peer;
          sharedDiscoveryPeerPromise = null;
          resolve(peer);
        });
        peer.on('error', (err) => {
          // Note: 'peer-unavailable' is emitted on the peer when connecting to a non-existent target,
          // which does NOT destroy the discovery peer itself.
          if (!peer.open) {
            clearTimeout(timer);
            sharedDiscoveryPeerPromise = null;
            reject(err);
          }
        });
        peer.on('close', () => {
          sharedDiscoveryPeer = null;
          sharedDiscoveryPeerPromise = null;
        });
      });
    })();

    return sharedDiscoveryPeerPromise;
  }

  // Preload PeerJS and warm up the discovery peer immediately
  ensurePeerJS().then(() => getDiscoveryPeer()).catch(() => {});

  function toRoomPeerId(sessionId) {
    return `rl-${GAME_ID}-room-` + String(sessionId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  }

  // =========================================================================
  // 2. SELF-ELECTING LOBBY HUB + LOCAL STORAGE + URL INVITE REGISTRY (/list)
  // =========================================================================
  const memoryRooms = {};
  const hubRegistry = {}; // Used when this browser tab is acting as the elected Lobby Hub
  let lobbyHubPeer = null;
  let lobbyHubClientConn = null;

  // Check if URL has a direct room invite (?room=<sessionId>&roomName=<name>)
  try {
    const params = new URLSearchParams(window.location.search);
    const invitedRoomId = params.get('room');
    const invitedRoomName = params.get('roomName') || 'Yokohama Warriors Battle';
    if (invitedRoomId) {
      memoryRooms[invitedRoomId] = {
        room_name: invitedRoomName,
        current: 1,
        max: 2,
        player_name: 'Anfitrión',
        hasPassword: false,
        ts: Date.now()
      };
    }
  } catch (e) {}

  function getLocalStoredRooms() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const now = Date.now();
      let changed = false;
      for (const sid of Object.keys(parsed)) {
        if (!parsed[sid] || now - (parsed[sid].ts || 0) > ROOM_TTL_MS) {
          delete parsed[sid];
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
      }
      return parsed;
    } catch (e) {
      return {};
    }
  }

  function saveLocalRoom(sessionId, roomInfo) {
    try {
      const all = getLocalStoredRooms();
      if (roomInfo === null) {
        delete all[sessionId];
        delete memoryRooms[sessionId];
        delete hubRegistry[sessionId];
      } else {
        const entry = { ...roomInfo, ts: Date.now() };
        all[sessionId] = entry;
        memoryRooms[sessionId] = entry;
        hubRegistry[sessionId] = entry;
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function getActiveHubRoomsPayload() {
    const now = Date.now();
    const out = {};
    for (const [sid, r] of Object.entries(hubRegistry)) {
      if (r && now - (r.ts || now) <= ROOM_TTL_MS && (r.current || 1) < (r.max || 2)) {
        out[sid] = {
          room_name: r.room_name,
          current: r.current || 1,
          max: r.max || 2,
          player_name: r.player_name || 'Piloto',
          hasPassword: !!r.hasPassword
        };
      }
    }
    return out;
  }

  /**
   * Ensures this host either claims the deterministic `LOBBY_HUB_PEER_ID` on PeerJS Cloud
   * OR registers its room with whoever currently owns `LOBBY_HUB_PEER_ID`.
   */
  async function publishRoomToLobbyHub(sessionId, roomMeta) {
    if (roomMeta === null) {
      delete hubRegistry[sessionId];
      if (lobbyHubClientConn && lobbyHubClientConn.open) {
        try {
          lobbyHubClientConn.send({ type: 'unregister-room', sessionid: sessionId });
        } catch (e) {}
      }
      // If we are the hub and have no more rooms, destroy hub peer so another host can claim it
      if (lobbyHubPeer && Object.keys(hubRegistry).length === 0) {
        try {
          lobbyHubPeer.destroy();
        } catch (e) {}
        lobbyHubPeer = null;
      }
      return;
    }

    hubRegistry[sessionId] = { ...roomMeta, ts: Date.now() };

    // If we already own the Lobby Hub peer, hubRegistry is already up to date!
    if (lobbyHubPeer && !lobbyHubPeer.destroyed && lobbyHubPeer.open) {
      return;
    }

    try {
      const PeerClass = await ensurePeerJS();
      await new Promise((resolve) => {
        const candidateHub = new PeerClass(LOBBY_HUB_PEER_ID, {
          config: { iceServers: ICE_SERVERS }
        });

        const timeout = setTimeout(() => resolve(), 3000);

        candidateHub.on('open', () => {
          clearTimeout(timeout);
          lobbyHubPeer = candidateHub;

          candidateHub.on('connection', (conn) => {
            conn.on('open', () => {
              // Immediately push current open rooms to any querying peer!
              conn.send({
                type: 'rooms-list',
                rooms: getActiveHubRoomsPayload()
              });
            });
            conn.on('data', (msg) => {
              const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
              if (!data) return;
              if (data.type === 'register-room' && data.sessionid && data.roomMeta) {
                hubRegistry[data.sessionid] = { ...data.roomMeta, ts: Date.now() };
              } else if (data.type === 'unregister-room' && data.sessionid) {
                delete hubRegistry[data.sessionid];
              } else if (data.type === 'list-rooms') {
                conn.send({
                  type: 'rooms-list',
                  rooms: getActiveHubRoomsPayload()
                });
              }
            });
          });

          resolve();
        });

        candidateHub.on('error', async (err) => {
          clearTimeout(timeout);
          try {
            candidateHub.destroy();
          } catch (e) {}

          // Another host already owns LOBBY_HUB_PEER_ID -> register our room with them!
          if (err && err.type === 'unavailable-id') {
            try {
              const discPeer = await getDiscoveryPeer();
              const conn = discPeer.connect(LOBBY_HUB_PEER_ID, { reliable: true });
              lobbyHubClientConn = conn;
              conn.on('open', () => {
                conn.send({
                  type: 'register-room',
                  sessionid: sessionId,
                  roomMeta
                });
                resolve();
              });
              setTimeout(resolve, 1500);
            } catch (e) {
              resolve();
            }
          } else {
            resolve();
          }
        });
      });
    } catch (e) {}
  }

  /**
   * Queries open rooms from:
   * 1. Local storage / same-PC rooms / URL invite parameter (?room=...)
   * 2. Global PeerJS Lobby Hub (`LOBBY_HUB_PEER_ID`)
   */
  async function fetchGlobalLobbyRooms() {
    const now = Date.now();
    const combined = { ...getLocalStoredRooms(), ...memoryRooms, ...getActiveHubRoomsPayload() };

    // If this tab is NOT the lobby hub, query the remote Lobby Hub via PeerJS
    if (!lobbyHubPeer || !lobbyHubPeer.open) {
      try {
        const discPeer = await getDiscoveryPeer();
        const remoteRooms = await new Promise((resolve) => {
          let settled = false;
          const finish = (roomsObj) => {
            if (settled) return;
            settled = true;
            resolve(roomsObj || {});
          };

          const timer = setTimeout(() => finish({}), 2200);

          // Listen for 'peer-unavailable' which fires in ~50ms if no host has created a room yet
          const onPeerError = (err) => {
            if (err && err.type === 'peer-unavailable') {
              clearTimeout(timer);
              discPeer.off('error', onPeerError);
              finish({});
            }
          };
          discPeer.on('error', onPeerError);

          const conn = discPeer.connect(LOBBY_HUB_PEER_ID, { reliable: true });
          conn.on('open', () => {
            conn.send({ type: 'list-rooms' });
          });
          conn.on('data', (msg) => {
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            if (data && data.type === 'rooms-list' && data.rooms) {
              clearTimeout(timer);
              discPeer.off('error', onPeerError);
              try {
                conn.close();
              } catch (e) {}
              finish(data.rooms);
            }
          });
          conn.on('error', () => {
            clearTimeout(timer);
            discPeer.off('error', onPeerError);
            finish({});
          });
        });

        for (const [sid, r] of Object.entries(remoteRooms)) {
          combined[sid] = { ...r, ts: now };
        }
      } catch (e) {}
    }

    const result = {};
    for (const [sid, r] of Object.entries(combined)) {
      if (r && now - (r.ts || now) <= ROOM_TTL_MS && (r.current || 1) < (r.max || 2)) {
        result[sid] = {
          room_name: r.room_name || 'Yokohama Room',
          current: r.current || 1,
          max: r.max || 2,
          player_name: r.player_name || 'Piloto',
          hasPassword: !!r.hasPassword
        };
      }
    }
    return result;
  }

  // Intercept window.fetch for EmulatorJS's `/list?domain=...&game_id=...`
  window.fetch = async function (input, init) {
    const urlStr = typeof input === 'string' ? input : (input && input.url) || '';
    if (urlStr.includes('/list?') && urlStr.includes('game_id=')) {
      const openRooms = await fetchGlobalLobbyRooms();
      return new Response(JSON.stringify(openRooms), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch(input, init);
  };

  // =========================================================================
  // 3. BINARY SAVE-STATE CHUNKING & COMPRESSION HELPERS
  // =========================================================================
  function uint8ToBase64(u8) {
    let binary = '';
    const len = u8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(u8[i]);
    }
    return btoa(binary);
  }

  function base64ToUint8(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      u8[i] = binary.charCodeAt(i);
    }
    return u8;
  }

  async function compressBytes(u8) {
    if (typeof CompressionStream === 'undefined') {
      return { bytes: u8, compressed: false };
    }
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(u8);
      writer.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      return { bytes: new Uint8Array(buf), compressed: true };
    } catch (e) {
      return { bytes: u8, compressed: false };
    }
  }

  async function decompressBytes(u8, compressed) {
    if (!compressed || typeof DecompressionStream === 'undefined') {
      return u8;
    }
    try {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(u8);
      writer.close();
      const buf = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      return u8;
    }
  }

  // =========================================================================
  // 4. P2P SOCKET.IO ADAPTER (BroadcastChannel + PeerJS WebRTC DataChannel)
  // =========================================================================
  class RLNetplaySocket {
    constructor(url) {
      this.url = url;
      this.id = 'peer_' + Math.random().toString(36).slice(2, 10);
      this.listeners = {};
      this.connected = false;
      this.isOwner = false;
      this.sessionId = null;
      this.playerId = null;
      this.roomMeta = null;
      this.players = {};
      this.peer = null;
      this.peerConns = new Map(); // peerId -> DataConnection
      this.bc = null;
      this.heartbeatTimer = null;
      this.incomingTransfers = new Map();
      this.seenMsgIds = new Set();

      // Trigger Socket.IO 'connect' asynchronously so EmulatorJS registers its .on('connect') first
      setTimeout(() => {
        this.connected = true;
        this._trigger('connect');
      }, 15);
    }

    on(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
      if (event === 'connect' && this.connected) {
        setTimeout(() => fn(), 0);
      }
      return this;
    }

    off(event, fn) {
      if (!this.listeners[event]) return this;
      if (!fn) {
        delete this.listeners[event];
      } else {
        this.listeners[event] = this.listeners[event].filter((l) => l !== fn);
      }
      return this;
    }

    _trigger(event, ...args) {
      const list = this.listeners[event] || [];
      for (const fn of list) {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[Netplay P2P] Error in ${event} handler:`, err);
        }
      }
    }

    emit(event, data, callback) {
      if (event === 'open-room') {
        this._handleOpenRoom(data, callback);
      } else if (event === 'join-room') {
        this._handleJoinRoom(data, callback);
      } else if (event === 'data-message') {
        this._handleOutgoingDataMessage(data);
      } else if (event === 'leave-room') {
        this.disconnect();
      }
    }

    // -----------------------------------------------------------------------
    // HOST: Open a room
    // -----------------------------------------------------------------------
    async _handleOpenRoom(data, callback) {
      const extra = (data && data.extra) || {};
      const sessionId = extra.sessionid;
      const playerId = extra.userid || extra.playerId;
      const roomName = extra.room_name || 'Yokohama Room';
      const playerName = extra.player_name || 'Piloto 1';
      const maxPlayers = (data && data.maxPlayers) || 2;
      const password = (data && data.password) || '';

      if (!sessionId || !playerId) {
        if (typeof callback === 'function') callback('Invalid room parameters');
        return;
      }

      this.isOwner = true;
      this.sessionId = sessionId;
      this.playerId = playerId;
      this.players = {
        [playerId]: { ...extra, socketId: this.id }
      };
      this.roomMeta = {
        sessionid: sessionId,
        room_name: roomName,
        player_name: playerName,
        current: 1,
        max: maxPlayers,
        hasPassword: !!password,
        password: password
      };

      // 1. Setup local BroadcastChannel for instant same-machine multiplayer
      this._setupBroadcastChannel(sessionId);

      // 2. Setup PeerJS WebRTC Host with deterministic ID `rl-<gameId>-room-<sessionid>`
      try {
        const PeerClass = await Promise.race([
          ensurePeerJS(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('PeerJS timeout')), 4000))
        ]);
        await new Promise((resolve) => {
          const hostPeerId = toRoomPeerId(sessionId);
          const peer = new PeerClass(hostPeerId, {
            config: { iceServers: ICE_SERVERS }
          });
          this.peer = peer;
          const timer = setTimeout(() => resolve(), 2500);

          peer.on('open', () => {
            clearTimeout(timer);
            resolve();
          });
          peer.on('connection', (conn) => {
            this._attachPeerConnection(conn);
          });
          peer.on('error', (err) => {
            console.warn('[Netplay P2P] PeerJS Host notice:', err);
            clearTimeout(timer);
            resolve();
          });
        });
      } catch (e) {
        console.warn('[Netplay P2P] Continuing with BroadcastChannel transport:', e);
      }

      // 3. Save room locally & publish to global PeerJS Lobby Hub
      saveLocalRoom(sessionId, this.roomMeta);
      publishRoomToLobbyHub(sessionId, this.roomMeta);

      // Keep room alive in Lobby Hub & localStorage every 25s
      this.heartbeatTimer = setInterval(() => {
        if (!this.connected || !this.isOwner) return;
        const currentCount = Object.keys(this.players).length;
        this.roomMeta.current = currentCount;
        saveLocalRoom(sessionId, this.roomMeta);
        publishRoomToLobbyHub(sessionId, this.roomMeta);
      }, 25000);

      // Update share URL with room info for convenience
      window.RL_ACTIVE_ROOM = { sessionId, roomName };

      // 4. Complete open-room callback FIRST (sets emulator.netplay.owner = true)
      if (typeof callback === 'function') {
        callback(null);
      }

      // 5. Notify EmulatorJS of initial player list
      setTimeout(() => {
        this._trigger('users-updated', { ...this.players });
      }, 30);
    }

    // -----------------------------------------------------------------------
    // CLIENT: Join an existing room
    // -----------------------------------------------------------------------
    async _handleJoinRoom(data, callback) {
      const extra = (data && data.extra) || {};
      const sessionId = extra.sessionid;
      const playerId = extra.userid || extra.playerId;
      const password = (data && data.password) || '';

      if (!sessionId || !playerId) {
        if (typeof callback === 'function') callback('Invalid join parameters');
        return;
      }

      this.isOwner = false;
      this.sessionId = sessionId;
      this.playerId = playerId;
      this.players = {
        [playerId]: { ...extra, socketId: this.id }
      };

      let joinResolved = false;
      const finishJoin = (err, users) => {
        if (joinResolved) return;
        joinResolved = true;
        if (err) {
          if (typeof callback === 'function') callback(err);
          return;
        }
        this.players = users;
        if (typeof callback === 'function') callback(null, users);
        setTimeout(() => {
          this._trigger('users-updated', { ...this.players });
        }, 50);
      };

      this._pendingJoinFinish = finishJoin;

      // 1. Setup BroadcastChannel (instant join if on same PC)
      this._setupBroadcastChannel(sessionId);
      if (this.bc) {
        try {
          this.bc.postMessage({
            type: 'join-request',
            senderId: this.id,
            msgId: `${this.id}_bc_join_${Date.now()}`,
            extra: { ...extra, socketId: this.id },
            password
          });
        } catch (e) {}
      }

      // 2. Connect via PeerJS WebRTC DataChannel to Host (`rl-<gameId>-room-<sessionid>`)
      try {
        const PeerClass = await Promise.race([
          ensurePeerJS(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('PeerJS timeout')), 3500))
        ]);
        const peer = new PeerClass({
          config: { iceServers: ICE_SERVERS }
        });
        this.peer = peer;
        peer.on('open', () => {
          const hostPeerId = toRoomPeerId(sessionId);
          const conn = peer.connect(hostPeerId, { reliable: true });
          this._attachPeerConnection(conn, () => {
            this._sendEnvelope({
              type: 'join-request',
              extra: { ...extra, socketId: this.id },
              password
            });
          });
        });
      } catch (e) {
        console.warn('[Netplay P2P] PeerJS client fallback:', e);
      }

      setTimeout(() => {
        if (!joinResolved) {
          finishJoin('No se pudo conectar con el anfitrión de la sala.');
        }
      }, 8000);
    }

    // -----------------------------------------------------------------------
    // TRANSPORTS: BroadcastChannel & PeerJS WebRTC DataChannels
    // -----------------------------------------------------------------------
    _setupBroadcastChannel(sessionId) {
      if (typeof BroadcastChannel === 'undefined') return;
      try {
        this.bc = new BroadcastChannel(`rl_netplay_room_${sessionId}`);
        this.bc.onmessage = (ev) => {
          if (ev && ev.data) this._onEnvelopeReceived(ev.data);
        };
      } catch (e) {}
    }

    _attachPeerConnection(conn, onOpenCallback) {
      if (!conn) return;
      conn.on('open', () => {
        this.peerConns.set(conn.peer, conn);
        if (typeof onOpenCallback === 'function') onOpenCallback();
      });
      conn.on('data', (data) => {
        const env = typeof data === 'string' ? JSON.parse(data) : data;
        this._onEnvelopeReceived(env, conn);
      });
      conn.on('close', () => {
        this.peerConns.delete(conn.peer);
        if (this.isOwner) {
          let removed = false;
          for (const [pid, pinfo] of Object.entries(this.players)) {
            if (pinfo.peerId === conn.peer && pid !== this.playerId) {
              delete this.players[pid];
              removed = true;
            }
          }
          if (removed) {
            this.roomMeta.current = Object.keys(this.players).length;
            saveLocalRoom(this.sessionId, this.roomMeta);
            publishRoomToLobbyHub(this.sessionId, this.roomMeta);
            this._broadcastUsersUpdated();
          }
        }
      });
    }

    _sendEnvelope(envelope) {
      const msg = {
        ...envelope,
        senderId: this.id,
        msgId: envelope.msgId || `${this.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      };
      this.seenMsgIds.add(msg.msgId);

      // 1. Send over BroadcastChannel (same PC)
      if (this.bc) {
        try {
          this.bc.postMessage(msg);
        } catch (e) {}
      }

      // 2. Send over all active WebRTC DataConnections
      for (const conn of this.peerConns.values()) {
        if (conn && conn.open) {
          try {
            conn.send(msg);
          } catch (e) {}
        }
      }
    }

    _onEnvelopeReceived(env, sourceConn) {
      if (!env || env.senderId === this.id) return;
      if (env.msgId) {
        if (this.seenMsgIds.has(env.msgId)) return;
        this.seenMsgIds.add(env.msgId);
        if (this.seenMsgIds.size > 2000) {
          const first = this.seenMsgIds.values().next().value;
          this.seenMsgIds.delete(first);
        }
      }

      if (env.type === 'join-request' && this.isOwner) {
        const guestExtra = env.extra || {};
        const guestId = guestExtra.userid || guestExtra.playerId;
        if (!guestId) return;

        if (this.roomMeta.password && this.roomMeta.password !== (env.password || '')) {
          this._sendEnvelope({
            type: 'join-ack',
            targetId: env.senderId,
            error: 'Contraseña incorrecta'
          });
          return;
        }

        const currentIds = Object.keys(this.players);
        if (!this.players[guestId] && currentIds.length >= (this.roomMeta.max || 2)) {
          this._sendEnvelope({
            type: 'join-ack',
            targetId: env.senderId,
            error: 'La sala está llena'
          });
          return;
        }

        this.players[guestId] = {
          ...guestExtra,
          socketId: env.senderId,
          peerId: sourceConn ? sourceConn.peer : null
        };

        // Update room count in lobby
        this.roomMeta.current = Object.keys(this.players).length;
        saveLocalRoom(this.sessionId, this.roomMeta);
        publishRoomToLobbyHub(this.sessionId, this.roomMeta);

        // Acknowledge join to guest
        this._sendEnvelope({
          type: 'join-ack',
          targetId: env.senderId,
          users: this.players
        });

        // Give guest 150ms to enter roomJoined state, then broadcast users-updated and trigger sync()
        setTimeout(() => {
          this._broadcastUsersUpdated();
        }, 150);
      } else if (env.type === 'join-ack' && !this.isOwner) {
        if (env.targetId && env.targetId !== this.id) return;
        if (this._pendingJoinFinish) {
          this._pendingJoinFinish(env.error || null, env.users || {});
        }
      } else if (env.type === 'users-updated' && !this.isOwner) {
        if (env.users) {
          this.players = env.users;
          this._trigger('users-updated', { ...this.players });
        }
      } else if (env.type === 'peer-leave') {
        if (this.isOwner && env.playerId && this.players[env.playerId]) {
          delete this.players[env.playerId];
          this.roomMeta.current = Object.keys(this.players).length;
          saveLocalRoom(this.sessionId, this.roomMeta);
          publishRoomToLobbyHub(this.sessionId, this.roomMeta);
          this._broadcastUsersUpdated();
        } else if (!this.isOwner && env.isOwnerLeaving) {
          this._trigger('disconnect');
        }
      } else if (env.type === 'data-message') {
        this._trigger('data-message', env.data);
      } else if (env.type === 'state-start') {
        this.incomingTransfers.set(env.transferId, {
          totalChunks: env.totalChunks,
          compressed: env.compressed,
          chunks: new Array(env.totalChunks),
          received: 0
        });
      } else if (env.type === 'state-chunk') {
        const transfer = this.incomingTransfers.get(env.transferId);
        if (!transfer) return;
        if (transfer.chunks[env.index] === undefined) {
          transfer.chunks[env.index] = env.chunkB64;
          transfer.received++;
        }
        if (transfer.received === transfer.totalChunks) {
          this.incomingTransfers.delete(env.transferId);
          this._reassembleStateAndEmit(transfer);
        }
      }
    }

    async _reassembleStateAndEmit(transfer) {
      try {
        const parts = transfer.chunks.map((b64) => base64ToUint8(b64));
        const totalLen = parts.reduce((acc, p) => acc + p.byteLength, 0);
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const p of parts) {
          combined.set(p, offset);
          offset += p.byteLength;
        }
        const decompressed = await decompressBytes(combined, transfer.compressed);
        this._trigger('data-message', { state: decompressed.buffer });
      } catch (err) {
        console.error('[Netplay P2P] Failed to reassemble state:', err);
      }
    }

    _broadcastUsersUpdated() {
      this._sendEnvelope({
        type: 'users-updated',
        users: this.players
      });
      this._trigger('users-updated', { ...this.players });
    }

    async _handleOutgoingDataMessage(data) {
      if (!data) return;

      // Special handling for large binary PS1 save states (`data.state`)
      if (data.state && (data.state instanceof Uint8Array || data.state instanceof ArrayBuffer || ArrayBuffer.isView(data.state))) {
        const rawBytes =
          data.state instanceof Uint8Array
            ? data.state
            : data.state instanceof ArrayBuffer
            ? new Uint8Array(data.state)
            : new Uint8Array(data.state.buffer, data.state.byteOffset, data.state.byteLength);

        // If on same PC with BroadcastChannel, BroadcastChannel can clone ArrayBuffer directly!
        if (this.bc) {
          try {
            this.bc.postMessage({
              type: 'data-message',
              senderId: this.id,
              msgId: `${this.id}_state_${Date.now()}`,
              data: { state: rawBytes.buffer }
            });
          } catch (e) {}
        }

        // For WebRTC DataChannels, compress + chunk into 16 KB slices so RTCDataChannel never overflows maxMessageSize
        if (this.peerConns.size > 0) {
          const { bytes, compressed } = await compressBytes(rawBytes);
          const totalChunks = Math.ceil(bytes.byteLength / CHUNK_SIZE);
          const transferId = `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          const startMsg = {
            type: 'state-start',
            senderId: this.id,
            msgId: `${transferId}_start`,
            transferId,
            totalChunks,
            compressed
          };

          for (const conn of this.peerConns.values()) {
            if (conn && conn.open) conn.send(startMsg);
          }

          for (let i = 0; i < totalChunks; i++) {
            const slice = bytes.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const chunkMsg = {
              type: 'state-chunk',
              senderId: this.id,
              msgId: `${transferId}_${i}`,
              transferId,
              index: i,
              chunkB64: uint8ToBase64(slice)
            };
            for (const conn of this.peerConns.values()) {
              if (conn && conn.open) {
                const dc = conn.dataChannel;
                if (dc && dc.bufferedAmount > 262144) {
                  await new Promise((r) => setTimeout(r, 15));
                }
                conn.send(chunkMsg);
              }
            }
          }
        }
        return;
      }

      // Standard Netplay messages (sync-control, ready, readyready, play, pause, etc.)
      this._sendEnvelope({
        type: 'data-message',
        data
      });
    }

    disconnect() {
      if (!this.connected) return;
      this.connected = false;

      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      if (this.sessionId) {
        this._sendEnvelope({
          type: 'peer-leave',
          playerId: this.playerId,
          isOwnerLeaving: this.isOwner
        });

        if (this.isOwner) {
          saveLocalRoom(this.sessionId, null);
          publishRoomToLobbyHub(this.sessionId, null);
          window.RL_ACTIVE_ROOM = null;
        }
      }

      for (const conn of this.peerConns.values()) {
        try {
          conn.close();
        } catch (e) {}
      }
      this.peerConns.clear();

      if (this.peer) {
        try {
          this.peer.destroy();
        } catch (e) {}
        this.peer = null;
      }

      if (this.bc) {
        try {
          this.bc.close();
        } catch (e) {}
        this.bc = null;
      }
    }
  }

  // =========================================================================
  // 5. INSTALL GLOBAL `window.io` & EMULATORJS HOOKS
  // =========================================================================
  let activeSocket = null;

  function rlNetplayIo(url) {
    if (activeSocket && activeSocket.connected) {
      activeSocket.disconnect();
    }
    activeSocket = new RLNetplaySocket(url);
    return activeSocket;
  }

  // Clean up room if host closes the browser tab
  window.addEventListener('beforeunload', () => {
    if (activeSocket && activeSocket.connected) {
      activeSocket.disconnect();
    }
  });

  // Lock `window.io` so EmulatorJS's CDN `socket.io.min.js` cannot overwrite our serverless P2P engine
  try {
    Object.defineProperty(window, 'io', {
      configurable: true,
      enumerable: true,
      get() {
        return rlNetplayIo;
      },
      set(_ignored) {
        // Keep rlNetplayIo active even after EmulatorJS loads socket.io.min.js
      }
    });
  } catch (e) {
    window.io = rlNetplayIo;
  }

  window.RLNetplay = {
    getOpenRooms: fetchGlobalLobbyRooms,
    attachToEmulator(emulator) {
      if (!emulator || !emulator.netplay) return;
      emulator.netplay.getOpenRooms = fetchGlobalLobbyRooms;
    }
  };
})();
