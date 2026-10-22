import {
  DEFAULT_STEP_NOTES,
  WAVE_GENERATOR_MODES,
  createWaveGeneratorSequence,
  normalizeWaveGeneratorConfig,
} from "./vstWaveGenerators";

describe("Wave Generator pattern tools", () => {
  test("offers the five requested generators", () => {
    expect(WAVE_GENERATOR_MODES.map(({ id }) => id)).toEqual([
      "arpeggiator", "chord", "step", "bassline", "melody",
    ]);
  });

  test.each(WAVE_GENERATOR_MODES.map(({ id }) => id))("creates a valid loop for %s", (mode) => {
    const sequence = createWaveGeneratorSequence({ mode, root: 9, scale: "minor", bpm: 132, steps: 16 }, `test-${mode}`);
    expect(sequence).toEqual(expect.objectContaining({
      id: `test-${mode}`,
      ppq: 480,
      durationTicks: 1920,
      loopEnabled: true,
      tempos: [{ tick: 0, bpm: 132 }],
    }));
    expect(sequence.events.some((event) => event.type === "note_on")).toBe(true);
    expect(sequence.events.every((event) => event.tick >= 0 && event.note >= 0 && event.note <= 127)).toBe(true);
    expect(sequence.events).toEqual([...sequence.events].sort((left, right) => {
      const leftTypeOrder = left.type === "note_off" ? 0 : 1;
      const rightTypeOrder = right.type === "note_off" ? 0 : 1;
      return left.tick - right.tick || leftTypeOrder - rightTypeOrder || left.note - right.note;
    }));
  });

  test("step sequencer respects rests and selected scale degrees", () => {
    const sequence = createWaveGeneratorSequence({
      mode: "step", root: 0, octave: 3, scale: "major", steps: 8,
      stepNotes: [0, null, 1, null, 2, null, 3, null],
    }, "step-test");
    expect(sequence.events.filter(({ type }) => type === "note_on").map(({ note }) => note)).toEqual([48, 50, 52, 53]);
  });

  test("uses a held keyboard or MIDI note as the live pattern root", () => {
    const sequence = createWaveGeneratorSequence({
      mode: "step", root: 0, octave: 3, scale: "major", steps: 8, triggerPitch: 57,
      stepNotes: [0, null, 1, null, 2, null, 3, null],
    }, "live-trigger-test");
    expect(sequence.events.filter(({ type }) => type === "note_on").map(({ note }) => note)).toEqual([57, 59, 61, 62]);
  });

  test("exposes one root chord at tick zero for live chord triggering", () => {
    const sequence = createWaveGeneratorSequence({ mode: "chord", chordMode: "single", singleChordType: "major", scale: "major", triggerPitch: 60 }, "live-chord-test");
    expect(sequence.events.filter(({ type, tick }) => type === "note_on" && tick === 0).map(({ note }) => note)).toEqual([60, 64, 67]);
    expect(sequence.loopEnabled).toBe(false);
  });

  test.each([
    ["major7", [60, 64, 67, 71]],
    ["minor7", [60, 63, 67, 70]],
    ["sus2", [60, 62, 67]],
    ["sus4", [60, 65, 67]],
    ["aug", [60, 64, 68]],
  ])("creates the requested single chord type %s", (singleChordType, expectedNotes) => {
    const sequence = createWaveGeneratorSequence({ mode: "chord", chordMode: "single", singleChordType, triggerPitch: 60 }, `single-${singleChordType}`);
    expect(sequence.events.filter(({ type }) => type === "note_on").map(({ note }) => note)).toEqual(expectedNotes);
  });

  test("accepts a user-written chord progression and preserves generator metadata", () => {
    const sequence = createWaveGeneratorSequence({
      mode: "chord", chordMode: "progression", scale: "major", triggerPitch: 60,
      customProgression: "I - vi - IV - V", steps: 16,
    }, "custom-progression");
    const roots = sequence.events.filter(({ type }) => type === "note_on").filter((_, index) => index % 3 === 0);
    expect(roots.map(({ note }) => note)).toEqual([60, 69, 65, 67]);
    expect(sequence.loopEnabled).toBe(true);
    expect(sequence.generatorConfig).toEqual(expect.objectContaining({ chordMode: "progression", customProgression: "I - vi - IV - V" }));
  });

  test("uses deterministic variation and clamps unsafe input", () => {
    const first = createWaveGeneratorSequence({ mode: "melody", variation: 7 }, "first");
    const second = createWaveGeneratorSequence({ mode: "melody", variation: 7 }, "second");
    expect(first.events).toEqual(second.events);
    expect(normalizeWaveGeneratorConfig({ bpm: 999, steps: 7, stepNotes: DEFAULT_STEP_NOTES })).toEqual(expect.objectContaining({ bpm: 240, steps: 16 }));
  });
});
