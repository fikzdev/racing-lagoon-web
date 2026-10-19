// Configuración Global de Racing Lagoon Web
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

window.RACING_LAGOON_CONFIG = {
  // En desarrollo local usa el archivo del servidor local.
  // En producción (Vercel) descarga el disco a través del Cloudflare Worker con CORS habilitado
  romUrl: isLocal 
    ? 'roms/racing_lagoon.zip' 
    : 'https://racing-lagoon-web.antoniofigueroqsanzana.workers.dev/',

  // Identificador único para almacenar la Memory Card virtual de PS1 en el navegador (IndexedDB)
  gameId: 992038,

  // Servidor de señalización Netplay para juego multijugador online
  netplayServer: window.location.origin,

  // Servidores STUN y TURN de alta disponibilidad para conectar jugadores por WebRTC
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};
