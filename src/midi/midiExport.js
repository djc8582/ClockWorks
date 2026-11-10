import { getState } from '../state.js';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Pure builder lives in midiBuild.js (unit-tested under Node)
export { buildMidiDataUri, buildMidiNotes } from './midiBuild.js';
import { buildMidiDataUri } from './midiBuild.js';

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
