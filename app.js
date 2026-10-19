// Racing Lagoon Web - Dedicated Arcade Controller
document.addEventListener('DOMContentLoaded', () => {
  const startGameBtn = document.getElementById('start-game-btn');
  const coverOverlay = document.getElementById('cover-overlay');
  const loadingText = document.getElementById('loading-text');
  const loadingSpinner = document.getElementById('loading-spinner');
  const gamepadStatus = document.getElementById('gamepad-status');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const reloadBtn = document.getElementById('reload-btn');
  const stageViewport = document.querySelector('.screen-viewport');

  let emulatorStarted = false;

  // Read configuration
  const config = window.RACING_LAGOON_CONFIG || {};
  const ROM_URL = config.romUrl || 'roms/racing_lagoon.zip';

  // Multi-Gamepad Live Monitor
  function updateGamepadStatus() {
    const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (gamepads.length === 0) {
      gamepadStatus.textContent = '🎮 P1: Teclado Activo';
      gamepadStatus.style.color = '#b8cce6';
    } else if (gamepads.length === 1) {
      gamepadStatus.textContent = `🎮 P1: DualShock Conectado | P2: Esperando`;
      gamepadStatus.style.color = '#00e5ff';
    } else {
      gamepadStatus.textContent = `🎮 P1: DualShock | 🎮 P2: DualShock (¡2P Listo!)`;
      gamepadStatus.style.color = '#00ff66';
    }
  }

  window.addEventListener('gamepadconnected', updateGamepadStatus);
  window.addEventListener('gamepaddisconnected', updateGamepadStatus);
  setInterval(updateGamepadStatus, 2500);

  // Tabbed Controls Switcher (P1 vs P2)
  const tabP1Btn = document.getElementById('tab-p1-btn');
  const tabP2Btn = document.getElementById('tab-p2-btn');
  const controlsP1Panel = document.getElementById('controls-p1-panel');
  const controlsP2Panel = document.getElementById('controls-p2-panel');

  if (tabP1Btn && tabP2Btn) {
    tabP1Btn.addEventListener('click', () => {
      tabP1Btn.classList.add('active');
      tabP2Btn.classList.remove('active');
      controlsP1Panel.style.display = 'block';
      controlsP2Panel.style.display = 'none';
    });

    tabP2Btn.addEventListener('click', () => {
      tabP2Btn.classList.add('active');
      tabP1Btn.classList.remove('active');
      controlsP2Panel.style.display = 'block';
      controlsP1Panel.style.display = 'none';
    });
  }

  // Copy Invite Link Button
  const copyInviteBtn = document.getElementById('copy-invite-btn');
  if (copyInviteBtn) {
    copyInviteBtn.addEventListener('click', () => {
      const shareUrl = window.location.href;
      navigator.clipboard.writeText(shareUrl).then(() => {
        const originalText = copyInviteBtn.textContent;
        copyInviteBtn.textContent = '✅ ¡Enlace Copiado!';
        setTimeout(() => {
          copyInviteBtn.textContent = originalText;
        }, 2500);
      }).catch(() => {
        prompt('Copia este enlace para enviarlo a tu amigo:', shareUrl);
      });
    });
  }

  // Fullscreen support (Button & 'F' key)
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      stageViewport.requestFullscreen().catch(err => {
        console.warn('Error al activar pantalla completa:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  fullscreenBtn.addEventListener('click', toggleFullscreen);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      // Toggle fullscreen only when not typing in an input
      if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        toggleFullscreen();
      }
    }
  });

  // Reload console
  reloadBtn.addEventListener('click', () => {
    window.location.reload();
  });

  // Visual Enhancement Toolbar Setup
  stageViewport.classList.add('aspect-4-3');
  const crtOverlay = document.getElementById('crt-overlay');
  const filterButtons = document.querySelectorAll('[data-filter]');
  const aspectButtons = document.querySelectorAll('[data-aspect]');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filterType = btn.dataset.filter;
      stageViewport.classList.remove('filter-smooth', 'filter-sharp', 'filter-neon');
      crtOverlay.classList.remove('active');

      if (filterType === 'crt') {
        crtOverlay.classList.add('active');
      } else if (filterType === 'smooth') {
        stageViewport.classList.add('filter-smooth');
      } else if (filterType === 'neon') {
        stageViewport.classList.add('filter-neon');
      }
    });
  });

  aspectButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      aspectButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const aspect = btn.dataset.aspect;
      stageViewport.classList.remove('aspect-4-3', 'aspect-16-9');
      if (aspect === '4-3') {
        stageViewport.classList.add('aspect-4-3');
      } else if (aspect === '16-9') {
        stageViewport.classList.add('aspect-16-9');
      }
    });
  });

  // ==========================================
  // PRECARGA DEL DISCO EN SEGUNDO PLANO + CACHÉ
  // ==========================================
  const romProgressOverlay = document.getElementById('rom-progress-overlay');
  const romProgressFill = document.getElementById('rom-progress-fill');
  const romProgressLabel = document.getElementById('rom-progress-label');
  const clearCacheBtn = document.getElementById('clear-rom-cache-btn');

  const toMB = bytes => (bytes / 1048576).toFixed(0);

  function renderRomProgress(s) {
    const pct = s.total ? Math.min(100, Math.floor((s.loaded / s.total) * 100)) : 0;
    let text = '';
    let color = '#a0c0e8';

    switch (s.status) {
      case 'checking':
        text = 'Buscando disco en la memoria del navegador...';
        break;
      case 'downloading':
        text = s.total
          ? `Copiando disco a tu navegador (solo la 1ª vez): ${pct}% · ${toMB(s.loaded)}/${toMB(s.total)} MB`
          : `Copiando disco a tu navegador (solo la 1ª vez): ${toMB(s.loaded)} MB`;
        break;
      case 'ready':
        text = s.fromCache
          ? 'DISCO EN MEMORIA · CARGA INSTANTÁNEA'
          : 'DISCO GUARDADO · LA PRÓXIMA VEZ CARGARÁ AL INSTANTE';
        color = '#00ff66';
        break;
      case 'error':
        text = 'No se pudo guardar el disco; se cargará directo desde internet.';
        color = '#ffd700';
        break;
      default:
        text = 'Preparando disco...';
    }

    loadingSpinner.style.display = (s.status === 'checking' || s.status === 'downloading') ? 'inline-block' : 'none';
    loadingText.textContent = text;
    loadingText.style.color = color;

    if (romProgressFill) romProgressFill.style.width = `${s.status === 'ready' ? 100 : pct}%`;
    if (romProgressLabel) romProgressLabel.textContent = text;
  }

  function initRomPreload() {
    startGameBtn.disabled = false; // Se puede iniciar aunque siga descargando: el emulador esperará al disco
    window.RomCache.onProgress(renderRomProgress);

    // Respeta el modo "ahorro de datos" del móvil: en ese caso solo descarga al pulsar Iniciar
    const saveData = navigator.connection && navigator.connection.saveData;
    if (!saveData) {
      window.RomCache.ensure(ROM_URL).catch(err => console.warn('Precarga del disco:', err));
    }
  }

  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      if (!confirm('¿Borrar el disco guardado en este navegador? (libera ~750 MB, se volverá a descargar la próxima vez)')) return;
      await window.RomCache.clear();
      location.reload();
    });
  }

  /** Obtiene la URL que usará el emulador: el disco local en caché o, si falla, la URL remota. */
  async function resolveGameUrl() {
    try {
      const blob = await window.RomCache.ensure(ROM_URL);
      return URL.createObjectURL(blob);
    } catch (err) {
      console.warn('Usando descarga directa del disco:', err);
      return ROM_URL;
    }
  }

  // ==========================================
  // PLAYSTATION 1 VIDEO INTRO CONTROLLER
  // ==========================================
  const ps1VideoScreen = document.getElementById('ps1-video-screen');
  const ps1IntroVideo = document.getElementById('ps1-intro-video');
  let introVideoActive = false;

  function endIntroVideo() {
    if (!introVideoActive) return;
    introVideoActive = false;

    try {
      ps1IntroVideo.pause();
    } catch (e) {}

    ps1VideoScreen.classList.add('fade-out');
    setTimeout(() => {
      ps1VideoScreen.classList.remove('active', 'fade-out');
    }, 750);
  }

  function startIntroVideo() {
    introVideoActive = true;
    ps1VideoScreen.classList.remove('fade-out');
    ps1VideoScreen.classList.add('active');

    ps1IntroVideo.currentTime = 0;
    ps1IntroVideo.play().catch(err => {
      console.warn('Video playback notice:', err);
      endIntroVideo();
    });

    ps1IntroVideo.onended = () => {
      endIntroVideo();
    };
  }

  // Allow clicking or pressing any key to skip the video intro
  ps1VideoScreen.addEventListener('click', endIntroVideo);
  window.addEventListener('keydown', (e) => {
    if (introVideoActive && e.key !== 'F' && e.key !== 'f') {
      endIntroVideo();
    }
  });

  // Start the game
  startGameBtn.addEventListener('click', () => {
    if (emulatorStarted) return;
    emulatorStarted = true;

    // Fade out cover
    coverOverlay.classList.add('hidden');

    // Play authentic PS1 video intro!
    startIntroVideo();

    // Configure EmulatorJS globals
    window.EJS_player = '#game-player';
    window.EJS_core = 'psx';
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#00ffd5';
    window.EJS_alignStartButton = 'center';
    window.EJS_gameUrl = ROM_URL;

    // Enable Netplay button explicitly in EmulatorJS
    window.EJS_Buttons = {
      netplay: true
    };
    window.EJS_DEBUG_XX = true;
    window.EJS_EXPERIMENTAL_NETPLAY = true;

    // Persistent Memory Card ID in IndexedDB
    window.EJS_gameID = config.gameId || 992038;

    // Netplay Configuration (Multiplayer Online)
    const netplayHost = config.netplayServer || window.location.origin;
    window.EJS_netplayServer = netplayHost;
    window.EJS_netplayUrl = netplayHost;

    if (config.iceServers) {
      window.EJS_netplayICEServers = config.iceServers;
    }

    // Unhide and reinforce Netplay toolbar button on emulator ready
    function forceNetplayButtonVisible() {
      try {
        if (window.EJS_emulator) {
          window.EJS_emulator.netplayEnabled = true;
          if (window.EJS_emulator.elements && window.EJS_emulator.elements.bottomBar) {
            const netplayBtns = window.EJS_emulator.elements.bottomBar.netplay;
            if (netplayBtns && netplayBtns[0]) {
              netplayBtns[0].style.display = 'inline-flex';
              netplayBtns[0].style.visibility = 'visible';
              netplayBtns[0].style.opacity = '1';
            }
          }
        }
      } catch (e) {
        console.warn('Netplay button visibility hook:', e);
      }
    }

    window.EJS_ready = () => {
      forceNetplayButtonVisible();
    };

    window.EJS_onGameStart = () => {
      forceNetplayButtonVisible();
    };

    // Keep checking periodically to override any late hidden styles
    const netplayCheckInterval = setInterval(forceNetplayButtonVisible, 1000);

    // Check optional Japanese BIOS + esperar a que el disco esté en caché, luego arrancar el emulador
    const biosCheck = fetch('bios/scph5500.bin', { method: 'HEAD' })
      .then(res => {
        if (res.ok) {
          window.EJS_biosUrl = 'bios/scph5500.bin';
        }
      })
      .catch(() => {});

    if (romProgressOverlay) romProgressOverlay.classList.add('active');

    Promise.all([biosCheck, resolveGameUrl()]).then(([, gameUrl]) => {
      window.EJS_gameUrl = gameUrl;
      // Nombre fijo: mantiene el mismo slot de Memory Card venga el disco de la caché o de internet
      window.EJS_gameName = 'Racing Lagoon (Japan)';
      // Evita que EmulatorJS guarde una segunda copia de 750 MB en IndexedDB (ya lo hace RomCache)
      window.EJS_CacheLimit = 0;

      if (romProgressOverlay) romProgressOverlay.classList.remove('active');

      const loaderScript = document.createElement('script');
      loaderScript.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
      loaderScript.async = true;
      document.body.appendChild(loaderScript);
    });
  });

  // Dedicated Netplay Launcher Button
  const openNetplayBtn = document.getElementById('open-netplay-btn');
  if (openNetplayBtn) {
    openNetplayBtn.addEventListener('click', () => {
      if (!emulatorStarted) {
        alert('⚠️ Primero debes presionar "INICIAR CARRERA". Una vez que arranque el juego, pulsa aquí para abrir o unirte a una sala de Netplay.');
        return;
      }

      if (window.EJS_emulator && typeof window.EJS_emulator.openNetplayMenu === 'function') {
        window.EJS_emulator.openNetplayMenu();
      } else {
        const npBtn = window.EJS_emulator?.elements?.bottomBar?.netplay?.[0];
        if (npBtn) {
          npBtn.click();
        } else {
          alert('⏳ El emulador aún está cargando los módulos... Espera unos segundos y vuelve a pulsar.');
        }
      }
    });
  }

  initRomPreload();
});
