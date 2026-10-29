const fs = require("fs");
const path = require("path");
const vm = require("vm");

if (process.argv.length !== 4 && process.argv.length !== 5) throw new Error("usage: render_vst_dsp_parity_fixture.cjs INPUT OUTPUT [--custom-ir]");
const customImpulse = process.argv[4] === "--custom-ir";
const creative = process.argv[4] === "--creative";
const advanced = process.argv[4] === "--advanced";
const legend = process.argv[4] === "--legend";
const reverbModes = {
  "--reverb-room": 0,
  "--reverb-spring": 1,
  "--reverb-plate": 2,
  "--reverb-hall": 3,
};
const reverbMode = reverbModes[process.argv[4]];
const workletPath = path.resolve(__dirname, "..", "public", "vst-dsp-worklet-v25.js");
let Processor = null;
class AudioWorkletProcessor { constructor() { this.port = { onmessage: null }; } }
vm.runInContext(fs.readFileSync(workletPath, "utf8"), vm.createContext({
  AudioWorkletProcessor, Float32Array, Math, Number, sampleRate: 48000,
  registerProcessor: (_name, processor) => { Processor = processor; },
}), { filename: workletPath });
if (!Processor) throw new Error("DSP worklet processor was not registered");

const levelMatchedOutput = (drive, output) => {
  const saturationDrive = 1 + drive * 14;
  const smallSignalGain = saturationDrive / Math.max(0.000001, Math.tanh(saturationDrive));
  return Math.max(0, Math.min(1, output - (20 * Math.log10(smallSignalGain)) / 24));
};
const legendPreampDrive = 0.035 + 0.24 * 0.38 * (0.9 + 0.2 * 0.66);
const legendTapeDrive = 0.025 + 0.19 * 0.34 + 0.04 * 0.16 + 0.02 * (1 - 0.5);
const plan = reverbMode !== undefined ? [
  { id: "reverb", type: "reverb", mix: 1, parameters: { mix: 0.64, mode: reverbMode, size: 0.58, decay: 0.52, damping: 0.55, pre_delay: 0.04, modulation: 0.22 }, explicitParameters: ["mix", "mode", "size", "decay", "damping", "pre_delay", "modulation"] },
] : legend ? [
  { id: "pre", type: "soft_clip", mix: 1, parameters: { drive: legendPreampDrive, character: 0.72 * 0.61 + 0.28 * 0.66, output: levelMatchedOutput(legendPreampDrive, 0.5) }, explicitParameters: ["drive", "character", "output"] },
  { id: "comp", type: "linked_compressor", mix: 1, parameters: { compress: 0.42, threshold: 0.76 - 0.46 * 0.42 - 0.08 * 0.33, ratio: 0.18 + 0.5 * 0.42 + 0.12 * 0.33, attack: 0.38 + 0.12 * (0.33 - 0.5), release: 0.46 + 0.08 * 0.33, makeup: 0 }, explicitParameters: ["compress", "threshold", "ratio", "attack", "release", "makeup"] },
  { id: "eq", type: "tone_shaper", mix: 1, parameters: { tone: 0.55, low: 0.54, mid: 0.5, high: 0.72 * 0.58 + 0.28 * 0.62 }, explicitParameters: ["tone", "low", "mid", "high"] },
  { id: "tape", type: "soft_clip", mix: 1, parameters: { drive: legendTapeDrive, character: 0.42 + 0.32 * 0.33 + 0.16 * 0.16, output: levelMatchedOutput(legendTapeDrive, 0.46) }, explicitParameters: ["drive", "character", "output"] },
] : advanced ? [
  { id: "eq", type: "parametric_eq", mix: 1, parameters: { mode: 0, low_cut_enabled: 1, low_cut_frequency: 0.25, low_cut_q: 0.12, low_gain: 0.62, low_frequency: 0.32, low_q: 0.18, mid_gain: 0.72, mid_frequency: 0.45, mid_q: 0.28, high_gain: 0.42, high_frequency: 0.55, high_q: 0.18, high_cut_enabled: 1, high_cut_frequency: 0.82, high_cut_q: 0.12, output: 0.48 }, explicitParameters: [] },
  { id: "multiband", type: "multiband_compressor", mix: 1, parameters: { amount: 0.85, low_crossover: 0.48, high_crossover: 0.42, low_threshold: 0.4, low_ratio: 0.55, low_attack: 0.35, low_release: 0.45, low_makeup: 0.08, mid_threshold: 0.4, mid_ratio: 0.55, mid_attack: 0.35, mid_release: 0.45, mid_makeup: 0.08, high_threshold: 0.4, high_ratio: 0.55, high_attack: 0.35, high_release: 0.45, high_makeup: 0.08 }, explicitParameters: [] },
] : creative ? [
  { id: "chorus", type: "chorus", mix: 1, parameters: { mix: 0.42, rate: 0.38, depth: 0.58, delay: 0.48, feedback: 0.35, stereo: 0.75 }, explicitParameters: ["mix", "rate", "depth", "delay", "feedback", "stereo"] },
  { id: "flanger", type: "flanger", mix: 1, parameters: { mix: 0.31, rate: 0.32, depth: 0.62, manual: 0.38, feedback: 0.68, stereo: 0.6 }, explicitParameters: ["mix", "rate", "depth", "manual", "feedback", "stereo"] },
  { id: "tremolo", type: "tremolo", mix: 1, parameters: { mix: 0.8, rate: 0.48, depth: 0.7, shape: 0.35, stereo: 0.5 }, explicitParameters: ["mix", "rate", "depth", "shape", "stereo"] },
  { id: "vibrato", type: "vibrato", mix: 1, parameters: { mix: 0.35, rate: 0.45, depth: 0.45, stereo: 0.4 }, explicitParameters: ["mix", "rate", "depth", "stereo"] },
  { id: "digital", type: "digital_delay", mix: 1, parameters: { mix: 0.24, time: 0.34, feedback: 0.38, tone: 0.58, character: 0.72, stereo: 0.35 }, explicitParameters: ["mix", "time", "feedback", "tone", "character", "stereo"] },
  { id: "reverb", type: "reverb", mix: 1, parameters: { mix: 0.22, mode: 1, size: 0.58, decay: 0.52, damping: 0.55, pre_delay: 0.04, modulation: 0.22 }, explicitParameters: ["mix", "mode", "size", "decay", "damping", "pre_delay", "modulation"] },
  { id: "shimmer", type: "shimmer", mix: 1, parameters: { mix: 0.18, size: 0.68, decay: 0.68, damping: 0.48, pre_delay: 0.04, shimmer: 0.5, rise: 0.5, tone: 0.42 }, explicitParameters: ["mix", "size", "decay", "damping", "pre_delay", "shimmer", "rise", "tone"] },
] : [
  { id: "input", type: "input_trim", mix: 1, parameters: { input: 0.56 }, explicitParameters: ["input"] },
  { id: "gate", type: "noise_gate", mix: 1, parameters: { threshold: 0.62, release: 0.2 }, explicitParameters: ["threshold", "release"] },
  { id: "amp", type: "dual_high_gain", mix: 1, parameters: { mode: 0, gain: 0.82, tight: 0.72, bass: 0.58, mid: 0.36, treble: 0.64, presence: 0.62, depth: 0.68, sag: 0.2, master: 0.62 }, explicitParameters: ["mode", "gain", "tight", "bass", "mid", "treble", "presence", "depth", "sag", "master"] },
  {
    id: "cab", type: "cabinet_ir", mix: 1,
    parameters: { cabinet: 0.88, mic_position: 0.62, mic_blend: 0.22, distance: 0.08, low_cut: 0.18, high_cut: 0.48, resonance: 0.64, level: 0.53 },
    explicitParameters: ["cabinet", "mic_position", "mic_blend", "distance", "low_cut", "high_cut", "resonance", "level"],
    ...(customImpulse ? { customImpulse: {
      signature: "parity-fixture",
      tapDelays: [0, 3, 17, 63, 127, 191, 319],
      coefficients: [0.72, -0.18, 0.12, -0.08, 0.052, -0.03, 0.018],
    } } : {}),
  },
  { id: "output", type: "output_trim", mix: 1, parameters: { output: 0.66 }, explicitParameters: ["output"] },
];
const inputBuffer = fs.readFileSync(process.argv[2]);
const input = new Float32Array(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.byteLength / 4);
const rendered = new Float32Array(input.length);
const processor = new Processor({ processorOptions: { plan } });
for (let offset = 0; offset < input.length; offset += 128) {
  const left = input.slice(offset, offset + 128);
  const right = Float32Array.from(left, (value) => value * 0.97);
  const leftOutput = new Float32Array(left.length); const rightOutput = new Float32Array(left.length);
  processor.process([[left, right]], [[leftOutput, rightOutput]]);
  rendered.set(leftOutput, offset);
}
fs.writeFileSync(process.argv[3], Buffer.from(rendered.buffer));
