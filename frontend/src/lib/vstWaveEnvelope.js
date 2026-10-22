export const WAVE_MIN_GAIN = 0.0001;
export const WAVE_DECLICK_ATTACK_SECONDS = 0.003;
// Exponential ramps cannot target absolute zero. Give the release a short
// final linear tail so stopping an oscillator never cuts a non-zero waveform.
export const WAVE_RELEASE_ZERO_SECONDS = 0.005;
export const WAVE_SOURCE_STOP_PADDING_SECONDS = 0.005;
// The amplitude envelope sits before the per-voice tone/effect chain. Keep a
// second gate at the very end of that chain and close it only during the final
// release tail, so filter state cannot be cut while it still contains a sample.
export const WAVE_RELEASE_OUTPUT_FADE_SECONDS = 0.012;
// Direct keyboard gestures still need a few render quanta of headroom. Starting
// an oscillator at currentTime can skip the silent edge of its attack ramp when
// the audio thread has already entered the current render quantum.
export const WAVE_DIRECT_START_LOOKAHEAD_SECONDS = 0.012;
// A held chord constructs several voices synchronously before any may start, so
// it needs enough shared headroom for the last voice to retain the same safe edge.
export const WAVE_CHORD_START_LOOKAHEAD_SECONDS = 0.02;

export const waveVoiceStartTime = (currentAudioTime, playbackOptions = null, currentPerformanceTime = 0) => {
  const audioNow = Number.isFinite(Number(currentAudioTime)) ? Number(currentAudioTime) : 0;
  const scheduledAtAudioTime = Number(playbackOptions?.scheduledAtAudioTime);
  if (Number.isFinite(scheduledAtAudioTime)) return Math.max(audioNow, scheduledAtAudioTime);
  const scheduledAtPerformance = Number(playbackOptions?.scheduledAtPerformance);
  if (playbackOptions?.patternScheduled && Number.isFinite(scheduledAtPerformance)) {
    return audioNow + Math.max(0, scheduledAtPerformance - Number(currentPerformanceTime || 0)) / 1000;
  }
  return audioNow + WAVE_DIRECT_START_LOOKAHEAD_SECONDS;
};

export const drainWaveVoiceRegistry = (registry) => {
  if (!(registry instanceof Map)) return [];
  const voices = Array.from(new Set(registry.values())).filter(Boolean);
  registry.clear();
  return voices;
};

export const moveWaveVoiceRegistryToken = (registry, currentToken, nextToken, voice) => {
  if (!(registry instanceof Map) || !voice) return null;
  const displacedVoice = registry.get(nextToken);
  registry.forEach((registeredVoice, registeredToken) => {
    if (
      registeredToken === currentToken
      || registeredVoice === voice
      || (displacedVoice && displacedVoice !== voice && registeredVoice === displacedVoice)
    ) registry.delete(registeredToken);
  });
  registry.set(nextToken, voice);
  return displacedVoice && displacedVoice !== voice ? displacedVoice : null;
};

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
