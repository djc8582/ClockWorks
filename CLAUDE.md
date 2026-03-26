# CLAUDE.md

## Project: Clockworks (React Native / Expo)
A polyrhythmic composition tool built with React Native and Expo Development Builds.

## Tech Stack
- Expo SDK 52 + React Native 0.76
- @shopify/react-native-skia — GPU-accelerated 2D rendering
- react-native-audio-api 0.6.5 — native Web Audio API implementation
- react-native-reanimated 3 — UI-thread animations
- react-native-gesture-handler — pinch, tap gestures
- midi-writer-js — MIDI file generation
- expo-file-system + expo-sharing — MIDI file export
- @react-native-community/slider — BPM slider

## Architecture Rules
- Expo Development Build (NOT Expo Go — native modules required)
- All canvas rendering via Skia declarative components
- State is a single mutable JS object in state.js, with `refreshRefs()` creating shallow copies for React
- useSyncExternalStore bridges state.js to React components
- Audio runs on native thread via react-native-audio-api
- Clock hand animation driven by Reanimated shared values at 60fps
- NO localStorage/AsyncStorage for state persistence
- `cancelScheduledValues()` crashes on react-native-audio-api 0.6.5 — do NOT use it

## Timbre System
Hybrid sample + synth architecture:
- **WAV sample timbres** (6 octaves C1–C6): epiano, piano, guitar, nylon, synth
- **Synthesized timbres** (generated on init): keys, organ, marimba, vibes, pluck
- **Drum kit samples** (WAV): 3 kits × 4 slots (kick, snare, hihat, perc)
- Samples preloaded at app startup, decoded when AudioContext initializes
- Synth buffers rendered async in batches to avoid blocking JS thread
- Voice pool capped at 24, soft-kill with gain ramp on eviction

## File Structure
```
ClockWorks/
├── App.js                    # Root component + loading screen + error boundary
├── app.json
├── babel.config.js
├── package.json
├── assets/samples/           # WAV sample files (melodic + drums)
└── src/
    ├── constants.js          # Colors, dimensions, timbres, scales
    ├── shapes.js             # Polygon geometry math
    ├── scale.js              # Scale/pitch quantization
    ├── state.js              # State management + useSyncExternalStore bridge
    ├── animation.js          # Easing functions
    ├── sequencer.js          # Scene auto-advance logic
    ├── audio/
    │   ├── audioEngine.js    # AudioContext, scheduler, note triggering
    │   ├── timbres.js        # Sample loading, synth rendering, voice management
    │   └── scheduler.js      # Custom transport (setInterval 50ms + 150ms lookahead)
    ├── rendering/
    │   ├── CanvasView.js     # Root Skia Canvas + gesture wrapper + play/pause overlay
    │   ├── ShapeRenderer.js  # Polygon rendering
    │   ├── ClockHand.js      # Rotating clock hand (Reanimated shared values)
    │   ├── GhostRing.js      # Add-shape dashed circle
    │   └── Animations.js     # Fire/spoke animation components
    ├── ui/
    │   ├── TopBar.js         # BPM slider + mixer toggle
    │   ├── SceneStrip.js     # Scene pill buttons
    │   ├── PianoRoll.js      # Windowed melodic grid + drum step sequencer
    │   ├── PianoRollCell.js  # Individual grid cell (React.memo)
    │   ├── PanelHeader.js    # Shape name, sides/subdivision steppers
    │   ├── TimbreRow.js      # Instrument + scale picker modals
    │   └── Mixer.js          # Per-shape volume sliders
    ├── gestures/
    │   ├── canvasGestures.js # Tap/pinch on Skia canvas + play/pause
    │   └── hitTesting.js     # Pure math hit testing
    ├── midi/
    │   └── midiExport.js     # MIDI export via expo-sharing
    └── hooks/
        ├── useClockSync.js   # Drives clock angle from audio time
        └── useStore.js       # useSyncExternalStore bridge
```

## Code Style
- Functional components with hooks (no class components)
- Plain objects and functions for non-React logic
- No `this` keyword in non-React code
- All state mutations through state.js `updateState()` with `safeActiveScene()` guard
- All magic numbers in constants.js
- Console statements gated with `__DEV__`

## Audio Rules
- AudioContext created on first user gesture
- All note scheduling through custom scheduler (scheduler.js)
- Never use setTimeout/setInterval for audio timing — only for scheduling lookahead
- Scheduler: setInterval(50ms) + audioContext.currentTime 150ms lookahead
- Voice cleanup via pruneVoices on each triggerTimbre call — no setTimeout per voice
- Soft-kill evicted voices with 20ms gain ramp to prevent pops
- AppState listener suspends AudioContext on background, resumes on foreground

## Rendering Rules
- All canvas drawing via Skia declarative components
- Clock hand uses Reanimated shared values for 60fps UI-thread updates
- PianoRoll uses row windowing — only visible rows + buffer are mounted
- Play/pause button uses native Pressable overlay for instant response

## Do NOT
- Do not use Expo Go (native modules required)
- Do not use Tone.js (replaced by react-native-audio-api)
- Do not use AsyncStorage or localStorage
- Do not use alert() or confirm()
- Do not use TypeScript (vanilla JS only)
- Do not call cancelScheduledValues() — crashes native audio on 0.6.5
