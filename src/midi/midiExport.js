import { getState } from '../state.js';
import { TIMING } from '../constants.js';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportMIDI() {
  try {
    // Dynamic import of midi-writer-js
    const MidiWriterModule = await import('midi-writer-js');
    const MidiWriter = MidiWriterModule.default || MidiWriterModule;
    const state = getState();
    if (!state.scenes || state.scenes.length === 0) return;
    const tracks = [];

    const maxShapes = Math.max(0, ...state.scenes.map(s => s.shapes.length));
    if (maxShapes === 0) return;

    const ticksPerCycle = 128 * TIMING.defaultCycleBeats;

    for (let si = 0; si < maxShapes; si++) {
      const track = new MidiWriter.Track();
      track.setTempo(state.bpm);

      let tickOffset = 0;
      for (const scene of state.scenes) {
        if (si < scene.shapes.length) {
          const shape = scene.shapes[si];
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
                  const stepNum = vi * sub + s;
                  const noteEvent = new MidiWriter.NoteEvent({
                    pitch: pitch,
                    duration: 'T' + Math.max(1, Math.round(ticksPerCycle / totalSteps * 0.8)),
                    velocity: Math.max(1, Math.round((vel / 127) * 100)),
                    startTick: tickOffset + (ci * ticksPerCycle) + Math.round(stepNum * ticksPerCycle / totalSteps),
                    channel: si + 1,
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
    const dataUri = write.dataUri();

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
