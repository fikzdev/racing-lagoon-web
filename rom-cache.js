// ==========================================================================
// ROM CACHE · Descarga el disco UNA sola vez y lo guarda en el navegador
// --------------------------------------------------------------------------
// - Usa Cache Storage (escrito directo a disco por streaming, no ocupa RAM).
// - La descarga empieza en segundo plano apenas se abre la página.
// - Las visitas siguientes cargan el disco desde el disco local (0 MB de red).
// - Cambia CACHE_VERSION si alguna vez reemplazas el archivo del juego.
// ==========================================================================
(function () {
  const CACHE_VERSION = 'v1';
  const CACHE_NAME = `racing-lagoon-rom-${CACHE_VERSION}`;
  const CACHE_KEY = '/__rom__/racing_lagoon.zip';

  const listeners = new Set();
  const state = { status: 'idle', loaded: 0, total: 0, fromCache: false, error: null };
  let readyPromise = null;

  function emit(patch) {
    Object.assign(state, patch);
    listeners.forEach(fn => {
      try { fn({ ...state }); } catch (e) { console.warn(e); }
    });
  }

  const hasCacheApi = () => typeof window.caches !== 'undefined';

  async function readCached() {
    if (!hasCacheApi()) return null;
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(CACHE_KEY);
    if (!hit) return null;
    const blob = await hit.blob();
    const expected = Number(hit.headers.get('X-Rom-Size')) || 0;
    // Descarta entradas corruptas o incompletas
    if (!blob.size || (expected && blob.size !== expected)) {
      await cache.delete(CACHE_KEY);
      return null;
    }
    return blob;
  }

  async function readStream(stream, onChunk) {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(value);
    }
  }

  async function download(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get('content-length')) || 0;
    let loaded = 0;
    emit({ status: 'downloading', loaded: 0, total });
    const count = chunk => {
      loaded += chunk.byteLength;
      emit({ loaded });
    };

    // Sin Cache API (navegadores muy antiguos): se mantiene en memoria solo esta sesión
    if (!hasCacheApi()) {
      const parts = [];
      await readStream(res.body, chunk => { parts.push(chunk); count(chunk); });
      return new Blob(parts, { type: 'application/zip' });
    }

    // Una rama del stream va directo a disco, la otra solo cuenta bytes para la barra de progreso
    const [toDisk, toCounter] = res.body.tee();
    const cache = await caches.open(CACHE_NAME);
    const headers = { 'Content-Type': 'application/zip' };
    if (total) headers['X-Rom-Size'] = String(total);

    await Promise.all([
      cache.put(CACHE_KEY, new Response(toDisk, { headers })),
      readStream(toCounter, count)
    ]);

    const blob = await readCached();
    if (!blob) throw new Error('El disco descargado está incompleto');
    return blob;
  }

  async function cleanupOldVersions() {
    if (!hasCacheApi()) return;
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('racing-lagoon-rom-') && k !== CACHE_NAME).map(k => caches.delete(k))
    );
  }

  window.RomCache = {
    /** Suscribirse al progreso. Devuelve una función para desuscribirse. */
    onProgress(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },

    /** Devuelve (y si hace falta descarga) el Blob del disco. Llamadas repetidas reutilizan la misma promesa. */
    ensure(url) {
      if (readyPromise) return readyPromise;
      readyPromise = (async () => {
        emit({ status: 'checking', error: null });

        // Pide al navegador que no borre la caché automáticamente cuando falte espacio
        try { await navigator.storage?.persist?.(); } catch (e) {}
        cleanupOldVersions().catch(() => {});

        const cached = await readCached().catch(() => null);
        if (cached) {
          emit({ status: 'ready', loaded: cached.size, total: cached.size, fromCache: true });
          return cached;
        }

        const blob = await download(url);
        emit({ status: 'ready', loaded: blob.size, total: blob.size, fromCache: false });
        return blob;
      })().catch(err => {
        readyPromise = null;
        emit({ status: 'error', error: err?.message || String(err) });
        throw err;
      });
      return readyPromise;
    },

    /** ¿Ya está el disco guardado en este navegador? */
    async isCached() {
      try { return !!(await readCached()); } catch (e) { return false; }
    },

    /** Borra el disco guardado (libera ~750 MB). */
    async clear() {
      readyPromise = null;
      if (hasCacheApi()) await caches.delete(CACHE_NAME);
      emit({ status: 'idle', loaded: 0, total: 0, fromCache: false, error: null });
    }
  };
})();
