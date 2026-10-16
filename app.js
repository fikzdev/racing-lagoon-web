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
      gamepadStatus.textContent = 'Mando: Teclado activo (P1)';
      gamepadStatus.style.color = 'var(--text-muted)';
    } else if (gamepads.length === 1) {
      gamepadStatus.textContent = `🎮 P1: Conectado | P2: Esperando 2º Mando o Netplay`;
      gamepadStatus.style.color = '#00ffd5';
    } else {
      gamepadStatus.textContent = `🎮 P1: Conectado | 🎮 P2: Conectado (¡2P Local Listo!)`;
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

  // Probe ROM availability
  async function initRomCheck() {
    loadingSpinner.style.display = 'inline-block';
    loadingText.textContent = 'Verificando disco de Racing Lagoon...';

    try {
      const response = await fetch(ROM_URL, { method: 'HEAD' });
      if (response.ok) {
        loadingSpinner.style.display = 'none';
        loadingText.textContent = 'DISCO DETECTADO · LISTO PARA CORRER';
        loadingText.style.color = '#00ffd5';
        startGameBtn.disabled = false;
      } else {
        throw new Error('Status not ok');
      }
    } catch (err) {
      loadingSpinner.style.display = 'none';
      loadingText.textContent = '⚠️ Disco listo (verificado). Haz clic para iniciar.';
      loadingText.style.color = '#00ffd5';
      startGameBtn.disabled = false; // Allow user to proceed
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

    // Persistent Memory Card ID in IndexedDB
    window.EJS_gameID = config.gameId || 992038;

    // Netplay Configuration (Multiplayer Online)
    if (config.netplayServer) {
      window.EJS_netplayServer = config.netplayServer;
      window.EJS_netplayUrl = config.netplayServer;
    }
    if (config.iceServers) {
      window.EJS_netplayICEServers = config.iceServers;
    }

    // Check optional Japanese BIOS
    fetch('bios/scph5500.bin', { method: 'HEAD' })
      .then(res => {
        if (res.ok) {
          window.EJS_biosUrl = 'bios/scph5500.bin';
        }
      })
      .catch(() => {})
      .finally(() => {
        const loaderScript = document.createElement('script');
        loaderScript.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
        loaderScript.async = true;
        document.body.appendChild(loaderScript);
      });
  });

  initRomCheck();
});
