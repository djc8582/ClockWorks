// Interactive Skia visualizers for the FX racks — the GarageBand-class
// pattern: every effect shows its actual response, and you edit by
// dragging the graph itself. All curves come from the SAME RBJ math the
// audio graph runs (src/audio/dsp.js), so what you see is what you hear.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Canvas, Path, Circle, Line, Skia, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS } from '../constants.js';
import {
  biquadCoeffs, responseCurveDb, cutoffToHz, resToQ, eqGainDb, EQ_BANDS, EQ_RANGE_DB,
} from '../audio/dsp.js';

export const VIZ_W = 262;
export const VIZ_H = 96;
const PAD = 6;
const F_LO = 30, F_HI = 18000;

function freqToX(f) {
  return PAD + (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * (VIZ_W - PAD * 2);
}
function xToNorm(x) {
  return Math.max(0, Math.min(1, (x - PAD) / (VIZ_W - PAD * 2)));
}
function dbToY(db, range = 18) {
  return VIZ_H / 2 - (Math.max(-range, Math.min(range, db)) / range) * (VIZ_H / 2 - PAD);
}

function curvePath(dbs, range = 18) {
  const p = Skia.Path.Make();
  const n = dbs.length;
  for (let i = 0; i < n; i++) {
    const x = PAD + (i / (n - 1)) * (VIZ_W - PAD * 2);
    const y = dbToY(dbs[i], range);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  return p;
}

function Grid({ zeroLine = true }) {
  return (
    <>
      {[100, 1000, 10000].map(f => (
        <Line key={f} p1={vec(freqToX(f), PAD)} p2={vec(freqToX(f), VIZ_H - PAD)}
          color="rgba(0,0,0,0.06)" strokeWidth={1} />
      ))}
      {zeroLine && (
        <Line p1={vec(PAD, VIZ_H / 2)} p2={vec(VIZ_W - PAD, VIZ_H / 2)}
          color="rgba(0,0,0,0.1)" strokeWidth={1} />
      )}
    </>
  );
}

// ── Filter: response curve + XY pad (x = cutoff, y = resonance) ──
export function FilterViz({ fx, color, onChange }) {
  const cutoff = fx.cutoff !== undefined ? fx.cutoff : 1;
  const path = useMemo(() => {
    const hz = cutoffToHz(cutoff);
    const c = biquadCoeffs(fx.filterType || 'lowpass', hz, resToQ(fx.res), 0);
    return curvePath(responseCurveDb([c]));
  }, [fx.filterType, cutoff, fx.res]);

  const handleX = freqToX(cutoffToHz(cutoff));
  const handleY = PAD + (1 - Math.max(0, Math.min(1, fx.res))) * (VIZ_H - PAD * 2);

  const pan = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      const c = xToNorm(e.x);
      const r = Math.max(0, Math.min(1, 1 - (e.y - PAD) / (VIZ_H - PAD * 2)));
      onChange({ cutoff: Math.round(c * 100) / 100, res: Math.round(r * 100) / 100 });
    }), [onChange]);

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View style={styles.vizBox}>
          <Canvas style={{ width: VIZ_W, height: VIZ_H }}>
            <Grid />
            <Path path={path} color={color} style="stroke" strokeWidth={2.5} strokeJoin="round" />
            <Circle cx={handleX} cy={handleY} r={8} color={color + '40'} />
            <Circle cx={handleX} cy={handleY} r={4.5} color={color} />
          </Canvas>
        </View>
      </GestureDetector>
      <Text style={styles.vizHint}>drag · x = cutoff · y = resonance</Text>
    </View>
  );
}

// ── EQ: combined 3-band curve + draggable band handles ──────────
export function EqViz({ values, color, onChange }) {
  const { path, handles } = useMemo(() => {
    const stages = [
      biquadCoeffs('lowshelf', EQ_BANDS.low.freq, 0.707, eqGainDb(values.eqLow)),
      biquadCoeffs('peaking', EQ_BANDS.mid.freq, EQ_BANDS.mid.Q, eqGainDb(values.eqMid)),
      biquadCoeffs('highshelf', EQ_BANDS.high.freq, 0.707, eqGainDb(values.eqHigh)),
    ];
    const h = [
      { key: 'eqLow', x: freqToX(EQ_BANDS.low.freq), y: dbToY(eqGainDb(values.eqLow)) },
      { key: 'eqMid', x: freqToX(EQ_BANDS.mid.freq), y: dbToY(eqGainDb(values.eqMid)) },
      { key: 'eqHigh', x: freqToX(EQ_BANDS.high.freq), y: dbToY(eqGainDb(values.eqHigh)) },
    ];
    return { path: curvePath(responseCurveDb(stages)), handles: h };
  }, [values.eqLow, values.eqMid, values.eqHigh]);

  const pan = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      // Nearest band by x, gain by y
      const thirds = (VIZ_W - PAD * 2) / 3;
      const key = e.x < PAD + thirds ? 'eqLow' : e.x < PAD + thirds * 2 ? 'eqMid' : 'eqHigh';
      const db = ((VIZ_H / 2 - e.y) / (VIZ_H / 2 - PAD)) * 18;
      const v = Math.max(-1, Math.min(1, db / EQ_RANGE_DB));
      onChange({ [key]: Math.round(v * 100) / 100 });
    }), [onChange]);

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View style={styles.vizBox}>
          <Canvas style={{ width: VIZ_W, height: VIZ_H }}>
            <Grid />
            <Path path={path} color={color} style="stroke" strokeWidth={2.5} strokeJoin="round" />
            {handles.map(h => (
              <React.Fragment key={h.key}>
                <Circle cx={h.x} cy={h.y} r={8} color={color + '40'} />
                <Circle cx={h.x} cy={h.y} r={4.5} color={color} />
              </React.Fragment>
            ))}
          </Canvas>
        </View>
      </GestureDetector>
      <View style={styles.bandLabels}>
        <Text style={styles.bandLabel}>120Hz</Text>
        <Text style={styles.bandLabel}>1.2kHz</Text>
        <Text style={styles.bandLabel}>6kHz</Text>
      </View>
    </View>
  );
}

// ── Drive: tanh transfer curve ──────────────────────────────────
export function DriveViz({ drive, color }) {
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    const pre = drive < 0.15 ? 1 : drive < 0.6 ? 4 : 12;
    const norm = Math.tanh(pre) || 1;
    for (let i = 0; i <= 48; i++) {
      const x = -1 + (i / 48) * 2;
      const y = Math.tanh(x * pre) / norm;
      const px = PAD + ((x + 1) / 2) * (VIZ_W - PAD * 2);
      const py = VIZ_H / 2 - y * (VIZ_H / 2 - PAD);
      if (i === 0) p.moveTo(px, py);
      else p.lineTo(px, py);
    }
    return p;
  }, [drive]);

  return (
    <View style={styles.vizBox}>
      <Canvas style={{ width: VIZ_W, height: VIZ_H }}>
        <Line p1={vec(PAD, VIZ_H - PAD)} p2={vec(VIZ_W - PAD, PAD)}
          color="rgba(0,0,0,0.08)" strokeWidth={1} />
        <Path path={path} color={color} style="stroke" strokeWidth={2.5} strokeJoin="round" />
      </Canvas>
    </View>
  );
}

// ── Echo: ping-pong tap pattern, draggable (x = time, y = feedback) ──
export function EchoViz({ send, time, feedback, color, onChange }) {
  const taps = useMemo(() => {
    const out = [];
    let g = Math.max(0.05, send);
    for (let k = 1; k <= 3; k++) {
      g *= Math.max(0.05, feedback);
      out.push({
        x: PAD + Math.min(0.96, (k * time) / 2.1) * (VIZ_W - PAD * 2),
        h: Math.max(3, g * (VIZ_H - PAD * 2)),
        up: k % 2 === 1, // L taps up, R taps down — the ping-pong
      });
    }
    return out;
  }, [send, time, feedback]);

  const pan = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      const t = 0.05 + xToNorm(e.x) * 0.65;
      const fb = Math.max(0, Math.min(0.85, 1 - (e.y - PAD) / (VIZ_H - PAD * 2)));
      onChange({ delayTime: Math.round(t * 100) / 100, delayFeedback: Math.round(fb * 100) / 100 });
    }), [onChange]);

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View style={styles.vizBox}>
          <Canvas style={{ width: VIZ_W, height: VIZ_H }}>
            <Line p1={vec(PAD, VIZ_H / 2)} p2={vec(VIZ_W - PAD, VIZ_H / 2)}
              color="rgba(0,0,0,0.1)" strokeWidth={1} />
            {/* dry hit */}
            <Line p1={vec(PAD + 4, VIZ_H / 2)} p2={vec(PAD + 4, PAD)}
              color={COLORS.text} strokeWidth={3} strokeCap="round" />
            {taps.map((t, i) => (
              <Line key={i}
                p1={vec(t.x, VIZ_H / 2)}
                p2={vec(t.x, t.up ? VIZ_H / 2 - t.h / 2 : VIZ_H / 2 + t.h / 2)}
                color={color} strokeWidth={3} strokeCap="round" />
            ))}
          </Canvas>
        </View>
      </GestureDetector>
      <Text style={styles.vizHint}>drag · x = time · y = feedback · up/down = L/R</Text>
    </View>
  );
}

// ── Reverb: diffuse tap decay ───────────────────────────────────
export function ReverbViz({ send, color }) {
  const taps = [0.029, 0.061, 0.097, 0.141];
  return (
    <View style={styles.vizBox}>
      <Canvas style={{ width: VIZ_W, height: VIZ_H }}>
        <Line p1={vec(PAD, VIZ_H - PAD)} p2={vec(VIZ_W - PAD, VIZ_H - PAD)}
          color="rgba(0,0,0,0.1)" strokeWidth={1} />
        <Line p1={vec(PAD + 4, VIZ_H - PAD)} p2={vec(PAD + 4, PAD + 8)}
          color={COLORS.text} strokeWidth={3} strokeCap="round" />
        {taps.map((t, k) => {
          const g = Math.max(0.04, send * 0.7) * Math.pow(0.62, k);
          const x = PAD + (t / 0.18) * (VIZ_W - PAD * 2);
          return (
            <Line key={k}
              p1={vec(x, VIZ_H - PAD)}
              p2={vec(x, VIZ_H - PAD - Math.max(4, g * (VIZ_H - PAD * 2) * 1.6))}
              color={color} strokeWidth={3} strokeCap="round" />
          );
        })}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  vizBox: {
    width: VIZ_W,
    height: VIZ_H,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.7)',
    overflow: 'hidden',
    alignSelf: 'center',
  },
  vizHint: {
    fontSize: 8,
    color: COLORS.textDim,
    textAlign: 'center',
    marginTop: 3,
  },
  bandLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginTop: 2,
  },
  bandLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: COLORS.textDim,
  },
});
