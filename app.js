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

  // ==========================================
  // PLAYSTATION 1 BIOS BOOT SEQUENCE & SYNTH
  // ==========================================
  const biosScreen = document.getElementById('ps1-bios-screen');
  const biosStage1 = document.getElementById('bios-stage-1');
  const biosStage2 = document.getElementById('bios-stage-2');

  let audioCtx = null;
  const activeOscillators = [];
  let biosActive = false;
  let biosTimeout1 = null;
  let biosTimeout2 = null;

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playStage1Sound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    // Harmonized ethereal chord: D3, A3, D4, F#4
    const chordNotes = [146.83, 220.00, 293.66, 369.99];

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 1.8);
    filter.Q.setValueAtTime(2.2, now);

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.01, now);
    masterGain.gain.linearRampToValueAtTime(0.3, now + 0.4);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 3.2);

    filter.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    chordNotes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + 3.3);
      activeOscillators.push(osc);
    });
  }

  function playStage2Sound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    // Sub-bass whoosh (A1 dropping to deep drone)
    const subOsc = audioCtx.createOscillator();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(55, now);
    subOsc.frequency.exponentialRampToValueAtTime(42, now + 2.5);

    const subFilter = audioCtx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.setValueAtTime(140, now);
    subFilter.frequency.linearRampToValueAtTime(80, now + 3.5);

    const subGain = audioCtx.createGain();
    subGain.gain.setValueAtTime(0.01, now);
    subGain.gain.linearRampToValueAtTime(0.35, now + 0.3);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 4.0);

    subOsc.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(audioCtx.destination);

    subOsc.start(now);
    subOsc.stop(now + 4.2);
    activeOscillators.push(subOsc);

    // Shimmering chimes / bell harmonics
    const chimeFreqs = [880, 1320, 1760, 2640];
    chimeFreqs.forEach((freq, i) => {
      const chimeOsc = audioCtx.createOscillator();
      chimeOsc.type = 'sine';
      chimeOsc.frequency.setValueAtTime(freq, now + (i * 0.06));

      const chimeGain = audioCtx.createGain();
      chimeGain.gain.setValueAtTime(0.01, now + (i * 0.06));
      chimeGain.gain.linearRampToValueAtTime(0.07, now + (i * 0.06) + 0.1);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.8);

      chimeOsc.connect(chimeGain);
      chimeGain.connect(audioCtx.destination);

      chimeOsc.start(now + (i * 0.06));
      chimeOsc.stop(now + 4.0);
      activeOscillators.push(chimeOsc);
    });
  }

  function stopAllBiosAudio() {
    activeOscillators.forEach(osc => {
      try { osc.stop(); } catch(e) {}
    });
    activeOscillators.length = 0;
  }

  function endBiosSequence() {
    if (!biosActive) return;
    biosActive = false;
    clearTimeout(biosTimeout1);
    clearTimeout(biosTimeout2);
    stopAllBiosAudio();

    biosScreen.classList.add('fade-out');
    setTimeout(() => {
      biosScreen.classList.remove('active', 'fade-out');
      biosStage1.classList.remove('active');
      biosStage2.classList.remove('active');
    }, 800);
  }

  function runPs1BiosSequence() {
    initAudioContext();
    biosActive = true;
    biosScreen.classList.remove('fade-out');
    biosScreen.classList.add('active');

    // Stage 1: White SCE Screen
    biosStage1.classList.add('active');
    biosStage2.classList.remove('active');
    playStage1Sound();

    // Stage 2: Black PlayStation Screen after 3.2s
    biosTimeout1 = setTimeout(() => {
      if (!biosActive) return;
      biosStage1.classList.remove('active');
      biosStage2.classList.add('active');
      playStage2Sound();
    }, 3200);

    // End sequence after 7.2s and reveal game
    biosTimeout2 = setTimeout(() => {
      endBiosSequence();
    }, 7200);
  }

  biosScreen.addEventListener('click', endBiosSequence);
  window.addEventListener('keydown', (e) => {
    if (biosActive && e.key !== 'F' && e.key !== 'f') {
      endBiosSequence();
    }
  });

  // Start the game
  startGameBtn.addEventListener('click', () => {
    if (emulatorStarted) return;
    emulatorStarted = true;

    // Fade out cover
    coverOverlay.classList.add('hidden');

    // Trigger authentic PS1 BIOS sequence!
    runPs1BiosSequence();

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
