import { createNativeDspProcessorClass, installNativeDspWorklet } from "./vstDspProcessor";
import { AMP_SIMULATOR_RACK_PRESET, HIGH_GAIN_AMP_RACK_PRESET } from "./vstMakerDspRack";
import fs from "fs";
import path from "path";

class TestProcessorBase {
  constructor() { this.messages = []; this.port = { onmessage: null, postMessage: (message) => this.messages.push(message) }; }
}

const render = (plan, left, right = left, sampleRate = 48000) => {
  const Processor = createNativeDspProcessorClass(TestProcessorBase, sampleRate);
  const processor = new Processor({ processorOptions: { plan } });
  const outputLeft = new Float32Array(left.length);
  const outputRight = new Float32Array(left.length);
  processor.process([[Float32Array.from(left), Float32Array.from(right)]], [[outputLeft, outputRight]]);
  return { processor, left: outputLeft, right: outputRight };
};

const renderGeneratedWorklet = (filename, plan, left, right = left, sampleRate = 48000) => {
  let Processor;
  const source = fs.readFileSync(path.join(process.cwd(), "public", filename), "utf8");
  const evaluate = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor", source);
  evaluate(TestProcessorBase, sampleRate, (_name, ProcessorClass) => { Processor = ProcessorClass; });
  const processor = new Processor({ processorOptions: { plan } });
  const outputLeft = new Float32Array(left.length); const outputRight = new Float32Array(left.length);
  processor.process([[Float32Array.from(left), Float32Array.from(right)]], [[outputLeft, outputRight]]);
  return { left: outputLeft, right: outputRight };
};

const materializePreset = (preset) => preset.map((module, index) => ({
  ...module,
  id: `${module.type}-${index}`,
  mix: 1,
  explicitParameters: Object.keys(module.parameters || {}),
}));

const rms = (signal, start = 0) => Math.sqrt(
  signal.slice(start).reduce((sum, value) => sum + value * value, 0) / (signal.length - start),
);

describe("native-parity DSP AudioWorklet", () => {
  test("loads the cache-busted v25 worklet and reuses its context promise", async () => {
    const originalAudioWorkletNode = global.AudioWorkletNode;
    global.AudioWorkletNode = function AudioWorkletNode() {};
    const addModule = jest.fn(() => Promise.resolve());
    const context = { audioWorklet: { addModule } };
    await installNativeDspWorklet(context);
    await installNativeDspWorklet(context);
    expect(addModule).toHaveBeenCalledTimes(1);
    expect(addModule).toHaveBeenCalledWith("/vst-dsp-worklet-v25.js");
    if (originalAudioWorkletNode === undefined) delete global.AudioWorkletNode;
    else global.AudioWorkletNode = originalAudioWorkletNode;
  });

  test("announces readiness only when the first render quantum starts", () => {
    const Processor = createNativeDspProcessorClass(TestProcessorBase, 48000);
    const processor = new Processor({ processorOptions: { plan: [] } });
    expect(processor.messages).not.toContainEqual({ type: "ready" });
    processor.process([[new Float32Array(1)]], [[new Float32Array(1), new Float32Array(1)]]);
    expect(processor.messages).toContainEqual({ type: "ready" });
  });

  test("reuses existing stateful nodes when a module is appended to the live rack", () => {
    const Processor = createNativeDspProcessorClass(TestProcessorBase, 48000);
    const input = { id: "input", type: "input_trim", mix: 1, parameters: { input: 0.5 }, explicitParameters: ["input"] };
    const processor = new Processor({ processorOptions: { plan: [input] } });
    const originalInputNode = processor.nodes[0];
    processor.port.onmessage({ data: { type: "plan", plan: [
      input,
      { id: "verb", type: "reverb", mix: 1, parameters: { mix: 0.25 }, explicitParameters: ["mix"] },
    ] } });
    expect(processor.nodes).toHaveLength(2);
    expect(processor.nodes[0]).toBe(originalInputNode);
    expect(processor.nodes[1].type).toBe("reverb");
  });

  test("updates a Legend circuit model in place without resetting its realtime state", () => {
    const Processor = createNativeDspProcessorClass(TestProcessorBase, 48000);
    const module = {
      id: "legend-pre", type: "legend_preamp", mix: 1,
      parameters: { model: 0, drive: 0.5, color: 0.5, high_pass: 0.2, output: 0.5 },
      explicitParameters: ["model", "drive", "color", "high_pass", "output"],
    };
    const processor = new Processor({ processorOptions: { plan: [module] } });
    const originalNode = processor.nodes[0];
    processor.process([[new Float32Array(64).fill(0.25), new Float32Array(64).fill(0.25)]], [[new Float32Array(64), new Float32Array(64)]]);
    const preservedFlux = originalNode.transformerFluxLeft;
    processor.port.onmessage({ data: { type: "plan", plan: [{ ...module, parameters: { ...module.parameters, model: 1 } }] } });
    expect(processor.nodes[0]).toBe(originalNode);
    expect(processor.nodes[0].transformerFluxLeft).toBe(preservedFlux);
    expect(processor.nodes[0].model.target).toBe(1);
  });

  test("materializes the precomputed cabinet bank without realtime trigonometric construction", () => {
    const cosine = jest.spyOn(Math, "cos");
    const Processor = createNativeDspProcessorClass(TestProcessorBase, 48000);
    const afterFactory = cosine.mock.calls.length;
    new Processor({ processorOptions: { plan: [{
      id: "verb", type: "reverb", mix: 1, parameters: { mix: 0.4 }, explicitParameters: ["mix"],
    }] } });
    expect(cosine.mock.calls.length - afterFactory).toBeLessThan(20);
    new Processor({ processorOptions: { plan: [{
      id: "cab", type: "cabinet_ir", mix: 1, parameters: {}, explicitParameters: [],
    }] } });
    expect(cosine.mock.calls.length - afterFactory).toBeLessThan(20);
    cosine.mockRestore();
  });

  test("matches native input/output gain laws and stereo-width matrix", () => {
    const plan = [
      { id: "input", type: "input_trim", mix: 1, parameters: { input: 0.5 }, explicitParameters: ["input"] },
      { id: "width", type: "stereo_width", mix: 1, parameters: { width: 0, mono_bass: 0 }, explicitParameters: ["width"] },
      { id: "output", type: "output_trim", mix: 1, parameters: { output: 0.75 }, explicitParameters: ["output"] },
    ];
    const result = render(plan, [1], [0]);
    expect(result.left[0]).toBeCloseTo(0.5, 6);
    expect(result.right[0]).toBeCloseTo(0.5, 6);
  });

  test("matches native CrossDelay impulse position and wet level", () => {
    const input = new Float32Array(191); input[0] = 1;
    const plan = [{
      id: "delay", type: "cross_delay", mix: 1,
      parameters: { space: 1, time: 0.19, feedback: 0.29, crossfeed: 1, filter: 1 },
      explicitParameters: ["space"],
    }];
    const result = render(plan, input, new Float32Array(191), 1000);
    expect(result.left[190]).toBeCloseTo(0.32, 6);
    expect(result.right[190]).toBeCloseTo(0, 6);
  });

  test("runs every new modulation, early-digital, reverb, and shimmer module with finite audible output", () => {
    const input = Float32Array.from({ length: 16384 }, (_, index) => (
      (index === 0 ? 0.8 : 0) + Math.sin(2 * Math.PI * 173 * index / 48000) * 0.12
    ));
    const plans = [
      ["chorus", { mix: 0.65, rate: 0.4, depth: 0.7, delay: 0.5, feedback: 0.35, stereo: 0.8 }],
      ["flanger", { mix: 0.6, rate: 0.3, depth: 0.7, manual: 0.4, feedback: 0.72, stereo: 0.6 }],
      ["tremolo", { mix: 1, rate: 0.5, depth: 0.8, shape: 0.45, stereo: 0.5 }],
      ["vibrato", { mix: 1, rate: 0.45, depth: 0.55, stereo: 0.4 }],
      ["digital_delay", { mix: 0.45, time: 0.35, feedback: 0.4, tone: 0.55, character: 0.75, stereo: 0.35 }],
      ["reverb", { mix: 0.4, size: 0.6, decay: 0.55, damping: 0.5, pre_delay: 0.05, modulation: 0.25 }],
      ["shimmer", { mix: 0.45, size: 0.7, decay: 0.7, damping: 0.45, pre_delay: 0.05, shimmer: 0.6, rise: 0.5, tone: 0.42 }],
    ];
    plans.forEach(([type, parameters]) => {
      const output = render([{ id: type, type, mix: 1, parameters, explicitParameters: Object.keys(parameters) }], input).left;
      expect(Array.from(output).every(Number.isFinite)).toBe(true);
      const difference = Math.sqrt(output.reduce((sum, value, index) => sum + ((value - input[index]) ** 2), 0) / output.length);
      expect(difference).toBeGreaterThan(1e-4);
    });
  });

  test("keeps Reverb v20 deterministic while every legacy Shimmer setting uses Chord Bloom", () => {
    const input = Float32Array.from({ length: 24000 }, (_, index) => (
      Math.sin(2 * Math.PI * 220 * index / 48000) * 0.17 + Math.sin(2 * Math.PI * 277.18 * index / 48000) * 0.11
    ));
    const reverbParameters = { mix: 1, mode: 1, size: 0.68, decay: 0.68, damping: 0.48, pre_delay: 0.03, modulation: 0.22 };
    const currentReverb = render([{
      id: "reverb", type: "reverb", mix: 1, parameters: reverbParameters,
      explicitParameters: Object.keys(reverbParameters),
    }], input, input, 48000);
    const legacyReverb = renderGeneratedWorklet("vst-dsp-worklet-v21.js", [{
      id: "reverb", type: "reverb", mix: 1, parameters: reverbParameters,
      explicitParameters: Object.keys(reverbParameters),
    }], input, input, 48000);
    expect(Array.from(currentReverb.left)).toEqual(Array.from(legacyReverb.left));
    expect(Array.from(currentReverb.right)).toEqual(Array.from(legacyReverb.right));

    const bloomParameters = { mix: 1, size: 0.68, decay: 0.68, damping: 0.48, pre_delay: 0.03, shimmer: 0.7, rise: 0.5, tone: 0.42 };
    const implicit = render([{
      id: "bloom", type: "shimmer", mix: 1, parameters: bloomParameters,
      explicitParameters: Object.keys(bloomParameters),
    }], input, input, 48000);
    const explicit = render([{
      id: "bloom", type: "shimmer", mix: 1, parameters: { ...bloomParameters, mode: 0 },
      explicitParameters: [...Object.keys(bloomParameters), "mode"],
    }], input, input, 48000);
    expect(Array.from(explicit.left)).toEqual(Array.from(implicit.left));
    expect(Array.from(explicit.right)).toEqual(Array.from(implicit.right));

    const processor = implicit.processor; const originalNode = processor.nodes[0];
    processor.port.onmessage({ data: { type: "plan", plan: [{
      id: "bloom", type: "shimmer", mix: 1, parameters: { ...bloomParameters, shimmer: 1, rise: 0, tone: 1 },
      explicitParameters: Object.keys(bloomParameters),
    }] } });
    expect(processor.nodes[0]).toBe(originalNode);
    expect(processor.nodes[0].bloomChoirState).toBeInstanceOf(Float64Array);
    expect(processor.nodes[0].pitchLeft).toBeInstanceOf(Float32Array);
    expect(processor.nodes[0].tank).toBeUndefined();
    expect(processor.nodes[0].shimmerMode).toBeUndefined();
    expect(processor.nodes[0].bloomPitchPhase).toBeInstanceOf(Float64Array);
    const outputLeft = new Float32Array(2048); const outputRight = new Float32Array(2048);
    processor.process([[input.subarray(0, 2048), input.subarray(0, 2048)]], [[outputLeft, outputRight]]);
    expect(Array.from(outputLeft).every(Number.isFinite)).toBe(true);
  });

  test("builds a delayed, dark chord shimmer inside the long Smooth Reverb tail", () => {
    const length = 144000; const activeLength = 96000;
    const chord = Float32Array.from({ length }, (_, index) => index < activeLength ? (
      Math.sin(2 * Math.PI * 220 * index / 48000) * 0.11
      + Math.sin(2 * Math.PI * 277.18 * index / 48000) * 0.08
      + Math.sin(2 * Math.PI * 329.63 * index / 48000) * 0.07
    ) : 0);
    const parameters = { mix: 1, size: 0.72, decay: 0.72, damping: 0.55, pre_delay: 0, shimmer: 1, rise: 0.5, tone: 0.42 };
    const withoutVoices = render([{
      id: "bloom", type: "shimmer", mix: 1, parameters: { ...parameters, shimmer: 0 },
      explicitParameters: Object.keys(parameters),
    }], chord, chord, 48000);
    const bloom = render([{
      id: "bloom", type: "shimmer", mix: 1, parameters,
      explicitParameters: Object.keys(parameters),
    }], chord, chord, 48000);
    const previous = renderGeneratedWorklet("vst-dsp-worklet-v21.js", [{
      id: "bloom", type: "shimmer", mix: 1, parameters: { ...parameters, mode: 1 },
      explicitParameters: [...Object.keys(parameters), "mode"],
    }], chord, chord, 48000);
    const previousRoot = renderGeneratedWorklet("vst-dsp-worklet-v21.js", [{
      id: "bloom", type: "shimmer", mix: 1, parameters: { ...parameters, mode: 1, shimmer: 0 },
      explicitParameters: [...Object.keys(parameters), "mode"],
    }], chord, chord, 48000);
    const harmonic = Float32Array.from(bloom.left, (value, index) => value - withoutVoices.left[index]);
    const previousHarmonic = Float32Array.from(previous.left, (value, index) => value - previousRoot.left[index]);
    const earlyRms = rms(harmonic.slice(2000, 8000)); const lateRms = rms(harmonic.slice(48000, 84000));
    const tail = bloom.left.slice(100000, 140000); const tailRight = bloom.right.slice(100000, 140000);
    const occupied = tail.reduce((count, value) => count + (Math.abs(value) > 1e-7 ? 1 : 0), 0) / tail.length;
    const tailRms = rms(tail); const stereoDifference = rms(Float32Array.from(tail, (value, index) => value - tailRight[index]));
    const monoTail = Float32Array.from(tail, (value, index) => (value + tailRight[index]) * 0.5);
    const bandMagnitude = (signal, frequency, start, samples) => {
      let real = 0; let imaginary = 0;
      for (let index = 0; index < samples; index += 1) {
        const phase = 2 * Math.PI * frequency * index / 48000; const value = signal[start + index];
        real += value * Math.cos(phase); imaginary -= value * Math.sin(phase);
      }
      return Math.hypot(real, imaginary) / samples;
    };
    const fifth = bandMagnitude(harmonic, 329.63, 52000, 24000);
    const octave = bandMagnitude(harmonic, 440, 52000, 24000);
    expect(Array.from(bloom.left).every(Number.isFinite)).toBe(true);
    expect(Array.from(bloom.right).every(Number.isFinite)).toBe(true);
    expect(earlyRms).toBeLessThan(lateRms * 0.45);
    expect(fifth).toBeGreaterThan(1e-5);
    expect(octave).toBeGreaterThan(1e-5);
    expect(lateRms).toBeGreaterThan(rms(previousHarmonic.slice(48000, 84000)) * 1.25);
    expect(occupied).toBeGreaterThan(0.98);
    expect(tailRms).toBeGreaterThan(1e-5);
    expect(stereoDifference).toBeGreaterThan(tailRms * 0.12);
    expect(rms(monoTail)).toBeGreaterThan(tailRms * 0.35);
    expect(bloom.left.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)).toBeLessThan(1);
    expect(rms(harmonic.slice(100000, 140000))).toBeGreaterThan(lateRms * 0.08);

    const shortChord = chord.slice(0, 48000); const rootShort = withoutVoices.left.slice(0, 48000);
    const fast = render([{ id: "fast", type: "shimmer", mix: 1, parameters: { ...parameters, rise: 0 }, explicitParameters: Object.keys(parameters) }], shortChord).left;
    const slow = render([{ id: "slow", type: "shimmer", mix: 1, parameters: { ...parameters, rise: 1 }, explicitParameters: Object.keys(parameters) }], shortChord).left;
    const fastRise = rms(Float32Array.from(fast, (value, index) => value - rootShort[index]).slice(8000, 24000));
    const slowRise = rms(Float32Array.from(slow, (value, index) => value - rootShort[index]).slice(8000, 24000));
    expect(fastRise).toBeGreaterThan(slowRise * 1.2);
  });

  test("controls low harmonic send and remains finite for major/minor chords at parameter extremes", () => {
    const length = 48000;
    const tone = (frequency) => Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * frequency * index / 48000) * 0.14);
    const parameters = { mix: 1, size: 1, decay: 1, damping: 0, pre_delay: 0, shimmer: 1, rise: 0, tone: 1 };
    const harmonicRms = (frequency) => {
      const input = tone(frequency);
      const voiced = render([{ id: "bloom", type: "shimmer", mix: 1, parameters, explicitParameters: Object.keys(parameters) }], input).left;
      const root = render([{ id: "bloom", type: "shimmer", mix: 1, parameters: { ...parameters, shimmer: 0 }, explicitParameters: Object.keys(parameters) }], input).left;
      return rms(Float32Array.from(voiced, (value, index) => value - root[index]), 28000);
    };
    expect(harmonicRms(80)).toBeLessThan(harmonicRms(320) * 0.7);

    const minorChord = Float32Array.from({ length }, (_, index) => (
      Math.sin(2 * Math.PI * 220 * index / 48000) * 0.1
      + Math.sin(2 * Math.PI * 261.63 * index / 48000) * 0.08
      + Math.sin(2 * Math.PI * 329.63 * index / 48000) * 0.07
    ));
    const darkSlow = { ...parameters, size: 0, damping: 1, rise: 1, tone: 0 };
    const output = render([{ id: "minor-bloom", type: "shimmer", mix: 1, parameters: darkSlow, explicitParameters: Object.keys(darkSlow) }], minorChord, minorChord).left;
    expect(Array.from(output).every(Number.isFinite)).toBe(true);
    expect(output.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)).toBeLessThan(1);
  });

  test("builds a dense stereo Hall tail without sparse barrel-like gaps", () => {
    const input = new Float32Array(48000); input[0] = 0.8;
    const parameters = {
      mix: 1, mode: 1, size: 0.68, decay: 0.66,
      damping: 0.52, pre_delay: 0.18, modulation: 0.28,
    };
    const result = render([{
      id: "smooth-hall", type: "reverb", mix: 1, parameters,
      explicitParameters: Object.keys(parameters),
    }], input, input, 48000);
    const start = 7000; const end = 36000;
    const tailLeft = result.left.slice(start, end); const tailRight = result.right.slice(start, end);
    const occupied = tailLeft.reduce((count, value) => count + (Math.abs(value) > 1e-7 ? 1 : 0), 0) / tailLeft.length;
    const peak = tailLeft.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    const tailRms = rms(tailLeft); const stereoDifference = rms(Float32Array.from(tailLeft, (value, index) => value - tailRight[index]));
    expect(Array.from(result.left).every(Number.isFinite)).toBe(true);
    expect(Array.from(result.right).every(Number.isFinite)).toBe(true);
    expect(occupied).toBeGreaterThan(0.9);
    expect(tailRms).toBeGreaterThan(1e-5);
    expect(peak / tailRms).toBeLessThan(12);
    expect(stereoDifference).toBeGreaterThan(tailRms * 0.15);
  });

  test("keeps Room, Spring, and Plate tails dense, finite, and stereo", () => {
    const input = new Float32Array(36000); input[0] = 0.8;
    [0, 1, 2].forEach((mode) => {
      const parameters = {
        mix: 1, mode: mode / 3, size: 0.62, decay: 0.58,
        damping: 0.52, pre_delay: 0.18, modulation: 0.22,
      };
      const result = render([{
        id: `smooth-reverb-${mode}`, type: "reverb", mix: 1, parameters,
        explicitParameters: Object.keys(parameters),
      }], input, input, 48000);
      const left = result.left.slice(5000, 30000); const right = result.right.slice(5000, 30000);
      const occupied = left.reduce((count, value) => count + (Math.abs(value) > 1e-7 ? 1 : 0), 0) / left.length;
      const tailRms = rms(left); const stereoDifference = rms(Float32Array.from(left, (value, index) => value - right[index]));
      expect(Array.from(result.left).every(Number.isFinite)).toBe(true);
      expect(Array.from(result.right).every(Number.isFinite)).toBe(true);
      expect(occupied).toBeGreaterThan(0.98);
      expect(tailRms).toBeGreaterThan(1e-5);
      expect(stereoDifference).toBeGreaterThan(tailRms * 0.15);
    });
  });

  test("early-digital delay adds a bandwidth-limited quantized repeat", () => {
    const input = new Float32Array(8000); input[0] = 0.73123;
    const parameters = { mix: 1, time: 0.62, feedback: 0.38, tone: 0.2, character: 1, stereo: 0 };
    const output = render([{ id: "digital", type: "digital_delay", mix: 1, parameters, explicitParameters: Object.keys(parameters) }], input, input, 48000).left;
    expect(output[0]).toBeCloseTo(0, 7);
    const repeat = output.slice(7000, 7600);
    expect(Math.max(...repeat.map(Math.abs))).toBeGreaterThan(0.01);
    expect(Math.max(...repeat.map(Math.abs))).not.toBeCloseTo(input[0], 4);
  });

  test("keeps native processors alive while bypass ramps", () => {
    const input = new Float32Array(32).fill(0.5);
    const plan = [{
      id: "clip", type: "soft_clip", mix: 1,
      parameters: { drive: 1, character: 0.5, output: 0.5 },
      explicitParameters: ["drive", "character", "output"],
    }];
    const result = render(plan, input, input, 1000);
    expect(result.left[31]).toBeGreaterThan(0.5);
    result.processor.port.onmessage({ data: { type: "bypass", bypassed: true } });
    const outputLeft = new Float32Array(12); const outputRight = new Float32Array(12);
    result.processor.process([[input.subarray(0, 12), input.subarray(0, 12)]], [[outputLeft, outputRight]]);
    expect(outputLeft[11]).toBeCloseTo(0.5, 6);
  });

  test("renders detailed compressor, tone and mono-bass parameters without non-finite samples", () => {
    const input = Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index * 0.071) * 0.8);
    const explicitParameters = ["threshold", "ratio", "attack", "release", "makeup"];
    const plan = [
      { id: "comp", type: "linked_compressor", mix: 1, parameters: { compress: 0.4, threshold: 0.35, ratio: 0.6, attack: 0.2, release: 0.4, makeup: 0.1 }, explicitParameters },
      { id: "tone", type: "tone_shaper", mix: 1, parameters: { tone: 0.55, low: 0.6, mid: 0.4, high: 0.7 }, explicitParameters: ["tone", "low", "mid", "high"] },
      { id: "width", type: "stereo_width", mix: 1, parameters: { width: 0.7, mono_bass: 0.4 }, explicitParameters: ["width", "mono_bass"] },
    ];
    const result = render(plan, input, Float32Array.from(input, (value) => value * -0.6));
    expect(Array.from(result.left).every(Number.isFinite)).toBe(true);
    expect(result.left[4095]).not.toBeCloseTo(input[4095], 3);
  });

  test("publishes real linked-compressor gain reduction for meters", () => {
    const input = new Float32Array(128).fill(1);
    const plan = [{
      id: "meter-comp", type: "linked_compressor", mix: 1,
      parameters: { compress: 1, threshold: 0.25, ratio: 0.8, attack: 0, release: 0.5, makeup: 0 },
      explicitParameters: ["threshold", "ratio", "attack", "release", "makeup"],
    }];
    const Processor = createNativeDspProcessorClass(TestProcessorBase, 48000);
    const processor = new Processor({ processorOptions: { plan } });
    for (let block = 0; block < 8; block += 1) {
      processor.process([[input, input]], [[new Float32Array(128), new Float32Array(128)]]);
    }
    const meter = processor.messages.find((message) => message.type === "meter");
    expect(meter.gainReduction).toBeGreaterThan(0);
    expect(meter.gainReductionById["meter-comp"]).toBeCloseTo(meter.gainReduction, 6);
  });

  test("renders dedicated Legend preamp circuits with level-dependent harmonics and low-cut response", () => {
    const length = 24000;
    const tone = (frequency, level = 0.12) => Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * frequency * index / 48000) * level);
    const renderPreamp = (model, input, overrides = {}) => render([{
      id: `pre-${model}`, type: "legend_preamp", mix: 1,
      parameters: { model: model / 3, drive: 0.68, color: 0.72, high_pass: 0.18, output: 0.5, ...overrides },
      explicitParameters: ["model", "drive", "color", "high_pass", "output"],
    }], input).left;
    const quietInput = tone(997, 0.04); const loudInput = tone(997, 0.35);
    const quiet = renderPreamp(0, quietInput); const loud = renderPreamp(0, loudInput);
    const normalizedDifference = (output, input) => {
      const outputRms = rms(output, 4000); const inputRms = rms(input, 4000);
      return rms(Float32Array.from(output, (value, index) => value / outputRms - input[index] / inputRms), 4000);
    };
    expect(normalizedDifference(loud, loudInput)).toBeGreaterThan(normalizedDifference(quiet, quietInput) * 1.08);
    const models = [0, 1, 2, 3].map((model) => renderPreamp(model, loudInput));
    expect(rms(Float32Array.from(models[0], (value, index) => value - models[2][index]), 4000)).toBeGreaterThan(0.001);
    const low = tone(35); const open = renderPreamp(1, low, { high_pass: 0 }); const cut = renderPreamp(1, low, { high_pass: 1 });
    expect(rms(cut, 4000)).toBeLessThan(rms(open, 4000) * 0.45);
    expect(models.every((output) => Array.from(output).every(Number.isFinite))).toBe(true);
  });

  test("uses distinct program-dependent Legend compressor topologies and reports their gain reduction", () => {
    const input = Float32Array.from({ length: 16384 }, (_, index) => (
      (index % 4096 < 700 ? 0.72 : 0.16) * Math.sin(2 * Math.PI * 173 * index / 48000)
    ));
    const processors = [0, 1, 2, 3].map((model) => render([{
      id: `legend-comp-${model}`, type: "legend_compressor", mix: 1,
      parameters: { model: model / 3, amount: 0.72, attack: 0.38, release: 0.46, makeup: 0 },
      explicitParameters: ["model", "amount", "attack", "release", "makeup"],
    }], input));
    expect(processors.every(({ left }) => Array.from(left).every(Number.isFinite))).toBe(true);
    expect(new Set(processors.map(({ left }) => rms(left, 4096).toFixed(4))).size).toBeGreaterThanOrEqual(3);
    processors.forEach(({ processor }, model) => {
      for (let block = 0; block < 7; block += 1) {
        processor.process([[input.subarray(0, 128), input.subarray(0, 128)]], [[new Float32Array(128), new Float32Array(128)]]);
      }
      const meter = processor.messages.find((message) => message.type === "meter");
      expect(meter.gainReductionById[`legend-comp-${model}`]).toBeGreaterThan(0);
    });
    const disabled = render([{
      id: "legend-comp-zero", type: "legend_compressor", mix: 1,
      parameters: { model: 0, amount: 0, attack: 0.38, release: 0.46, makeup: 0 },
      explicitParameters: ["model", "amount", "attack", "release", "makeup"],
    }], input).left;
    expect(rms(Float32Array.from(disabled, (value, index) => value - input[index]), 4096)).toBeLessThan(1e-7);
  });

  test("renders four dedicated Legend EQ architectures with fixed musical responses and flat gain staging", () => {
    const length = 24000;
    const tone = (frequency, level = 0.08) => Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * frequency * index / 48000) * level);
    const renderEq = (model, input, overrides = {}) => {
      const parameters = { model: model / 3, low: 0.5, mid: 0.5, high: 0.5, air: 0.5, ...overrides };
      return render([{ id: `legend-eq-${model}`, type: "legend_eq", mix: 1, parameters, explicitParameters: Object.keys(parameters) }], input).left;
    };
    const reference = tone(997);
    [0, 1, 2, 3].forEach((model) => {
      const flat = renderEq(model, reference);
      expect(Array.from(flat).every(Number.isFinite)).toBe(true);
      expect(rms(flat, 4000) / rms(reference, 4000)).toBeGreaterThan(0.97);
      expect(rms(flat, 4000) / rms(reference, 4000)).toBeLessThan(1.01);
    });
    const low = tone(100); const mid = tone(1000); const shapedLow = renderEq(0, low, { low: 0.82 });
    const shapedMid = renderEq(0, mid, { low: 0.82 });
    expect(rms(shapedLow, 4000) / rms(low, 4000)).toBeGreaterThan(rms(shapedMid, 4000) / rms(mid, 4000) * 1.35);
    const settings = { low: 0.76, mid: 0.26, high: 0.7, air: 0.66 };
    const models = [0, 1, 2, 3].map((model) => renderEq(model, reference, settings));
    const signatures = models.map((output) => rms(output, 4000).toFixed(4));
    expect(new Set(signatures).size).toBeGreaterThanOrEqual(3);
    expect(rms(Float32Array.from(models[0], (value, index) => value - models[2][index]), 4000)).toBeGreaterThan(0.001);
  });

  test("separates Legend EQ High presence from the upper-octave Air shelf", () => {
    const length = 24000;
    const tone = (frequency) => Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * frequency * index / 48000) * 0.05);
    const renderGain = (model, frequency, overrides) => {
      const input = tone(frequency);
      const parameters = { model: model / 3, low: 0.5, mid: 0.5, high: 0.5, air: 0.5, ...overrides };
      const output = render([{ id: `legend-eq-separation-${model}`, type: "legend_eq", mix: 1, parameters, explicitParameters: Object.keys(parameters) }], input).left;
      return rms(output, 4000) / rms(input, 4000);
    };
    const presenceFrequencies = [8000, 4800, 5000, 7500];
    const airFrequencies = [18000, 15000, 16000, 19000];
    [0, 1, 2, 3].forEach((model) => {
      const highAtPresence = renderGain(model, presenceFrequencies[model], { high: 0.9 });
      const highAtAir = renderGain(model, airFrequencies[model], { high: 0.9 });
      const airAtPresence = renderGain(model, presenceFrequencies[model], { air: 0.9 });
      const airAtAir = renderGain(model, airFrequencies[model], { air: 0.9 });
      expect(highAtPresence).toBeGreaterThan(airAtPresence * 1.25);
      expect(highAtPresence).toBeGreaterThan(highAtAir * 1.18);
      expect(airAtAir).toBeGreaterThan(airAtPresence * 1.12);
    });
  });

  test("models Legend tape formulation, speed, head response, modulation, and optional deterministic noise", () => {
    const length = 24000;
    const tone = (frequency, level = 0.12) => Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * frequency * index / 48000) * level);
    const renderTape = (input, overrides = {}) => {
      const parameters = { model: 1 / 3, drive: 0.55, speed: 0.5, age: 0.25, wow_flutter: 0, noise: 0, output: 0.5, ...overrides };
      return render([{ id: "legend-tape", type: "legend_tape", mix: 1, parameters, explicitParameters: Object.keys(parameters) }], input).left;
    };
    const high = tone(10000); const slow = renderTape(high, { speed: 0 }); const fast = renderTape(high, { speed: 1 });
    expect(rms(fast, 4000)).toBeGreaterThan(rms(slow, 4000) * 1.12);
    const program = Float32Array.from({ length }, (_, index) => (
      Math.sin(2 * Math.PI * 73 * index / 48000) * 0.16 + Math.sin(2 * Math.PI * 1703 * index / 48000) * 0.21
    ));
    const formulations = [0, 1, 2, 3].map((model) => renderTape(program, { model: model / 3, drive: 0.82, age: 0.48 }));
    expect(formulations.every((output) => Array.from(output).every(Number.isFinite))).toBe(true);
    expect(new Set(formulations.map((output) => rms(output, 4000).toFixed(4))).size).toBeGreaterThanOrEqual(3);
    const stable = renderTape(program, { wow_flutter: 0 }); const moving = renderTape(program, { wow_flutter: 0.8 });
    expect(rms(Float32Array.from(moving, (value, index) => value - stable[index]), 4000)).toBeGreaterThan(0.002);
    const silence = new Float32Array(4096); const quiet = renderTape(silence); const noisyA = renderTape(silence, { noise: 0.7 }); const noisyB = renderTape(silence, { noise: 0.7 });
    expect(rms(quiet)).toBe(0);
    expect(rms(noisyA)).toBeGreaterThan(0);
    expect(Array.from(noisyA)).toEqual(Array.from(noisyB));
  });

  test("updates Legend EQ and tape models in place without resetting filter or transport state", () => {
    const Processor = createNativeDspProcessorClass(TestProcessorBase, 48000);
    const eq = { id: "eq", type: "legend_eq", mix: 1, parameters: { model: 0, low: 0.7, mid: 0.4, high: 0.6, air: 0.5 }, explicitParameters: ["model", "low", "mid", "high", "air"] };
    const tape = { id: "tape", type: "legend_tape", mix: 1, parameters: { model: 1 / 3, drive: 0.5, speed: 0.5, age: 0.2, wow_flutter: 0.4, noise: 0, output: 0.5 }, explicitParameters: ["model", "drive", "speed", "age", "wow_flutter", "noise", "output"] };
    const processor = new Processor({ processorOptions: { plan: [eq, tape] } });
    const input = Float32Array.from({ length: 128 }, (_, index) => Math.sin(index * 0.17) * 0.2);
    processor.process([[input, input]], [[new Float32Array(128), new Float32Array(128)]]);
    const originalEq = processor.nodes[0]; const originalTape = processor.nodes[1];
    const savedEqState = originalEq.legendEqLeftState[0].z1; const savedTapeCursor = originalTape.tapeDelayCursor;
    processor.port.onmessage({ data: { type: "plan", plan: [
      { ...eq, parameters: { ...eq.parameters, model: 1 } },
      { ...tape, parameters: { ...tape.parameters, model: 0 } },
    ] } });
    expect(processor.nodes[0]).toBe(originalEq); expect(processor.nodes[1]).toBe(originalTape);
    expect(originalEq.legendEqLeftState[0].z1).toBe(savedEqState); expect(originalTape.tapeDelayCursor).toBe(savedTapeCursor);
    expect(originalEq.model.target).toBe(1); expect(originalTape.model.target).toBe(0);
  });

  test("de-esser reduces sibilance while preserving low-frequency body", () => {
    const length = 24000;
    const low = Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * 180 * index / 48000) * 0.25);
    const sibilant = Float32Array.from({ length }, (_, index) => low[index] + Math.sin(2 * Math.PI * 7000 * index / 48000) * 0.35);
    const parameters = { amount: 1, frequency: 0.61, threshold: 0.25, range: 1, attack: 0, release: 0.35 };
    const plan = [{ id: "de-esser", type: "de_esser", mix: 1, parameters, explicitParameters: Object.keys(parameters) }];
    const lowOutput = render(plan, low).left;
    const sibilantOutput = render(plan, sibilant).left;
    expect(rms(lowOutput, 4000) / rms(low, 4000)).toBeGreaterThan(0.9);
    expect(rms(sibilantOutput, 4000)).toBeLessThan(rms(sibilant, 4000) * 0.82);
    expect(Array.from(sibilantOutput).every(Number.isFinite)).toBe(true);
  });

  test("parametric EQ selects frequency and can process only the Mid channel", () => {
    const length = 24000;
    const tone = Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * 1265 * index / 48000) * 0.12);
    const parameters = { mode: 0, mid_gain: 1, mid_frequency: 0.5, mid_q: 0.3, output: 0.5 };
    const plan = [{ id: "eq", type: "parametric_eq", mix: 1, parameters, explicitParameters: Object.keys(parameters) }];
    const boosted = render(plan, tone).left;
    expect(rms(boosted, 4000)).toBeGreaterThan(rms(tone, 4000) * 2);
    const midOnly = render([{ ...plan[0], parameters: { ...parameters, mode: 0.5 } }], tone, Float32Array.from(tone, (value) => -value));
    expect(rms(midOnly.left, 4000) / rms(tone, 4000)).toBeCloseTo(1, 2);
  });

  test("Prism Spectrum EQ applies analyzer-owned enabled, frequency, gain, and Q bands", () => {
    const length = 24000;
    const tone = Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * 1000 * index / 48000) * 0.12);
    const parameters = {
      band_1_enabled: 0, band_2_enabled: 0,
      band_3_enabled: 1, band_3_frequency: Math.log(1000 / 10) / Math.log(3000), band_3_gain: 1, band_3_q: 0.48,
      band_4_enabled: 0, band_5_enabled: 0,
    };
    const boosted = render([{ id: "prism", type: "prism_eq", mix: 1, parameters, explicitParameters: Object.keys(parameters) }], tone).left;
    expect(rms(boosted, 4000)).toBeGreaterThan(rms(tone, 4000) * 2);
    expect(Array.from(boosted).every(Number.isFinite)).toBe(true);
  });

  test("multiband compressor applies independent stereo-linked band dynamics", () => {
    const input = Float32Array.from({ length: 24000 }, (_, index) => (
      Math.sin(2 * Math.PI * 100 * index / 48000) * 0.35 + Math.sin(2 * Math.PI * 5000 * index / 48000) * 0.35
    ));
    const parameters = {
      amount: 1, low_crossover: 0.5, high_crossover: 0.42,
      low_threshold: 0.3, low_ratio: 0.8, low_attack: 0, low_release: 0.4, low_makeup: 0,
      mid_threshold: 0.3, mid_ratio: 0.8, mid_attack: 0, mid_release: 0.4, mid_makeup: 0,
      high_threshold: 0.3, high_ratio: 0.8, high_attack: 0, high_release: 0.4, high_makeup: 0,
    };
    const output = render([{ id: "mb", type: "multiband_compressor", mix: 1, parameters, explicitParameters: Object.keys(parameters) }], input).left;
    expect(Array.from(output).every(Number.isFinite)).toBe(true);
    expect(rms(output, 4000)).toBeLessThan(rms(input, 4000) * 0.7);
  });

  test("runs the original gate, overdrive, amp and cabinet chain", () => {
    const input = Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index * 0.057) * 0.18);
    const plan = [
      { id: "gate", type: "noise_gate", mix: 1, parameters: { threshold: 0.35, release: 0.45 }, explicitParameters: ["threshold", "release"] },
      { id: "drive", type: "amp_overdrive", mix: 1, parameters: { drive: 0.6, tone: 0.55, level: 0.5 }, explicitParameters: ["drive", "tone", "level"] },
      { id: "amp", type: "amp_model", mix: 1, parameters: { gain: 0.55, bass: 0.6, mid: 0.45, treble: 0.65, presence: 0.4, master: 0.75 }, explicitParameters: ["gain", "bass", "mid", "treble", "presence", "master"] },
      { id: "cab", type: "cabinet_ir", mix: 1, parameters: { cabinet: 0.5, mic_position: 0.55, resonance: 0.5, level: 0.5 }, explicitParameters: ["cabinet", "mic_position", "resonance", "level"] },
    ];
    const result = render(plan, input, input);
    expect(Array.from(result.left).every(Number.isFinite)).toBe(true);
    expect(Math.max(...result.left.map(Math.abs))).toBeGreaterThan(0.1);
    expect(result.left[4095]).not.toBeCloseTo(input[4095], 3);
  });

  test("keeps the Synth Test amp, cabinet, delay, and True Reverb chain audible", () => {
    const input = Float32Array.from({ length: 16384 }, (_, index) => Math.sin(2 * Math.PI * 220 * index / 48000) * 0.2);
    const module = (id, type, parameters) => ({ id, type, mix: 1, parameters, explicitParameters: Object.keys(parameters) });
    const plan = [
      module("input", "input_trim", { input: 0.5 }),
      module("gate", "noise_gate", { threshold: 0.4, release: 0.5 }),
      module("drive", "amp_overdrive", { drive: 0.6, tone: 0.55, level: 0.5 }),
      module("amp", "amp_model", { gain: 0.55, bass: 0.6, mid: 0.45, treble: 0.65, presence: 0.4, master: 0.75 }),
      module("cab", "cabinet_ir", { cabinet: 0.5, mic_position: 0.55, resonance: 0.5, level: 0.5 }),
      module("output", "output_trim", { output: 0.75 }),
      module("delay", "digital_delay", { mix: 0.14, time: 0.81, feedback: 0.31 }),
      module("verb", "reverb", { mix: 0.25 }),
    ];
    const result = render(plan, input);
    expect(rms(result.left, 4096)).toBeGreaterThan(0.005);
    expect(Array.from(result.left).every(Number.isFinite)).toBe(true);
  });

  test.each([
    ["Original Cream Amp", AMP_SIMULATOR_RACK_PRESET],
    ["Obsidian High Gain", HIGH_GAIN_AMP_RACK_PRESET],
  ])("keeps the %s factory preset near bypass loudness for a nominal guitar DI", (_name, preset) => {
    const input = Float32Array.from({ length: 48000 }, (_, index) => 0.12 * (
      0.72 * Math.sin(2 * Math.PI * 82.4 * index / 48000)
      + 0.22 * Math.sin(2 * Math.PI * 164.8 * index / 48000)
      + 0.12 * Math.sin(2 * Math.PI * 247.2 * index / 48000)
    ));
    const output = render(materializePreset(preset), input).left;
    const gainDb = 20 * Math.log10(rms(output, 12000) / rms(input, 12000));

    expect(gainDb).toBeGreaterThan(-3);
    expect(gainDb).toBeLessThan(6);
    expect(Math.max(...output.map(Math.abs))).toBeLessThan(0.25);
  });

  test("custom cabinet taps replace the procedural response and can update live", () => {
    const input = new Float32Array(16); input[0] = 1;
    const module = {
      id: "cab", type: "cabinet_ir", mix: 1,
      parameters: { cabinet: 0.5, mic_position: 0.5, low_cut: 0, high_cut: 1, resonance: 0.5, level: 0.5 },
      explicitParameters: ["cabinet", "mic_position", "low_cut", "high_cut", "resonance", "level"],
      customImpulse: { signature: "first", tapDelays: [2], coefficients: [1] },
    };
    const result = render([module], input);

    expect(result.left[0]).toBeCloseTo(0, 7);
    expect(result.left[1]).toBeCloseTo(0, 7);
    expect(Math.abs(result.left[2])).toBeGreaterThan(0.01);

    result.processor.port.onmessage({ data: { type: "plan", plan: [{
      ...module, customImpulse: { signature: "second", tapDelays: [4], coefficients: [1] },
    }] } });
    expect(result.processor.nodes[0].customTapDelays[0]).toBe(4);
  });

  test("high-gain preset produces a materially different saturated metal response", () => {
    const input = Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index * 0.061) * 0.08);
    const planFor = ({ mode, gain, presence, cabinet }) => [
      { id: "amp", type: "dual_high_gain", mix: 1, parameters: { mode, gain, tight: 0.72, bass: 0.58, mid: 0.36, treble: 0.64, presence, depth: 0.68, sag: 0.2, master: 0.62 }, explicitParameters: ["mode", "gain", "tight", "bass", "mid", "treble", "presence", "depth", "sag", "master"] },
      { id: "cab", type: "cabinet_ir", mix: 1, parameters: { cabinet, mic_position: 0.62, resonance: 0.64, level: 0.53 }, explicitParameters: ["cabinet", "mic_position", "resonance", "level"] },
    ];
    const clean = render(planFor({ mode: 0, gain: 0.12, presence: 0.3, cabinet: 0.2 }), input).left;
    const highGain = render(planFor({ mode: 0, gain: 0.82, presence: 0.62, cabinet: 0.88 }), input).left;
    const cascading = render(planFor({ mode: 1, gain: 0.82, presence: 0.62, cabinet: 0.88 }), input).left;
    const differenceRms = Math.sqrt(highGain.reduce((sum, value, index) => sum + ((value - clean[index]) ** 2), 0) / highGain.length);
    const voicingDifference = Math.sqrt(highGain.reduce((sum, value, index) => sum + ((value - cascading[index]) ** 2), 0) / highGain.length);
    const highGainRms = rms(highGain);

    expect(Array.from(highGain).every(Number.isFinite)).toBe(true);
    expect(differenceRms / highGainRms).toBeGreaterThan(0.5);
    expect(voicingDifference / highGainRms).toBeGreaterThan(0.1);
  });

  test("uses the filtered 4x amp path and extended original cabinet response", () => {
    const impulse = new Float32Array(512); impulse[0] = 1;
    const plan = [
      { id: "amp", type: "dual_high_gain", mix: 1, parameters: { mode: 0, gain: 0.82, tight: 0.72, bass: 0.58, mid: 0.36, treble: 0.64, presence: 0.62, depth: 0.68, sag: 0.2, master: 0.62 }, explicitParameters: ["mode", "gain", "tight", "bass", "mid", "treble", "presence", "depth", "sag", "master"] },
      { id: "cab", type: "cabinet_ir", mix: 1, parameters: { cabinet: 0.88, mic_position: 0.62, mic_blend: 0.22, distance: 0.08, low_cut: 0.18, high_cut: 0.48, resonance: 0.5, level: 0.5 }, explicitParameters: ["cabinet", "mic_position", "mic_blend", "distance", "low_cut", "high_cut", "resonance", "level"] },
    ];
    const result = render(plan, impulse);
    const amp = result.processor.nodes[0]; const cabinet = result.processor.nodes[1];
    const lateEnergy = result.left.slice(64, 256).reduce((sum, value) => sum + value * value, 0);

    expect(amp.preFilterLeft).toHaveLength(2);
    expect(amp.postFilterLeft).toHaveLength(2);
    expect(cabinet.leftHistory).toHaveLength(512);
    expect(cabinet.morphedIr).toHaveLength(224);
    expect(cabinet.reflectionHistoryLeft).toHaveLength(1024);
    expect(lateEnergy).toBeGreaterThan(1e-8);
  });

  test("Cabinet V3 changes mic family and applies a steep speaker-band rolloff", () => {
    const impulse = new Float32Array(2048); impulse[0] = 1;
    const planFor = (micBlend, highCut) => [{
      id: "cab", type: "cabinet_ir", mix: 1,
      parameters: { cabinet: 0.8, mic_position: 0.6, mic_blend: micBlend, distance: 0.12, low_cut: 0.2, high_cut: highCut, resonance: 0.55, level: 0.5 },
      explicitParameters: ["cabinet", "mic_position", "mic_blend", "distance", "low_cut", "high_cut", "resonance", "level"],
    }];
    const dynamic = render(planFor(0, 0.75), impulse).left;
    const ribbon = render(planFor(1, 0.75), impulse).left;
    const difference = Math.sqrt(dynamic.reduce((sum, value, index) => sum + ((value - ribbon[index]) ** 2), 0));
    const highFrequency = Float32Array.from({ length: 8192 }, (_, index) => Math.sin(2 * Math.PI * 10000 * index / 48000));
    const brightHighFrequency = render(planFor(0, 0.75), highFrequency).left.slice(4096);
    const darkHighFrequency = render(planFor(0, 0.05), highFrequency).left.slice(4096);
    const rms = (signal) => Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length);
    expect(difference).toBeGreaterThan(0.0005);
    expect(rms(darkHighFrequency)).toBeLessThan(rms(brightHighFrequency) * 0.65);
  });
});
