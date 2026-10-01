// src/events.js — mini pub/sub síncrono para comunicación entre features.
// Reglas:
//   - Síncrono. `emit` ejecuta handlers en orden de suscripción.
//   - Fire-and-forget. Si no hay suscriptores, no pasa nada.
//   - Aislado. Si un handler tira, no rompe a los demás.
//   - Sin cola. Suscribite antes de emitir.
//
// Convención de nombres: "feature:evento" en minúsculas.

const listeners = new Map();

export function on(event, callback) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  return () => {
    const set = listeners.get(event);
    if (set) set.delete(callback);
  };
}

export function off(event, callback) {
  const set = listeners.get(event);
  if (set) set.delete(callback);
}

export function emit(event, data) {
  const set = listeners.get(event);
  if (!set) return;
  for (const cb of set) {
    try { cb(data); }
    catch (e) { console.error(`[events] handler "${event}" falló:`, e); }
  }
}