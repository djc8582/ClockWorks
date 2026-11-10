// Pure voice-pool policy (no React Native imports — unit-tested under Node).
//
// Voice entry shape: { start, silentAt, endTime, tap, killed }
//   start    — scheduled start time (audio clock)
//   silentAt — time after which the voice's envelope is at 0 (inaudible)
//   endTime  — time after which the voice can be pruned
//
// On react-native-audio-api 0.6.5 a sounding voice can't be faded on
// demand (AudioParam events before the queue end are ignored and
// cancelScheduledValues crashes), so killing a SOUNDING voice is a hard
// cut = an audible click. The old policy evicted "oldest tap, else index 0"
// regardless of audibility. Prefer victims that make no sound when killed.
export function pickVictimIndex(voices, now) {
  const last = voices.length - 1; // never evict the voice being added
  let best = -1;
  let bestRank = Infinity;
  let bestKey = Infinity;
  for (let i = 0; i < last; i++) {
    const v = voices[i];
    let rank;
    if (v.killed || v.silentAt <= now) rank = 0;     // already inaudible — free
    else if (v.tap && v.start > now) rank = 1;       // echo/verb tap not started — silent drop
    else if (v.tap) rank = 2;                        // sounding tap — quiet, decaying copy
    else if (v.start <= now) rank = 3;               // sounding main note — oldest is most decayed
    else rank = 4;                                   // future main note — last resort (a dropped note)
    const key = rank === 4 ? -v.start : v.start;     // future notes: drop the furthest-out one
    if (rank < bestRank || (rank === bestRank && key < bestKey)) {
      best = i; bestRank = rank; bestKey = key;
      if (rank === 0) break;
    }
  }
  return best === -1 ? 0 : best;
}
