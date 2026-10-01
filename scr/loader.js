// src/loader.js — descarga de libs pesadas con progreso.
// Hoja pura: no importa nada nuestro.

export const LibraryLoader = (() => {
  const cache = new Map();

  function fmtBytes(n) {
    if (!n || n < 0) return "?";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "";
    if (sec < 1) return "menos de 1s";
    if (sec < 60) return Math.round(sec) + "s";
    return Math.round(sec / 60) + "min";
  }
  function emit(entry, st) {
    for (const fn of entry.subscribers) { try { fn(st); } catch (_) {} }
  }

  async function fetchWithProgress(url, signal, onProgress) {
    const res = await fetch(url, { signal, cache: "default" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const total  = +res.headers.get("content-length") || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    const t0 = performance.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const elapsed = (performance.now() - t0) / 1000;
      const speed   = loaded / Math.max(0.1, elapsed);
      const eta     = total > 0 ? (total - loaded) / Math.max(1, speed) : -1;
      onProgress({ loaded, total, percent: total ? loaded / total : 0, speed, eta });
    }
    return new Blob(chunks, { type: "application/javascript" });
  }

  async function injectScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload  = () => resolve();
      s.onerror = () => reject(new Error("Error al cargar script"));
      document.head.appendChild(s);
    });
  }

  function load(url, { name, onProgress } = {}) {
    if (cache.has(url)) {
      const entry = cache.get(url);
      if (onProgress) entry.subscribers.add(onProgress);
      return { promise: entry.promise, entry };
    }
    const entry = {
      subscribers: new Set(),
      controller:  new AbortController(),
      blobUrl:     null,
      promise:     null,
    };
    if (onProgress) entry.subscribers.add(onProgress);
    cache.set(url, entry);

    entry.promise = (async () => {
      try {
        emit(entry, { phase: "download", name, loaded: 0, total: 0, percent: 0 });
        let usedFallback = false;
        try {
          const blob = await fetchWithProgress(url, entry.controller.signal, (p) => {
            emit(entry, { phase: "download", name, ...p });
          });
          entry.blobUrl = URL.createObjectURL(blob);
          emit(entry, { phase: "injecting", name, percent: 1 });
          await injectScript(entry.blobUrl);
        } catch (fetchErr) {
          if (fetchErr.name === "AbortError") throw fetchErr;
          usedFallback = true;
          emit(entry, { phase: "fallback", name });
          await injectScript(url);
        }
        emit(entry, { phase: "ready", name, percent: 1, usedFallback });
        return usedFallback ? url : entry.blobUrl;
      } catch (err) {
        emit(entry, { phase: "error", name, error: err });
        cache.delete(url);
        throw err;
      }
    })();
    return { promise: entry.promise, entry };
  }

  function abort(url) {
    const entry = cache.get(url);
    if (entry && entry.controller) {
      entry.controller.abort();
      emit(entry, { phase: "cancelled" });
    }
  }

  return { load, abort, fmtBytes, fmtTime };
})();