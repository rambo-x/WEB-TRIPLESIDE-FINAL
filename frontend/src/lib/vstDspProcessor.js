// The browser rack mirrors native-vst3/Source/DspModules.cpp sample by sample.
// Keep constants and operation order aligned with that file; parity tests guard
// the contract. AudioWorklet keeps this code off the UI thread.
export const createNativeDspProcessorClass = (BaseProcessor, workletSampleRate) => {
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));
  const dbGain = (db) => 10 ** (db / 20);
  // Nonlinear amp stages naturally drive low-level DI signals toward full
  // scale. Keep their internal circuit level separate from the user-facing
  // Master control so engaging an amp does not create a startling jump.
  const AMP_REFERENCE_GAIN = dbGain(-12);
  const PI = Math.PI;
  const OVERSAMPLING_FACTOR = 4;
  const CABINET_IR_LENGTH = 512;
  const CABINET_TAPS = 224;
  const CABINET_REFLECTION_HISTORY = 1024;
  const SMOOTH_REVERB_DELAY_PROFILES = [
    [11.3, 13.7, 17.3, 19.9, 23.9, 29.3, 31.7, 37.1],
    [15.1, 18.7, 23.3, 27.7, 32.9, 38.3, 44.9, 52.1],
    [19.1, 23.9, 29.7, 35.3, 41.9, 47.9, 56.3, 67.1],
    [29.7, 37.1, 41.9, 47.9, 53.9, 61.3, 71.9, 83.3],
  ];
  const readFractionalRing = (buffer, cursor, delay) => {
    let position = cursor - delay;
    while (position < 0) position += buffer.length;
    const first = Math.trunc(position) % buffer.length;
    const second = (first + 1) % buffer.length;
    const fraction = position - Math.floor(position);
    return buffer[first] + (buffer[second] - buffer[first]) * fraction;
  };
  const processDelayAllpass = (input, buffer, cursor, delay, coefficient) => {
    const read = (cursor + buffer.length - delay) % buffer.length;
    const delayed = buffer[read];
    const output = delayed - coefficient * input;
    buffer[cursor] = input + coefficient * output;
    return output;
  };
  const pitchShiftBloomVoice = (buffer, cursor, voicePhase, ratio, offset) => {
    const grain = workletSampleRate * 0.11;
    const phase = (voicePhase + offset) % 1; const phaseB = (phase + 0.5) % 1;
    const a = readFractionalRing(buffer, cursor, 1 + (1 - phase) * grain);
    const b = readFractionalRing(buffer, cursor, 1 + (1 - phaseB) * grain);
    const wa = Math.sin(PI * phase); const wb = Math.sin(PI * phaseB);
    const wa2 = wa * wa; const wb2 = wb * wb;
    return ((a * wa2 + b * wb2) / Math.max(0.001, wa2 + wb2)) * Math.min(1, 1.25 / ratio);
  };
  const makeLowPass = (sampleRate, cutoff, q) => {
    const omega = 2 * PI * cutoff / sampleRate; const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q); const inverseA0 = 1 / (1 + alpha);
    return {
      b0: (1 - cosine) * 0.5 * inverseA0, b1: (1 - cosine) * inverseA0,
      b2: (1 - cosine) * 0.5 * inverseA0, a1: -2 * cosine * inverseA0, a2: (1 - alpha) * inverseA0,
    };
  };
  const makeBiquadState = () => ({ z1: 0, z2: 0 });
  const processBiquad = (input, coefficients, state) => {
    const output = coefficients.b0 * input + state.z1;
    state.z1 = coefficients.b1 * input - coefficients.a1 * output + state.z2;
    state.z2 = coefficients.b2 * input - coefficients.a2 * output;
    return output;
  };
  const makePeak = (frequency, gainDb, q) => {
    const omega = 2 * PI * clamp(frequency, 10, workletSampleRate * 0.45) / workletSampleRate;
    const cosine = Math.cos(omega); const sine = Math.sin(omega); const a = 10 ** (gainDb / 40);
    const alpha = sine / (2 * Math.max(0.1, q)); const inverse = 1 / (1 + alpha / a);
    return { b0: (1 + alpha * a) * inverse, b1: -2 * cosine * inverse, b2: (1 - alpha * a) * inverse,
      a1: -2 * cosine * inverse, a2: (1 - alpha / a) * inverse };
  };
  const makeShelf = (frequency, gainDb, highShelf) => {
    if (Math.abs(gainDb) < 0.000001) return identityBiquad();
    const omega = 2 * PI * clamp(frequency, 10, workletSampleRate * 0.45) / workletSampleRate;
    const cosine = Math.cos(omega); const sine = Math.sin(omega); const a = 10 ** (gainDb / 40);
    const rootA = Math.sqrt(a); const alpha = sine / Math.sqrt(2); const doubleRootAlpha = 2 * rootA * alpha;
    const direction = highShelf ? -1 : 1;
    const a0 = (a + 1) + direction * (a - 1) * cosine + doubleRootAlpha;
    return {
      b0: a * ((a + 1) - direction * (a - 1) * cosine + doubleRootAlpha) / a0,
      b1: 2 * a * (direction * (a - 1) - (a + 1) * cosine) / a0,
      b2: a * ((a + 1) - direction * (a - 1) * cosine - doubleRootAlpha) / a0,
      a1: -2 * (direction * (a - 1) + (a + 1) * cosine) / a0,
      a2: ((a + 1) + direction * (a - 1) * cosine - doubleRootAlpha) / a0,
    };
  };
  const makeCut = (frequency, q, highPass) => {
    const omega = 2 * PI * clamp(frequency, 10, workletSampleRate * 0.45) / workletSampleRate;
    const cosine = Math.cos(omega); const alpha = Math.sin(omega) / (2 * Math.max(0.1, q)); const inverse = 1 / (1 + alpha);
    const sign = highPass ? 1 : -1; const b0 = (1 + sign * cosine) * 0.5 * inverse;
    return { b0, b1: -sign * (1 + sign * cosine) * inverse, b2: b0, a1: -2 * cosine * inverse, a2: (1 - alpha) * inverse };
  };
  const identityBiquad = () => ({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
  // The original procedural cabinet bank is precomputed at build time for the
  // two browser hardware rates used in practice. Decoding these exact Float32
  // coefficients is realtime-safe and preserves the previous cabinet sound.
  const CABINET_IR_BANK_44100 = "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";
  const CABINET_IR_BANK_48000 = "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";
  const decodeCabinetIrBanks = (encoded) => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const bytes = new Uint8Array(Math.trunc(encoded.length * 3 / 4) - padding);
    let bits = 0; let accumulator = 0; let outputIndex = 0;
    for (let index = 0; index < encoded.length && encoded[index] !== "="; index += 1) {
      accumulator = (accumulator << 6) | alphabet.indexOf(encoded[index]);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes[outputIndex] = (accumulator >> bits) & 255;
        outputIndex += 1;
        accumulator &= bits ? (1 << bits) - 1 : 0;
      }
    }
    const view = new DataView(bytes.buffer);
    return Array.from({ length: 8 }, (_, bank) => Float32Array.from(
      { length: CABINET_TAPS },
      (_unused, tap) => view.getFloat32((bank * CABINET_TAPS + tap) * 4, true),
    ));
  };
  const makeCabinetIr = () => ({
    banks: decodeCabinetIrBanks(
      Math.abs(workletSampleRate - 44100) < Math.abs(workletSampleRate - 48000)
        ? CABINET_IR_BANK_44100
        : CABINET_IR_BANK_48000,
    ),
    tapDelays: Uint16Array.from({ length: CABINET_TAPS }, (_, slot) => (
      slot < 128 ? slot : 128 + (slot - 128) * 4 + 1
    )),
  });
  let cabinetIr = null;
  const ensureCabinetIr = () => {
    if (!cabinetIr) cabinetIr = makeCabinetIr();
    return cabinetIr;
  };
  const rebuildCabinetIr = (node, cabinet, position, micBlend) => {
    const impulseBank = ensureCabinetIr();
    for (let tap = 0; tap < CABINET_TAPS; tap += 1) {
      const vintageDynamic = impulseBank.banks[0][tap] + (impulseBank.banks[1][tap] - impulseBank.banks[0][tap]) * position;
      const modernDynamic = impulseBank.banks[4][tap] + (impulseBank.banks[5][tap] - impulseBank.banks[4][tap]) * position;
      const dynamic = vintageDynamic + (modernDynamic - vintageDynamic) * cabinet;
      const vintageRibbon = impulseBank.banks[2][tap] + (impulseBank.banks[3][tap] - impulseBank.banks[2][tap]) * position;
      const modernRibbon = impulseBank.banks[6][tap] + (impulseBank.banks[7][tap] - impulseBank.banks[6][tap]) * position;
      const ribbon = vintageRibbon + (modernRibbon - vintageRibbon) * cabinet;
      node.morphedIr[tap] = dynamic + (ribbon - dynamic) * micBlend;
    }
  };
  const oversamplingCutoff = Math.min(19000, workletSampleRate * 0.43);
  const oversamplingLowPass = [
    makeLowPass(workletSampleRate * OVERSAMPLING_FACTOR, oversamplingCutoff, 0.5411961),
    makeLowPass(workletSampleRate * OVERSAMPLING_FACTOR, oversamplingCutoff, 1.306563),
  ];
  const makeOversampler = () => ({
    previous: 0,
    preFilter: [makeBiquadState(), makeBiquadState()],
    postFilter: [makeBiquadState(), makeBiquadState()],
  });
  const processOversampled = (oversampler, input, nonlinear) => {
    let output = 0;
    for (let phase = 1; phase <= OVERSAMPLING_FACTOR; phase += 1) {
      const fraction = phase / OVERSAMPLING_FACTOR;
      let sample = oversampler.previous + (input - oversampler.previous) * fraction;
      for (let section = 0; section < oversamplingLowPass.length; section += 1)
        sample = processBiquad(sample, oversamplingLowPass[section], oversampler.preFilter[section]);
      sample = nonlinear(sample);
      for (let section = 0; section < oversamplingLowPass.length; section += 1)
        sample = processBiquad(sample, oversamplingLowPass[section], oversampler.postFilter[section]);
      output = sample;
    }
    oversampler.previous = input;
    return output;
  };
  const processOversampledSaturation = (oversampler, input, mode, drive, bias, offset, normalization, postDrive = 1) => {
    let output = 0;
    for (let phase = 1; phase <= OVERSAMPLING_FACTOR; phase += 1) {
      const fraction = phase / OVERSAMPLING_FACTOR;
      let sample = oversampler.previous + (input - oversampler.previous) * fraction;
      for (let section = 0; section < oversamplingLowPass.length; section += 1)
        sample = processBiquad(sample, oversamplingLowPass[section], oversampler.preFilter[section]);
      if (mode === 0) sample = (Math.tanh((sample + bias) * drive) - offset) / normalization;
      else if (mode === 1) sample = Math.tanh(sample * drive) / normalization;
      else {
        sample = (Math.tanh((sample + bias) * drive) - offset) / normalization;
        sample = Math.tanh(sample * postDrive);
      }
      for (let section = 0; section < oversamplingLowPass.length; section += 1)
        sample = processBiquad(sample, oversamplingLowPass[section], oversampler.postFilter[section]);
      output = sample;
    }
    oversampler.previous = input;
    return output;
  };

  class Smooth {
    constructor(milliseconds, value) {
      this.samples = Math.max(1, Math.round(workletSampleRate * milliseconds / 1000));
      this.current = value;
      this.target = value;
      this.step = 0;
      this.remaining = 0;
    }
    set(value) {
      if (value === this.target) return;
      this.target = value;
      this.remaining = this.samples;
      this.step = (this.target - this.current) / this.remaining;
    }
    next() {
      if (this.remaining <= 0) return this.current;
      this.current += this.step;
      this.remaining -= 1;
      if (this.remaining === 0) this.current = this.target;
      return this.current;
    }
  }

  const primary = (module) => {
    const key = {
      input_trim: "input", soft_clip: "drive", linked_compressor: "compress", legend_preamp: "drive", legend_compressor: "amount",
      legend_eq: "mid", legend_tape: "drive",
      de_esser: "amount", prism_eq: "band_3_gain", parametric_eq: "mid_gain", multiband_compressor: "amount", tone_shaper: "tone",
      stereo_width: "width", noise_gate: "threshold", amp_overdrive: "drive", amp_model: "gain", dual_high_gain: "gain", silk_bloom: "gain",
      cabinet_ir: "cabinet", cross_delay: "space", chorus: "mix", flanger: "mix", tremolo: "mix", vibrato: "mix",
      digital_delay: "mix", reverb: "mix", shimmer: "mix", dry_wet: "mix", output_trim: "output",
    }[module.type];
    return clamp(module.parameters?.[key]);
  };

  const gainFor = (type, value) => {
    if (value <= 0) return 0;
    return dbGain(type === "input_trim" ? value * 24 - 12 : value * 16 - 12);
  };

  const makeNode = (module) => {
    const value = primary(module);
    const node = {
      id: module.id,
      type: module.type,
      mix: new Smooth(10, clamp(module.mix, 0, 1)),
      bypass: new Smooth(10, module.bypassed ? 1 : 0),
    };
    if (["input_trim", "output_trim"].includes(node.type)) node.gain = new Smooth(10, gainFor(node.type, value));
    if (node.type === "soft_clip") {
      node.amount = new Smooth(10, value); node.character = new Smooth(10, 0.5); node.output = new Smooth(10, 1);
      node.leftOversampler = makeOversampler(); node.rightOversampler = makeOversampler();
    }
    if (node.type === "linked_compressor") {
      node.amount = new Smooth(15, value); node.threshold = new Smooth(15, 0.7); node.ratio = new Smooth(15, 0.13);
      node.attack = new Smooth(15, 0.63); node.release = new Smooth(15, 0.46); node.makeup = new Smooth(15, 0);
      node.envelope = 0; node.thresholdOverridden = false; node.ratioOverridden = false;
      node.attackOverridden = false; node.releaseOverridden = false; node.gainReduction = 1; node.effectiveGainReduction = 1;
    }
    if (node.type === "legend_preamp") {
      node.amount = new Smooth(15, value); node.model = new Smooth(20, 0); node.color = new Smooth(20, 0.52);
      node.highPass = new Smooth(20, 0.18); node.output = new Smooth(15, 1);
      node.leftOversampler = makeOversampler(); node.rightOversampler = makeOversampler();
      node.inputDcLeft = 0; node.inputDcRight = 0; node.transformerFluxLeft = 0; node.transformerFluxRight = 0;
      node.transformerHighLeft = 0; node.transformerHighRight = 0; node.outputDcLeft = 0; node.outputDcRight = 0;
    }
    if (node.type === "legend_compressor") {
      node.amount = new Smooth(15, value); node.model = new Smooth(20, 0); node.attack = new Smooth(15, 0.38);
      node.release = new Smooth(15, 0.46); node.makeup = new Smooth(15, 0);
      node.detectorPeak = 0; node.detectorEnergy = 0; node.gainReduction = 1; node.effectiveGainReduction = 1;
      node.leftOversampler = makeOversampler(); node.rightOversampler = makeOversampler();
    }
    if (node.type === "legend_eq") {
      node.model = new Smooth(20, 0); node.low = new Smooth(20, 0.5); node.mid = new Smooth(20, 0.5);
      node.high = new Smooth(20, 0.5); node.air = new Smooth(20, 0.5);
      node.legendEqCoefficients = Array.from({ length: 6 }, identityBiquad);
      node.legendEqLeftState = Array.from({ length: 6 }, makeBiquadState);
      node.legendEqRightState = Array.from({ length: 6 }, makeBiquadState); node.legendEqCountdown = 0;
      node.leftOversampler = makeOversampler(); node.rightOversampler = makeOversampler();
    }
    if (node.type === "legend_tape") {
      node.amount = new Smooth(20, value); node.model = new Smooth(20, 1 / 3); node.speed = new Smooth(20, 0.5);
      node.age = new Smooth(20, 0.16); node.wowFlutter = new Smooth(20, 0.12); node.noise = new Smooth(20, 0); node.output = new Smooth(15, dbGain(-0.96));
      node.leftOversampler = makeOversampler(); node.rightOversampler = makeOversampler();
      node.tapeFluxLeft = 0; node.tapeFluxRight = 0; node.tapeHeadLeft = 0; node.tapeHeadRight = 0;
      node.tapeHighLeft = 0; node.tapeHighRight = 0; node.tapeEnvelope = 0;
      node.tapeDelayLeft = new Float32Array(Math.max(128, Math.trunc(workletSampleRate * 0.008)));
      node.tapeDelayRight = new Float32Array(node.tapeDelayLeft.length); node.tapeDelayCursor = 0;
      node.tapeWowPhase = 0; node.tapeFlutterPhase = 0; node.tapeNoiseState = 0x6d2b79f5;
    }
    if (node.type === "de_esser") {
      node.amount = new Smooth(15, value); node.frequency = new Smooth(20, 0.5); node.threshold = new Smooth(15, 0.58);
      node.range = new Smooth(15, 0.5); node.attack = new Smooth(15, 0.35); node.release = new Smooth(15, 0.45);
      node.detectorLowLeft = 0; node.detectorLowRight = 0; node.bandLeft = 0; node.bandRight = 0; node.envelope = 0;
    }
    if (node.type === "prism_eq") {
      node.prismControls = Array.from({ length: 5 }, (_unused, band) => [
        new Smooth(5, 0), new Smooth(20, [0.201, 0.31, 0.562, 0.735, 0.859][band]),
        new Smooth(20, [0.5, 0.42, 0.48, 0.54, 0.32][band]), new Smooth(20, [0.453, 0.452, 0.478, 0.486, 0.452][band]),
      ]);
      node.prismCoefficients = Array.from({ length: 5 }, identityBiquad);
      node.prismLeftState = Array.from({ length: 5 }, makeBiquadState); node.prismRightState = Array.from({ length: 5 }, makeBiquadState); node.prismCountdown = 0;
    }
    if (node.type === "parametric_eq") {
      const defaults = [0, 0, 0.28, 0.12, 0.5, 0.32, 0.18, value, 0.45, 0.28, 0.5, 0.55, 0.18, 0, 0.78, 0.12, 0.5];
      node.eqControls = defaults.map((initial) => new Smooth(20, initial)); node.eqCoefficients = Array.from({ length: 5 }, identityBiquad);
      node.eqLeftState = Array.from({ length: 5 }, makeBiquadState); node.eqRightState = Array.from({ length: 5 }, makeBiquadState); node.eqCountdown = 0;
    }
    if (node.type === "multiband_compressor") {
      node.amount = new Smooth(15, value); node.lowCrossover = new Smooth(20, 0.48); node.highCrossover = new Smooth(20, 0.42);
      node.mbControls = [[0.58, 0.2, 0.62, 0.5, 0], [0.54, 0.26, 0.5, 0.45, 0], [0.5, 0.3, 0.38, 0.4, 0]]
        .map((band) => band.map((initial) => new Smooth(15, initial)));
      node.lowLeft = 0; node.lowRight = 0; node.belowHighLeft = 0; node.belowHighRight = 0; node.mbEnvelopes = [0, 0, 0];
    }
    if (node.type === "tone_shaper") {
      node.amount = new Smooth(15, value); node.lowGain = new Smooth(15, 0.5); node.midGain = new Smooth(15, 0.5);
      node.highGain = new Smooth(15, 0.5); node.lowLeft = 0; node.lowRight = 0; node.highLowLeft = 0; node.highLowRight = 0;
      node.threeBand = false;
    }
    if (node.type === "stereo_width") {
      node.amount = new Smooth(10, value); node.monoBass = new Smooth(10, 0); node.sideLow = 0;
    }
    if (node.type === "noise_gate") {
      node.threshold = new Smooth(10, value); node.release = new Smooth(10, 0.5); node.envelope = 0; node.gateGain = 0;
      node.detectorLowLeft = 0; node.detectorLowRight = 0; node.holdSamplesRemaining = 0; node.open = false;
    }
    if (node.type === "amp_overdrive") {
      node.drive = new Smooth(10, value); node.tone = new Smooth(10, 0.5); node.level = new Smooth(10, 1);
      node.toneLeft = 0; node.toneRight = 0;
      node.leftOversampler = makeOversampler(); node.rightOversampler = makeOversampler();
    }
    if (node.type === "amp_model") {
      node.gain = new Smooth(20, value); node.bass = new Smooth(20, 0.5); node.mid = new Smooth(20, 0.5);
      node.treble = new Smooth(20, 0.5); node.presence = new Smooth(20, 0.35); node.master = new Smooth(20, 1);
      node.dcLeft = 0; node.dcRight = 0; node.lowLeft = 0; node.lowRight = 0;
      node.highLowLeft = 0; node.highLowRight = 0; node.sagEnvelope = 0;
      node.leftOversampler = makeOversampler(); node.rightOversampler = makeOversampler();
    }
    if (node.type === "dual_high_gain") {
      node.mode = new Smooth(5, 0); node.gain = new Smooth(20, value); node.tight = new Smooth(20, 0.65);
      node.bass = new Smooth(20, 0.5); node.mid = new Smooth(20, 0.5); node.treble = new Smooth(20, 0.5);
      node.presence = new Smooth(20, 0.5); node.depth = new Smooth(20, 0.5); node.sag = new Smooth(20, 0.25);
      node.master = new Smooth(20, 0.65); node.previousLeft = 0; node.previousRight = 0;
      node.preFilterLeft = [makeBiquadState(), makeBiquadState()]; node.preFilterRight = [makeBiquadState(), makeBiquadState()];
      node.postFilterLeft = [makeBiquadState(), makeBiquadState()]; node.postFilterRight = [makeBiquadState(), makeBiquadState()];
      node.highPassLeft = new Float32Array(4); node.highPassRight = new Float32Array(4);
      node.lowPassLeft = new Float32Array(4); node.lowPassRight = new Float32Array(4);
      node.toneLowLeft = 0; node.toneLowRight = 0; node.toneHighLowLeft = 0; node.toneHighLowRight = 0;
      node.presenceLowLeft = 0; node.presenceLowRight = 0; node.depthLowLeft = 0; node.depthLowRight = 0;
      node.speakerLowLeft = 0; node.speakerLowRight = 0; node.speakerBodyLeft = 0; node.speakerBodyRight = 0;
      node.transformerFluxLeft = 0; node.transformerFluxRight = 0; node.sagEnvelope = 0;
    }
    if (node.type === "silk_bloom") {
      node.mode = new Smooth(8, 0.5); node.pickup = new Smooth(8, 0.5); node.gain = new Smooth(20, value); node.touch = new Smooth(20, 0.72);
      node.bass = new Smooth(20, 0.48); node.mid = new Smooth(20, 0.58); node.treble = new Smooth(20, 0.54);
      node.presence = new Smooth(20, 0.38); node.sag = new Smooth(20, 0.42); node.master = new Smooth(20, 0.7);
      node.dcLeft = 0; node.dcRight = 0; node.pickupLowLeft = 0; node.pickupLowRight = 0;
      node.lowLeft = 0; node.lowRight = 0; node.highLowLeft = 0; node.highLowRight = 0; node.sagEnvelope = 0;
      node.leftOversampler = makeOversampler(); node.rightOversampler = makeOversampler();
    }
    if (node.type === "cabinet_ir") {
      node.cabinet = new Smooth(25, value); node.micPosition = new Smooth(25, 0.58);
      node.micBlend = new Smooth(25, 0.22); node.distance = new Smooth(25, 0.08);
      node.lowCut = new Smooth(25, 0.18); node.highCut = new Smooth(25, 0.48);
      node.resonance = new Smooth(25, 0.5); node.level = new Smooth(20, 1);
      node.leftHistory = new Float32Array(CABINET_IR_LENGTH); node.rightHistory = new Float32Array(CABINET_IR_LENGTH); node.cursor = 0;
      node.reflectionHistoryLeft = new Float32Array(CABINET_REFLECTION_HISTORY);
      node.reflectionHistoryRight = new Float32Array(CABINET_REFLECTION_HISTORY); node.reflectionCursor = 0;
      node.morphedIr = new Float32Array(CABINET_TAPS); node.morphCountdown = 0;
      node.lowPassLeft = new Float32Array(4); node.lowPassRight = new Float32Array(4);
      node.highPassLeft = new Float32Array(2); node.highPassRight = new Float32Array(2);
      node.resonanceLeft = 0; node.resonanceRight = 0;
      rebuildCabinetIr(node, value, 0.58, 0.22);
      node.lastCabinet = value; node.lastMicPosition = 0.58; node.lastMicBlend = 0.22;
    }
    if (node.type === "cross_delay") {
      const length = Math.max(2, Math.trunc(workletSampleRate * 1.01));
      node.leftDelay = new Float32Array(length); node.rightDelay = new Float32Array(length); node.cursor = 0;
      node.amount = new Smooth(20, value); node.time = new Smooth(20, 0.19); node.feedback = new Smooth(20, 0.29);
      node.crossfeed = new Smooth(20, 1); node.filter = new Smooth(20, 1); node.filteredLeft = 0; node.filteredRight = 0;
      node.timeOverridden = false; node.feedbackOverridden = false;
    }
    if (["chorus", "flanger", "vibrato"].includes(node.type)) {
      const length = Math.max(4, Math.trunc(workletSampleRate * 0.06));
      node.leftDelay = new Float32Array(length); node.rightDelay = new Float32Array(length); node.cursor = 0; node.phase = 0;
      node.lastLeft = 0; node.lastRight = 0; node.amount = new Smooth(15, value);
      node.rate = new Smooth(20, node.type === "flanger" ? 0.32 : 0.4);
      node.depth = new Smooth(20, node.type === "vibrato" ? 0.45 : 0.6);
      node.delay = new Smooth(20, node.type === "flanger" ? 0.38 : 0.48);
      node.feedback = new Smooth(20, node.type === "flanger" ? 0.68 : 0.35);
      node.stereo = new Smooth(20, node.type === "chorus" ? 0.75 : 0.5);
    }
    if (node.type === "tremolo") {
      node.amount = new Smooth(15, value); node.rate = new Smooth(20, 0.48); node.depth = new Smooth(20, 0.7);
      node.shape = new Smooth(20, 0.35); node.stereo = new Smooth(20, 0.5); node.phase = 0;
    }
    if (node.type === "digital_delay") {
      const length = Math.max(4, Math.trunc(workletSampleRate * 0.82));
      node.leftDelay = new Float32Array(length); node.rightDelay = new Float32Array(length); node.cursor = 0;
      node.filteredLeft = 0; node.filteredRight = 0; node.amount = new Smooth(15, value); node.time = new Smooth(25, 0.62);
      node.feedback = new Smooth(20, 0.38); node.tone = new Smooth(20, 0.58); node.character = new Smooth(20, 0.72); node.stereo = new Smooth(20, 0.35);
    }
    if (["reverb", "shimmer"].includes(node.type)) {
      const preLength = Math.max(4, Math.trunc(workletSampleRate * 0.125));
      const pitchLength = Math.max(8, Math.trunc(workletSampleRate * 0.135));
      node.preDelayLeft = new Float32Array(preLength); node.preDelayRight = new Float32Array(preLength); node.preDelayCursor = 0;
      node.pitchLeft = new Float32Array(pitchLength); node.pitchRight = new Float32Array(pitchLength); node.pitchCursor = 0; node.modulationPhase = 0;
      node.dispersionState = new Float32Array(8);
      const hallTankLength = Math.max(8, Math.trunc(workletSampleRate * 0.18));
      const hallDiffuserLength = Math.max(8, Math.trunc(workletSampleRate * 0.014));
      node.hallTank = Array.from({ length: 8 }, () => new Float32Array(hallTankLength)); node.hallTankCursor = new Uint32Array(8);
      node.hallDampingState = new Float64Array(8); node.hallLowState = new Float64Array(8);
      node.hallLines = new Float64Array(8); node.hallMatrix = new Float64Array(8);
      node.hallDiffuserLeft = Array.from({ length: 4 }, () => new Float32Array(hallDiffuserLength));
      node.hallDiffuserRight = Array.from({ length: 4 }, () => new Float32Array(hallDiffuserLength));
      node.hallDiffuserCursor = new Uint32Array(4);
      node.hallDiffuserDelays = [3.1, 4.7, 6.9, 9.7].map((milliseconds) => Math.max(1, Math.trunc(workletSampleRate * milliseconds / 1000)));
      node.hallModulationPhase = 1.37;
      node.bloomEnvelope = 0;
      node.bloomHighPassState = new Float64Array(4); node.bloomLowPassState = new Float64Array(2);
      node.bloomChoirState = new Float64Array(6);
      node.bloomPitchPhase = new Float64Array([0, 0.19, 0.37, 0.61]);
      node.amount = new Smooth(20, value); node.mode = new Smooth(40, 1); node.size = new Smooth(30, node.type === "shimmer" ? 0.68 : 0.58);
      node.decay = new Smooth(30, node.type === "shimmer" ? 0.68 : 0.52); node.damping = new Smooth(30, node.type === "shimmer" ? 0.48 : 0.55);
      node.preDelay = new Smooth(25, node.type === "shimmer" ? 0.22 : 0.18); node.modulation = new Smooth(30, 0.22);
      node.shimmer = new Smooth(30, node.type === "shimmer" ? 0.5 : 0);
      node.rise = new Smooth(30, 0.5); node.tone = new Smooth(30, 0.42);
    }
    if (node.type === "dry_wet") node.amount = new Smooth(10, value);
    updateNode(node, module);
    return node;
  };

  const updateNode = (node, module) => {
    node.mix.set(clamp(module.mix, 0, 1));
    node.bypass.set(module.bypassed ? 1 : 0);
    const parameters = module.parameters || {};
    const explicit = new Set(module.explicitParameters || []);
    const value = primary(module);
    if (node.gain) node.gain.set(gainFor(node.type, value));
    if (node.amount) node.amount.set(value);
    if (node.type === "soft_clip") {
      node.character.set(clamp(parameters.character ?? 0.5));
      node.output.set(dbGain((clamp(parameters.output ?? 0.5) - 0.5) * 24));
    } else if (node.type === "linked_compressor") {
      node.thresholdOverridden = explicit.has("threshold"); node.ratioOverridden = explicit.has("ratio");
      node.attackOverridden = explicit.has("attack"); node.releaseOverridden = explicit.has("release");
      if (node.thresholdOverridden) node.threshold.set(clamp(parameters.threshold));
      if (node.ratioOverridden) node.ratio.set(clamp(parameters.ratio));
      if (node.attackOverridden) node.attack.set(clamp(parameters.attack));
      if (node.releaseOverridden) node.release.set(clamp(parameters.release));
      node.makeup.set(clamp(parameters.makeup ?? 0));
    } else if (node.type === "legend_preamp") {
      node.model.set(clamp(parameters.model ?? 0)); node.color.set(clamp(parameters.color ?? 0.52));
      node.highPass.set(clamp(parameters.high_pass ?? 0.18));
      node.output.set(dbGain((clamp(parameters.output ?? 0.5) - 0.5) * 24));
    } else if (node.type === "legend_compressor") {
      node.model.set(clamp(parameters.model ?? 0)); node.attack.set(clamp(parameters.attack ?? 0.38));
      node.release.set(clamp(parameters.release ?? 0.46)); node.makeup.set(clamp(parameters.makeup ?? 0));
    } else if (node.type === "legend_eq") {
      node.model.set(clamp(parameters.model ?? 0)); node.low.set(clamp(parameters.low ?? 0.5));
      node.mid.set(clamp(parameters.mid ?? 0.5)); node.high.set(clamp(parameters.high ?? 0.5)); node.air.set(clamp(parameters.air ?? 0.5));
    } else if (node.type === "legend_tape") {
      node.model.set(clamp(parameters.model ?? (1 / 3))); node.speed.set(clamp(parameters.speed ?? 0.5));
      node.age.set(clamp(parameters.age ?? 0.16)); node.wowFlutter.set(clamp(parameters.wow_flutter ?? 0.12));
      node.noise.set(clamp(parameters.noise ?? 0)); node.output.set(dbGain((clamp(parameters.output ?? 0.46) - 0.5) * 24));
    } else if (node.type === "de_esser") {
      node.amount.set(value); node.frequency.set(clamp(parameters.frequency ?? 0.5));
      node.threshold.set(clamp(parameters.threshold ?? 0.58)); node.range.set(clamp(parameters.range ?? 0.5));
      node.attack.set(clamp(parameters.attack ?? 0.35)); node.release.set(clamp(parameters.release ?? 0.45));
    } else if (node.type === "prism_eq") {
      node.prismControls.forEach((controls, band) => {
        const slot = band + 1;
        const defaults = [[0, 0.201, 0.5, 0.453], [0, 0.31, 0.42, 0.452], [0, 0.562, 0.48, 0.478], [0, 0.735, 0.54, 0.486], [0, 0.859, 0.32, 0.452]][band];
        ["enabled", "frequency", "gain", "q"].forEach((suffix, index) => controls[index].set(clamp(parameters[`band_${slot}_${suffix}`] ?? defaults[index])));
      });
    } else if (node.type === "parametric_eq") {
      const keys = ["mode", "low_cut_enabled", "low_cut_frequency", "low_cut_q", "low_gain", "low_frequency", "low_q",
        "mid_gain", "mid_frequency", "mid_q", "high_gain", "high_frequency", "high_q", "high_cut_enabled", "high_cut_frequency", "high_cut_q", "output"];
      const defaults = [0, 0, 0.28, 0.12, 0.5, 0.32, 0.18, 0.5, 0.45, 0.28, 0.5, 0.55, 0.18, 0, 0.78, 0.12, 0.5];
      keys.forEach((key, index) => node.eqControls[index].set(clamp(parameters[key] ?? defaults[index])));
    } else if (node.type === "multiband_compressor") {
      node.amount.set(value); node.lowCrossover.set(clamp(parameters.low_crossover ?? 0.48)); node.highCrossover.set(clamp(parameters.high_crossover ?? 0.42));
      ["low", "mid", "high"].forEach((band, bandIndex) => ["threshold", "ratio", "attack", "release", "makeup"].forEach((suffix, index) => {
        const defaults = [[0.58, 0.2, 0.62, 0.5, 0], [0.54, 0.26, 0.5, 0.45, 0], [0.5, 0.3, 0.38, 0.4, 0]];
        node.mbControls[bandIndex][index].set(clamp(parameters[`${band}_${suffix}`] ?? defaults[bandIndex][index]));
      }));
    } else if (node.type === "tone_shaper") {
      node.threeBand = ["low", "mid", "high"].some((key) => explicit.has(key));
      if (explicit.has("low")) node.lowGain.set(clamp(parameters.low));
      if (explicit.has("mid")) node.midGain.set(clamp(parameters.mid));
      if (explicit.has("high")) node.highGain.set(clamp(parameters.high));
    } else if (node.type === "stereo_width") {
      const control = clamp(parameters.mono_bass ?? 0);
      node.monoBass.set(control <= 0 ? 0 : 1 - Math.exp(-2 * PI * 40 * (10 ** control) / workletSampleRate));
    } else if (node.type === "noise_gate") {
      node.threshold.set(value); node.release.set(clamp(parameters.release ?? 0.5));
    } else if (node.type === "amp_overdrive") {
      node.drive.set(value); node.tone.set(clamp(parameters.tone ?? 0.5));
      node.level.set(dbGain((clamp(parameters.level ?? 0.5) - 0.5) * 24));
    } else if (node.type === "amp_model") {
      node.gain.set(value); node.bass.set(clamp(parameters.bass ?? 0.5)); node.mid.set(clamp(parameters.mid ?? 0.5));
      node.treble.set(clamp(parameters.treble ?? 0.5)); node.presence.set(clamp(parameters.presence ?? 0.35));
      node.master.set(dbGain(-18 + clamp(parameters.master ?? 0.75) * 24));
    } else if (node.type === "dual_high_gain") {
      node.gain.set(value); node.mode.set(clamp(parameters.mode ?? 0)); node.tight.set(clamp(parameters.tight ?? 0.65));
      node.bass.set(clamp(parameters.bass ?? 0.5)); node.mid.set(clamp(parameters.mid ?? 0.5)); node.treble.set(clamp(parameters.treble ?? 0.5));
      node.presence.set(clamp(parameters.presence ?? 0.5)); node.depth.set(clamp(parameters.depth ?? 0.5));
      node.sag.set(clamp(parameters.sag ?? 0.25)); node.master.set(clamp(parameters.master ?? 0.65));
    } else if (node.type === "silk_bloom") {
      node.gain.set(value); node.mode.set(clamp(parameters.mode ?? 0.5)); node.pickup.set(clamp(parameters.pickup ?? 0.5));
      node.touch.set(clamp(parameters.touch ?? 0.72)); node.bass.set(clamp(parameters.bass ?? 0.48)); node.mid.set(clamp(parameters.mid ?? 0.58));
      node.treble.set(clamp(parameters.treble ?? 0.54)); node.presence.set(clamp(parameters.presence ?? 0.38));
      node.sag.set(clamp(parameters.sag ?? 0.42)); node.master.set(clamp(parameters.master ?? 0.7));
    } else if (node.type === "cabinet_ir") {
      const custom = module.customImpulse;
      if (custom && Array.isArray(custom.tapDelays) && Array.isArray(custom.coefficients)
        && custom.tapDelays.length === custom.coefficients.length && custom.tapDelays.length > 0) {
        const delays = Int32Array.from(custom.tapDelays.map((delay) => Math.max(0, Math.trunc(delay))));
        const coefficients = Float32Array.from(custom.coefficients.map((coefficient) => Number(coefficient) || 0));
        const historyLength = Math.max(CABINET_IR_LENGTH, 1 + delays.reduce((maximum, delay) => Math.max(maximum, delay), 0));
        const signature = String(custom.signature || `${historyLength}:${delays.length}:${coefficients[0] || 0}:${coefficients[coefficients.length - 1] || 0}`);
        if (signature !== node.customImpulseSignature) {
          node.customImpulseSignature = signature;
          node.customTapDelays = delays; node.customCoefficients = coefficients;
          node.leftHistory = new Float32Array(historyLength); node.rightHistory = new Float32Array(historyLength); node.cursor = 0;
        }
      } else if (node.customTapDelays) {
        node.customImpulseSignature = ""; node.customTapDelays = null; node.customCoefficients = null;
        node.leftHistory = new Float32Array(CABINET_IR_LENGTH); node.rightHistory = new Float32Array(CABINET_IR_LENGTH); node.cursor = 0;
      }
      node.cabinet.set(value); node.micPosition.set(clamp(parameters.mic_position ?? 0.58));
      node.micBlend.set(clamp(parameters.mic_blend ?? 0.22)); node.distance.set(clamp(parameters.distance ?? 0.08));
      node.lowCut.set(clamp(parameters.low_cut ?? 0.18)); node.highCut.set(clamp(parameters.high_cut ?? 0.48));
      node.resonance.set(clamp(parameters.resonance ?? 0.5));
      node.level.set(dbGain((clamp(parameters.level ?? 0.5) - 0.5) * 24));
    } else if (node.type === "cross_delay") {
      node.timeOverridden = explicit.has("time"); node.feedbackOverridden = explicit.has("feedback");
      if (node.timeOverridden) node.time.set(0.02 * (50 ** clamp(parameters.time)));
      if (node.feedbackOverridden) node.feedback.set(0.05 + clamp(parameters.feedback) * 0.8);
      node.crossfeed.set(clamp(parameters.crossfeed ?? 1)); node.filter.set(clamp(parameters.filter ?? 1));
    } else if (["chorus", "flanger", "vibrato"].includes(node.type)) {
      node.rate.set(clamp(parameters.rate ?? (node.type === "flanger" ? 0.32 : 0.4)));
      node.depth.set(clamp(parameters.depth ?? (node.type === "vibrato" ? 0.45 : 0.6)));
      node.delay.set(clamp(parameters[node.type === "flanger" ? "manual" : "delay"] ?? (node.type === "flanger" ? 0.38 : 0.48)));
      node.feedback.set(clamp(parameters.feedback ?? (node.type === "flanger" ? 0.68 : 0.35)));
      node.stereo.set(clamp(parameters.stereo ?? (node.type === "chorus" ? 0.75 : 0.5)));
    } else if (node.type === "tremolo") {
      node.rate.set(clamp(parameters.rate ?? 0.48)); node.depth.set(clamp(parameters.depth ?? 0.7));
      node.shape.set(clamp(parameters.shape ?? 0.35)); node.stereo.set(clamp(parameters.stereo ?? 0.5));
    } else if (node.type === "digital_delay") {
      node.time.set(clamp(parameters.time ?? 0.62)); node.feedback.set(clamp(parameters.feedback ?? 0.38));
      node.tone.set(clamp(parameters.tone ?? 0.58)); node.character.set(clamp(parameters.character ?? 0.72)); node.stereo.set(clamp(parameters.stereo ?? 0.35));
    } else if (["reverb", "shimmer"].includes(node.type)) {
      if (node.type === "reverb") node.mode.set(clamp(parameters.mode ?? 1));
      node.size.set(clamp(parameters.size ?? (node.type === "shimmer" ? 0.68 : 0.58)));
      node.decay.set(clamp(parameters.decay ?? (node.type === "shimmer" ? 0.68 : 0.52)));
      node.damping.set(clamp(parameters.damping ?? (node.type === "shimmer" ? 0.48 : 0.55)));
      node.preDelay.set(clamp(parameters.pre_delay ?? (node.type === "shimmer" ? 0.22 : 0.18)));
      node.modulation.set(clamp(parameters.modulation ?? 0.22)); node.shimmer.set(clamp(parameters.shimmer ?? (node.type === "shimmer" ? 0.5 : 0)));
      node.rise.set(clamp(parameters.rise ?? 0.5)); node.tone.set(clamp(parameters.tone ?? 0.42));
    }
  };

  const processNode = (node, inputLeft, inputRight, rackDryLeft, rackDryRight) => {
    let left = inputLeft; let right = inputRight;
    if (["input_trim", "output_trim"].includes(node.type)) {
      const gain = node.gain.next(); left *= gain; right *= gain;
    } else if (node.type === "soft_clip") {
      const amount = node.amount.next(); const character = node.character.next(); const output = node.output.next();
      if (amount <= 0.0001) { left *= output; right *= output; }
      else {
        const drive = 1 + amount * 14; const normalization = Math.tanh(drive); const bias = (character - 0.5) * 0.6;
        const offset = Math.tanh(bias * drive);
        left = processOversampledSaturation(node.leftOversampler, left, 0, drive, bias, offset, normalization) * output;
        right = processOversampledSaturation(node.rightOversampler, right, 0, drive, bias, offset, normalization) * output;
      }
    } else if (node.type === "linked_compressor") {
      const amount = node.amount.next(); const thresholdControl = node.threshold.next(); const ratioControl = node.ratio.next();
      const attackControl = node.attack.next(); const releaseControl = node.release.next(); const makeup = node.makeup.next();
      const detector = Math.max(Math.abs(left), Math.abs(right));
      const attackSeconds = node.attackOverridden ? 0.0001 * (1000 ** attackControl) : 0.008;
      const releaseSeconds = node.releaseOverridden ? 0.02 * (50 ** releaseControl) : 0.12;
      const coefficient = Math.exp(-1 / ((detector > node.envelope ? attackSeconds : releaseSeconds) * workletSampleRate));
      node.envelope = coefficient * node.envelope + (1 - coefficient) * detector;
      const thresholdDb = node.thresholdOverridden ? -48 + thresholdControl * 48 : -6 - 24 * amount;
      const threshold = dbGain(thresholdDb); const ratio = node.ratioOverridden ? 1 + 19 * ratioControl : 1 + 7 * amount;
      const reduction = node.envelope > threshold ? (threshold / node.envelope) ** (1 - 1 / ratio) : 1;
      node.gainReduction = reduction;
      const gain = reduction * dbGain(makeup * 24); left *= gain; right *= gain;
    } else if (node.type === "legend_preamp") {
      const model = Math.max(0, Math.min(3, Math.round(node.model.next() * 3)));
      const amount = node.amount.next(); const color = node.color.next(); const highPass = node.highPass.next(); const output = node.output.next();
      const highPassHz = [16, 20, 13, 24][model] * (10 ** (highPass * 0.82));
      const highPassAlpha = 1 - Math.exp(-2 * PI * highPassHz / workletSampleRate);
      node.inputDcLeft += highPassAlpha * (left - node.inputDcLeft); node.inputDcRight += highPassAlpha * (right - node.inputDcRight);
      left -= node.inputDcLeft; right -= node.inputDcRight;
      const fluxAlpha = 1 - Math.exp(-2 * PI * [95, 135, 68, 155][model] / workletSampleRate);
      node.transformerFluxLeft += fluxAlpha * (left - node.transformerFluxLeft); node.transformerFluxRight += fluxAlpha * (right - node.transformerFluxRight);
      const lowColor = [0.055, 0.028, 0.072, 0.038][model] * color;
      left += node.transformerFluxLeft * lowColor; right += node.transformerFluxRight * lowColor;
      const highCut = Math.min(workletSampleRate * 0.44, [17500, 20500, 14800, 22000][model] * (1 - color * [0.13, 0.06, 0.18, 0.04][model]));
      const highAlpha = 1 - Math.exp(-2 * PI * highCut / workletSampleRate);
      node.transformerHighLeft += highAlpha * (left - node.transformerHighLeft); node.transformerHighRight += highAlpha * (right - node.transformerHighRight);
      left += (node.transformerHighLeft - left) * color * [0.34, 0.18, 0.46, 0.12][model];
      right += (node.transformerHighRight - right) * color * [0.34, 0.18, 0.46, 0.12][model];
      const drive = [1.25, 1.45, 1.12, 1.32][model] + amount * [4.4, 5.1, 3.7, 4.2][model];
      const bias = [0.035, 0.018, 0.085, 0.026][model] * (0.35 + color * 1.3);
      const offset = Math.tanh(bias * drive); const normalization = Math.tanh(drive);
      const linearCompensation = normalization / Math.max(0.000001, drive * (1 - offset * offset));
      left = processOversampledSaturation(node.leftOversampler, left, 0, drive, bias, offset, normalization) * linearCompensation;
      right = processOversampledSaturation(node.rightOversampler, right, 0, drive, bias, offset, normalization) * linearCompensation;
      const outputDrive = 1.02 + color * [0.34, 0.22, 0.46, 0.18][model];
      left = Math.tanh(left * outputDrive) / outputDrive; right = Math.tanh(right * outputDrive) / outputDrive;
      const dcAlpha = 1 - Math.exp(-2 * PI * 5 / workletSampleRate);
      node.outputDcLeft += dcAlpha * (left - node.outputDcLeft); node.outputDcRight += dcAlpha * (right - node.outputDcRight);
      left = (left - node.outputDcLeft) * output; right = (right - node.outputDcRight) * output;
    } else if (node.type === "legend_compressor") {
      const model = Math.max(0, Math.min(3, Math.round(node.model.next() * 3)));
      const amount = node.amount.next(); const attackControl = node.attack.next(); const releaseControl = node.release.next(); const makeup = node.makeup.next();
      const absolutePeak = Math.max(Math.abs(left), Math.abs(right));
      const peakAttack = [0.00003, 0.004, 0.00015, 0.006][model]; const peakRelease = [0.008, 0.12, 0.025, 0.16][model];
      const peakCoefficient = Math.exp(-1 / ((absolutePeak > node.detectorPeak ? peakAttack : peakRelease) * workletSampleRate));
      node.detectorPeak = peakCoefficient * node.detectorPeak + (1 - peakCoefficient) * absolutePeak;
      const energyInput = (left * left + right * right) * 0.5;
      const energyTime = [0.0015, 0.035, 0.006, 0.055][model]; const energyCoefficient = Math.exp(-1 / (energyTime * workletSampleRate));
      node.detectorEnergy = energyCoefficient * node.detectorEnergy + (1 - energyCoefficient) * energyInput;
      const rmsDetector = Math.sqrt(Math.max(0, node.detectorEnergy));
      const detector = model === 0 ? node.detectorPeak : model === 1 ? rmsDetector : model === 2 ? node.detectorPeak * 0.72 + rmsDetector * 0.28 : rmsDetector * 0.82 + node.detectorPeak * 0.18;
      const thresholdDb = [-7.5, -9.5, -6.5, -8.5][model] - amount * [23, 20, 24, 19][model];
      const ratio = 1 + amount * [19, 3.5, 9, 3.65][model];
      const kneeDb = [2, 10, 4, 12][model]; const overDb = 20 * Math.log10(Math.max(0.000001, detector)) - thresholdDb;
      let reductionDb = 0;
      if (overDb >= kneeDb * 0.5) reductionDb = overDb * (1 - 1 / ratio);
      else if (overDb > kneeDb * -0.5) reductionDb = ((overDb + kneeDb * 0.5) ** 2 / (2 * kneeDb)) * (1 - 1 / ratio);
      const targetReduction = dbGain(-reductionDb);
      const attackSeconds = [0.00002 * (300 ** attackControl), 0.002 * (30 ** attackControl), 0.0001 * (100 ** attackControl), 0.003 * (20 ** attackControl)][model];
      const programFactor = 1 + Math.min(3, reductionDb / [8, 5, 10, 6][model]);
      const releaseSeconds = [0.03 * (20 ** releaseControl), 0.08 * (25 ** releaseControl), 0.04 * (15 ** releaseControl), 0.1 * (12 ** releaseControl)][model] * (targetReduction > node.gainReduction ? programFactor : 1);
      const gainCoefficient = Math.exp(-1 / ((targetReduction < node.gainReduction ? attackSeconds : releaseSeconds) * workletSampleRate));
      node.gainReduction = gainCoefficient * node.gainReduction + (1 - gainCoefficient) * targetReduction;
      const reductionAmount = 1 - node.gainReduction;
      if (reductionAmount > 0.000001) {
        const distortionDrive = 1 + reductionAmount * [2.4, 1.05, 0.62, 1.5][model];
        const distortionBias = [0.018, 0.04, 0.006, 0.028][model] * reductionAmount;
        const distortionOffset = Math.tanh(distortionBias * distortionDrive); const distortionNormalization = Math.tanh(distortionDrive);
        const distortionCompensation = distortionNormalization / Math.max(0.000001, distortionDrive * (1 - distortionOffset * distortionOffset));
        left = processOversampledSaturation(node.leftOversampler, left, 0, distortionDrive, distortionBias, distortionOffset, distortionNormalization) * distortionCompensation;
        right = processOversampledSaturation(node.rightOversampler, right, 0, distortionDrive, distortionBias, distortionOffset, distortionNormalization) * distortionCompensation;
      }
      const gain = node.gainReduction * dbGain(makeup * 24); left *= gain; right *= gain;
    } else if (node.type === "legend_eq") {
      const model = Math.max(0, Math.min(3, Math.round(node.model.next() * 3)));
      const lowDb = (node.low.next() - 0.5) * 24; const midDb = (node.mid.next() - 0.5) * 24;
      const highDb = (node.high.next() - 0.5) * 24; const airDb = (node.air.next() - 0.5) * 24;
      if (node.legendEqCountdown <= 0) {
        if (model === 0) {
          const passiveLowInteraction = -Math.max(0, lowDb) * 0.24 + Math.min(0, lowDb) * 0.08;
          node.legendEqCoefficients = [
            makeShelf(100, lowDb * 0.86, false), makePeak(320, passiveLowInteraction, 0.58),
            makePeak(720, midDb * 0.72, 0.52), makePeak(8000, highDb * 0.82, 0.68),
            makeShelf(16000, airDb * 0.58, true), identityBiquad(),
          ];
        } else if (model === 1) {
          node.legendEqCoefficients = [
            makeShelf(105, lowDb * 0.9, false), makePeak(360, lowDb * -0.08, 0.72),
            makePeak(1600, midDb * 0.9, 0.82), makePeak(4800, highDb * 0.9, 0.76),
            makeShelf(12000, airDb * 0.62, true), identityBiquad(),
          ];
        } else if (model === 2) {
          node.legendEqCoefficients = [
            makePeak(100, lowDb * 0.92, 0.48 + Math.abs(lowDb) * 0.055), makeShelf(62, lowDb * 0.18, false),
            makePeak(1050, midDb * 0.96, 0.58 + Math.abs(midDb) * 0.07),
            makePeak(5000, highDb * 0.92, 0.62 + Math.abs(highDb) * 0.065),
            makeShelf(14000, airDb * 0.64, true), identityBiquad(),
          ];
        } else {
          node.legendEqCoefficients = [
            makeShelf(82, lowDb, false), makePeak(760, midDb, 0.72),
            makePeak(7500, highDb, 0.72), makeShelf(18000, airDb * 0.72, true),
            identityBiquad(), identityBiquad(),
          ];
        }
        node.legendEqCountdown = 15;
      } else node.legendEqCountdown -= 1;
      left = node.legendEqCoefficients.reduce((sample, coefficients, index) => processBiquad(sample, coefficients, node.legendEqLeftState[index]), left);
      right = node.legendEqCoefficients.reduce((sample, coefficients, index) => processBiquad(sample, coefficients, node.legendEqRightState[index]), right);
      const stageDrive = [1.2, 1.1, 1.13, 1.015][model]; const stageBias = [0.018, 0.012, 0.006, 0][model];
      const stageOffset = Math.tanh(stageBias * stageDrive); const stageCompensation = 1 / (stageDrive * (1 - stageOffset * stageOffset));
      left = (Math.tanh((left + stageBias) * stageDrive) - stageOffset) * stageCompensation;
      right = (Math.tanh((right + stageBias) * stageDrive) - stageOffset) * stageCompensation;
    } else if (node.type === "legend_tape") {
      const model = Math.max(0, Math.min(3, Math.round(node.model.next() * 3)));
      const speed = Math.max(0, Math.min(2, Math.round(node.speed.next() * 2)));
      const amount = node.amount.next(); const age = node.age.next(); const wowFlutter = node.wowFlutter.next();
      const noise = node.noise.next(); const output = node.output.next();
      const detector = Math.max(Math.abs(left), Math.abs(right));
      const detectorTime = detector > node.tapeEnvelope ? 0.0012 : 0.075 + age * 0.11;
      const detectorCoefficient = Math.exp(-1 / (detectorTime * workletSampleRate));
      node.tapeEnvelope = detectorCoefficient * node.tapeEnvelope + (1 - detectorCoefficient) * detector;
      const transientCompression = 1 / (1 + Math.max(0, node.tapeEnvelope - 0.16) * amount * [0.42, 0.32, 0.22, 0.12][model] * (1 + age));
      const fluxAlpha = 1 - Math.exp(-2 * PI * [18, 25, 34][speed] / workletSampleRate);
      node.tapeFluxLeft += fluxAlpha * (left - node.tapeFluxLeft); node.tapeFluxRight += fluxAlpha * (right - node.tapeFluxRight);
      const drive = [1.18, 1.12, 1.08, 1.04][model] + amount * [4.8, 4.3, 3.7, 2.8][model] + age * [0.8, 0.58, 0.42, 0.25][model];
      const baseBias = [0.026, 0.016, 0.009, 0.004][model] * (0.4 + amount * 0.75 + age * 0.8);
      const fluxBiasLeft = baseBias + node.tapeFluxLeft * [0.14, 0.1, 0.07, 0.035][model];
      const fluxBiasRight = baseBias + node.tapeFluxRight * [0.14, 0.1, 0.07, 0.035][model];
      const saturate = (oversampler, sample, bias) => {
        const offset = Math.tanh(bias * drive); const normalization = Math.tanh(drive);
        const compensation = normalization / Math.max(0.000001, drive * (1 - offset * offset));
        return processOversampledSaturation(oversampler, sample, 0, drive, bias, offset, normalization) * compensation;
      };
      left = saturate(node.leftOversampler, left, fluxBiasLeft) * transientCompression;
      right = saturate(node.rightOversampler, right, fluxBiasRight) * transientCompression;
      const headFrequency = [48, 78, 118][speed] * [0.88, 1, 1.08, 1.14][model];
      const headAlpha = 1 - Math.exp(-2 * PI * headFrequency / workletSampleRate);
      node.tapeHeadLeft += headAlpha * (left - node.tapeHeadLeft); node.tapeHeadRight += headAlpha * (right - node.tapeHeadRight);
      const headGain = [0.18, 0.13, 0.09, 0.045][model] * (1 - speed * 0.22) * (0.35 + amount * 0.65);
      left += node.tapeHeadLeft * headGain; right += node.tapeHeadRight * headGain;
      const highCut = Math.min(workletSampleRate * 0.44, [10800, 15800, 21000][speed] * [0.86, 0.96, 1.04, 1.1][model] * (1 - age * 0.38));
      const highAlpha = 1 - Math.exp(-2 * PI * highCut / workletSampleRate);
      node.tapeHighLeft += highAlpha * (left - node.tapeHighLeft); node.tapeHighRight += highAlpha * (right - node.tapeHighRight);
      left = node.tapeHighLeft; right = node.tapeHighRight;
      if (wowFlutter > 0.0001) {
        node.tapeDelayLeft[node.tapeDelayCursor] = left; node.tapeDelayRight[node.tapeDelayCursor] = right;
        const modulation = Math.sin(node.tapeWowPhase) * (2.8 + age * 3.2) + Math.sin(node.tapeFlutterPhase) * (0.65 + age * 0.7);
        const delaySamples = Math.max(1, 2 + wowFlutter * (5 + modulation));
        left = readFractionalRing(node.tapeDelayLeft, node.tapeDelayCursor, delaySamples);
        right = readFractionalRing(node.tapeDelayRight, node.tapeDelayCursor, delaySamples);
        node.tapeDelayCursor = (node.tapeDelayCursor + 1) % node.tapeDelayLeft.length;
        node.tapeWowPhase += 2 * PI * [0.38, 0.52, 0.67][speed] / workletSampleRate;
        node.tapeFlutterPhase += 2 * PI * [5.7, 7.4, 9.1][speed] / workletSampleRate;
        if (node.tapeWowPhase >= 2 * PI) node.tapeWowPhase -= 2 * PI;
        if (node.tapeFlutterPhase >= 2 * PI) node.tapeFlutterPhase -= 2 * PI;
      }
      if (noise > 0.0001) {
        node.tapeNoiseState = (Math.imul(node.tapeNoiseState, 1664525) + 1013904223) >>> 0;
        const random = node.tapeNoiseState / 4294967296 * 2 - 1;
        const noiseGain = dbGain(-78 + noise * 24 + age * 5); left += random * noiseGain; right += random * noiseGain * 0.93;
      }
      left *= output; right *= output;
    } else if (node.type === "de_esser") {
      const amount = node.amount.next(); const center = 3000 * (4 ** node.frequency.next());
      const threshold = dbGain(-48 + node.threshold.next() * 48); const maximumReduction = node.range.next() * 18 * amount;
      const attackSeconds = 0.0001 * (200 ** node.attack.next()); const releaseSeconds = 0.02 * (15 ** node.release.next());
      const lowerAlpha = 1 - Math.exp(-2 * PI * Math.min(center / 1.6, workletSampleRate * 0.42) / workletSampleRate);
      const upperAlpha = 1 - Math.exp(-2 * PI * Math.min(center * 1.6, workletSampleRate * 0.45) / workletSampleRate);
      node.detectorLowLeft += lowerAlpha * (left - node.detectorLowLeft);
      node.detectorLowRight += lowerAlpha * (right - node.detectorLowRight);
      node.bandLeft += upperAlpha * ((left - node.detectorLowLeft) - node.bandLeft);
      node.bandRight += upperAlpha * ((right - node.detectorLowRight) - node.bandRight);
      const detector = Math.max(Math.abs(node.bandLeft), Math.abs(node.bandRight));
      const coefficient = Math.exp(-1 / ((detector > node.envelope ? attackSeconds : releaseSeconds) * workletSampleRate));
      node.envelope = coefficient * node.envelope + (1 - coefficient) * detector;
      const overDb = node.envelope > threshold ? 20 * Math.log10(node.envelope / threshold) : 0;
      const gain = dbGain(-Math.min(maximumReduction, overDb * amount));
      left -= node.bandLeft * (1 - gain); right -= node.bandRight * (1 - gain);
    } else if (node.type === "prism_eq") {
      const values = node.prismControls.map((controls) => controls.map((control) => control.next()));
      if (node.prismCountdown <= 0) {
        values.forEach((band, index) => {
          if (band[0] < 0.5) node.prismCoefficients[index] = identityBiquad();
          else {
            const frequency = 10 * (3000 ** band[1]); const q = 0.025 * (1600 ** band[3]);
            node.prismCoefficients[index] = index === 0 ? makeCut(frequency, q, true) : makePeak(frequency, (band[2] - 0.5) * 24, q);
          }
        });
        node.prismCountdown = 15;
      } else node.prismCountdown -= 1;
      left = node.prismCoefficients.reduce((sample, coefficients, index) => processBiquad(sample, coefficients, node.prismLeftState[index]), left);
      right = node.prismCoefficients.reduce((sample, coefficients, index) => processBiquad(sample, coefficients, node.prismRightState[index]), right);
    } else if (node.type === "parametric_eq") {
      const values = node.eqControls.map((control) => control.next());
      if (node.eqCountdown <= 0) {
        node.eqCoefficients[0] = values[1] >= 0.5 ? makeCut(20 * (50 ** values[2]), 0.5 + values[3] * 1.5, true) : identityBiquad();
        node.eqCoefficients[1] = makePeak(40 * (20 ** values[5]), (values[4] - 0.5) * 24, 0.3 + values[6] * 7.7);
        node.eqCoefficients[2] = makePeak(200 * (40 ** values[8]), (values[7] - 0.5) * 24, 0.3 + values[9] * 7.7);
        node.eqCoefficients[3] = makePeak(2000 * (9 ** values[11]), (values[10] - 0.5) * 24, 0.3 + values[12] * 7.7);
        node.eqCoefficients[4] = values[13] >= 0.5 ? makeCut(4000 * (5 ** values[14]), 0.5 + values[15] * 1.5, false) : identityBiquad();
        node.eqCountdown = 15;
      } else node.eqCountdown -= 1;
      const chain = (sample, states) => node.eqCoefficients.reduce((current, coefficients, index) => processBiquad(current, coefficients, states[index]), sample);
      const mode = Math.max(0, Math.min(2, Math.round(values[0] * 2)));
      if (mode === 0) { left = chain(left, node.eqLeftState); right = chain(right, node.eqRightState); }
      else {
        let middle = (left + right) * 0.5; let side = (left - right) * 0.5;
        if (mode === 1) middle = chain(middle, node.eqLeftState); else side = chain(side, node.eqRightState);
        left = middle + side; right = middle - side;
      }
      const output = dbGain((values[16] - 0.5) * 24); left *= output; right *= output;
    } else if (node.type === "multiband_compressor") {
      const amount = node.amount.next(); const lowHz = 80 * (7.5 ** node.lowCrossover.next()); const highHz = 1200 * (6.6666667 ** node.highCrossover.next());
      const lowAlpha = 1 - Math.exp(-2 * PI * lowHz / workletSampleRate); const highAlpha = 1 - Math.exp(-2 * PI * highHz / workletSampleRate);
      node.lowLeft += lowAlpha * (left - node.lowLeft); node.lowRight += lowAlpha * (right - node.lowRight);
      node.belowHighLeft += highAlpha * (left - node.belowHighLeft); node.belowHighRight += highAlpha * (right - node.belowHighRight);
      const bandLeft = [node.lowLeft, node.belowHighLeft - node.lowLeft, left - node.belowHighLeft];
      const bandRight = [node.lowRight, node.belowHighRight - node.lowRight, right - node.belowHighRight];
      left = 0; right = 0;
      for (let band = 0; band < 3; band += 1) {
        const values = node.mbControls[band].map((control) => control.next()); const detector = Math.max(Math.abs(bandLeft[band]), Math.abs(bandRight[band]));
        const attack = 0.0001 * (1000 ** values[2]); const release = 0.02 * (50 ** values[3]);
        const coefficient = Math.exp(-1 / ((detector > node.mbEnvelopes[band] ? attack : release) * workletSampleRate));
        node.mbEnvelopes[band] = coefficient * node.mbEnvelopes[band] + (1 - coefficient) * detector;
        const threshold = dbGain(-48 + values[0] * 48); const ratio = 1 + values[1] * 19;
        const reduction = node.mbEnvelopes[band] > threshold ? (threshold / node.mbEnvelopes[band]) ** ((1 - 1 / ratio) * amount) : 1;
        const gain = reduction * dbGain(values[4] * 18); left += bandLeft[band] * gain; right += bandRight[band] * gain;
      }
    } else if (node.type === "tone_shaper") {
      const amount = node.amount.next(); const low = node.lowGain.next(); const mid = node.midGain.next(); const high = node.highGain.next();
      if (node.threeBand) {
        const lowAlpha = 1 - Math.exp(-2 * PI * 250 / workletSampleRate); const highAlpha = 1 - Math.exp(-2 * PI * 3000 / workletSampleRate);
        node.lowLeft += lowAlpha * (left - node.lowLeft); node.lowRight += lowAlpha * (right - node.lowRight);
        node.highLowLeft += highAlpha * (left - node.highLowLeft); node.highLowRight += highAlpha * (right - node.highLowRight);
        const lowScale = dbGain((low - 0.5) * 24); const midScale = dbGain((mid - 0.5) * 24); const highScale = dbGain((high - 0.5) * 24);
        left = node.lowLeft * lowScale + (node.highLowLeft - node.lowLeft) * midScale + (left - node.highLowLeft) * highScale;
        right = node.lowRight * lowScale + (node.highLowRight - node.lowRight) * midScale + (right - node.highLowRight) * highScale;
      } else {
        const alpha = 1 - Math.exp(-2 * PI * 300 * (60 ** amount) / workletSampleRate);
        node.lowLeft += alpha * (left - node.lowLeft); node.lowRight += alpha * (right - node.lowRight);
        if (amount < 0.5) { const dark = (0.5 - amount) * 2; left += (node.lowLeft - left) * dark; right += (node.lowRight - right) * dark; }
        else { const bright = (amount - 0.5) * 0.7; left += (left - node.lowLeft) * bright; right += (right - node.lowRight) * bright; }
      }
    } else if (node.type === "stereo_width") {
      const width = node.amount.next() * 2; const alpha = node.monoBass.next(); const middle = (left + right) * 0.5;
      let side = (left - right) * 0.5;
      if (alpha > 0.0001) { node.sideLow += alpha * (side - node.sideLow); side -= node.sideLow; }
      side *= width; left = middle + side; right = middle - side;
    } else if (node.type === "noise_gate") {
      const detectorHighPassAlpha = 1 - Math.exp(-2 * PI * 55 / workletSampleRate);
      node.detectorLowLeft += detectorHighPassAlpha * (left - node.detectorLowLeft);
      node.detectorLowRight += detectorHighPassAlpha * (right - node.detectorLowRight);
      const detector = Math.max(Math.abs(left - node.detectorLowLeft), Math.abs(right - node.detectorLowRight));
      const envelopeCoefficient = Math.exp(-1 / ((detector > node.envelope ? 0.00035 : 0.065) * workletSampleRate));
      node.envelope = envelopeCoefficient * node.envelope + (1 - envelopeCoefficient) * detector;
      const threshold = dbGain(-80 + node.threshold.next() * 60);
      if (node.envelope >= threshold) {
        node.open = true; node.holdSamplesRemaining = Math.max(1, Math.trunc(workletSampleRate * 0.008));
      } else if (node.open) {
        if (node.holdSamplesRemaining > 0) node.holdSamplesRemaining -= 1;
        else if (node.envelope < threshold * 0.62) node.open = false;
      }
      const releaseSeconds = 0.005 * (100 ** node.release.next());
      const target = node.open ? 1 : 0;
      const gainCoefficient = Math.exp(-1 / ((target ? 0.0006 : releaseSeconds) * workletSampleRate));
      node.gateGain = gainCoefficient * node.gateGain + (1 - gainCoefficient) * target;
      left *= node.gateGain; right *= node.gateGain;
    } else if (node.type === "amp_overdrive") {
      const drive = node.drive.next(); const tone = node.tone.next(); const level = node.level.next();
      const inputGain = 1 + drive * 24; const normalization = Math.tanh(inputGain);
      left = processOversampledSaturation(node.leftOversampler, left, 1, inputGain, 0, 0, normalization);
      right = processOversampledSaturation(node.rightOversampler, right, 1, inputGain, 0, 0, normalization);
      const alpha = 1 - Math.exp(-2 * PI * 700 * (16 ** tone) / workletSampleRate);
      node.toneLeft += alpha * (left - node.toneLeft); node.toneRight += alpha * (right - node.toneRight);
      const brightness = 0.15 + tone * 0.85;
      left = (node.toneLeft + (left - node.toneLeft) * brightness) * level;
      right = (node.toneRight + (right - node.toneRight) * brightness) * level;
    } else if (node.type === "amp_model") {
      const gain = node.gain.next(); const bass = node.bass.next(); const mid = node.mid.next();
      const treble = node.treble.next(); const presence = node.presence.next(); const master = node.master.next();
      const dcAlpha = 1 - Math.exp(-2 * PI * 25 / workletSampleRate);
      node.dcLeft += dcAlpha * (left - node.dcLeft); node.dcRight += dcAlpha * (right - node.dcRight);
      left -= node.dcLeft; right -= node.dcRight;
      const drive = 1 + gain * 35; const bias = 0.04 + gain * 0.08;
      const biasOffset = Math.tanh(bias * drive); const normalization = Math.tanh(drive);
      left = processOversampledSaturation(node.leftOversampler, left, 2, drive, bias, biasOffset, normalization, 1.4 + gain);
      right = processOversampledSaturation(node.rightOversampler, right, 2, drive, bias, biasOffset, normalization, 1.4 + gain);
      const detector = Math.max(Math.abs(left), Math.abs(right)); const sagAlpha = 1 - Math.exp(-1 / (0.08 * workletSampleRate));
      node.sagEnvelope += sagAlpha * (detector - node.sagEnvelope);
      const sagGain = 1 / (1 + node.sagEnvelope * gain * 0.45);
      left *= sagGain; right *= sagGain;
      const lowAlpha = 1 - Math.exp(-2 * PI * 220 / workletSampleRate); const highAlpha = 1 - Math.exp(-2 * PI * 2600 / workletSampleRate);
      node.lowLeft += lowAlpha * (left - node.lowLeft); node.lowRight += lowAlpha * (right - node.lowRight);
      node.highLowLeft += highAlpha * (left - node.highLowLeft); node.highLowRight += highAlpha * (right - node.highLowRight);
      const lowScale = dbGain((bass - 0.5) * 24); const midScale = dbGain((mid - 0.5) * 24); const highScale = dbGain((treble - 0.5) * 24);
      left = node.lowLeft * lowScale + (node.highLowLeft - node.lowLeft) * midScale + (left - node.highLowLeft) * highScale;
      right = node.lowRight * lowScale + (node.highLowRight - node.lowRight) * midScale + (right - node.highLowRight) * highScale;
      left = (left + (left - node.highLowLeft) * presence * 0.45) * master * AMP_REFERENCE_GAIN;
      right = (right + (right - node.highLowRight) * presence * 0.45) * master * AMP_REFERENCE_GAIN;
    } else if (node.type === "silk_bloom") {
      const modeValue = node.mode.next(); const mode = modeValue < 1 / 3 ? 0 : modeValue < 2 / 3 ? 1 : 2;
      const pickup = node.pickup.next() * 2 - 1; const gain = node.gain.next(); const touch = node.touch.next();
      const bass = node.bass.next(); const mid = node.mid.next(); const treble = node.treble.next();
      const presence = node.presence.next(); const sag = node.sag.next(); const master = node.master.next();
      const dcAlpha = 1 - Math.exp(-2 * PI * 25 / workletSampleRate);
      node.dcLeft += dcAlpha * (left - node.dcLeft); node.dcRight += dcAlpha * (right - node.dcRight); left -= node.dcLeft; right -= node.dcRight;
      const pickupAlpha = 1 - Math.exp(-2 * PI * 1450 / workletSampleRate);
      node.pickupLowLeft += pickupAlpha * (left - node.pickupLowLeft); node.pickupLowRight += pickupAlpha * (right - node.pickupLowRight);
      left = left * (1 - pickup * 0.1) + node.pickupLowLeft * pickup * 0.16; right = right * (1 - pickup * 0.1) + node.pickupLowRight * pickup * 0.16;
      const modeDrive = [0.72, 1.35, 2.2][mode]; const drive = (1.25 + gain * 15) * modeDrive;
      const detectorIn = Math.max(Math.abs(left), Math.abs(right)); const dynamicDrive = drive * (1 + detectorIn * touch * (mode === 0 ? 1.1 : 0.55));
      const bias = [0.018, 0.032, 0.046][mode] + pickup * 0.006; const biasOffset = Math.tanh(bias * dynamicDrive); const normalization = Math.max(0.2, Math.tanh(dynamicDrive));
      const shape = (sample) => { const first = (Math.tanh((sample + bias) * dynamicDrive) - biasOffset) / normalization; return Math.tanh(first * [1.05, 1.3, 1.65][mode]); };
      left = processOversampled(node.leftOversampler, left, shape); right = processOversampled(node.rightOversampler, right, shape);
      const detector = Math.max(Math.abs(left), Math.abs(right)); const sagAlpha = 1 - Math.exp(-1 / ((0.045 + sag * 0.12) * workletSampleRate));
      node.sagEnvelope += sagAlpha * (detector - node.sagEnvelope); const bloom = 1 / (1 + node.sagEnvelope * sag * [0.25, 0.48, 0.72][mode]); left *= bloom; right *= bloom;
      const lowAlpha = 1 - Math.exp(-2 * PI * 210 / workletSampleRate); const highAlpha = 1 - Math.exp(-2 * PI * 2850 / workletSampleRate);
      node.lowLeft += lowAlpha * (left - node.lowLeft); node.lowRight += lowAlpha * (right - node.lowRight); node.highLowLeft += highAlpha * (left - node.highLowLeft); node.highLowRight += highAlpha * (right - node.highLowRight);
      const lowScale = dbGain((bass - 0.5) * 18); const midScale = dbGain((mid - 0.5) * 18 + [0.5, 1.4, 2.2][mode]); const highScale = dbGain((treble - 0.5) * 16);
      left = node.lowLeft * lowScale + (node.highLowLeft - node.lowLeft) * midScale + (left - node.highLowLeft) * highScale;
      right = node.lowRight * lowScale + (node.highLowRight - node.lowRight) * midScale + (right - node.highLowRight) * highScale;
      const masterGain = dbGain(-18 + master * 24) * AMP_REFERENCE_GAIN; left = (left + (left - node.highLowLeft) * presence * 0.32) * masterGain; right = (right + (right - node.highLowRight) * presence * 0.32) * masterGain;
    } else if (node.type === "dual_high_gain") {
      const rectified = node.mode.next() < 0.5;
      const gain = node.gain.next(); const tight = node.tight.next(); const bass = node.bass.next();
      const mid = node.mid.next(); const treble = node.treble.next(); const presence = node.presence.next();
      const depth = node.depth.next(); const sag = node.sag.next(); const master = node.master.next();
      const processPreamp = (input, highPass, lowPass) => {
        const rectifiedDrive = [1, 0.82, 1.15, 0.7]; const cascadingDrive = [0.85, 1.05, 0.9, 0.82];
        const driveShape = rectified ? rectifiedDrive : cascadingDrive;
        const highPassCutoff = (rectified ? 78 : 55) + tight * (rectified ? 165 : 115);
        const lowPassCutoff = (rectified ? 12500 : 9800) - gain * (rectified ? 1800 : 1200);
        const baseDrive = rectified ? 1.8 + gain * 8.5 : 1.55 + gain * 7.4;
        let value = input;
        for (let stage = 0; stage < 4; stage += 1) {
          const hpAlpha = 1 - Math.exp(-2 * PI * highPassCutoff * (1 + stage * 0.12) / (workletSampleRate * OVERSAMPLING_FACTOR));
          highPass[stage] += hpAlpha * (value - highPass[stage]); value -= highPass[stage];
          const drive = baseDrive * driveShape[stage];
          const bias = (rectified ? 0.025 : 0.018) * (stage % 2 ? -1 : 1) * (0.5 + gain);
          value = (Math.tanh((value + bias) * drive) - Math.tanh(bias * drive)) / Math.max(0.2, Math.tanh(drive));
          value *= rectified ? 0.73 : 0.76;
          const lpAlpha = 1 - Math.exp(-2 * PI * lowPassCutoff / (workletSampleRate * OVERSAMPLING_FACTOR));
          lowPass[stage] += lpAlpha * (value - lowPass[stage]); value = lowPass[stage];
        }
        return value;
      };
      const sagGain = 1 / (1 + node.sagEnvelope * sag * (rectified ? 0.55 : 0.9));
      const inputLeft = left; const inputRight = right;
      for (let phase = 1; phase <= OVERSAMPLING_FACTOR; phase += 1) {
        const fraction = phase / OVERSAMPLING_FACTOR;
        let oversampledLeft = node.previousLeft + (inputLeft - node.previousLeft) * fraction;
        let oversampledRight = node.previousRight + (inputRight - node.previousRight) * fraction;
        for (let section = 0; section < oversamplingLowPass.length; section += 1) {
          oversampledLeft = processBiquad(oversampledLeft, oversamplingLowPass[section], node.preFilterLeft[section]);
          oversampledRight = processBiquad(oversampledRight, oversamplingLowPass[section], node.preFilterRight[section]);
        }
        oversampledLeft = processPreamp(oversampledLeft, node.highPassLeft, node.lowPassLeft);
        oversampledRight = processPreamp(oversampledRight, node.highPassRight, node.lowPassRight);
        oversampledLeft = Math.tanh(oversampledLeft * (rectified ? 1.22 : 1.38) * sagGain);
        oversampledRight = Math.tanh(oversampledRight * (rectified ? 1.22 : 1.38) * sagGain);
        for (let section = 0; section < oversamplingLowPass.length; section += 1) {
          oversampledLeft = processBiquad(oversampledLeft, oversamplingLowPass[section], node.postFilterLeft[section]);
          oversampledRight = processBiquad(oversampledRight, oversamplingLowPass[section], node.postFilterRight[section]);
        }
        left = oversampledLeft; right = oversampledRight;
      }
      node.previousLeft = inputLeft; node.previousRight = inputRight;
      const detector = Math.max(Math.abs(left), Math.abs(right));
      const sagAlpha = 1 - Math.exp(-1 / ((rectified ? 0.045 : 0.085) * workletSampleRate));
      node.sagEnvelope += sagAlpha * (detector - node.sagEnvelope);
      const lowAlpha = 1 - Math.exp(-2 * PI * (rectified ? 190 : 230) / workletSampleRate);
      const highAlpha = 1 - Math.exp(-2 * PI * (rectified ? 2850 : 2550) / workletSampleRate);
      node.toneLowLeft += lowAlpha * (left - node.toneLowLeft); node.toneLowRight += lowAlpha * (right - node.toneLowRight);
      node.toneHighLowLeft += highAlpha * (left - node.toneHighLowLeft); node.toneHighLowRight += highAlpha * (right - node.toneHighLowRight);
      const lowScale = dbGain((bass - 0.5) * 20); const midScale = dbGain((mid - 0.5) * 20 + (rectified ? -2 : 1.5));
      const highScale = dbGain((treble - 0.5) * 20);
      left = node.toneLowLeft * lowScale + (node.toneHighLowLeft - node.toneLowLeft) * midScale + (left - node.toneHighLowLeft) * highScale;
      right = node.toneLowRight * lowScale + (node.toneHighLowRight - node.toneLowRight) * midScale + (right - node.toneHighLowRight) * highScale;
      const speakerLowAlpha = 1 - Math.exp(-2 * PI * (rectified ? 92 : 105) / workletSampleRate);
      const speakerBodyAlpha = 1 - Math.exp(-2 * PI * (rectified ? 185 : 210) / workletSampleRate);
      node.speakerLowLeft += speakerLowAlpha * (left - node.speakerLowLeft); node.speakerLowRight += speakerLowAlpha * (right - node.speakerLowRight);
      node.speakerBodyLeft += speakerBodyAlpha * (left - node.speakerBodyLeft); node.speakerBodyRight += speakerBodyAlpha * (right - node.speakerBodyRight);
      const loadDamping = 1 / (1 + detector * (rectified ? 0.55 : 0.42));
      left += (node.speakerLowLeft - node.speakerBodyLeft) * (0.16 + depth * 0.24) * loadDamping;
      right += (node.speakerLowRight - node.speakerBodyRight) * (0.16 + depth * 0.24) * loadDamping;
      const depthAlpha = 1 - Math.exp(-2 * PI * 115 / workletSampleRate);
      node.depthLowLeft += depthAlpha * (left - node.depthLowLeft); node.depthLowRight += depthAlpha * (right - node.depthLowRight);
      left += node.depthLowLeft * depth * (rectified ? 0.8 : 0.62); right += node.depthLowRight * depth * (rectified ? 0.8 : 0.62);
      const presenceAlpha = 1 - Math.exp(-2 * PI * 3400 / workletSampleRate);
      node.presenceLowLeft += presenceAlpha * (left - node.presenceLowLeft); node.presenceLowRight += presenceAlpha * (right - node.presenceLowRight);
      left += (left - node.presenceLowLeft) * presence * (rectified ? 0.7 : 0.48);
      right += (right - node.presenceLowRight) * presence * (rectified ? 0.7 : 0.48);
      const fluxAlpha = 1 - Math.exp(-2 * PI * 34 / workletSampleRate);
      node.transformerFluxLeft += fluxAlpha * (left - node.transformerFluxLeft);
      node.transformerFluxRight += fluxAlpha * (right - node.transformerFluxRight);
      const transformerDrive = 1.04 + master * 0.32; const transformerNormalization = Math.tanh(transformerDrive);
      left = Math.tanh((left + node.transformerFluxLeft * sag * 0.075) * transformerDrive) / transformerNormalization;
      right = Math.tanh((right + node.transformerFluxRight * sag * 0.075) * transformerDrive) / transformerNormalization;
      const masterGain = dbGain(-18 + master * 24) * AMP_REFERENCE_GAIN;
      left *= masterGain; right *= masterGain;
    } else if (node.type === "cabinet_ir") {
      node.leftHistory[node.cursor] = left; node.rightHistory[node.cursor] = right;
      const cabinet = node.cabinet.next(); const mic = node.micPosition.next();
      const micBlend = node.micBlend.next(); const distance = node.distance.next();
      const lowCut = node.lowCut.next(); const highCut = node.highCut.next();
      const customImpulse = node.customTapDelays && node.customCoefficients;
      if (!customImpulse) {
        if (node.morphCountdown === 0) {
          if (Math.abs(cabinet - node.lastCabinet) > 1e-6 || Math.abs(mic - node.lastMicPosition) > 1e-6 || Math.abs(micBlend - node.lastMicBlend) > 1e-6) {
            rebuildCabinetIr(node, cabinet, mic, micBlend);
            node.lastCabinet = cabinet; node.lastMicPosition = mic; node.lastMicBlend = micBlend;
          }
          node.morphCountdown = 31;
        } else node.morphCountdown -= 1;
      }
      let convolvedLeft = 0; let convolvedRight = 0;
      if (customImpulse) {
        for (let tap = 0; tap < node.customCoefficients.length; tap += 1) {
          const delayed = node.customTapDelays[tap];
          const historyIndex = node.cursor >= delayed ? node.cursor - delayed : node.cursor + node.leftHistory.length - delayed;
          const coefficient = node.customCoefficients[tap];
          convolvedLeft += node.leftHistory[historyIndex] * coefficient;
          convolvedRight += node.rightHistory[historyIndex] * coefficient;
        }
      } else {
        const impulseBank = ensureCabinetIr();
        for (let tap = 0; tap < CABINET_TAPS; tap += 1) {
          const historyIndex = (node.cursor - impulseBank.tapDelays[tap]) & (CABINET_IR_LENGTH - 1);
          const coefficient = node.morphedIr[tap];
          convolvedLeft += node.leftHistory[historyIndex] * coefficient;
          convolvedRight += node.rightHistory[historyIndex] * coefficient;
        }
      }
      node.cursor = customImpulse ? (node.cursor + 1) % node.leftHistory.length : (node.cursor + 1) & (CABINET_IR_LENGTH - 1);
      if (!customImpulse) {
        node.reflectionHistoryLeft[node.reflectionCursor] = convolvedLeft;
        node.reflectionHistoryRight[node.reflectionCursor] = convolvedRight;
        const reflectionDelay = Math.max(1, Math.min(Math.trunc(CABINET_REFLECTION_HISTORY / 3),
          Math.trunc(workletSampleRate * (0.00025 + distance * 0.00175))));
        const firstReflectionIndex = (node.reflectionCursor + CABINET_REFLECTION_HISTORY - reflectionDelay) % CABINET_REFLECTION_HISTORY;
        const secondReflectionIndex = (node.reflectionCursor + CABINET_REFLECTION_HISTORY - reflectionDelay * 2) % CABINET_REFLECTION_HISTORY;
        convolvedLeft += node.reflectionHistoryLeft[firstReflectionIndex] * distance * 0.16
          - node.reflectionHistoryLeft[secondReflectionIndex] * distance * 0.065;
        convolvedRight += node.reflectionHistoryRight[firstReflectionIndex] * distance * 0.16
          - node.reflectionHistoryRight[secondReflectionIndex] * distance * 0.065;
        node.reflectionCursor = (node.reflectionCursor + 1) % CABINET_REFLECTION_HISTORY;
      }
      const resonance = node.resonance.next(); const level = node.level.next();
      const lowCutHz = 45 * (3.1 ** lowCut);
      const highCutHz = Math.max(2800, Math.min(workletSampleRate * 0.42,
        4200 * (2 ** (highCut * 1.25)) * (0.76 + mic * 0.48) * (1 - micBlend * 0.12) * (1 - distance * 0.16)));
      const highPassAlpha = 1 - Math.exp(-2 * PI * lowCutHz / workletSampleRate);
      const lowPassAlpha = 1 - Math.exp(-2 * PI * highCutHz / workletSampleRate);
      for (let stage = 0; stage < node.highPassLeft.length; stage += 1) {
        node.highPassLeft[stage] += highPassAlpha * (convolvedLeft - node.highPassLeft[stage]);
        node.highPassRight[stage] += highPassAlpha * (convolvedRight - node.highPassRight[stage]);
        convolvedLeft -= node.highPassLeft[stage]; convolvedRight -= node.highPassRight[stage];
      }
      for (let stage = 0; stage < node.lowPassLeft.length; stage += 1) {
        node.lowPassLeft[stage] += lowPassAlpha * (convolvedLeft - node.lowPassLeft[stage]);
        node.lowPassRight[stage] += lowPassAlpha * (convolvedRight - node.lowPassRight[stage]);
        convolvedLeft = node.lowPassLeft[stage]; convolvedRight = node.lowPassRight[stage];
      }
      const resonanceAlpha = 1 - Math.exp(-2 * PI * (88 + cabinet * 30) / workletSampleRate);
      node.resonanceLeft += resonanceAlpha * (convolvedLeft - node.resonanceLeft);
      node.resonanceRight += resonanceAlpha * (convolvedRight - node.resonanceRight);
      const resonanceGain = (resonance - 0.5) * 0.62;
      left = (convolvedLeft + node.resonanceLeft * resonanceGain) * level;
      right = (convolvedRight + node.resonanceRight * resonanceGain) * level;
    } else if (node.type === "cross_delay") {
      const amount = node.amount.next();
      if (amount > 0.0001) {
        const seconds = node.time.next(); const feedback = node.feedback.next(); const crossfeed = node.crossfeed.next(); const filter = node.filter.next();
        const delaySamples = Math.max(1, Math.min(node.leftDelay.length - 1, Math.round(workletSampleRate * seconds)));
        const read = (node.cursor + node.leftDelay.length - delaySamples) % node.leftDelay.length;
        const delayedLeft = node.leftDelay[read]; const delayedRight = node.rightDelay[read]; const alpha = 0.02 + filter * 0.98;
        node.filteredLeft += alpha * (delayedLeft - node.filteredLeft); node.filteredRight += alpha * (delayedRight - node.filteredRight);
        const effectiveFeedback = node.feedbackOverridden ? feedback : 0.18 + amount * 0.5;
        const returnLeft = node.filteredLeft * (1 - crossfeed) + node.filteredRight * crossfeed;
        const returnRight = node.filteredRight * (1 - crossfeed) + node.filteredLeft * crossfeed;
        node.leftDelay[node.cursor] = left + returnLeft * effectiveFeedback; node.rightDelay[node.cursor] = right + returnRight * effectiveFeedback;
        node.cursor = (node.cursor + 1) % node.leftDelay.length;
        left += node.filteredLeft * amount * 0.32; right += node.filteredRight * amount * 0.32;
      }
    } else if (["chorus", "flanger", "vibrato"].includes(node.type)) {
      const mix = node.amount.next(); const rate = 0.05 * (100 ** node.rate.next()); const depth = node.depth.next();
      const delay = node.delay.next(); const feedbackControl = node.feedback.next(); const stereoPhase = node.stereo.next() * PI;
      let baseMilliseconds = 8 + delay * 20; let sweepMilliseconds = depth * 10; let feedback = feedbackControl * 0.55;
      if (node.type === "flanger") { baseMilliseconds = 0.25 + delay * 7.75; sweepMilliseconds = 0.1 + depth * 4.9; feedback = (feedbackControl - 0.5) * 1.5; }
      else if (node.type === "vibrato") { baseMilliseconds = 7; sweepMilliseconds = 0.2 + depth * 6; feedback = 0; }
      const readDelay = (buffer, samples) => {
        let position = node.cursor - samples; while (position < 0) position += buffer.length;
        const first = Math.trunc(position) % buffer.length; const second = (first + 1) % buffer.length; const fraction = position - Math.floor(position);
        return buffer[first] + (buffer[second] - buffer[first]) * fraction;
      };
      const delayLeft = Math.max(1, workletSampleRate * 0.001 * (baseMilliseconds + sweepMilliseconds * (0.5 + 0.5 * Math.sin(node.phase))));
      const delayRight = Math.max(1, workletSampleRate * 0.001 * (baseMilliseconds + sweepMilliseconds * (0.5 + 0.5 * Math.sin(node.phase + stereoPhase))));
      const wetLeft = readDelay(node.leftDelay, delayLeft); const wetRight = readDelay(node.rightDelay, delayRight);
      node.leftDelay[node.cursor] = left + node.lastLeft * feedback; node.rightDelay[node.cursor] = right + node.lastRight * feedback;
      node.lastLeft = wetLeft; node.lastRight = wetRight; node.cursor = (node.cursor + 1) % node.leftDelay.length;
      node.phase += 2 * PI * rate / workletSampleRate; if (node.phase >= 2 * PI) node.phase -= 2 * PI;
      const dryGain = node.type === "vibrato" ? 1 - mix : 1 - mix * 0.5;
      left = left * dryGain + wetLeft * mix; right = right * dryGain + wetRight * mix;
    } else if (node.type === "tremolo") {
      const mix = node.amount.next(); const rate = 0.2 * (60 ** node.rate.next()); const depth = node.depth.next(); const shape = node.shape.next();
      const lfo = (phase) => {
        const sine = 0.5 + 0.5 * Math.sin(phase); const position = (phase / (2 * PI) + 0.25) % 1; const triangle = 1 - Math.abs(2 * position - 1); const square = Math.sin(phase) >= 0 ? 1 : 0;
        return shape < 0.5 ? sine + (triangle - sine) * shape * 2 : triangle + (square - triangle) * (shape - 0.5) * 2;
      };
      const gainLeft = 1 - depth * (1 - lfo(node.phase)); const gainRight = 1 - depth * (1 - lfo(node.phase + node.stereo.next() * PI));
      left *= 1 + (gainLeft - 1) * mix; right *= 1 + (gainRight - 1) * mix;
      node.phase += 2 * PI * rate / workletSampleRate; if (node.phase >= 2 * PI) node.phase -= 2 * PI;
    } else if (node.type === "digital_delay") {
      const mix = node.amount.next(); const seconds = 0.01 * (80 ** node.time.next()); const feedback = node.feedback.next() * 0.92;
      const tone = node.tone.next(); const character = node.character.next(); const stereo = node.stereo.next();
      const samples = Math.max(1, Math.min(node.leftDelay.length - 1, Math.round(workletSampleRate * seconds)));
      const read = (node.cursor + node.leftDelay.length - samples) % node.leftDelay.length;
      const delayedLeft = node.leftDelay[read]; const delayedRight = node.rightDelay[read];
      const cutoff = Math.min(workletSampleRate * 0.42, 1800 * (8 ** tone) * (1 - character * 0.34)); const alpha = 1 - Math.exp(-2 * PI * cutoff / workletSampleRate);
      node.filteredLeft += alpha * (delayedLeft - node.filteredLeft); node.filteredRight += alpha * (delayedRight - node.filteredRight);
      const drive = 1 + character * 0.65; const normalization = Math.tanh(drive); const levels = 32768 * (0.0625 ** character);
      const encode = (sample) => Math.round((Math.tanh(sample * drive) / normalization) * levels) / levels;
      const returnLeft = node.filteredLeft * (1 - stereo) + node.filteredRight * stereo;
      const returnRight = node.filteredRight * (1 - stereo) + node.filteredLeft * stereo;
      node.leftDelay[node.cursor] = encode(left + returnLeft * feedback); node.rightDelay[node.cursor] = encode(right + returnRight * feedback);
      node.cursor = (node.cursor + 1) % node.leftDelay.length;
      left = left * (1 - mix) + node.filteredLeft * mix; right = right * (1 - mix) + node.filteredRight * mix;
    } else if (["reverb", "shimmer"].includes(node.type)) {
      const dryLeft = left; const dryRight = right; const mix = node.amount.next(); const sizeValue = node.size.next();
      const decay = node.decay.next(); const damping = node.damping.next(); const pre = node.preDelay.next(); const modulation = node.modulation.next(); const shimmer = node.shimmer.next();
      const rise = node.rise.next(); const tone = node.tone.next();
      const mode = Math.max(0, Math.min(3, Math.round(node.mode.next() * 3)));
      const preSamples = Math.max(1, Math.min(node.preDelayLeft.length - 1, Math.trunc(pre * 0.12 * workletSampleRate)));
      const preRead = (node.preDelayCursor + node.preDelayLeft.length - preSamples) % node.preDelayLeft.length;
      const inputLeft = node.preDelayLeft[preRead]; const inputRight = node.preDelayRight[preRead];
      node.preDelayLeft[node.preDelayCursor] = left; node.preDelayRight[node.preDelayCursor] = right; node.preDelayCursor = (node.preDelayCursor + 1) % node.preDelayLeft.length;
      if (node.type === "reverb") {
        let diffuseLeft = inputLeft; let diffuseRight = inputRight;
        const diffusion = [0.46, 0.56, 0.62, 0.58][mode] + sizeValue * [0.08, 0.1, 0.1, 0.12][mode];
        for (let stage = 0; stage < 4; stage += 1) {
          const cursor = node.hallDiffuserCursor[stage]; const delay = node.hallDiffuserDelays[stage];
          diffuseLeft = processDelayAllpass(diffuseLeft, node.hallDiffuserLeft[stage], cursor, delay, diffusion);
          diffuseRight = processDelayAllpass(diffuseRight, node.hallDiffuserRight[stage], cursor, delay, diffusion);
          node.hallDiffuserCursor[stage] = (cursor + 1) % node.hallDiffuserLeft[stage].length;
        }
        const hallSize = [0.72, 0.76, 0.8, 0.82][mode] + sizeValue * [0.54, 0.6, 0.64, 0.68][mode]; const x = node.hallLines;
        const highCut = Math.min(workletSampleRate * 0.44, [3600, 3100, 4200, 2600][mode] * ([7, 7, 6, 8][mode] ** (1 - damping)));
        const dampingAlpha = 1 - Math.exp(-2 * PI * highCut / workletSampleRate);
        const lowAlpha = 1 - Math.exp(-2 * PI * ([125, 105, 110, 95][mode] + damping * [55, 65, 60, 70][mode]) / workletSampleRate);
        for (let line = 0; line < 8; line += 1) {
          const wobble = modulation * (Math.sin(node.modulationPhase + line * 1.71) * [0.55, 0.9, 1.25, 1.7][mode] + Math.sin(node.hallModulationPhase + line * 2.13) * [0.22, 0.42, 0.62, 0.8][mode]);
          const delaySamples = Math.max(2, Math.min(node.hallTank[line].length - 2, workletSampleRate * 0.001 * SMOOTH_REVERB_DELAY_PROFILES[mode][line] * hallSize + wobble));
          let sample = readFractionalRing(node.hallTank[line], node.hallTankCursor[line], delaySamples);
          node.hallDampingState[line] += dampingAlpha * (sample - node.hallDampingState[line]); sample = node.hallDampingState[line];
          node.hallLowState[line] += lowAlpha * (sample - node.hallLowState[line]); sample -= node.hallLowState[line] * [0.24, 0.28, 0.2, 0.34][mode];
          if (mode === 1) {
            const coefficient = line % 2 ? 0.63 : 0.51; const output = -coefficient * sample + node.dispersionState[line];
            node.dispersionState[line] = sample + coefficient * output; sample = output;
          }
          x[line] = sample;
          node.hallMatrix[line] = x[line];
        }
        for (let stride = 1; stride < 8; stride *= 2) {
          for (let start = 0; start < 8; start += stride * 2) {
            for (let offset = 0; offset < stride; offset += 1) {
              const first = start + offset; const second = first + stride;
              const a = node.hallMatrix[first]; const b = node.hallMatrix[second];
              node.hallMatrix[first] = a + b; node.hallMatrix[second] = a - b;
            }
          }
        }
        const hallFeedback = Math.min([0.89, 0.93, 0.95, 0.972][mode], [0.53, 0.59, 0.65, 0.72][mode] + decay * [0.36, 0.34, 0.3, 0.255][mode]); const matrixScale = 0.3535533905932738;
        for (let line = 0; line < 8; line += 1) {
          const primaryInput = line % 2 ? diffuseRight : diffuseLeft; const crossInput = line % 2 ? diffuseLeft : diffuseRight;
          const injectionSign = (line & 2) === 0 ? 1 : -1;
          const tankInput = (primaryInput * [0.34, 0.29, 0.25, 0.22][mode] + crossInput * [0.065, 0.05, 0.042, 0.035][mode]) * injectionSign + node.hallMatrix[line] * matrixScale * hallFeedback;
          node.hallTank[line][node.hallTankCursor[line]] = Math.tanh(tankInput * 1.08) / 1.08;
          node.hallTankCursor[line] = (node.hallTankCursor[line] + 1) % node.hallTank[line].length;
        }
        node.modulationPhase += 2 * PI * [0.23, 0.27, 0.17, 0.11][mode] / workletSampleRate; node.hallModulationPhase += 2 * PI * [0.31, 0.37, 0.23, 0.173][mode] / workletSampleRate;
        if (node.modulationPhase >= 2 * PI) node.modulationPhase -= 2 * PI;
        if (node.hallModulationPhase >= 2 * PI) node.hallModulationPhase -= 2 * PI;
        const lateLeft = (x[0] + x[2] + x[5] - x[7]) * [0.32, 0.3, 0.3, 0.28][mode]; const lateRight = (x[1] + x[3] + x[4] - x[6]) * [0.32, 0.3, 0.3, 0.28][mode];
        const wetLeft = lateLeft * [0.82, 0.88, 0.94, 1][mode] + diffuseLeft * [0.16, 0.12, 0.085, 0.075][mode]; const wetRight = lateRight * [0.82, 0.88, 0.94, 1][mode] + diffuseRight * [0.16, 0.12, 0.085, 0.075][mode];
        left = dryLeft * (1 - mix) + wetLeft * mix; right = dryRight * (1 - mix) + wetRight * mix;
      } else {
        const envelopeTarget = Math.min(1, Math.max(Math.abs(dryLeft), Math.abs(dryRight)) * 8);
        const attackSeconds = 0.18 + rise * 0.27; const releaseSeconds = 0.75 + rise * 0.85;
        const envelopeCoefficient = 1 - Math.exp(-1 / (workletSampleRate * (envelopeTarget > node.bloomEnvelope ? attackSeconds : releaseSeconds)));
        node.bloomEnvelope += envelopeCoefficient * (envelopeTarget - node.bloomEnvelope);
        const highPassCutoff = 220 - tone * 80; const lowPassCutoff = Math.min(workletSampleRate * 0.42, 3200 + tone * 2300);
        const highPassAlpha = 1 - Math.exp(-2 * PI * highPassCutoff / workletSampleRate);
        const lowPassAlpha = 1 - Math.exp(-2 * PI * lowPassCutoff / workletSampleRate);
        node.bloomHighPassState[0] += highPassAlpha * (inputLeft - node.bloomHighPassState[0]);
        node.bloomHighPassState[1] += highPassAlpha * (inputRight - node.bloomHighPassState[1]);
        const harmonicHighLeftStage1 = inputLeft - node.bloomHighPassState[0]; const harmonicHighRightStage1 = inputRight - node.bloomHighPassState[1];
        node.bloomHighPassState[2] += highPassAlpha * (harmonicHighLeftStage1 - node.bloomHighPassState[2]);
        node.bloomHighPassState[3] += highPassAlpha * (harmonicHighRightStage1 - node.bloomHighPassState[3]);
        const harmonicHighLeft = harmonicHighLeftStage1 - node.bloomHighPassState[2]; const harmonicHighRight = harmonicHighRightStage1 - node.bloomHighPassState[3];
        node.bloomLowPassState[0] += lowPassAlpha * (harmonicHighLeft - node.bloomLowPassState[0]);
        node.bloomLowPassState[1] += lowPassAlpha * (harmonicHighRight - node.bloomLowPassState[1]);
        node.pitchLeft[node.pitchCursor] = node.bloomLowPassState[0] * node.bloomEnvelope;
        node.pitchRight[node.pitchCursor] = node.bloomLowPassState[1] * node.bloomEnvelope;
        const octaveLeftRatio = 2.001; const octaveRightRatio = 1.999;
        const fifthLeftRatio = (2 ** (7 / 12)) * 1.0008; const fifthRightRatio = (2 ** (7 / 12)) * 0.9992;
        const octaveLeft = pitchShiftBloomVoice(node.pitchLeft, node.pitchCursor, node.bloomPitchPhase[0], octaveLeftRatio, 0);
        const octaveRight = pitchShiftBloomVoice(node.pitchRight, node.pitchCursor, node.bloomPitchPhase[1], octaveRightRatio, 0.17);
        const fifthLeft = pitchShiftBloomVoice(node.pitchLeft, node.pitchCursor, node.bloomPitchPhase[2], fifthLeftRatio, 0.33);
        const fifthRight = pitchShiftBloomVoice(node.pitchRight, node.pitchCursor, node.bloomPitchPhase[3], fifthRightRatio, 0.67);
        node.pitchCursor = (node.pitchCursor + 1) % node.pitchLeft.length;
        node.bloomPitchPhase[0] = (node.bloomPitchPhase[0] + (octaveLeftRatio - 1) / (workletSampleRate * 0.11)) % 1;
        node.bloomPitchPhase[1] = (node.bloomPitchPhase[1] + (octaveRightRatio - 1) / (workletSampleRate * 0.11)) % 1;
        node.bloomPitchPhase[2] = (node.bloomPitchPhase[2] + (fifthLeftRatio - 1) / (workletSampleRate * 0.11)) % 1;
        node.bloomPitchPhase[3] = (node.bloomPitchPhase[3] + (fifthRightRatio - 1) / (workletSampleRate * 0.11)) % 1;
        const vocalLeft = octaveLeft * 0.64 + fifthLeft * 0.36;
        const vocalRight = octaveRight * 0.64 + fifthRight * 0.36;
        const choirLowAlpha = 1 - Math.exp(-2 * PI * (520 + tone * 180) / workletSampleRate);
        const choirMidAlpha = 1 - Math.exp(-2 * PI * (1550 + tone * 450) / workletSampleRate);
        const choirUpperAlpha = 1 - Math.exp(-2 * PI * (3000 + tone * 900) / workletSampleRate);
        node.bloomChoirState[0] += choirLowAlpha * (vocalLeft - node.bloomChoirState[0]);
        node.bloomChoirState[1] += choirMidAlpha * (vocalLeft - node.bloomChoirState[1]);
        node.bloomChoirState[2] += choirUpperAlpha * (vocalLeft - node.bloomChoirState[2]);
        node.bloomChoirState[3] += choirLowAlpha * (vocalRight - node.bloomChoirState[3]);
        node.bloomChoirState[4] += choirMidAlpha * (vocalRight - node.bloomChoirState[4]);
        node.bloomChoirState[5] += choirUpperAlpha * (vocalRight - node.bloomChoirState[5]);
        const choirShapedLeft = vocalLeft * 0.34 + node.bloomChoirState[0] * 0.38 + (node.bloomChoirState[1] - node.bloomChoirState[0]) * 1.2 + (node.bloomChoirState[2] - node.bloomChoirState[1]) * 0.34;
        const choirShapedRight = vocalRight * 0.34 + node.bloomChoirState[3] * 0.38 + (node.bloomChoirState[4] - node.bloomChoirState[3]) * 1.2 + (node.bloomChoirState[5] - node.bloomChoirState[4]) * 0.34;
        const choirGain = shimmer * (0.24 + 0.38 * shimmer);
        const harmonicLeft = Math.tanh(choirShapedLeft * choirGain * 1.08) / 1.08;
        const harmonicRight = Math.tanh(choirShapedRight * choirGain * 1.08) / 1.08;

        let diffuseLeft = inputLeft; let diffuseRight = inputRight;
        const diffusion = 0.58 + sizeValue * 0.12;
        for (let stage = 0; stage < 4; stage += 1) {
          const cursor = node.hallDiffuserCursor[stage]; const delay = node.hallDiffuserDelays[stage];
          diffuseLeft = processDelayAllpass(diffuseLeft, node.hallDiffuserLeft[stage], cursor, delay, diffusion);
          diffuseRight = processDelayAllpass(diffuseRight, node.hallDiffuserRight[stage], cursor, delay, diffusion);
          node.hallDiffuserCursor[stage] = (cursor + 1) % node.hallDiffuserLeft[stage].length;
        }
        const hallSize = 0.82 + sizeValue * 0.68; const x = node.hallLines;
        const highCut = Math.min(workletSampleRate * 0.44, 2600 * (8 ** (1 - damping)));
        const dampingAlpha = 1 - Math.exp(-2 * PI * highCut / workletSampleRate);
        const lowAlpha = 1 - Math.exp(-2 * PI * (95 + damping * 70) / workletSampleRate);
        for (let line = 0; line < 8; line += 1) {
          const wobble = modulation * (Math.sin(node.modulationPhase + line * 1.71) * 1.7 + Math.sin(node.hallModulationPhase + line * 2.13) * 0.8);
          const delaySamples = Math.max(2, Math.min(node.hallTank[line].length - 2, workletSampleRate * 0.001 * SMOOTH_REVERB_DELAY_PROFILES[3][line] * hallSize + wobble));
          let sample = readFractionalRing(node.hallTank[line], node.hallTankCursor[line], delaySamples);
          node.hallDampingState[line] += dampingAlpha * (sample - node.hallDampingState[line]); sample = node.hallDampingState[line];
          node.hallLowState[line] += lowAlpha * (sample - node.hallLowState[line]); sample -= node.hallLowState[line] * 0.34;
          x[line] = sample; node.hallMatrix[line] = sample;
        }
        for (let stride = 1; stride < 8; stride *= 2) {
          for (let start = 0; start < 8; start += stride * 2) {
            for (let offset = 0; offset < stride; offset += 1) {
              const first = start + offset; const second = first + stride;
              const a = node.hallMatrix[first]; const b = node.hallMatrix[second];
              node.hallMatrix[first] = a + b; node.hallMatrix[second] = a - b;
            }
          }
        }
        const hallFeedback = Math.min(0.972, 0.72 + decay * 0.255); const matrixScale = 0.3535533905932738;
        for (let line = 0; line < 8; line += 1) {
          const primaryInput = line % 2 ? diffuseRight : diffuseLeft; const crossInput = line % 2 ? diffuseLeft : diffuseRight;
          const harmonicInput = line % 2 ? harmonicRight : harmonicLeft; const injectionSign = (line & 2) === 0 ? 1 : -1;
          const rootInjection = primaryInput * 0.22 + crossInput * 0.035;
          const tankInput = (rootInjection + harmonicInput) * injectionSign + node.hallMatrix[line] * matrixScale * hallFeedback;
          node.hallTank[line][node.hallTankCursor[line]] = Math.tanh(tankInput * 1.08) / 1.08;
          node.hallTankCursor[line] = (node.hallTankCursor[line] + 1) % node.hallTank[line].length;
        }
        node.modulationPhase += 2 * PI * 0.11 / workletSampleRate; node.hallModulationPhase += 2 * PI * 0.173 / workletSampleRate;
        if (node.modulationPhase >= 2 * PI) node.modulationPhase -= 2 * PI;
        if (node.hallModulationPhase >= 2 * PI) node.hallModulationPhase -= 2 * PI;
        const lateLeft = (x[0] + x[2] + x[5] - x[7]) * 0.28; const lateRight = (x[1] + x[3] + x[4] - x[6]) * 0.28;
        const wetLeft = lateLeft + diffuseLeft * 0.075; const wetRight = lateRight + diffuseRight * 0.075;
        left = dryLeft * (1 - mix) + wetLeft * mix; right = dryRight * (1 - mix) + wetRight * mix;
      }
    } else if (node.type === "dry_wet") {
      const mix = node.amount.next(); left = rackDryLeft + (left - rackDryLeft) * mix; right = rackDryRight + (right - rackDryRight) * mix;
    }
    const mix = node.mix.next() * (1 - node.bypass.next());
    if (["linked_compressor", "legend_compressor"].includes(node.type)) node.effectiveGainReduction = 1 - mix * (1 - node.gainReduction);
    node.outputLeft = inputLeft + (left - inputLeft) * mix;
    node.outputRight = inputRight + (right - inputRight) * mix;
  };

  return class NativeDspRackProcessor extends BaseProcessor {
    constructor(options = {}) {
      super();
      const settings = options.processorOptions || {};
      this.nodes = (settings.plan || []).map(makeNode);
      this.globalBypass = new Smooth(10, settings.bypassed ? 1 : 0);
      this.meterBlocks = 0;
      this.readyPosted = false;
      this.port.onmessage = ({ data }) => {
        if (data?.type === "plan" && Array.isArray(data.plan)) {
          const reusableNodes = new Map(this.nodes.map((node) => [`${node.id}:${node.type}`, node]));
          this.nodes = data.plan.map((module) => {
            const reusable = reusableNodes.get(`${module.id}:${module.type}`);
            if (!reusable) return makeNode(module);
            updateNode(reusable, module);
            return reusable;
          });
        } else if (data?.type === "bypass") this.globalBypass.set(data.bypassed ? 1 : 0);
      };
    }
    process(inputs, outputs) {
      if (!this.readyPosted) {
        this.readyPosted = true;
        this.port.postMessage?.({ type: "ready" });
      }
      const input = inputs[0] || []; const output = outputs[0] || [];
      const leftIn = input[0]; const rightIn = input[1] || leftIn; const leftOut = output[0]; const rightOut = output[1];
      if (!leftOut) return true;
      for (let index = 0; index < leftOut.length; index += 1) {
        const dryLeft = leftIn?.[index] || 0; const dryRight = rightIn?.[index] || 0;
        let left = dryLeft; let right = dryRight; let rackDryLeft = dryLeft; let rackDryRight = dryRight;
        for (const node of this.nodes) {
          processNode(node, left, right, rackDryLeft, rackDryRight);
          left = node.outputLeft; right = node.outputRight;
          if (node.type === "input_trim") { rackDryLeft = left; rackDryRight = right; }
        }
        const bypass = this.globalBypass.next();
        leftOut[index] = left + (dryLeft - left) * bypass;
        if (rightOut) rightOut[index] = right + (dryRight - right) * bypass;
      }
      this.meterBlocks += 1;
      if (this.meterBlocks >= 8) {
        this.meterBlocks = 0;
        const compressors = this.nodes.filter((node) => ["linked_compressor", "legend_compressor"].includes(node.type));
        const normalized = (gain) => clamp(-20 * Math.log10(Math.max(0.000001, gain)) / 24);
        const active = 1 - this.globalBypass.current;
        this.port.postMessage?.({
          type: "meter",
          gainReduction: active * compressors.reduce((maximum, node) => Math.max(maximum, normalized(node.effectiveGainReduction)), 0),
          gainReductionById: Object.fromEntries(compressors.map((node) => [node.id, active * normalized(node.effectiveGainReduction)])),
        });
      }
      return true;
    }
  };
};

export const installNativeDspWorklet = async (context) => {
  if (!context?.audioWorklet || typeof AudioWorkletNode === "undefined") throw new Error("AudioWorklet is unavailable");
  if (!context.__tripleSideNativeDspWorklet) {
    // A static same-origin module survives production minification and can be
    // cached independently. prestart/prebuild regenerate it from this file.
    const publicRoot = process.env.PUBLIC_URL || "";
    context.__tripleSideNativeDspWorklet = context.audioWorklet.addModule(`${publicRoot}/vst-dsp-worklet-v25.js`);
  }
  await context.__tripleSideNativeDspWorklet;
};

export const createNativeDspWorkletNode = (context, plan, bypassed = false) => new AudioWorkletNode(
  context,
  "tripleside-native-dsp",
  { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { plan, bypassed } },
);
