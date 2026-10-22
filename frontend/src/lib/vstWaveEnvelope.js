export const WAVE_MIN_GAIN = 0.0001;
export const WAVE_DECLICK_ATTACK_SECONDS = 0.003;

export const shouldScheduleWaveRelease = (currentReleaseAt, nextReleaseAt, immediate = false) => {
  if (immediate) return true;
  const current = Number(currentReleaseAt);
  const next = Number(nextReleaseAt);
  if (!Number.isFinite(current) || !Number.isFinite(next)) return true;
  return next < current;
};

const positiveGain = (value, fallback = WAVE_MIN_GAIN) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(WAVE_MIN_GAIN, number) : fallback;
};

const exponentialValue = (start, end, progress) => {
  const from = positiveGain(start);
  const to = positiveGain(end);
  const amount = Math.max(0, Math.min(1, Number(progress) || 0));
  return from * ((to / from) ** amount);
};

// AudioParam.value only describes the value at the current render quantum. A
// Pattern Lab note-off may be queued hundreds of milliseconds early, so its
// release must derive the gain at that future timestamp from the envelope.
export const waveAmpEnvelopeValueAt = (envelope, atTime) => {
  if (!envelope) return WAVE_MIN_GAIN;
  const startAt = Number(envelope.startAt) || 0;
  const elapsed = Number(atTime) - startAt;
  const attackSeconds = Math.max(0, Number(envelope.attackSeconds) || 0);
  const decaySeconds = Math.max(0, Number(envelope.decaySeconds) || 0);
  const targetGain = positiveGain(envelope.targetGain);
  const sustainGain = positiveGain(envelope.sustainGain);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return WAVE_MIN_GAIN;
  if (attackSeconds > 0 && elapsed < attackSeconds) {
    return exponentialValue(WAVE_MIN_GAIN, targetGain, elapsed / attackSeconds);
  }
  const decayElapsed = elapsed - attackSeconds;
  if (decaySeconds > 0 && decayElapsed < decaySeconds) {
    return exponentialValue(targetGain, sustainGain, decayElapsed / decaySeconds);
  }
  return sustainGain;
};
