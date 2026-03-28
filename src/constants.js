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
  min: 0,    // C-1
  max: 131,  // B10
  defaultPitch: 60,
  defaultVelocity: 85,
};

export const MAX_SHAPES = 20;
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
  // Western modes
  "Major": [0, 2, 4, 5, 7, 9, 11],
  "Minor": [0, 2, 3, 5, 7, 8, 10],
  "Dorian": [0, 2, 3, 5, 7, 9, 10],
  "Phrygian": [0, 1, 3, 5, 7, 8, 10],
  "Lydian": [0, 2, 4, 6, 7, 9, 11],
  "Mixolydian": [0, 2, 4, 5, 7, 9, 10],
  "Locrian": [0, 1, 3, 5, 6, 8, 10],
  // Pentatonic / blues
  "Pentatonic": [0, 2, 4, 7, 9],
  "Minor Pent": [0, 3, 5, 7, 10],
  "Blues": [0, 3, 5, 6, 7, 10],
  "Blues Maj": [0, 2, 3, 4, 7, 9],
  // Jazz / Bebop
  "Melodic Min": [0, 2, 3, 5, 7, 9, 11],
  "Harmonic Min": [0, 2, 3, 5, 7, 8, 11],
  "Harmonic Maj": [0, 2, 4, 5, 7, 8, 11],
  "Bebop Dom": [0, 2, 4, 5, 7, 9, 10, 11],
  "Bebop Maj": [0, 2, 4, 5, 7, 8, 9, 11],
  "Altered": [0, 1, 3, 4, 6, 8, 10],
  "Dim (HW)": [0, 1, 3, 4, 6, 7, 9, 10],
  "Dim (WH)": [0, 2, 3, 5, 6, 8, 9, 11],
  "Whole Tone": [0, 2, 4, 6, 8, 10],
  // World scales
  "Hirajoshi": [0, 2, 3, 7, 8],
  "In Sen": [0, 1, 5, 7, 10],
  "Iwato": [0, 1, 5, 6, 10],
  "Kumoi": [0, 2, 3, 7, 9],
  "Pelog": [0, 1, 3, 7, 8],
  "Raga Todi": [0, 1, 3, 6, 7, 8, 11],
  "Raga Bhairav": [0, 1, 4, 5, 7, 8, 11],
  "Raga Marwa": [0, 1, 4, 6, 7, 9, 11],
  "Maqam Hijaz": [0, 1, 4, 5, 7, 8, 10],
  "Maqam Bayati": [0, 2, 3, 5, 7, 8, 10],
  "Phrygian Dom": [0, 1, 4, 5, 7, 8, 10],
  "Dbl Harmonic": [0, 1, 4, 5, 7, 8, 11],
  "Hungarian Min": [0, 2, 3, 6, 7, 8, 11],
  "Hungarian Maj": [0, 3, 4, 6, 7, 9, 10],
  "Romanian Min": [0, 2, 3, 6, 7, 9, 10],
  "Neapolitan Min": [0, 1, 3, 5, 7, 8, 11],
  "Neapolitan Maj": [0, 1, 3, 5, 7, 9, 11],
  "Enigmatic": [0, 1, 4, 6, 8, 10, 11],
  "Persian": [0, 1, 4, 5, 6, 8, 11],
  // Symmetric / exotic
  "Augmented": [0, 3, 4, 7, 8, 11],
  "Tritone": [0, 1, 4, 6, 7, 10],
  "Prometheus": [0, 2, 4, 6, 9, 10],
  "Super Locrian": [0, 1, 3, 4, 6, 8, 10],
  // Sparse
  "Maj Triad": [0, 4, 7],
  "Min Triad": [0, 3, 7],
  "Power": [0, 7],
  "Quartal": [0, 5, 10],
  "Fifths": [0, 7],
  "Octaves": [0],
  "Chromatic": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  // Harmonic series (true overtone ratios as fractional semitones)
  "Harm 1-8": [0, 3.86, 7.02, 9.69],                     // unique PCs from harmonics 1-8
  "Harm 1-16": [0, 2.04, 3.86, 5.51, 7.02, 8.41, 9.69, 10.88],
  "Harm Odd": [0, 7.02, 3.86, 9.69, 2.04, 5.51],         // odd harmonics 1,3,5,7,9,11
  "Harm 7th": [0, 3.86, 7.02, 9.69],                      // natural 7th chord from series
  "Overtone": [0, 2, 4, 6, 7, 9, 10],                     // Lydian dominant (12-TET approx)
  // Microtonal — true quarter tones and equal divisions
  "Quarter 24": [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5],
  "Quarter 6": [0, 1.5, 3, 5, 7, 9],
  "Quarter 8": [0, 1.5, 3, 4.5, 6, 7, 9, 10.5],
  // Maqam scales (true neutral intervals)
  "Maqam Bayati": [0, 1.5, 3, 5, 7, 8, 10],
  "Maqam Rast": [0, 2, 3.5, 5, 7, 9, 10.5],
  "Maqam Saba": [0, 1.5, 3, 4, 5, 8, 10],
  "Maqam Sikah": [0, 1.5, 3.5, 5.5, 7, 8.5, 10.5],
  // Gamelan (true intervals, not 12-TET approximations)
  "Slendro": [0, 2.4, 4.8, 7.2, 9.6],
  "Pelog": [0, 1.2, 2.8, 5, 7, 7.8, 10.2],
  // Equal temperament divisions
  "Equi 5": [0, 2.4, 4.8, 7.2, 9.6],
  "Equi 6": [0, 2, 4, 6, 8, 10],
  "Equi 7": [0, 1.71, 3.43, 5.14, 6.86, 8.57, 10.29],
  "Equi 8": [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5],
  // African / Gamelan / Other world
  "Akebono": [0, 2, 3, 7, 8],
  "Yo": [0, 2, 5, 7, 9],
  "Ritusen": [0, 2, 5, 7, 9],
  "Balinese": [0, 1, 3, 7, 8],
  "Egyptian": [0, 2, 5, 7, 10],
  "Chinese": [0, 4, 6, 7, 11],
  "Mongolian": [0, 2, 4, 7, 9],
  "Japanese": [0, 1, 5, 7, 8],
  // Symmetrical / Mathematical
  "Messiaen 1": [0, 2, 4, 6, 8, 10],
  "Messiaen 2": [0, 1, 3, 4, 6, 7, 9, 10],
  "Messiaen 3": [0, 1, 2, 4, 5, 6, 8, 9, 10],
  "Messiaen 4": [0, 1, 2, 5, 6, 7, 8, 11],
  "Messiaen 5": [0, 1, 5, 6, 7, 11],
  "Messiaen 6": [0, 1, 2, 4, 6, 7, 8, 10],
  "Messiaen 7": [0, 1, 2, 3, 5, 6, 7, 8, 9, 11],
  // Chords as scales
  "Maj7": [0, 4, 7, 11],
  "Min7": [0, 3, 7, 10],
  "Dom7": [0, 4, 7, 10],
  "Dim7": [0, 3, 6, 9],
  "Aug": [0, 4, 8],
  "Sus4": [0, 5, 7],
  "Sus2": [0, 2, 7],
  "9th": [0, 2, 4, 7, 10],
  "11th": [0, 2, 4, 5, 7, 10],
  "13th": [0, 2, 4, 5, 7, 9, 10],
};
