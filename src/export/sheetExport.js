// Sheet music PDF export — generates musical notation using pure HTML/CSS.
// Uses Unicode music symbols and CSS positioning for note placement on staves.
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getState } from '../state.js';
import { TIMING } from '../constants.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SHAPE_COLORS = ['#E84855', '#3185FC', '#FFBE0B', '#8338EC', '#06D6A0'];

function midiToNoteName(midi) {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}

// Map MIDI pitch to vertical position on a staff (treble clef)
// Middle C (60) = 1 ledger line below staff. Each step = half a staff space.
// Staff lines from bottom: E4(64), G4(67), B4(71), D5(74), F5(77)
function midiToStaffY(midi) {
  // C4=60 is at position 0, each semitone moves by the scale degree offset
  const noteInOctave = midi % 12;
  const octave = Math.floor(midi / 12);
  // Map chromatic pitch to diatonic position (C=0,D=1,E=2,F=3,G=4,A=5,B=6)
  const diatonicMap = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const diatonic = diatonicMap[noteInOctave];
  // Position relative to middle C (C4 = octave 5 in MIDI, diatonic 0)
  const pos = (octave - 5) * 7 + diatonic;
  // Convert to pixels: 0 = middle C (one ledger line below), each diatonic step = 5px
  // Staff bottom line (E4) is at pos=2, top line (F5) is at pos=9
  return pos;
}

function generateShapeStaff(shape, shapeIdx) {
  const color = SHAPE_COLORS[shapeIdx % SHAPE_COLORS.length];
  const sides = shape.sides || 3;
  const sub = shape.subdivision || 1;
  const isDrum = (shape.timbre || '').startsWith('drumkit');
  const timbre = shape.timbre || 'unknown';
  const noteWidth = 80;
  const staffWidth = sides * sub * noteWidth + 120;

  // Build note events
  const events = [];
  for (let vi = 0; vi < sides; vi++) {
    const v = shape.vertices[vi];
    if (!v) continue;
    for (let s = 0; s < sub; s++) {
      const sd = s === 0 ? v : (v.subs && v.subs[s - 1]);
      if (!sd || sd.muted) {
        events.push({ rest: true, step: vi * sub + s });
      } else if (isDrum) {
        const slots = sd.pitches || [vi % 4];
        const names = ['K', 'S', 'H', 'P'];
        events.push({ drum: slots.map(i => names[i % 4]).join(''), step: vi * sub + s });
      } else {
        const pitches = sd.pitches || [60];
        events.push({ pitches, step: vi * sub + s });
      }
    }
  }

  // SVG staff with 5 lines
  const staffH = 140;
  const staffTop = 40;
  const lineSpacing = 16; // space between staff lines

  let svg = `<svg width="${staffWidth}" height="${staffH + staffTop + 30}" xmlns="http://www.w3.org/2000/svg">`;

  // Staff lines
  for (let i = 0; i < 5; i++) {
    const y = staffTop + i * lineSpacing;
    svg += `<line x1="50" y1="${y}" x2="${staffWidth - 10}" y2="${y}" stroke="#999" stroke-width="1"/>`;
  }

  // Treble clef symbol
  if (!isDrum) {
    svg += `<text x="10" y="${staffTop + 50}" font-size="64" font-family="serif">\u{1D11E}</text>`;
  } else {
    svg += `<text x="16" y="${staffTop + 42}" font-size="24" font-weight="bold" fill="#666">DR</text>`;
  }

  // Time signature
  svg += `<text x="55" y="${staffTop + 24}" font-size="24" font-weight="bold" fill="#333">${sides}</text>`;
  svg += `<text x="55" y="${staffTop + 50}" font-size="24" font-weight="bold" fill="#333">${sub === 1 ? 4 : sub * 4}</text>`;

  // Bar line at start
  svg += `<line x1="78" y1="${staffTop}" x2="78" y2="${staffTop + 4 * lineSpacing}" stroke="#999" stroke-width="1.5"/>`;

  // Notes
  const noteStartX = 95;
  for (const evt of events) {
    const x = noteStartX + evt.step * noteWidth;

    // Beat group lines
    if (evt.step > 0 && evt.step % sub === 0) {
      svg += `<line x1="${x - 5}" y1="${staffTop}" x2="${x - 5}" y2="${staffTop + 40}" stroke="#ddd" stroke-width="0.5"/>`;
    }

    if (evt.rest) {
      // Rest marker
      svg += `<text x="${x}" y="${staffTop + 2 * lineSpacing + 5}" font-size="24" fill="#bbb" text-anchor="middle">-</text>`;
    } else if (evt.drum) {
      svg += `<text x="${x}" y="${staffTop + 2 * lineSpacing + 6}" font-size="20" font-weight="bold" fill="${color}" text-anchor="middle">x</text>`;
      svg += `<text x="${x}" y="${staffTop + 4 * lineSpacing + 22}" font-size="11" fill="#666" text-anchor="middle">${evt.drum}</text>`;
    } else {
      // Pitched notes
      for (const pitch of evt.pitches) {
        const pos = midiToStaffY(pitch);
        // pos: 0=C4(middle C), 2=E4(bottom line), 9=F5(top line)
        // Bottom staff line (E4, pos=2) is at staffTop + 4*lineSpacing
        // Each diatonic step moves 0.5 * lineSpacing
        const noteY = staffTop + 4 * lineSpacing - (pos - 2) * (lineSpacing / 2);

        // Ledger lines if needed
        if (noteY > staffTop + 4 * lineSpacing + 2) {
          for (let ly = staffTop + 5 * lineSpacing; ly <= noteY + 2; ly += lineSpacing) {
            svg += `<line x1="${x - 14}" y1="${ly}" x2="${x + 14}" y2="${ly}" stroke="#999" stroke-width="1"/>`;
          }
        }
        if (noteY < staffTop - 2) {
          for (let ly = staffTop - lineSpacing; ly >= noteY - 2; ly -= lineSpacing) {
            svg += `<line x1="${x - 14}" y1="${ly}" x2="${x + 14}" y2="${ly}" stroke="#999" stroke-width="1"/>`;
          }
        }

        // Note head (filled oval)
        svg += `<ellipse cx="${x}" cy="${noteY}" rx="8" ry="6" fill="${color}" transform="rotate(-12,${x},${noteY})"/>`;

        // Stem
        const stemDir = noteY > staffTop + 2 * lineSpacing ? -1 : 1;
        const stemX = stemDir === -1 ? x + 7 : x - 7;
        svg += `<line x1="${stemX}" y1="${noteY}" x2="${stemX}" y2="${noteY + stemDir * 40}" stroke="${color}" stroke-width="1.5"/>`;

        // Note name below staff
        svg += `<text x="${x}" y="${staffTop + 4 * lineSpacing + 22}" font-size="10" fill="#999" text-anchor="middle">${midiToNoteName(pitch)}</text>`;

        // Sharp indicator
        if (NOTE_NAMES[pitch % 12].includes('#')) {
          svg += `<text x="${x - 16}" y="${noteY + 5}" font-size="16" fill="${color}">#</text>`;
        }
      }
    }
  }

  // Final bar line
  svg += `<line x1="${staffWidth - 12}" y1="${staffTop}" x2="${staffWidth - 12}" y2="${staffTop + 4 * lineSpacing}" stroke="#333" stroke-width="2.5"/>`;

  svg += `</svg>`;

  return `
    <div style="margin-bottom:12px;">
      <p style="font-size:13px;color:${color};font-weight:600;margin:6px 0 2px 0;">${timbre}${sub > 1 ? ' (÷' + sub + ')' : ''}</p>
      <div style="overflow-x:auto;">${svg}</div>
    </div>
  `;
}

export async function exportSheet() {
  const state = getState();
  const bpm = state.bpm || 120;

  let parts = '';
  for (let si = 0; si < state.scenes.length; si++) {
    const scene = state.scenes[si];
    parts += `<h2 style="color:#666;font-size:13px;border-bottom:1px solid #eee;padding-bottom:3px;margin-top:20px;">Scene ${si + 1}</h2>`;
    for (let shi = 0; shi < scene.shapes.length; shi++) {
      parts += generateShapeStaff(scene.shapes[shi], shi);
    }
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 16px; color: #333; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 2px 0; }
  .meta { text-align: center; color: #999; font-size: 10px; margin-bottom: 16px; }
  svg { display: block; max-width: 100%; }
</style>
</head><body>
  <h1>Clockworks</h1>
  <div class="meta">${bpm} BPM &middot; ${state.scenes.length} scene${state.scenes.length > 1 ? 's' : ''}</div>
  ${parts}
</body></html>`;

  const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Export Sheet Music',
    });
  }
}
