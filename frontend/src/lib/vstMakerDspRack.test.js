import {
  appendDspRackModule,
  createAmpSimulatorRack,
  createAmpSimulatorTemplateState,
  createHighGainAmpTemplateState,
  createLegendHardwareRack,
  controlsShareDspBinding,
  dspBindingValue,
  DSP_RACK_MODULE_OPTIONS,
  formatDspParameterValue,
  isLegacyHighGainAmpRack,
  isLegendHardwareModule,
  moveDspRackModule,
  normalizeDspRack,
  removeDspRackModule,
  serializeDspRack,
  syncControlsFromDspBinding,
  syncDspRackFromControl,
} from "./vstMakerDspRack";

describe("VST Maker DSP rack", () => {
  test("normalizes supported modules and legacy parent ids", () => {
    expect(normalizeDspRack([{ id: "tone", type: "tone-shaper", parent_id: "root", mix: 4, parameters: {} }])).toEqual([
      expect.objectContaining({ id: "tone", type: "tone_shaper", parentId: "root", order: 0, mix: 1, parameters: {} }),
    ]);
  });

  test("migrates the former algorithmic reverb label without changing its stable type", () => {
    expect(normalizeDspRack([{ id: "verb", type: "reverb", name: "Algorithmic Reverb", parameters: {} }])[0]).toEqual(
      expect.objectContaining({ id: "verb", type: "reverb", name: "True Reverb" }),
    );
  });

  test("appends and reorders modules with contiguous order", () => {
    let modules = appendDspRackModule([], "soft_clip", "clip");
    modules = appendDspRackModule(modules, "output_trim", "out");
    modules = moveDspRackModule(modules, "out", -1);
    expect(modules.map(({ id, order }) => [id, order])).toEqual([["out", 0], ["clip", 1]]);
  });

  test("creates a complete and separately classified Legend Hardware channel", () => {
    let nextId = 0;
    const modules = createLegendHardwareRack(() => `legend-${nextId += 1}`);
    expect(modules.map((module) => module.type)).toEqual([
      "legend_preamp", "legend_compressor", "legend_eq", "legend_tape",
    ]);
    expect(modules.every(isLegendHardwareModule)).toBe(true);
    expect(modules.map((module) => module.order)).toEqual([0, 1, 2, 3]);
    expect(modules[0].parameters).toEqual(expect.objectContaining({ model: 0, drive: 0.38, high_pass: 0.18 }));
    expect(modules[1].parameters.makeup).toBe(0);
    expect(modules[2].parameters).toEqual(expect.objectContaining({ low: 0.5, mid: 0.5, high: 0.5, air: 0.5 }));
    expect(modules[3].parameters).toEqual(expect.objectContaining({ speed: 0.5, age: 0.16, wow_flutter: 0.12, output: 0.46 }));
  });

  test("migrates only the former hot Legend Hardware factory defaults", () => {
    const migrated = normalizeDspRack([
      { id: "comp", type: "legend_compressor", parameters: { model: 0, amount: 0.42, attack: 0.38, release: 0.46, makeup: 0.12 } },
      { id: "eq", type: "legend_eq", parameters: { model: 0, low: 0.54, mid: 0.5, high: 0.54, air: 0.54 } },
      { id: "tape", type: "legend_tape", parameters: { model: 1 / 3, drive: 0.34, speed: 0.5, age: 0.16, wow_flutter: 0.12, output: 0.5 } },
    ]);
    expect(migrated[0].parameters.makeup).toBe(0);
    expect(migrated[1].parameters).toEqual(expect.objectContaining({ low: 0.5, high: 0.5, air: 0.5 }));
    expect(migrated[2].parameters.output).toBe(0.46);
    expect(normalizeDspRack([{ id: "custom", type: "legend_compressor", parameters: { model: 0, amount: 0.5, attack: 0.38, release: 0.46, makeup: 0.12 } }])[0].parameters.makeup).toBe(0.12);
  });

  test("formats Legend Hardware choices as readable circuit names", () => {
    const preamp = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "legend_preamp");
    const tape = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "legend_tape");
    expect(formatDspParameterValue(preamp.parameters[0], 0.34)).toBe("American Discrete");
    expect(formatDspParameterValue(tape.parameters.find(({ key }) => key === "speed"), 1)).toBe("30 ips");
  });

  test("removing a module safely clears its UI bindings", () => {
    const modules = appendDspRackModule([], "soft_clip", "clip");
    const result = removeDspRackModule(modules, [{ id: "a", moduleId: "clip" }, { id: "b", moduleId: null }], "clip");
    expect(result.modules).toEqual([]);
    expect(result.controls).toEqual([{ id: "a", moduleId: null }, { id: "b", moduleId: null }]);
  });

  test("serializes the backend snake-case graph contract", () => {
    const payload = serializeDspRack([{ id: "in", type: "input_trim", parentId: "root", samplerGroupId: "kick", parameters: { input: 0.8 } }]);
    expect(payload[0]).toEqual(expect.objectContaining({ id: "in", parent_id: "root", sampler_group_id: "kick", order: 0, parameters: { input: 0.8 } }));
    expect(payload[0]).not.toHaveProperty("parentId");
  });

  test("normalizes sampler-scoped DSP targets from browser and API projects", () => {
    expect(normalizeDspRack([{ id: "a", type: "tone_shaper", samplerGroupId: "kick" }])[0].samplerGroupId).toBe("kick");
    expect(normalizeDspRack([{ id: "b", type: "tone_shaper", sampler_group_id: "snare" }])[0].samplerGroupId).toBe("snare");
  });

  test("publishes the complete native parameter catalog with useful units", () => {
    const tuning = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "tuning");
    expect(tuning.parameters.map((parameter) => parameter.key)).toEqual(["tuning", "fine_tune"]);
    expect(formatDspParameterValue(tuning.parameters[0], 1)).toBe("+24 st");
    expect(formatDspParameterValue(tuning.parameters[1], 0.25)).toBe("-50 ct");
    const generator = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "wave_generator");
    expect(generator.parameters.map((parameter) => parameter.key)).toEqual([
      "waveform", "octave", "semitone", "fine", "level", "pulse_width", "phase_reset", "voice_mode", "retrigger",
      "attack", "decay", "sustain", "release", "velocity_sensitivity", "velocity_curve", "velocity_min_level",
      "filter_cutoff", "filter_resonance", "filter_env_amount", "filter_key_tracking",
      "osc2_enabled", "osc2_waveform", "osc2_octave", "osc2_detune", "osc2_level", "osc2_pulse_width", "sub_level", "noise_level", "noise_color",
      "unison_voices", "unison_detune", "stereo_spread", "glide", "glide_mode", "vibrato_rate", "vibrato_depth", "vibrato_delay",
    ]);
    expect(formatDspParameterValue(generator.parameters[0], 0.76)).toBe("Square");
    expect(formatDspParameterValue(generator.parameters[1], 0.5)).toBe("+0 oct");
    expect(formatDspParameterValue(generator.parameters.find(({ key }) => key === "velocity_curve"), 0)).toBe("Soft");
    expect(formatDspParameterValue(generator.parameters.find(({ key }) => key === "velocity_curve"), 0.5)).toBe("Linear");
    expect(formatDspParameterValue(generator.parameters.find(({ key }) => key === "velocity_curve"), 1)).toBe("Hard");
    const compressor = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "linked_compressor");
    expect(compressor.parameters.map((parameter) => parameter.key)).toEqual(["compress", "threshold", "ratio", "attack", "release", "makeup"]);
    expect(formatDspParameterValue(compressor.parameters[1], 0.5)).toBe("-24.0 dB");
    expect(formatDspParameterValue(compressor.parameters[2], 0.5)).toBe("10.5:1");
    const deEsser = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "de_esser");
    expect(deEsser.parameters.map((parameter) => parameter.key)).toEqual(["amount", "frequency", "threshold", "range", "attack", "release"]);
    expect(formatDspParameterValue(deEsser.parameters[1], 0.5)).toBe("6.0 kHz");
    expect(formatDspParameterValue(deEsser.parameters[3], 0.5)).toBe("9.0 dB");
    const equalizer = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "parametric_eq");
    expect(equalizer.parameters.map(({ key }) => key)).toEqual([
      "mode", "low_cut_enabled", "low_cut_frequency", "low_cut_q", "low_gain", "low_frequency", "low_q",
      "mid_gain", "mid_frequency", "mid_q", "high_gain", "high_frequency", "high_q",
      "high_cut_enabled", "high_cut_frequency", "high_cut_q", "output",
    ]);
    expect(formatDspParameterValue(equalizer.parameters[0], 0.5)).toBe("Mid");
    expect(formatDspParameterValue(equalizer.parameters[8], 0.5)).toBe("1265 Hz");
    const multiband = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "multiband_compressor");
    expect(multiband.parameters).toHaveLength(18);
    expect(formatDspParameterValue(multiband.parameters[1], 0.5)).toBe("219 Hz");
    const delay = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "cross_delay");
    expect(formatDspParameterValue(delay.parameters[1], delay.parameters[1].defaultValue)).toBe("190 ms");
    expect(DSP_RACK_MODULE_OPTIONS.filter((module) => ["noise_gate", "amp_overdrive", "amp_model", "dual_high_gain", "cabinet_ir"].includes(module.type)).map((module) => module.type)).toEqual([
      "noise_gate", "amp_overdrive", "amp_model", "dual_high_gain", "cabinet_ir",
    ]);
    const amp = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "amp_model");
    expect(amp.parameters.map((parameter) => parameter.key)).toEqual(["gain", "bass", "mid", "treble", "presence", "master"]);
    const highGain = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "dual_high_gain");
    expect(highGain.parameters.map((parameter) => parameter.key)).toEqual(["mode", "gain", "tight", "bass", "mid", "treble", "presence", "depth", "sag", "master"]);
    expect(DSP_RACK_MODULE_OPTIONS.filter((module) => ["chorus", "flanger", "tremolo", "vibrato", "digital_delay", "reverb", "shimmer"].includes(module.type)).map((module) => module.type)).toEqual([
      "chorus", "flanger", "tremolo", "vibrato", "digital_delay", "reverb", "shimmer",
    ]);
    expect(DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "digital_delay").parameters.map(({ key }) => key)).toEqual([
      "mix", "time", "feedback", "tone", "character", "stereo",
    ]);
    const trueReverb = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "reverb");
    expect(trueReverb.name).toBe("True Reverb");
    expect(trueReverb.parameters.map(({ key }) => key)).toEqual(["mix", "mode", "size", "decay", "damping", "pre_delay", "modulation"]);
    expect([0, 1 / 3, 2 / 3, 1].map((value) => formatDspParameterValue(trueReverb.parameters[1], value))).toEqual(["Room", "Spring", "Plate", "Hall"]);
    const shimmer = DSP_RACK_MODULE_OPTIONS.find((module) => module.type === "shimmer");
    expect(shimmer.name).toBe("Chord Bloom");
    expect(shimmer.parameters.map(({ key }) => key)).toEqual(["mix", "size", "decay", "damping", "pre_delay", "shimmer", "rise", "tone"]);
    expect(formatDspParameterValue(shimmer.parameters[6], 0.5)).toBe("315 ms");
    expect(formatDspParameterValue(shimmer.parameters[7], 0.42)).toBe("4.2 kHz");
  });

  test("migrates every stored Shimmer project to the single Chord Bloom algorithm", () => {
    const [legacy] = normalizeDspRack([{ id: "legacy-shimmer", type: "shimmer", name: "Shimmer Reverb", parameters: { mix: 0.4, shimmer: 0.7, mode: 0 } }]);
    expect(legacy.name).toBe("Chord Bloom");
    expect(legacy.parameters).not.toHaveProperty("mode");
    const [bloom] = normalizeDspRack([{ id: "bloom", type: "shimmer", parameters: { mode: 1, rise: 0.75, tone: 0.3 } }]);
    expect(bloom.parameters).toEqual(expect.objectContaining({ rise: 0.75, tone: 0.3 }));
    expect(bloom.parameters).not.toHaveProperty("mode");
  });

  test("creates a complete wave generator source", () => {
    const generator = appendDspRackModule([], "wave_generator", "osc-1")[0];
    expect(generator.parameters).toEqual(expect.objectContaining({
      waveform: 0, octave: 0.5, semitone: 0.5, fine: 0.5, level: 0.65, pulse_width: 0.5, phase_reset: 1, voice_mode: 1, retrigger: 1,
      attack: 0, decay: 0.2, sustain: 1, release: 0.18, filter_cutoff: 1, filter_resonance: 0,
      velocity_sensitivity: 1, velocity_curve: 1, velocity_min_level: 0,
      osc2_enabled: 0, osc2_level: 0.5, sub_level: 0, noise_level: 0, unison_voices: 0, glide: 0, vibrato_depth: 0,
    }));
  });

  test("migrates older generators to the visible mono/retrigger defaults", () => {
    const [generator] = normalizeDspRack([{ id: "legacy-osc", type: "wave_generator", parameters: { level: 0.7 } }]);
    expect(generator.parameters).toEqual(expect.objectContaining({ voice_mode: 1, retrigger: 1, level: 0.7 }));
    expect(generator.parameters).not.toHaveProperty("note_priority");
  });

  test("creates the complete voiced amp-simulator chain", () => {
    let nextId = 0;
    const modules = createAmpSimulatorRack((type) => `${type}-${nextId += 1}`);
    expect(modules.map((module) => module.type)).toEqual([
      "input_trim", "noise_gate", "amp_overdrive", "amp_model", "cabinet_ir", "output_trim",
    ]);
    expect(modules.map((module) => module.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(modules.find((module) => module.type === "amp_model")?.parameters).toEqual({
      gain: 0.55, bass: 0.6, mid: 0.45, treble: 0.65, presence: 0.4, master: 0.75,
    });
    expect(modules.find((module) => module.type === "output_trim")?.parameters.output).toBe(0.75);
  });

  test("binds every saved amp parameter to the ready-to-use template controls", () => {
    let nextId = 0;
    const { engineModules, interfaceControls } = createAmpSimulatorTemplateState(() => `amp-template-${nextId += 1}`);
    const parameterBindings = engineModules.flatMap((module) => (
      Object.keys(module.parameters).map((parameter) => `${module.id}:${parameter}`)
    ));
    const controlBindings = interfaceControls
      .filter((control) => control.moduleId)
      .map((control) => `${control.moduleId}:${control.parameter}`);

    expect(interfaceControls).toHaveLength(18);
    expect(controlBindings).toHaveLength(17);
    expect(new Set(controlBindings)).toEqual(new Set(parameterBindings));
    expect(interfaceControls).toContainEqual(expect.objectContaining({
      kind: "button", label: "Bypass", parameter: "bypass", moduleId: null,
    }));
  });

  test("creates a fully bound, genuinely high-gain metal amp preset", () => {
    let nextId = 0;
    const { engineModules, interfaceControls } = createHighGainAmpTemplateState(() => `high-gain-${nextId += 1}`);
    const moduleByType = Object.fromEntries(engineModules.map((module) => [module.type, module]));
    const parameterBindings = engineModules.flatMap((module) => (
      Object.keys(module.parameters).map((parameter) => `${module.id}:${parameter}`)
    ));
    const controlBindings = interfaceControls
      .filter((control) => control.moduleId)
      .map((control) => `${control.moduleId}:${control.parameter}`);

    expect(engineModules.map((module) => module.type)).toEqual([
      "input_trim", "noise_gate", "dual_high_gain", "cabinet_ir", "output_trim",
    ]);
    expect(moduleByType.noise_gate.parameters).toEqual({ threshold: 0.62, release: 0.2 });
    expect(moduleByType.dual_high_gain.parameters).toEqual({
      mode: 0, gain: 0.82, tight: 0.72, bass: 0.58, mid: 0.36, treble: 0.64,
      presence: 0.62, depth: 0.68, sag: 0.2, master: 0.62,
    });
    expect(moduleByType.cabinet_ir.parameters).toEqual({ cabinet: 0.88, mic_position: 0.62, resonance: 0.64, level: 0.53 });
    expect(interfaceControls).toHaveLength(19);
    expect(interfaceControls).toContainEqual(expect.objectContaining({ label: "Voicing", parameter: "mode", off_label: "RECT", on_label: "CASC" }));
    expect(new Set(controlBindings)).toEqual(new Set(parameterBindings));
  });

  test("detects only the superseded Obsidian rack topology for safe migration", () => {
    expect(isLegacyHighGainAmpRack([
      { type: "input_trim" }, { type: "noise_gate" }, { type: "amp_overdrive" },
      { type: "amp_model" }, { type: "cabinet_ir" }, { type: "output_trim" },
    ])).toBe(true);
    expect(isLegacyHighGainAmpRack([
      { type: "input_trim" }, { type: "noise_gate" }, { type: "dual_high_gain" },
      { type: "cabinet_ir" }, { type: "output_trim" },
    ])).toBe(false);
  });

  test("syncs a Designer control into only its exact DSP module binding", () => {
    let modules = appendDspRackModule([], "linked_compressor", "compressor-a");
    modules = appendDspRackModule(modules, "linked_compressor", "compressor-b");
    const result = syncDspRackFromControl(modules, { moduleId: "compressor-a", parameter: "threshold", value: 25 });
    expect(result[0].parameters.threshold).toBe(0.25);
    expect(result[1].parameters.threshold).toBeUndefined();
    expect(dspBindingValue(result[1], "threshold")).toBe(0.7);
  });

  test("syncs parameter, module mix, and bypass values back to bound controls", () => {
    const controls = [
      { id: "a", moduleId: "compressor-a", parameter: "threshold", value: 50 },
      { id: "b", moduleId: "compressor-b", parameter: "threshold", value: 50 },
      { id: "c", moduleId: "compressor-a", parameter: "module_mix", value: 50 },
    ];
    expect(syncControlsFromDspBinding(controls, "compressor-a", "threshold", 0.25).map(({ value }) => value)).toEqual([25, 50, 50]);
    expect(syncDspRackFromControl(appendDspRackModule([], "linked_compressor", "compressor-a"), { moduleId: "compressor-a", parameter: "module_mix", value: 35 })[0].mix).toBe(0.35);
    expect(syncDspRackFromControl(appendDspRackModule([], "linked_compressor", "compressor-a"), { moduleId: "compressor-a", parameter: "bypass", value: 100 })[0].bypassed).toBe(true);
  });

  test("routes an internal macro through the first matching DSP module", () => {
    let modules = appendDspRackModule([], "tone_shaper", "tone-a");
    modules = appendDspRackModule(modules, "tone_shaper", "tone-b");
    const result = syncDspRackFromControl(modules, { moduleId: null, parameter: "tone", value: 72 });
    expect(result[0].parameters.tone).toBe(0.72);
    expect(result[1].parameters.tone).toBe(0.5);
    const controls = [{ id: "macro", moduleId: null, parameter: "tone", value: 20 }];
    expect(syncControlsFromDspBinding(controls, "tone-a", "tone", 0.61, result)[0].value).toBe(61);
    expect(syncControlsFromDspBinding(controls, "tone-b", "tone", 0.3, result)[0].value).toBe(20);
  });

  test("reads rack values and scopes shared bindings by module id", () => {
    const module = { id: "compressor-a", type: "linked_compressor", bypassed: true, mix: 0.4, parameters: { threshold: 0.2 } };
    expect(dspBindingValue(module, "threshold")).toBe(0.2);
    expect(dspBindingValue(module, "module_mix")).toBe(0.4);
    expect(dspBindingValue(module, "bypass")).toBe(1);
    expect(controlsShareDspBinding(
      { moduleId: "compressor-a", parameter: "threshold" },
      { moduleId: "compressor-b", parameter: "threshold" },
    )).toBe(false);
  });
});
