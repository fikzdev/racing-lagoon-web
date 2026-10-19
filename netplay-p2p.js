/**
 * Racing Lagoon Web — Resilient Serverless Netplay Engine
 * Provides 100% reliable room discovery, joining, and real-time controller sync on Vercel
 * using WebSocket pub/sub (ntfy.sh) + BroadcastChannel + binary state attachments.
 */
(function () {
  'use strict';

  const CONFIG = window.RACING_LAGOON_CONFIG || {};
  const GAME_ID = String(CONFIG.gameId || 992038).replace(/[^a-zA-Z0-9]/g, '');
  const LOBBY_TOPIC = `rl_lobby_${GAME_ID}`;
  const NTFY_BASE = 'https://ntfy.sh';
  const NTFY_WS_BASE = 'wss://ntfy.sh';
  const ROOM_TTL_MS = 60 * 1000;

  // Guest control mode: false = Controller 2 (Versus / 2 Warriors Battle), true = Controller 1 (Shared Menu)
  window.RL_GUEST_SHARED_P1 = false;

  const originalFetch = window.fetch.bind(window);

  // =========================================================================
  // 1. GLOBAL LOBBY DISCOVERY SYSTEM
  // =========================================================================
  const liveRooms = {};
  const inviteRooms = {};

  // Check URL query parameters for direct room invite: ?room=<sessionId>&roomName=<name>
  try {
    const params = new URLSearchParams(window.location.search);
    const invitedRoomId = params.get('room');
    const invitedRoomName = params.get('roomName') || 'Yokohama Warriors Battle';
    if (invitedRoomId) {
      inviteRooms[invitedRoomId] = {
        room_name: invitedRoomName,
        current: 1,
        max: 2,
        player_name: 'Anfitrión',
        hasPassword: false,
        ts: Date.now() + 600000 // 10 min TTL for invite links
      };
    }
  } catch (e) {}

  let lobbyWs = null;
  let lobbyOpenPromise = null;

  function ensureLobbyWebSocket() {
    if (lobbyWs && (lobbyWs.readyState === WebSocket.OPEN || lobbyWs.readyState === WebSocket.CONNECTING)) {
      return lobbyOpenPromise;
    }
    lobbyOpenPromise = new Promise((resolve) => {
      try {
        lobbyWs = new WebSocket(`${NTFY_WS_BASE}/${LOBBY_TOPIC}/ws`);
        lobbyWs.onopen = () => {
          resolve();
        };
        lobbyWs.onmessage = (event) => {
          try {
            const wrapper = JSON.parse(event.data);
            if (wrapper.event === 'message' && wrapper.message) {
              const data = JSON.parse(wrapper.message);
              if (data.type === 'announce' && data.room && data.sessionid) {
                liveRooms[data.sessionid] = {
                  room_name: data.room.room_name || 'Yokohama Room',
                  current: data.room.current || 1,
                  max: data.room.max || 2,
                  player_name: data.room.player_name || 'Piloto',
                  hasPassword: !!data.room.hasPassword,
                  ts: Date.now()
                };
              } else if (data.type === 'close' && data.sessionid) {
                delete liveRooms[data.sessionid];
              } else if (data.type === 'discover') {
                if (window.RL_CURRENT_HOST_ROOM) {
                  publishLobbyMessage({
                    type: 'announce',
                    sessionid: window.RL_CURRENT_HOST_ROOM.sessionid,
                    room: window.RL_CURRENT_HOST_ROOM
                  });
                }
              }
            }
          } catch (e) {}
        };
        lobbyWs.onerror = () => resolve();
        lobbyWs.onclose = () => {
          lobbyWs = null;
          lobbyOpenPromise = null;
          setTimeout(ensureLobbyWebSocket, 3000);
        };
      } catch (e) {
        resolve();
      }
    });
    return lobbyOpenPromise;
  }

  ensureLobbyWebSocket();

  async function publishLobbyMessage(payload) {
    try {
      await originalFetch(`${NTFY_BASE}/${LOBBY_TOPIC}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
    } catch (e) {}
  }

  async function fetchGlobalLobbyRooms() {
    // Ensure WebSocket is open before pinging
    try {
      await Promise.race([
        ensureLobbyWebSocket(),
        new Promise((r) => setTimeout(r, 600))
      ]);
    } catch (e) {}

    // Broadcast discover ping to all online hosts
    publishLobbyMessage({ type: 'discover' });

    // Give online hosts up to 500ms to answer if we don't have rooms yet
    if (Object.keys(liveRooms).length === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }

    const now = Date.now();
    const result = {};

    // 1. Add direct invite rooms
    for (const [sid, r] of Object.entries(inviteRooms)) {
      if (r && now - (r.ts || now) <= ROOM_TTL_MS + 600000) {
        result[sid] = {
          room_name: r.room_name,
          current: r.current || 1,
          max: r.max || 2,
          player_name: r.player_name || 'Piloto',
          hasPassword: !!r.hasPassword
        };
      }
    }

    // 2. Add live announced rooms
    for (const [sid, r] of Object.entries(liveRooms)) {
      if (r && now - (r.ts || now) <= ROOM_TTL_MS && (r.current || 1) < (r.max || 2)) {
        result[sid] = {
          room_name: r.room_name,
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
  // 2. EMULATORJS NETPLAY CONTROLS & CANVAS FOCUS PATCH
  // =========================================================================
  function focusEmulatorCanvas(emu, closeNetplayModal = false) {
    try {
      if (closeNetplayModal && emu && emu.netplayMenu) {
        emu.netplayMenu.style.display = 'none';
      }
      if (emu && emu.elements && emu.elements.parent) {
        emu.elements.parent.focus();
      }
    } catch (e) {}
  }

  function patchNetplayInstance(emu) {
    if (!emu || !emu.netplay) return;

    emu.netplay.getOpenRooms = fetchGlobalLobbyRooms;

    if (!emu.netplay.simulateInput || emu.netplay._rlInputPatched) return;
    emu.netplay._rlInputPatched = true;

    // Reset frame counters cleanly without freezing
    emu.netplay.reset = () => {
      try {
        emu.netplay.init_frame =
          emu.gameManager && typeof emu.gameManager.getFrameNum === 'function'
            ? parseInt(emu.gameManager.getFrameNum()) || 0
            : 0;
      } catch (e) {
        emu.netplay.init_frame = 0;
      }
      emu.netplay.currentFrame = 0;
      emu.netplay.inputsData = {};
      emu.netplay.syncing = false;
      emu.netplay.wait = false;
    };

    // Remove broken lockstep postMainLoop that paused the guest on missing frame numbers
    if (emu.Module) {
      emu.Module.postMainLoop = () => {
        if (!emu.isNetplay) return;
        try {
          emu.netplay.currentFrame =
            parseInt(emu.gameManager.getFrameNum()) - (emu.netplay.init_frame || 0);
        } catch (e) {}
      };
    }

    // Auto-close Netplay modal and focus canvas when entering room
    if (typeof emu.netplay.roomJoined === 'function' && !emu.netplay._rlRoomJoinedWrapped) {
      emu.netplay._rlRoomJoinedWrapped = true;
      const origRoomJoined = emu.netplay.roomJoined.bind(emu.netplay);
      emu.netplay.roomJoined = function (isOwner, roomName, password, roomId) {
        origRoomJoined(isOwner, roomName, password, roomId);
        setTimeout(() => focusEmulatorCanvas(emu, !isOwner), 200);
      };
    }

    // Synchronize emulator state
    let isSyncing = false;
    emu.netplay.sync = async () => {
      if (isSyncing) return;
      if (!emu.netplay.owner) {
        emu.netplay.sendMessage({ sync: true });
        return;
      }
      isSyncing = true;
      try {
        emu.netplay.ready = 0;
        const state = emu.gameManager.getState();
        emu.netplay.sendMessage({ state: state });
        emu.netplay.setLoading(true);
        emu.pause(true);
        emu.netplay.ready++;
        emu.netplay.currentFrame = 0;
        if (emu.netplay.ready >= emu.netplay.getUserCount()) {
          emu.play(true);
          emu.netplay.setLoading(false);
          focusEmulatorCanvas(emu, false);
        } else {
          setTimeout(() => {
            if (emu.paused && emu.isNetplay) {
              emu.netplay.setLoading(false);
              emu.play(true);
              focusEmulatorCanvas(emu, true);
            }
          }, 3500);
        }
      } catch (e) {
        console.warn('[Netplay] Sync error:', e);
        emu.play(true);
      }
      isSyncing = false;
    };

    // Real-time button inputs for both Host and Guest
    emu.netplay.simulateInput = (player, index, value, resp) => {
      if (!emu.isNetplay) return;
      if (player !== 0 && player !== 1 && !resp) return;

      let targetPort;
      if (emu.netplay.owner) {
        targetPort = player === 1 ? 1 : 0;
      } else {
        // Guest defaults to Port 1 (Piloto 2 in 2 Warriors Battle), or Port 0 if shared menu mode is toggled
        targetPort = window.RL_GUEST_SHARED_P1 ? 0 : 1;
      }

      // Execute locally on WASM PS1 core immediately
      if (emu.gameManager && emu.gameManager.functions && emu.gameManager.functions.simulateInput) {
        emu.gameManager.functions.simulateInput(targetPort, index, value);
      }

      // Send to peer immediately
      emu.netplay.sendMessage({
        'direct-input': [targetPort, index, value]
      });
    };

    // Incoming messages
    emu.netplay.dataMessage = (data) => {
      if (!data) return;

      if (data['direct-input']) {
        const [port, index, value] = data['direct-input'];
        if (emu.gameManager && emu.gameManager.functions && emu.gameManager.functions.simulateInput) {
          emu.gameManager.functions.simulateInput(port, index, value);
        }
        return;
      }

      if (data.sync === true && emu.netplay.owner) {
        emu.netplay.sync();
        return;
      }

      if (data.state) {
        emu.netplay.wait = false;
        emu.netplay.syncing = false;
        emu.netplay.setLoading(true);
        emu.pause(true);
        try {
          emu.gameManager.loadState(new Uint8Array(data.state));
        } catch (e) {
          console.error('[Netplay] loadState error:', e);
        }
        emu.netplay.sendMessage({ ready: true });
        setTimeout(() => {
          if (emu.isNetplay) {
            emu.netplay.setLoading(false);
            emu.netplay.reset();
            emu.play(true);
            focusEmulatorCanvas(emu, true);
          }
        }, 200);
        return;
      }

      if (data.ready && emu.netplay.owner) {
        emu.netplay.ready = (emu.netplay.ready || 1) + 1;
        if (emu.netplay.ready >= emu.netplay.getUserCount()) {
          emu.netplay.sendMessage({ readyready: true });
          emu.netplay.reset();
          emu.netplay.setLoading(false);
          setTimeout(() => {
            emu.play(true);
            focusEmulatorCanvas(emu, true);
          }, 40);
        }
        return;
      }

      if (data.readyready) {
        emu.netplay.setLoading(false);
        emu.netplay.reset();
        emu.play(true);
        focusEmulatorCanvas(emu, true);
        return;
      }

      if (data.play && !emu.netplay.owner) emu.play(true);
      if (data.pause && !emu.netplay.owner) emu.pause(true);
      if (data.restart) {
        emu.gameManager.restart();
        emu.netplay.reset();
        emu.play(true);
      }
    };
  }

  // Refocus emulator canvas on keydown if modal was closed
  window.addEventListener(
    'keydown',
    (e) => {
      const emu = window.EJS_emulator;
      if (!emu || !emu.started) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (emu.elements && emu.elements.parent && document.activeElement !== emu.elements.parent) {
        emu.elements.parent.focus();
        if (typeof emu.keyChange === 'function') {
          try {
            emu.keyChange(e);
          } catch (err) {}
        }
      }
    },
    true
  );

  // =========================================================================
  // 3. ROBUST ROOM SOCKET TRANSPORT (ntfy WebSocket + BroadcastChannel)
  // =========================================================================
  function toRoomTopic(sessionId) {
    return 'rl_rm_' + String(sessionId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 32);
  }

  class RLNetplaySocket {
    constructor(url) {
      this.url = url;
      this.id = 'sock_' + Math.random().toString(36).slice(2, 10);
      this.listeners = {};
      this.connected = false;
      this.isOwner = false;
      this.sessionId = null;
      this.playerId = null;
      this.roomMeta = null;
      this.players = {};
      this.bc = null;
      this.ws = null;
      this.heartbeatTimer = null;
      this.seenMsgIds = new Set();

      if (window.EJS_emulator) {
        patchNetplayInstance(window.EJS_emulator);
      }

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
          console.error(`[Netplay] Error in ${event} handler:`, err);
        }
      }
    }

    emit(event, data, callback) {
      if (window.EJS_emulator) {
        patchNetplayInstance(window.EJS_emulator);
      }
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

    _setupTransports(sessionId) {
      // 1. Same-PC instant BroadcastChannel
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          this.bc = new BroadcastChannel(`rl_room_bc_${sessionId}`);
          this.bc.onmessage = (ev) => {
            if (ev && ev.data) this._onEnvelopeReceived(ev.data);
          };
        } catch (e) {}
      }

      // 2. Global WebSocket room topic
      const topic = toRoomTopic(sessionId);
      try {
        this.ws = new WebSocket(`${NTFY_WS_BASE}/${topic}/ws`);
        this.ws.onmessage = async (event) => {
          try {
            const wrapper = JSON.parse(event.data);
            if (wrapper.event === 'message') {
              // Attachment (binary state upload)
              if (wrapper.attachment && wrapper.attachment.url) {
                try {
                  const res = await originalFetch(wrapper.attachment.url);
                  const arrayBuf = await res.arrayBuffer();
                  this._trigger('data-message', { state: arrayBuf });
                } catch (e) {
                  console.error('[Netplay] Error downloading state attachment:', e);
                }
                return;
              }
              if (wrapper.message) {
                const env = JSON.parse(wrapper.message);
                this._onEnvelopeReceived(env);
              }
            }
          } catch (e) {}
        };
      } catch (e) {}
    }

    _sendEnvelope(envelope) {
      const msg = {
        ...envelope,
        senderId: this.id,
        msgId: envelope.msgId || `${this.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      };
      this.seenMsgIds.add(msg.msgId);

      // Send on local BroadcastChannel
      if (this.bc) {
        try {
          this.bc.postMessage(msg);
        } catch (e) {}
      }

      // Send to room topic via HTTP POST
      if (this.sessionId) {
        const topic = toRoomTopic(this.sessionId);
        originalFetch(`${NTFY_BASE}/${topic}`, {
          method: 'POST',
          body: JSON.stringify(msg),
          cache: 'no-store'
        }).catch(() => {});
      }
    }

    _onEnvelopeReceived(env) {
      if (!env || env.senderId === this.id) return;
      if (env.msgId) {
        if (this.seenMsgIds.has(env.msgId)) return;
        this.seenMsgIds.add(env.msgId);
        if (this.seenMsgIds.size > 2000) {
          const first = this.seenMsgIds.values().next().value;
          this.seenMsgIds.delete(first);
        }
      }

      // Host receives join request
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
          socketId: env.senderId
        };

        this.roomMeta.current = Object.keys(this.players).length;

        // Acknowledge join to guest
        this._sendEnvelope({
          type: 'join-ack',
          targetId: env.senderId,
          users: this.players
        });

        // Broadcast users update
        setTimeout(() => {
          this._broadcastUsersUpdated();
        }, 120);
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
          this._broadcastUsersUpdated();
        } else if (!this.isOwner && env.isOwnerLeaving) {
          this._trigger('disconnect');
        }
      } else if (env.type === 'data-message') {
        this._trigger('data-message', env.data);
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

      // Binary PS1 Save-State upload
      if (data.state && (data.state instanceof Uint8Array || data.state instanceof ArrayBuffer || ArrayBuffer.isView(data.state))) {
        const rawBytes =
          data.state instanceof Uint8Array
            ? data.state
            : data.state instanceof ArrayBuffer
            ? new Uint8Array(data.state)
            : new Uint8Array(data.state.buffer, data.state.byteOffset, data.state.byteLength);

        // Send via local BroadcastChannel (instant for same-machine tabs)
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

        // Upload state file to room topic via HTTP PUT
        if (this.sessionId) {
          const topic = toRoomTopic(this.sessionId);
          try {
            originalFetch(`${NTFY_BASE}/${topic}`, {
              method: 'PUT',
              headers: { Filename: 'state.bin' },
              body: rawBytes
            }).catch(() => {});
          } catch (e) {}
        }
        return;
      }

      this._sendEnvelope({
        type: 'data-message',
        data
      });
    }

    async _handleOpenRoom(data, callback) {
      const extra = (data && data.extra) || {};
      const sessionId = extra.sessionid;
      const playerId = extra.userid || extra.playerId;
      const roomName = extra.room_name || 'Yokohama Room';
      const playerName = extra.player_name || 'Piloto 1';
      const maxPlayers = (data && data.maxPlayers) || 2;
      const password = (data && data.password) || '';

      if (!sessionId || !playerId) {
        if (typeof callback === 'function') callback('Parámetros de sala inválidos');
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

      this._setupTransports(sessionId);

      window.RL_CURRENT_HOST_ROOM = this.roomMeta;
      window.RL_ACTIVE_ROOM = { sessionId, roomName };

      // Announce room to global lobby
      publishLobbyMessage({
        type: 'announce',
        sessionid: sessionId,
        room: this.roomMeta
      });

      // Periodic heartbeat every 5s while waiting for player
      this.heartbeatTimer = setInterval(() => {
        if (!this.connected || !this.isOwner) return;
        this.roomMeta.current = Object.keys(this.players).length;
        window.RL_CURRENT_HOST_ROOM = this.roomMeta;
        publishLobbyMessage({
          type: 'announce',
          sessionid: sessionId,
          room: this.roomMeta
        });
      }, 5000);

      if (typeof callback === 'function') {
        callback(null);
      }

      setTimeout(() => {
        this._trigger('users-updated', { ...this.players });
      }, 30);
    }

    async _handleJoinRoom(data, callback) {
      const extra = (data && data.extra) || {};
      const sessionId = extra.sessionid;
      const playerId = extra.userid || extra.playerId;
      const password = (data && data.password) || '';

      if (!sessionId || !playerId) {
        if (typeof callback === 'function') callback('Parámetros de entrada inválidos');
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

      this._setupTransports(sessionId);

      // Send join-request immediately and retry after 800ms
      const sendJoinRequest = () => {
        if (joinResolved) return;
        this._sendEnvelope({
          type: 'join-request',
          extra: { ...extra, socketId: this.id },
          password
        });
      };

      // Wait 100ms for WebSocket connect before first attempt
      setTimeout(sendJoinRequest, 100);
      setTimeout(sendJoinRequest, 900);
      setTimeout(sendJoinRequest, 2000);

      setTimeout(() => {
        if (!joinResolved) {
          finishJoin('No se pudo conectar con el anfitrión de la sala (puede haberse cerrado).');
        }
      }, 7000);
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
          publishLobbyMessage({
            type: 'close',
            sessionid: this.sessionId
          });
          window.RL_CURRENT_HOST_ROOM = null;
          window.RL_ACTIVE_ROOM = null;
        }
      }

      if (this.bc) {
        try {
          this.bc.close();
        } catch (e) {}
        this.bc = null;
      }

      if (this.ws) {
        try {
          this.ws.close();
        } catch (e) {}
        this.ws = null;
      }
    }
  }

  // =========================================================================
  // 4. INSTALL GLOBAL `window.io` & EMULATORJS HOOKS
  // =========================================================================
  let activeSocket = null;

  function rlNetplayIo(url) {
    if (activeSocket && activeSocket.connected) {
      activeSocket.disconnect();
    }
    activeSocket = new RLNetplaySocket(url);
    return activeSocket;
  }

  window.addEventListener('beforeunload', () => {
    if (activeSocket && activeSocket.connected) {
      activeSocket.disconnect();
    }
  });

  try {
    Object.defineProperty(window, 'io', {
      configurable: true,
      enumerable: true,
      get() {
        return rlNetplayIo;
      },
      set(_ignored) {}
    });
  } catch (e) {
    window.io = rlNetplayIo;
  }

  window.RLNetplay = {
    getOpenRooms: fetchGlobalLobbyRooms,
    patchNetplayInstance,
    attachToEmulator(emulator) {
      if (!emulator) return;
      if (!emulator._rlDefineHooked && typeof emulator.defineNetplayFunctions === 'function') {
        emulator._rlDefineHooked = true;
        const origDefine = emulator.defineNetplayFunctions.bind(emulator);
        emulator.defineNetplayFunctions = function () {
          origDefine();
          patchNetplayInstance(emulator);
        };
      }
      patchNetplayInstance(emulator);
    }
  };
})();
