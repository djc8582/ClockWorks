// Pure MIDI builder (no Expo/RN imports — unit-tested under Node).
// Step timing comes from audio/eventWindow.js's stepPhase(), the same
// definition the live scheduler uses, so an exported note lands on the
// tick that corresponds to the moment the app plays it.
import { TIMING, MAX_SUBDIVISION } from '../constants.js';
import { stepPhase } from '../audio/eventWindow.js';
import { songScenes } from '../looper.js';

// General MIDI percussion notes for the 4 drum slots (kick, snare, hihat, perc)
const GM_DRUM_NOTES = [36, 38, 42, 39];
export const MIDI_PPQ = 128; // midi-writer-js fixed header division

// Melodic channels 1-16, skipping 10 (reserved for percussion in GM)
function melodicChannel(trackIndex) {
  const usable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
  return usable[trackIndex % usable.length];
}

// Flat note list: [{ track, tick, durTicks, pitch, velocity, channel }]
export function buildMidiNotes(state) {
  const notes = [];
  if (!state || !state.scenes || state.scenes.length === 0) return { notes, trackCount: 0 };
  // The song's bars in play order (per-layer loops are already
  // materialized into each bar). Bars past the song end — which hold
  // loop repeats for the strip preview — are not exported.
  const scenes = songScenes(state);
  const maxShapes = Math.max(0, ...scenes.map(s => s.shapes.length));
  if (maxShapes === 0) return { notes, trackCount: 0 };

  const ticksPerCycle = MIDI_PPQ * TIMING.defaultCycleBeats;

  for (let si = 0; si < maxShapes; si++) {
    let tickOffset = 0;
    for (const scene of scenes) {
      if (si < scene.shapes.length) {
        const shape = scene.shapes[si];
        const isDrum = (shape.timbre || '').startsWith('drumkit');
        // Same subdivision cap as the live engine
        const sub = Math.max(1, Math.min(shape.subdivision || 1, MAX_SUBDIVISION));
        const totalSteps = shape.sides * sub;

        for (let ci = 0; ci < TIMING.sceneCycles; ci++) {
          for (let vi = 0; vi < shape.vertices.length; vi++) {
            const v = shape.vertices[vi];
            const steps = [v, ...(v.subs || [])];
            for (let s = 0; s < Math.min(steps.length, sub); s++) {
              const step = steps[s];
              if (!step || step.muted) continue;
              // Drum default mirrors the engine (vertex index → slot)
              const pitches = step.pitches || (isDrum ? [vi % 4] : [60]);
              const vel = step.velocity != null ? step.velocity : 85;
              const stepNum = vi * sub + s;
              for (const pitch of pitches) {
                // Drum slots map to GM percussion on channel 10; melodic
                // pitches are rounded (MIDI has no fractional notes) + clamped
                const midiPitch = isDrum
                  ? GM_DRUM_NOTES[((Math.round(pitch) % 4) + 4) % 4]
                  : Math.max(0, Math.min(127, Math.round(pitch)));
                notes.push({
                  track: si,
                  tick: tickOffset + (ci * ticksPerCycle) + Math.round(stepPhase(stepNum, totalSteps) * ticksPerCycle),
                  durTicks: Math.max(1, Math.round(ticksPerCycle / totalSteps * 0.8)),
                  pitch: midiPitch,
                  velocity: Math.max(1, Math.min(100, Math.round((vel / 127) * 100))),
                  channel: isDrum ? 10 : melodicChannel(si),
                });
              }
            }
          }
        }
      }
      tickOffset += TIMING.sceneCycles * ticksPerCycle;
    }
  }
  return { notes, trackCount: maxShapes };
}

// Build the MIDI file as a data URI — pure (no file I/O, no share sheet),
// so the self-test harness and Node tests can validate it directly.
export async function buildMidiDataUri(state) {
  const MidiWriterModule = await import('midi-writer-js');
  const MidiWriter = MidiWriterModule.default || MidiWriterModule;
  const { notes, trackCount } = buildMidiNotes(state);
  if (trackCount === 0) return null;
  const tracks = [];
  for (let t = 0; t < trackCount; t++) {
    const track = new MidiWriter.Track();
    track.setTempo(state.bpm);
    tracks.push(track);
  }
  for (const n of notes) {
    tracks[n.track].addEvent(new MidiWriter.NoteEvent({
      pitch: n.pitch,
      duration: 'T' + n.durTicks,
      velocity: n.velocity,
      startTick: n.tick,
      channel: n.channel,
    }));
  }
  const write = new MidiWriter.Writer(tracks);
  return write.dataUri();
}
