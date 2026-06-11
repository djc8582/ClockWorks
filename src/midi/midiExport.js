import { getState } from '../state.js';
import { TIMING } from '../constants.js';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// General MIDI percussion notes for the 4 drum slots (kick, snare, hihat, perc)
const GM_DRUM_NOTES = [36, 38, 42, 39];

// Melodic channels 1-16, skipping 10 (reserved for percussion in GM)
function melodicChannel(trackIndex) {
  const usable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
  return usable[trackIndex % usable.length];
}

// Build the MIDI file as a data URI — pure (no file I/O, no share sheet),
// so the self-test harness can validate it directly.
export async function buildMidiDataUri(state) {
    // Dynamic import of midi-writer-js
    const MidiWriterModule = await import('midi-writer-js');
    const MidiWriter = MidiWriterModule.default || MidiWriterModule;
    if (!state.scenes || state.scenes.length === 0) return null;
    const tracks = [];

    // Only export scenes that actually contain shapes — disabled/empty
    // slots would otherwise become long stretches of silence
    const scenes = state.scenes.filter(sc => sc.shapes && sc.shapes.length > 0);
    const maxShapes = Math.max(0, ...scenes.map(s => s.shapes.length));
    if (maxShapes === 0) return null;

    const ticksPerCycle = 128 * TIMING.defaultCycleBeats;

    for (let si = 0; si < maxShapes; si++) {
      const track = new MidiWriter.Track();
      track.setTempo(state.bpm);

      let tickOffset = 0;
      for (const scene of scenes) {
        if (si < scene.shapes.length) {
          const shape = scene.shapes[si];
          const isDrum = (shape.timbre || '').startsWith('drumkit');
          const sub = shape.subdivision || 1;
          const totalSteps = shape.sides * sub;

          for (let ci = 0; ci < TIMING.sceneCycles; ci++) {
            for (let vi = 0; vi < shape.vertices.length; vi++) {
              const v = shape.vertices[vi];
              const steps = [v, ...(v.subs || [])];
              for (let s = 0; s < Math.min(steps.length, sub); s++) {
                const step = steps[s];
                if (step.muted) continue;
                const pitches = step.pitches || [60];
                const vel = step.velocity != null ? step.velocity : 85;
                for (const pitch of pitches) {
                  // Drum slots map to GM percussion on channel 10; melodic
                  // pitches are rounded (MIDI has no fractional notes) + clamped
                  const midiPitch = isDrum
                    ? GM_DRUM_NOTES[((Math.round(pitch) % 4) + 4) % 4]
                    : Math.max(0, Math.min(127, Math.round(pitch)));
                  const stepNum = vi * sub + s;
                  const noteEvent = new MidiWriter.NoteEvent({
                    pitch: midiPitch,
                    duration: 'T' + Math.max(1, Math.round(ticksPerCycle / totalSteps * 0.8)),
                    velocity: Math.max(1, Math.round((vel / 127) * 100)),
                    startTick: tickOffset + (ci * ticksPerCycle) + Math.round(stepNum * ticksPerCycle / totalSteps),
                    channel: isDrum ? 10 : melodicChannel(si),
                  });
                  track.addEvent(noteEvent);
                }
              }
            }
          }
        }
        tickOffset += TIMING.sceneCycles * ticksPerCycle;
      }

      tracks.push(track);
    }

    const write = new MidiWriter.Writer(tracks);
    return write.dataUri();
}

export async function exportMIDI() {
  try {
    const dataUri = await buildMidiDataUri(getState());
    if (!dataUri) return;

    // Extract base64 data from data URI
    const base64Data = dataUri.split(',')[1];

    // Write to temp file
    const fileUri = FileSystem.cacheDirectory + 'clockworks.mid';
    await FileSystem.writeAsStringAsync(fileUri, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Share
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'audio/midi',
        dialogTitle: 'Export MIDI',
      });
    }
  } catch (err) {
    console.warn('MIDI export failed:', err);
  }
}
