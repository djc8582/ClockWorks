// ── Color Palette ──────────────────────────────────────────────
// Chrome Music Lab inspired: bright saturated colors on a clean light background
export const COLORS = {
  shapes: [
    { main: "#E84855", glow: "rgba(232,72,85,0.3)", dim: "rgba(232,72,85,0.5)", fill: "rgba(232,72,85,0.12)" },   // red
    { main: "#3185FC", glow: "rgba(49,133,252,0.3)", dim: "rgba(49,133,252,0.5)", fill: "rgba(49,133,252,0.12)" }, // blue
    { main: "#FFBE0B", glow: "rgba(255,190,11,0.3)", dim: "rgba(255,190,11,0.5)", fill: "rgba(255,190,11,0.12)" }, // yellow
    { main: "#8338EC", glow: "rgba(131,56,236,0.3)", dim: "rgba(131,56,236,0.5)", fill: "rgba(131,56,236,0.12)" }, // purple
    { main: "#06D6A0", glow: "rgba(6,214,160,0.3)", dim: "rgba(6,214,160,0.5)", fill: "rgba(6,214,160,0.12)" },   // green
  ],
  bg: "#F5F5F7",
  bgGradientCenter: "#FFFFFF",
  clockHand: "#333333",
  clockHandGlow: "rgba(0,0,0,0.08)",
  ghostRing: "rgba(0,0,0,0.08)",
  ghostRingHover: "rgba(0,0,0,0.18)",
  muted: "rgba(0,0,0,0.15)",
  scaleRingActive: "rgba(0,0,0,0.12)",
  scaleRingInactive: "rgba(0,0,0,0.04)",
  text: "#333333",
  textDim: "rgba(0,0,0,0.35)",
  textLight: "rgba(0,0,0,0.55)",
  white: "#FFFFFF",
  overlay: "rgba(0,0,0,0.5)",
  panelBg: "#FFFFFF",
  panelBorder: "rgba(0,0,0,0.08)",
  buttonBg: "rgba(0,0,0,0.06)",
  buttonHover: "rgba(0,0,0,0.12)",
};

// ── Dimensions ─────────────────────────────────────────────────
export const DIMENSIONS = {
  maxRadiusFraction: 0.55,
  minRadiusFraction: 0.18,
  vertexMinRadius: 6,
  vertexMaxRadius: 18,
  mutedVertexRadius: 8,
  hitRadius: 24,
  stemMinFraction: 0.05,
  stemMaxFraction: 0.65,
  clockHandWidth: 2.5,
  clockHandGlowWidth: 6,
  edgeWidth: 3,
  stemWidth: 2.5,
  ghostRingWidth: 2.5,
  canvasZoomMin: 0.4,
  canvasZoomMax: 3.0,
  canvasZoomStep: 0.08,
  rollZoomMin: 0.5,
  rollZoomMax: 3.0,
  rollZoomStep: 0.1,
  addButtonRadius: 28,
  timbreButtonRadius: 22,
  timbreButtonSpacing: 54,
};

// ── Timing ─────────────────────────────────────────────────────
export const TIMING = {
  fireAnimationDuration: 250,
  fireScaleUpDuration: 60,
  fireScaleDownDuration: 190,
  doubleTapWindow: 300,
  longPressThreshold: 600,
  morphDuration: 500,
  shapeAppearDuration: 350,
  shapeDeleteDuration: 300,
  breathingPeriod: 5000,
  breathingAmplitude: 0.006,
  clockTrailAngle: Math.PI / 5,
  velocityDragSensitivity: 0.5,
  pitchDragSensitivity: 0.3,
  previewNoteThrottle: 120,
  defaultCycleBeats: 4,
  sceneCycles: 1,
  noteLabelFadeDuration: 1200,
  bpmLabelFadeDuration: 800,
  scaleNameFadeDuration: 2500,
};

// ── Pitch ──────────────────────────────────────────────────────
export const PITCH = {
  min: 24,
  max: 96,
  defaultPitch: 60,
  defaultVelocity: 85,
};

export const MAX_SHAPES = 5;
export const MAX_SCENES = 8;
export const MIN_SIDES = 2;
export const MAX_SIDES = 24;
export const MAX_SUBDIVISION = 4;

// ── Timbres ───────────────────────────────────────────────────
export const TIMBRES = [
  // Keys
  { id: "epiano",  label: "E.Piano",     category: "Keys" },
  { id: "piano",   label: "Piano",       category: "Keys" },
  { id: "keys",    label: "Bright Keys", category: "Keys" },
  { id: "organ",   label: "Organ",       category: "Keys" },
  // Mallet
  { id: "marimba", label: "Marimba",  category: "Mallet" },
  { id: "vibes",   label: "Vibes",    category: "Mallet" },
  // String
  { id: "pluck",   label: "Pluck",    category: "String" },
  { id: "guitar",  label: "Guitar",   category: "String" },
  { id: "nylon",   label: "Nylon",    category: "String" },
  // Synth
  { id: "synth",   label: "Synth",    category: "Synth" },
  // Drum Kits
  { id: "drumkit1", label: "Vinyl Kit",  category: "Drums" },
  { id: "drumkit2", label: "Tight Kit",  category: "Drums" },
  { id: "drumkit3", label: "Soft Kit",   category: "Drums" },
];

export const DRUM_TIMBRES = new Set(["drumkit1", "drumkit2", "drumkit3"]);

// Drum kit slot order: vertex 0=kick, 1=snare, 2=hihat, 3=perc, then repeats
export const DRUM_SLOTS = ['kick', 'snare', 'hihat', 'perc'];

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const SCALE_DEFINITIONS = {
  "Major": [0, 2, 4, 5, 7, 9, 11],
  "Minor": [0, 2, 3, 5, 7, 8, 10],
  "Dorian": [0, 2, 3, 5, 7, 9, 10],
  "Mixolydian": [0, 2, 4, 5, 7, 9, 10],
  "Pentatonic": [0, 2, 4, 7, 9],
  "Blues": [0, 3, 5, 6, 7, 10],
  "Lydian": [0, 2, 4, 6, 7, 9, 11],
  "Phrygian": [0, 1, 3, 5, 7, 8, 10],
  "Whole Tone": [0, 2, 4, 6, 8, 10],
  "Chromatic": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
