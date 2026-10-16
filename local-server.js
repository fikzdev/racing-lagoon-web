const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
  '.cue': 'text/plain; charset=UTF-8',
  '.chd': 'application/octet-stream',
  '.iso': 'application/octet-stream',
  '.pbp': 'application/octet-stream',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

// Rooms registry for EmulatorJS Netplay
const rooms = {};

// Clean up empty rooms every 60s
setInterval(() => {
  for (const sessionId in rooms) {
    if (!rooms[sessionId].players || Object.keys(rooms[sessionId].players).length === 0) {
      delete rooms[sessionId];
    }
  }
}, 60000);

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // EmulatorJS Netplay Room Listing API
  if (pathname === '/list') {
    const gameId = parsedUrl.searchParams.get('game_id');
    const openRooms = Object.keys(rooms)
      .filter((sessionId) => {
        const room = rooms[sessionId];
        return (
          room &&
          Object.keys(room.players).length < room.maxPlayers &&
          (!gameId || String(room.gameId) === String(gameId))
        );
      })
      .reduce((acc, sessionId) => {
        const room = rooms[sessionId];
        const ownerPlayerId = Object.keys(room.players).find(
          (playerId) => room.players[playerId].socketId === room.owner
        );
        const playerName = ownerPlayerId ? room.players[ownerPlayerId].player_name : 'Piloto Anónimo';
        acc[sessionId] = {
          room_name: room.roomName,
          current: Object.keys(room.players).length,
          max: room.maxPlayers,
          player_name: playerName,
          hasPassword: !!room.password,
        };
        return acc;
      }, {});

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(openRooms));
    return;
  }

  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Security check: prevent directory traversal
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Headers for WebAssembly performance & cross-origin safety
    const baseHeaders = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Accept-Ranges': 'bytes'
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, baseHeaders);
      res.end();
      return;
    }

    // Support HTTP Range requests (crucial for streaming large ROMs)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

      if (start >= stats.size || end >= stats.size) {
        res.writeHead(416, {
          ...baseHeaders,
          'Content-Range': `bytes */${stats.size}`
        });
        res.end();
        return;
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(safePath, { start, end });

      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Content-Length': chunkSize
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        ...baseHeaders,
        'Content-Length': stats.size
      });
      fs.createReadStream(safePath).pipe(res);
    }
  });
});

// Attach Socket.IO for real-time EmulatorJS Netplay
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  socket.on('open-room', (data, callback) => {
    let sessionId, playerId, roomName, gameId, maxPlayers, playerName;
    if (data.extra) {
      sessionId = data.extra.sessionid;
      playerId = data.extra.userid || data.extra.playerId;
      roomName = data.extra.room_name;
      gameId = data.extra.game_id;
      maxPlayers = data.maxPlayers || 2;
      playerName = data.extra.player_name || 'Piloto Anónimo';
    }
    if (!sessionId || !playerId) {
      if (typeof callback === 'function') callback('Invalid data: sessionId and playerId required');
      return;
    }
    if (rooms[sessionId]) {
      if (typeof callback === 'function') callback('Room already exists');
      return;
    }

    rooms[sessionId] = {
      owner: socket.id,
      players: { [playerId]: { ...data.extra, socketId: socket.id } },
      peers: [],
      roomName: roomName || `Sala ${sessionId.substring(0, 5)}`,
      gameId: gameId || '992038',
      password: data.password || null,
      maxPlayers: maxPlayers,
    };
    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.playerId = playerId;
    io.to(sessionId).emit('users-updated', rooms[sessionId].players);
    if (typeof callback === 'function') callback(null);
  });

  socket.on('join-room', (data, callback) => {
    const { sessionid: sessionId, userid: playerId } = data.extra || {};
    
    if (!sessionId || !playerId) {
      if (typeof callback === 'function') callback('Invalid data: sessionId and playerId required');
      return;
    }

    const room = rooms[sessionId];
    if (!room) {
      if (typeof callback === 'function') callback('Room not found');
      return;
    }

    const roomPassword = data.password || null;
    if (room.password && room.password !== roomPassword) {
      if (typeof callback === 'function') callback('Incorrect password');
      return;
    }
    
    if (Object.keys(room.players).length >= room.maxPlayers) {
      if (typeof callback === 'function') callback('Room full');
      return;
    }
    
    room.players[playerId] = { ...data.extra, socketId: socket.id };
    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.playerId = playerId;
    
    io.to(sessionId).emit('users-updated', room.players);
    if (typeof callback === 'function') callback(null, room.players);
  });

  socket.on('leave-room', () => {
    if (socket.sessionId && socket.playerId) {
      const sessionId = socket.sessionId;
      const playerId = socket.playerId;
      if (rooms[sessionId]) {
        delete rooms[sessionId].players[playerId];
        rooms[sessionId].peers = rooms[sessionId].peers.filter(
          (peer) => peer.source !== socket.id && peer.target !== socket.id
        );
        io.to(sessionId).emit('users-updated', rooms[sessionId].players);
        if (Object.keys(rooms[sessionId].players).length === 0) {
          delete rooms[sessionId];
        } else if (socket.id === rooms[sessionId].owner) {
          const remainingPlayers = Object.keys(rooms[sessionId].players);
          if (remainingPlayers.length > 0) {
            const newOwnerId = rooms[sessionId].players[remainingPlayers[0]].socketId;
            rooms[sessionId].owner = newOwnerId;
            io.to(sessionId).emit('users-updated', rooms[sessionId].players);
          }
        }
      }
      socket.leave(sessionId);
      delete socket.sessionId;
      delete socket.playerId;
    }
  });

  socket.on('webrtc-signal', (data) => {
    try {
      const { target, candidate, offer, answer, requestRenegotiate } = data || {};
      if (requestRenegotiate) {
        const targetSocket = io.sockets.sockets.get(target);
        if (targetSocket) {
          targetSocket.emit('webrtc-signal', {
            sender: socket.id,
            requestRenegotiate: true,
          });
        }
      } else if (target) {
        io.to(target).emit('webrtc-signal', {
          sender: socket.id,
          candidate,
          offer,
          answer,
        });
      }
    } catch (error) {
      console.error(`WebRTC signal error: ${error.message}`);
    }
  });

  socket.on('data-message', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('data-message', data);
    }
  });

  socket.on('snapshot', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('snapshot', data);
    }
  });

  socket.on('input', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('input', data);
    }
  });

  socket.on('disconnect', () => {
    const sessionId = socket.sessionId;
    const playerId = socket.playerId;
    if (sessionId && playerId && rooms[sessionId]) {
      delete rooms[sessionId].players[playerId];
      io.to(sessionId).emit('users-updated', rooms[sessionId].players);
      if (Object.keys(rooms[sessionId].players).length === 0) {
        delete rooms[sessionId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🏎️  Racing Lagoon Web + Netplay Server running at:`);
  console.log(`    👉 http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
