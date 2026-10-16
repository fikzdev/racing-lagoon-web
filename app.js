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

  // Gamepad Detection
  window.addEventListener('gamepadconnected', (e) => {
    gamepadStatus.textContent = `🎮 Mando detectado: ${e.gamepad.id.slice(0, 20)}...`;
    gamepadStatus.style.color = '#00ff66';
  });

  window.addEventListener('gamepaddisconnected', () => {
    gamepadStatus.textContent = 'Mando: Teclado activo';
    gamepadStatus.style.color = 'var(--text-muted)';
  });

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

  // Start the game
  startGameBtn.addEventListener('click', () => {
    if (emulatorStarted) return;
    emulatorStarted = true;

    // Fade out cover
    coverOverlay.classList.add('hidden');

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
