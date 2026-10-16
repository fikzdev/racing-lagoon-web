// Configuración Global de Racing Lagoon Web
window.RACING_LAGOON_CONFIG = {
  // Ruta del archivo del juego:
  // - En desarrollo local: 'roms/racing_lagoon.zip'
  // - En producción (Vercel): reemplaza por la URL directa de tu release en GitHub, Cloudflare R2 o Internet Archive.
  romUrl: 'roms/racing_lagoon.zip',

  // Identificador único para almacenar la Memory Card virtual de PS1 en el navegador (IndexedDB)
  gameId: 992038,

  // Servidor público de señalización Netplay para juego multijugador online
  netplayServer: 'https://netplay.emulatorjs.org/',

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
