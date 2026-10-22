import {
  WAVE_DECLICK_ATTACK_SECONDS,
  WAVE_MIN_GAIN,
  shouldScheduleWaveRelease,
  waveAmpEnvelopeValueAt,
} from "./vstWaveEnvelope";

describe("Wave Generator amplitude envelope", () => {
  const envelope = {
    startAt: 10,
    attackSeconds: WAVE_DECLICK_ATTACK_SECONDS,
    decaySeconds: 0.15,
    targetGain: 0.24,
    sustainGain: 0.24,
  };

  test("keeps a queued short-note release at its actual envelope level", () => {
    const releaseGain = waveAmpEnvelopeValueAt(envelope, 10.0975);
    expect(releaseGain).toBeCloseTo(0.24, 6);
    expect(releaseGain).not.toBe(1);
  });

  test("calculates exponential attack and decay values at future timestamps", () => {
    const attackMidpoint = waveAmpEnvelopeValueAt(envelope, 10 + WAVE_DECLICK_ATTACK_SECONDS / 2);
    expect(attackMidpoint).toBeCloseTo(Math.sqrt(WAVE_MIN_GAIN * 0.24), 6);

    const decaying = { ...envelope, targetGain: 0.32, sustainGain: 0.08 };
    const decayMidpoint = waveAmpEnvelopeValueAt(decaying, 10 + WAVE_DECLICK_ATTACK_SECONDS + 0.075);
    expect(decayMidpoint).toBeCloseTo(Math.sqrt(0.32 * 0.08), 6);
  });

  test("returns the silent floor before a scheduled voice begins", () => {
    expect(waveAmpEnvelopeValueAt(envelope, 9.9)).toBe(WAVE_MIN_GAIN);
  });

  test("does not restart a release tail at a later loop boundary", () => {
    expect(shouldScheduleWaveRelease(12.098, 12.125)).toBe(false);
    expect(shouldScheduleWaveRelease(12.125, 12.098)).toBe(true);
    expect(shouldScheduleWaveRelease(12.098, 12.125, true)).toBe(true);
  });
});
