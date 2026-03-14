# CLAUDE.md

## Project: Clockworks (React Native / Expo)
A polyrhythmic composition tool ported from web to React Native with Expo Development Builds.

## Tech Stack
- Expo SDK 52 + React Native 0.76
- @shopify/react-native-skia — GPU-accelerated 2D rendering
- react-native-audio-api — native Web Audio API implementation
- react-native-reanimated 3 — UI-thread animations
- react-native-gesture-handler — pinch, tap, pan gestures
- midi-writer-js — MIDI file generation
- expo-file-system + expo-sharing — MIDI file export
- @react-native-community/slider — BPM slider

## Architecture Rules
- Expo Development Build (NOT Expo Go — native modules required)
- All canvas rendering via Skia declarative components
- State is a single serializable JavaScript object managed in state.js
- useSyncExternalStore bridges state.js to React components
- Audio runs on native thread via react-native-audio-api
- Clock hand animation driven by Reanimated shared values
- NO localStorage/AsyncStorage for state persistence

## File Structure
```
ClockWorks/
├── App.js                    # Root component
├── app.json
├── babel.config.js
├── package.json
└── src/
    ├── constants.js          # Colors, dimensions, config
    ├── shapes.js             # Polygon geometry math
    ├── scale.js              # Scale/pitch quantization
    ├── state.js              # State management + useSyncExternalStore bridge
    ├── animation.js          # Easing functions
    ├── sequencer.js          # Scene auto-advance logic
    ├── audio/
    │   ├── audioEngine.js    # AudioContext, effects chain, init
    │   ├── timbres.js        # 8 timbres as raw Web Audio nodes
    │   └── scheduler.js      # Custom transport (replaces Tone.Transport)
    ├── rendering/
    │   ├── CanvasView.js     # Root Skia Canvas + gesture wrapper
    │   ├── ShapeRenderer.js  # Polygon rendering
    │   ├── ClockHand.js      # Rotating clock hand
    │   ├── GhostRing.js      # Add-shape dashed circle
    │   └── Animations.js     # Fire/spoke animation components
    ├── ui/
    │   ├── TopBar.js         # BPM slider + scale picker
    │   ├── SceneStrip.js     # Scene pill buttons
    │   ├── PianoRoll.js      # Full piano roll grid
    │   ├── PanelHeader.js    # Shape name, sides/sub steppers
    │   ├── TimbreRow.js      # Timbre buttons + reverb slider
    │   └── PianoRollCell.js  # Individual grid cell
    ├── gestures/
    │   ├── canvasGestures.js # Tap/pinch on Skia canvas
    │   └── hitTesting.js     # Pure math hit testing
    ├── midi/
    │   └── midiExport.js     # MIDI export via expo-sharing
    └── hooks/
        ├── useClockSync.js   # Drives clock angle from audio time
        └── useStore.js       # useSyncExternalStore bridge
```

## Code Style
- Functional components with hooks (no class components)
- Plain objects and functions for non-React logic (state.js, shapes.js, etc.)
- No `this` keyword in non-React code
- All state mutations through state.js update functions
- All magic numbers in constants.js
- All easing functions in animation.js

## Audio Rules
- AudioContext created on first user gesture
- All note scheduling through custom scheduler (scheduler.js)
- Never use setTimeout/setInterval for audio timing — only for scheduling lookahead
- Tone.Transport replaced by custom setInterval(25ms) + audioContext.currentTime lookahead

## Rendering Rules
- All canvas drawing via Skia declarative components
- Clock hand uses Reanimated shared values for 60fps UI-thread updates
- Fire/spoke animations use withTiming()

## Do NOT
- Do not use Expo Go (native modules required)
- Do not use Tone.js (replaced by react-native-audio-api)
- Do not use AsyncStorage or localStorage
- Do not use alert() or confirm()
- Do not use TypeScript (vanilla JS only)
