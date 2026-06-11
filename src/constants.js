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

// ── UI tokens — soft & playful, matched to the canvas ──────────
// The UI extends the clock's Chrome-Music-Lab look: rounded pills,
// light tinted fills from the shape palette, soft diffuse shadows.
// No hard borders anywhere — color and weight do the talking.
export const UI = {
  radius: 16,        // cards
  radiusSmall: 12,   // buttons, inputs
  pill: 999,         // fully-round chips
  separator: "rgba(0,0,0,0.08)",
  chipBg: "rgba(0,0,0,0.05)",
  // Soft floating shadows — blurred, low opacity
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 8,
  },
  softShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
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

// ── Audio engine limits ────────────────────────────────────────
export const AUDIO = {
  maxBpm: 500,            // beyond this the event storm risks native voice-teardown races
  minBpm: 10,
  minEventSpacing: 0.02,  // never schedule two events of a shape closer than 20ms
};

// ── Per-track + master effects ─────────────────────────────────
// Defaults for a shape's channel strip. Implemented with Gain/Biquad/
// StereoPanner only — the proven-stable nodes on react-native-audio-api 0.6.5.
export function makeDefaultFx() {
  return {
    pan: 0,                 // -1..1
    filterType: 'lowpass',  // 'lowpass' | 'highpass' | 'bandpass'
    cutoff: 1,              // 0..1 → 80Hz..18kHz log (1 = open lowpass)
    res: 0,                 // 0..1 → filter Q 0.707..8 (resonance)
    drive: 0,               // 0..1 tanh saturation (quantized warm/hot internally)
    echoSend: 0,            // 0..1 into the ping-pong echo bus
    verbSend: 0,            // 0..1 into the diffuse reverb bus
  };
}

export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'];

export function makeDefaultMasterFx() {
  return {
    volume: 1,        // 0..1 master level (scaled by auto-headroom)
    tone: 1,          // master lowpass, 0..1
    delayTime: 0.25,  // echo tap spacing in seconds (0.05..0.7)
    delayFeedback: 0.45, // per-tap decay (0..0.85)
    delayWet: 0.5,    // echo bus return level
    reverbWet: 0.5,   // reverb bus return level
  };
}

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
  // Granular (grain-engine renders of other timbres)
  { id: "cloud",   label: "Cloud",    category: "Granular" },
  { id: "shimmer", label: "Shimmer",  category: "Granular" },
  { id: "stutter", label: "Stutter",  category: "Granular" },
  // Drum Kits
  { id: "drumkit1", label: "Vinyl Kit",  category: "Drums" },
  { id: "drumkit2", label: "Tight Kit",  category: "Drums" },
  { id: "drumkit3", label: "Soft Kit",   category: "Drums" },
];

export const DRUM_TIMBRES = new Set(["drumkit1", "drumkit2", "drumkit3"]);

// Drum kit slot order: vertex 0=kick, 1=snare, 2=hihat, 3=perc, then repeats
export const DRUM_SLOTS = ['kick', 'snare', 'hihat', 'perc'];

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ── Scale Definitions ─────────────────────────────────────────
// Pitch class intervals from root. Integers = 12-TET, fractional = microtonal.
// Harmonic series: 12 * log2(n) mod 12 for harmonic n
// Just intonation: 12 * log2(ratio) for each scale degree
export const SCALE_DEFINITIONS = {
  // ── Western Modes (7 church modes) ──
  "Major": [0, 2, 4, 5, 7, 9, 11],
  "Dorian": [0, 2, 3, 5, 7, 9, 10],
  "Phrygian": [0, 1, 3, 5, 7, 8, 10],
  "Lydian": [0, 2, 4, 6, 7, 9, 11],
  "Mixolydian": [0, 2, 4, 5, 7, 9, 10],
  "Minor": [0, 2, 3, 5, 7, 8, 10],
  "Locrian": [0, 1, 3, 5, 6, 8, 10],

  // ── Melodic Minor Modes ──
  "Melodic Min": [0, 2, 3, 5, 7, 9, 11],           // mode 1: ascending melodic minor
  "Dorian b2": [0, 1, 3, 5, 7, 9, 10],             // mode 2: Phrygian #6
  "Lydian Aug": [0, 2, 4, 6, 8, 9, 11],             // mode 3: Lydian #5
  "Overtone": [0, 2, 4, 6, 7, 9, 10],               // mode 4: Lydian Dominant / Acoustic
  "Mixolydian b6": [0, 2, 4, 5, 7, 8, 10],          // mode 5: Aeolian Dominant / Hindu
  "Locrian #2": [0, 2, 3, 5, 6, 8, 10],             // mode 6: Half-Diminished
  "Altered": [0, 1, 3, 4, 6, 8, 10],                // mode 7: Super Locrian / Diminished WT

  // ── Harmonic Minor Modes ──
  "Harmonic Min": [0, 2, 3, 5, 7, 8, 11],           // mode 1
  "Locrian #6": [0, 1, 3, 5, 6, 9, 10],             // mode 2
  "Ionian #5": [0, 2, 4, 5, 8, 9, 11],              // mode 3: Augmented Major
  "Dorian #4": [0, 2, 3, 6, 7, 9, 10],              // mode 4: Romanian / Ukrainian Dorian
  "Phrygian Dom": [0, 1, 4, 5, 7, 8, 10],           // mode 5: Spanish Gypsy / Hijaz
  "Lydian #2": [0, 3, 4, 6, 7, 9, 11],              // mode 6
  "Altered Dim": [0, 1, 3, 4, 6, 8, 9],             // mode 7: Ultra Locrian

  // ── Harmonic Major Modes ──
  "Harmonic Maj": [0, 2, 4, 5, 7, 8, 11],           // mode 1
  "Dorian b5": [0, 2, 3, 5, 6, 9, 10],              // mode 2
  "Mixolydian b2": [0, 1, 4, 5, 7, 9, 10],          // mode 5
  "Lydian Aug #2": [0, 3, 4, 6, 8, 9, 11],          // mode 6

  // ── Pentatonic & Blues ──
  "Pentatonic": [0, 2, 4, 7, 9],
  "Minor Pent": [0, 3, 5, 7, 10],
  "Blues": [0, 3, 5, 6, 7, 10],
  "Blues Maj": [0, 2, 3, 4, 7, 9],
  "Man Gong": [0, 3, 5, 8, 10],
  "Pygmy": [0, 2, 3, 7, 10],

  // ── Jazz & Bebop ──
  "Bebop Dom": [0, 2, 4, 5, 7, 9, 10, 11],         // Mixolydian + maj7 passing tone
  "Bebop Maj": [0, 2, 4, 5, 7, 8, 9, 11],           // Major + b6 passing tone
  "Bebop Min": [0, 2, 3, 5, 7, 8, 9, 10],           // Harmonic minor + nat7 passing tone
  "Bebop Dor": [0, 2, 3, 4, 5, 7, 9, 10],           // Dorian + maj3 passing tone
  "Leading WT": [0, 2, 4, 6, 8, 10, 11],            // Whole tone + leading tone

  // ── Symmetric ──
  "Whole Tone": [0, 2, 4, 6, 8, 10],
  "Dim (HW)": [0, 1, 3, 4, 6, 7, 9, 10],
  "Dim (WH)": [0, 2, 3, 5, 6, 8, 9, 11],
  "Augmented": [0, 3, 4, 7, 8, 11],
  "Tritone": [0, 1, 4, 6, 7, 10],
  "Prometheus": [0, 2, 4, 6, 9, 10],                // Scriabin Mystic Chord
  "Messiaen 2": [0, 1, 3, 4, 6, 7, 9, 10],
  "Messiaen 3": [0, 1, 2, 4, 5, 6, 8, 9, 10],
  "Messiaen 4": [0, 1, 2, 5, 6, 7, 8, 11],
  "Messiaen 5": [0, 1, 5, 6, 7, 11],
  "Messiaen 6": [0, 1, 2, 4, 6, 7, 8, 10],
  "Messiaen 7": [0, 1, 2, 3, 5, 6, 7, 8, 9, 11],

  // ── South Asian (Ragas) ──
  "Raga Todi": [0, 1, 3, 6, 7, 8, 11],
  "Raga Bhairav": [0, 1, 4, 5, 7, 8, 11],
  "Raga Marwa": [0, 1, 4, 6, 7, 9, 11],
  "Raga Purvi": [0, 1, 4, 6, 7, 8, 11],
  "Ahir Bhairav": [0, 1, 4, 5, 7, 9, 10],
  "Charukeshi": [0, 2, 4, 5, 7, 8, 10],             // Mixolydian b6 in raga tradition
  "Malkauns": [0, 3, 5, 8, 10],
  "Hamsadhvani": [0, 2, 4, 7, 11],
  "Hindol": [0, 4, 6, 9, 11],
  "Jog": [0, 3, 5, 7, 9, 10],
  "Madhuvanti": [0, 1, 4, 6, 7, 9, 10],

  // ── Middle Eastern (12-TET) ──
  "Maqam Hijaz": [0, 1, 4, 5, 7, 8, 10],
  "Maqam Kurd": [0, 1, 3, 5, 7, 8, 10],             // Phrygian in maqam tradition
  "Dbl Harmonic": [0, 1, 4, 5, 7, 8, 11],           // Byzantine / Arabic / Bhairav
  "Spanish 8": [0, 1, 3, 4, 5, 6, 8, 10],           // Jewish / 8-tone Phrygian

  // ── East Asian ──
  "Hirajoshi": [0, 2, 3, 7, 8],
  "In Sen": [0, 1, 5, 7, 10],
  "Iwato": [0, 1, 5, 6, 10],
  "Kumoi": [0, 2, 3, 7, 9],
  "Akebono": [0, 2, 3, 7, 8],
  "Yo": [0, 2, 5, 7, 9],
  "Pelog 5": [0, 1, 3, 7, 8],                       // Balinese Pelog pentatonic
  "Chinese": [0, 4, 6, 7, 11],
  "Mongolian": [0, 2, 4, 7, 9],                     // = Major Pentatonic
  "Japanese": [0, 1, 5, 7, 8],
  "Egyptian": [0, 2, 5, 7, 10],                     // Suspended Pentatonic

  // ── European Folk ──
  "Hungarian Min": [0, 2, 3, 6, 7, 8, 11],
  "Hungarian Maj": [0, 3, 4, 6, 7, 9, 10],
  "Romanian Min": [0, 2, 3, 6, 7, 9, 10],           // Ukrainian Dorian
  "Neapolitan Min": [0, 1, 3, 5, 7, 8, 11],
  "Neapolitan Maj": [0, 1, 3, 5, 7, 9, 11],
  "Enigmatic": [0, 1, 4, 6, 8, 10, 11],
  "Persian": [0, 1, 4, 5, 6, 8, 11],

  // ── Maqam Microtonal (quarter-tone neutral intervals) ──
  "Maqam Bayati": [0, 1.5, 3, 5, 7, 8, 10],        // neutral 2nd
  "Maqam Rast": [0, 2, 3.5, 5, 7, 9, 10.5],        // neutral 3rd & 7th
  "Maqam Saba": [0, 1.5, 3, 4, 5, 8, 10],
  "Maqam Sikah": [0, 1.5, 3.5, 5.5, 7, 8.5, 10.5],
  "Maqam Suznak": [0, 2, 3.5, 5, 7, 9, 10],        // Rast + Nahawand upper
  "Maqam Jiharkah": [0, 2, 4, 5, 7, 9, 10.5],      // Ajam + Rast upper
  "Maqam Huzam": [0, 1.5, 3.5, 5, 7, 8, 10],       // Sikah-based

  // ── Ancient Greek Genera ──
  "Greek Enharmonic": [0, 0.5, 1, 5, 7, 7.5, 8],   // quarter-tone tetrachords
  "Greek Chromatic": [0, 1, 2, 5, 7, 8, 9],         // semitone tetrachords

  // ── Harmonic Series (true overtone ratios, 12*log2(n) mod 12) ──
  "Harm 1-8": [0, 3.86, 7.02, 9.69],               // H1,3,5,7 unique PCs
  "Harm 1-16": [0, 2.04, 3.86, 5.51, 7.02, 8.41, 9.69, 10.88], // all unique PCs H1-H16
  "Harm Odd": [0, 2.04, 3.86, 5.51, 7.02, 9.69],   // odd harmonics 1,3,5,7,9,11
  "Harm Prime": [0, 3.86, 5.51, 7.02, 8.41, 9.69], // prime harmonics 2,3,5,7,11,13
  "Subharm": [0, 2.31, 4.98, 8.14],                 // subharmonics 1/1-1/8 unique PCs
  "Subharm 16": [0, 1.12, 2.31, 3.59, 4.98, 6.49, 8.14, 9.96], // subharmonics 1/1-1/16

  // ── Just Intonation & Pythagorean ──
  "Just Major": [0, 2.04, 3.86, 4.98, 7.02, 8.84, 10.88],    // 5-limit JI: 1 9/8 5/4 4/3 3/2 5/3 15/8
  "Just Minor": [0, 2.04, 3.16, 4.98, 7.02, 8.14, 10.18],    // 5-limit JI: 1 9/8 6/5 4/3 3/2 8/5 9/5
  "Pythagorean": [0, 2.04, 4.08, 4.98, 7.02, 9.06, 11.10],   // 3-limit: 1 9/8 81/64 4/3 3/2 27/16 243/128

  // ── Equal Temperament (N equal divisions of octave) ──
  "Equi 5": [0, 2.4, 4.8, 7.2, 9.6],
  "Equi 7": [0, 1.71, 3.43, 5.14, 6.86, 8.57, 10.29],
  "Equi 8": [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5],
  "Equi 9": [0, 1.33, 2.67, 4, 5.33, 6.67, 8, 9.33, 10.67],
  "Equi 10": [0, 1.2, 2.4, 3.6, 4.8, 6, 7.2, 8.4, 9.6, 10.8],
  "Equi 11": [0, 1.09, 2.18, 3.27, 4.36, 5.45, 6.55, 7.64, 8.73, 9.82, 10.91],

  // ── Gamelan (authentic non-equal intervals) ──
  "Slendro": [0, 2.3, 4.7, 7.1, 9.3],              // Javanese ~5-tone (not perfectly equal)
  "Pelog": [0, 1.2, 2.8, 5, 7, 7.8, 10.2],         // Javanese 7-tone

  // ── Quarter Tone ──
  "Quarter 24": [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5],

  // ── Chords as Scales ──
  "Maj7": [0, 4, 7, 11],
  "Min7": [0, 3, 7, 10],
  "Dom7": [0, 4, 7, 10],
  "Dim7": [0, 3, 6, 9],
  "Min Maj7": [0, 3, 7, 11],
  "Dom7b5": [0, 4, 6, 10],
  "Dom7#5": [0, 4, 8, 10],
  "Min7b5": [0, 3, 6, 10],
  "Aug": [0, 4, 8],
  "Sus4": [0, 5, 7],
  "Sus2": [0, 2, 7],
  "9th": [0, 2, 4, 7, 10],
  "11th": [0, 2, 4, 5, 7, 10],
  "13th": [0, 2, 4, 5, 7, 9, 10],

  // ── Utility ──
  "Chromatic": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "Maj Triad": [0, 4, 7],
  "Min Triad": [0, 3, 7],
  "Power": [0, 7],
  "Quartal": [0, 5, 10],
  "Octaves": [0],
};

// Category display order for scale picker UI
export const SCALE_CATEGORIES = [
  { name: "Modes", scales: [
    "Major", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Minor", "Locrian",
  ]},
  { name: "Minor Modes", scales: [
    "Melodic Min", "Dorian b2", "Lydian Aug", "Overtone", "Mixolydian b6", "Locrian #2", "Altered",
    "Harmonic Min", "Locrian #6", "Ionian #5", "Dorian #4", "Phrygian Dom", "Lydian #2", "Altered Dim",
    "Harmonic Maj", "Dorian b5", "Mixolydian b2", "Lydian Aug #2",
  ]},
  { name: "Pentatonic & Blues", scales: [
    "Pentatonic", "Minor Pent", "Blues", "Blues Maj", "Man Gong", "Pygmy",
  ]},
  { name: "Jazz & Bebop", scales: [
    "Bebop Dom", "Bebop Maj", "Bebop Min", "Bebop Dor", "Leading WT",
  ]},
  { name: "Symmetric", scales: [
    "Whole Tone", "Dim (HW)", "Dim (WH)", "Augmented", "Tritone", "Prometheus",
    "Messiaen 2", "Messiaen 3", "Messiaen 4", "Messiaen 5", "Messiaen 6", "Messiaen 7",
  ]},
  { name: "South Asian", scales: [
    "Raga Todi", "Raga Bhairav", "Raga Marwa", "Raga Purvi", "Ahir Bhairav",
    "Charukeshi", "Malkauns", "Hamsadhvani", "Hindol", "Jog", "Madhuvanti",
  ]},
  { name: "Middle Eastern", scales: [
    "Maqam Hijaz", "Maqam Kurd", "Dbl Harmonic", "Spanish 8",
    "Maqam Bayati", "Maqam Rast", "Maqam Saba", "Maqam Sikah",
    "Maqam Suznak", "Maqam Jiharkah", "Maqam Huzam",
  ]},
  { name: "East Asian", scales: [
    "Hirajoshi", "In Sen", "Iwato", "Kumoi", "Akebono", "Yo",
    "Pelog 5", "Chinese", "Mongolian", "Japanese", "Egyptian",
  ]},
  { name: "European", scales: [
    "Hungarian Min", "Hungarian Maj", "Romanian Min",
    "Neapolitan Min", "Neapolitan Maj", "Enigmatic", "Persian",
  ]},
  { name: "Spectral", scales: [
    "Harm 1-8", "Harm 1-16", "Harm Odd", "Harm Prime",
    "Subharm", "Subharm 16",
    "Just Major", "Just Minor", "Pythagorean",
  ]},
  { name: "Microtonal", scales: [
    "Equi 5", "Equi 7", "Equi 8", "Equi 9", "Equi 10", "Equi 11",
    "Slendro", "Pelog", "Quarter 24",
    "Greek Enharmonic", "Greek Chromatic",
  ]},
  { name: "Chords", scales: [
    "Maj7", "Min7", "Dom7", "Dim7", "Min Maj7", "Dom7b5", "Dom7#5", "Min7b5",
    "Aug", "Sus4", "Sus2", "9th", "11th", "13th",
  ]},
  { name: "Utility", scales: [
    "Chromatic", "Maj Triad", "Min Triad", "Power", "Quartal", "Octaves",
  ]},
];

// Scales where root transposition is meaningless (all pitch classes already present)
export const NO_TRANSPOSE_SCALES = new Set(["Chromatic", "Quarter 24"]);
