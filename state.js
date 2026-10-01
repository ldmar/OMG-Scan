// src/state.js — estado global, preferencias, constantes.
// Importa solo utils. NO importa ui/features.

import { clamp } from "./utils.js";

export const STORAGE_KEY = "omgscan.prefs.v1";
export const MAX_DIM     = 2400;

export const DEFAULT_CORNERS = () => ([
  { x: 0.06, y: 0.06 },
  { x: 0.94, y: 0.06 },
  { x: 0.94, y: 0.94 },
  { x: 0.06, y: 0.94 },
]);

export const FILTERS = [
  { id: "original", label: "Original"  },
  { id: "auto",     label: "OMG Auto"  },
  { id: "color",    label: "Color"     },
  { id: "gray",     label: "Escáner"   },
  { id: "bw",       label: "B/N"       },
];

export const prefs = {
  autoStraighten: true,
  liveDetect: false,
  liveAutoShutter: false,
  magnifierZoom: 3,
  lastFilter: "auto",
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.autoStraighten    === "boolean") this.autoStraighten    = data.autoStraighten;
      if (typeof data.liveDetect        === "boolean") this.liveDetect        = data.liveDetect;
      if (typeof data.liveAutoShutter   === "boolean") this.liveAutoShutter   = data.liveAutoShutter;
      if (typeof data.magnifierZoom     === "number")  this.magnifierZoom     = clamp(data.magnifierZoom, 2, 6);
      if (typeof data.lastFilter        === "string")  this.lastFilter        = data.lastFilter;
    } catch (_) {}
  },
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        autoStraighten:  this.autoStraighten,
        liveDetect:      this.liveDetect,
        liveAutoShutter: this.liveAutoShutter,
        magnifierZoom:   this.magnifierZoom,
        lastFilter:      this.lastFilter,
      }));
    } catch (_) {}
  },
};
prefs._load();

export const state = {
  stream: null, facing: "environment",
  torchOn: false, torchSupported: false,
  rawCapture: null,
  rotation: 0,
  crop: {
    corners: DEFAULT_CORNERS(),
    zoom: 1, panX: 0, panY: 0,
  },
  cropped: null,
  currentFilter: prefs.lastFilter || "auto",
  pages: [],
  qualityTimer: null,
  brush: {
    enabled: false, size: 70, strength: 60,
    strokes: [], mask: null, w: 0, h: 0,
  },
  preFilterCanvas: null,
  renderedCanvas: null,
  currentDocId: null,
  isPainting: false,
  // Quadscan
  quadscanInstance: null,
  quadscanPromise: null,
  quadscanReady: false,
  quadscanFailed: false,
  // Auto-enderezar
  autoStraighten: prefs.autoStraighten,
  // Live detect
  liveDetect: false,
  liveTimer: null,
  liveBusy: false,
  liveIntervalMs: 500,
  liveSuccessStreak: 0,
  liveFailStreak: 0,
  liveCornersHistory: [],
  // Auto-shutter
  autoShutter: prefs.liveAutoShutter,
  autoShutterEnabled: false,
  autoShutterTimer: null,
  autoShutterCountdown: null,
  // Magnifier
  magnifierZoom: prefs.magnifierZoom,
};