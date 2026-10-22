export const WAVE_GENERATOR_MODES = [
  { id: "arpeggiator", label: "Arpeggiator", detail: "Pecah chord menjadi pola nada bergerak" },
  { id: "chord", label: "Chord Generator", detail: "Susun progresi chord siap pakai" },
  { id: "step", label: "Step Sequencer", detail: "Program nada per langkah" },
  { id: "bassline", label: "Bassline Generator", detail: "Buat groove bass otomatis" },
  { id: "melody", label: "Melody Generator", detail: "Rancang frase melodi musikal" },
];

export const WAVE_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const WAVE_SCALE_OPTIONS = [
  { id: "major", label: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", label: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "pentatonic", label: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10] },
];

export const WAVE_PROGRESSION_OPTIONS = [
  { id: "pop", label: "Pop · I–V–vi–IV", degrees: [0, 4, 5, 3] },
  { id: "emotive", label: "Emotive · vi–IV–I–V", degrees: [5, 3, 0, 4] },
  { id: "classic", label: "Classic · I–vi–IV–V", degrees: [0, 5, 3, 4] },
  { id: "dark", label: "Dark · i–VI–III–VII", degrees: [0, 5, 2, 6] },
];

export const WAVE_SINGLE_CHORD_OPTIONS = [
  { id: "major", label: "Major", intervals: [0, 4, 7] },
  { id: "minor", label: "Minor", intervals: [0, 3, 7] },
  { id: "major7", label: "Major 7", intervals: [0, 4, 7, 11] },
  { id: "minor7", label: "Minor 7", intervals: [0, 3, 7, 10] },
  { id: "sus2", label: "Sus 2", intervals: [0, 2, 7] },
  { id: "sus4", label: "Sus 4", intervals: [0, 5, 7] },
  { id: "aug", label: "Aug", intervals: [0, 4, 8] },
];

export const DEFAULT_STEP_NOTES = [0, null, 2, null, 4, null, 2, null, 0, null, 3, null, 4, 2, 1, null];

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
};

const scaleFor = (scaleId) => WAVE_SCALE_OPTIONS.find((scale) => scale.id === scaleId) || WAVE_SCALE_OPTIONS[0];

const degreePitch = (rootPitch, intervals, degree, octaveOffset = 0) => {
  const size = intervals.length;
  const normalizedDegree = ((degree % size) + size) % size;
  const octave = Math.floor(degree / size) + octaveOffset;
  return Math.max(0, Math.min(127, rootPitch + intervals[normalizedDegree] + octave * 12));
};

const seededUnit = (seed) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const addNote = (notes, step, length, pitch, velocity = 100) => {
  notes.push({ step, length: Math.max(0.1, length), pitch: Math.round(pitch), velocity: Math.round(clamp(velocity, 1, 127, 100)) });
};

const compareMidiEvents = (left, right) => {
  const leftTypeOrder = left.type === "note_off" ? 0 : 1;
  const rightTypeOrder = right.type === "note_off" ? 0 : 1;
  return left.tick - right.tick || leftTypeOrder - rightTypeOrder || left.note - right.note;
};

const arpeggiatorNotes = (config, rootPitch, intervals) => {
  const chordSize = config.chordType === "seventh" ? 4 : 3;
  const octaves = Math.round(clamp(config.octaves, 1, 3, 2));
  let degrees = [];
  for (let octave = 0; octave < octaves; octave += 1) {
    for (let chordTone = 0; chordTone < chordSize; chordTone += 1) degrees.push(chordTone * 2 + octave * intervals.length);
  }
  if (config.direction === "down") degrees = [...degrees].reverse();
  if (config.direction === "updown" && degrees.length > 2) degrees = [...degrees, ...degrees.slice(1, -1).reverse()];
  return Array.from({ length: config.steps }, (_, step) => {
    const randomIndex = Math.floor(seededUnit(step + config.variation * 31) * degrees.length);
    const degree = config.direction === "random" ? degrees[randomIndex] : degrees[step % degrees.length];
    return { step, degree, velocity: step % 4 === 0 ? 116 : 94 };
  }).map(({ step, degree, velocity }) => ({ step, length: config.gate, pitch: degreePitch(rootPitch, intervals, degree), velocity }));
};

const progressionDegrees = (value) => {
  const romanDegrees = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
  const tokens = String(value || "")
    .replace(/[–—]/g, "-")
    .split(/[\s,;|>\-/]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 16);
  return tokens.map((token) => {
    const cleaned = token.replace(/[°º+]/g, "").replace(/(?:maj|min|dim|aug|sus)?7?$/i, "");
    if (/^[1-7]$/.test(cleaned)) return Number(cleaned) - 1;
    return romanDegrees[cleaned.toUpperCase()];
  }).filter(Number.isInteger);
};

const chordNotes = (config, rootPitch, intervals) => {
  if (config.chordMode === "single") {
    const chord = WAVE_SINGLE_CHORD_OPTIONS.find((item) => item.id === config.singleChordType) || WAVE_SINGLE_CHORD_OPTIONS[0];
    const notes = [];
    chord.intervals.forEach((interval, noteIndex) => {
      addNote(notes, 0, Math.min(config.steps, config.steps * config.gate), Math.min(127, rootPitch + interval), noteIndex === 0 ? 108 : 92);
    });
    return notes;
  }
  const legacyProgression = WAVE_PROGRESSION_OPTIONS.find((item) => item.id === config.progression) || WAVE_PROGRESSION_OPTIONS[0];
  const degrees = progressionDegrees(config.customProgression);
  const progression = degrees.length ? degrees : legacyProgression.degrees;
  const chordLength = Math.max(1, Math.floor(config.steps / progression.length));
  const notes = [];
  progression.forEach((degree, index) => {
    const step = index * chordLength;
    [degree, degree + 2, degree + 4].forEach((chordDegree, noteIndex) => {
      addNote(notes, step, chordLength * config.gate, degreePitch(rootPitch, intervals, chordDegree), noteIndex === 0 ? 108 : 92);
    });
  });
  return notes;
};

const stepSequencerNotes = (config, rootPitch, intervals) => {
  const pattern = Array.isArray(config.stepNotes) ? config.stepNotes : DEFAULT_STEP_NOTES;
  const notes = [];
  Array.from({ length: config.steps }, (_, step) => pattern[step % pattern.length]).forEach((degree, step) => {
    if (degree === null || degree === undefined || Number(degree) < 0) return;
    addNote(notes, step, config.gate, degreePitch(rootPitch, intervals, Number(degree)), step % 4 === 0 ? 114 : 96);
  });
  return notes;
};

const basslineNotes = (config, rootPitch, intervals) => {
  const patterns = {
    pulse: [0, null, 0, 2, 0, null, 4, null, 0, 2, 3, null, 0, null, 4, 2],
    octave: [0, null, 7, null, 0, 4, 7, null, 0, null, 7, 5, 0, 4, 2, null],
    acid: [0, null, 0, 1, 2, null, 0, 4, 0, 5, null, 4, 3, null, 1, 2],
    syncopated: [0, null, null, 0, 4, null, 2, null, null, 0, 5, null, 4, null, 2, null],
  };
  const pattern = patterns[config.bassStyle] || patterns.pulse;
  const notes = [];
  Array.from({ length: config.steps }, (_, step) => pattern[step % pattern.length]).forEach((degree, step) => {
    if (degree === null) return;
    const accent = step % 4 === 0 || (config.bassStyle === "acid" && step % 5 === 0);
    addNote(notes, step, accent ? Math.min(1.35, config.gate + 0.2) : config.gate, degreePitch(rootPitch - 12, intervals, degree), accent ? 120 : 94);
  });
  return notes;
};

const melodyNotes = (config, rootPitch, intervals) => {
  const density = clamp(config.density, 0.25, 1, 0.7);
  const range = Math.round(clamp(config.range, 1, 3, 2)) * intervals.length;
  const notes = [];
  let previousDegree = Math.floor(range / 2);
  for (let step = 0; step < config.steps; step += 1) {
    const chance = seededUnit(step * 7 + config.variation * 41);
    if (step % 4 !== 0 && chance > density) continue;
    const movement = Math.floor(seededUnit(step * 13 + config.variation * 17) * 7) - 3;
    previousDegree = Math.max(0, Math.min(range, previousDegree + movement));
    if (config.contour === "rising") previousDegree = Math.max(previousDegree, Math.floor((step / Math.max(1, config.steps - 1)) * range));
    if (config.contour === "falling") previousDegree = Math.min(previousDegree, Math.ceil((1 - step / Math.max(1, config.steps - 1)) * range));
    addNote(notes, step, chance < 0.22 ? Math.min(2, config.gate * 1.7) : config.gate, degreePitch(rootPitch, intervals, previousDegree), step % 4 === 0 ? 112 : 88 + Math.round(chance * 22));
  }
  return notes;
};

const displayName = (config) => {
  const root = WAVE_NOTE_NAMES[config.root];
  const scale = scaleFor(config.scale).label;
  const labels = {
    arpeggiator: "Arpeggiator",
    chord: "Chord Generator",
    step: "Step Sequencer",
    bassline: "Bassline Generator",
    melody: "Melody Generator",
  };
  if (config.mode === "chord" && config.chordMode === "single") {
    const chord = WAVE_SINGLE_CHORD_OPTIONS.find((item) => item.id === config.singleChordType) || WAVE_SINGLE_CHORD_OPTIONS[0];
    return `Chord Generator · ${root} ${chord.label}`;
  }
  return `${labels[config.mode] || labels.arpeggiator} · ${root} ${scale}`;
};

export const normalizeWaveGeneratorConfig = (input = {}) => ({
  mode: WAVE_GENERATOR_MODES.some((mode) => mode.id === input.mode) ? input.mode : "arpeggiator",
  root: Math.round(clamp(input.root, 0, 11, 0)),
  octave: Math.round(clamp(input.octave, 1, 6, 3)),
  scale: scaleFor(input.scale).id,
  bpm: Math.round(clamp(input.bpm, 40, 240, 120)),
  steps: [8, 16, 32].includes(Number(input.steps)) ? Number(input.steps) : 16,
  gate: clamp(input.gate, 0.15, 1.75, 0.78),
  variation: Math.max(0, Math.round(clamp(input.variation, 0, 9999, 0))),
  chordType: input.chordType === "seventh" ? "seventh" : "triad",
  direction: ["up", "down", "updown", "random"].includes(input.direction) ? input.direction : "up",
  octaves: Math.round(clamp(input.octaves, 1, 3, 2)),
  chordMode: input.chordMode === "single" ? "single" : "progression",
  singleChordType: WAVE_SINGLE_CHORD_OPTIONS.some((chord) => chord.id === input.singleChordType) ? input.singleChordType : "major",
  progression: WAVE_PROGRESSION_OPTIONS.some((progression) => progression.id === input.progression) ? input.progression : "pop",
  customProgression: typeof input.customProgression === "string" && input.customProgression.trim()
    ? input.customProgression.trim().slice(0, 96)
    : "I - V - vi - IV",
  bassStyle: ["pulse", "octave", "acid", "syncopated"].includes(input.bassStyle) ? input.bassStyle : "pulse",
  contour: ["free", "rising", "falling"].includes(input.contour) ? input.contour : "free",
  density: clamp(input.density, 0.25, 1, 0.7),
  range: Math.round(clamp(input.range, 1, 3, 2)),
  stepNotes: Array.from({ length: 32 }, (_, index) => {
    const value = Array.isArray(input.stepNotes) ? input.stepNotes[index] : DEFAULT_STEP_NOTES[index % DEFAULT_STEP_NOTES.length];
    if (value === null || value === undefined || Number(value) < 0) return null;
    return Math.round(clamp(value, 0, 20, 0));
  }),
});

export const createWaveGeneratorSequence = (input = {}, sequenceId = null) => {
  const config = normalizeWaveGeneratorConfig(input);
  const intervals = scaleFor(config.scale).intervals;
  const rootPitch = Number.isInteger(input.triggerPitch)
    ? Math.round(clamp(input.triggerPitch, 0, 127, 60))
    : 12 * (config.octave + 1) + config.root;
  const factories = {
    arpeggiator: arpeggiatorNotes,
    chord: chordNotes,
    step: stepSequencerNotes,
    bassline: basslineNotes,
    melody: melodyNotes,
  };
  const notes = factories[config.mode](config, rootPitch, intervals);
  const ppq = 480;
  const ticksPerStep = ppq / 4;
  const events = notes.flatMap((note) => [
    { tick: Math.round(note.step * ticksPerStep), type: "note_on", note: note.pitch, velocity: note.velocity, channel: 0 },
    { tick: Math.round((note.step + note.length) * ticksPerStep), type: "note_off", note: note.pitch, velocity: 0, channel: 0 },
  ]).sort(compareMidiEvents);
  return {
    id: String(sequenceId || globalThis.crypto?.randomUUID?.() || `wave-pattern-${Date.now()}`),
    name: displayName(config).slice(0, 160),
    ppq,
    durationTicks: config.steps * ticksPerStep,
    loopEnabled: !(config.mode === "chord" && config.chordMode === "single"),
    events,
    tempos: [{ tick: 0, bpm: config.bpm }],
    generatorConfig: config,
  };
};
