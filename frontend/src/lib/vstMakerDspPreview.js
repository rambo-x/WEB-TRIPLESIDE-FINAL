import { DSP_RACK_MODULE_OPTIONS, INTERNAL_DSP_MACRO_BINDINGS, dspRackOption, internalDspMacroTarget, normalizeDspRack } from "./vstMakerDspRack";

const clampUnit = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

const macroValue = (controls, parameter, fallback) => {
  const control = (Array.isArray(controls) ? controls : []).find((item) => (
    !item.moduleId
    && item.parameter === parameter
    && !["pad", "keyboard", "gain_meter", "vu_meter"].includes(item.kind)
  ));
  return control ? clampUnit(Number(control.value) / 100, fallback) : fallback;
};

const LEGACY_PARAMETERS = {
  input_trim: ["input", 0.5],
  soft_clip: ["drive", 0.24],
  linked_compressor: ["compress", 0.32],
  tone_shaper: ["tone", 0.5],
  stereo_width: ["width", 0.5],
  cross_delay: ["space", 0.18],
  dry_wet: ["mix", 1],
  output_trim: ["output", 0.75],
};

const LEGACY_MODULE_TYPES = Object.keys(LEGACY_PARAMETERS);

const levelMatchedSoftClip = (drive, output = 0.5) => {
  const normalizedDrive = clampUnit(drive, 0);
  const saturationDrive = 1 + normalizedDrive * 14;
  const smallSignalGain = saturationDrive / Math.max(0.000001, Math.tanh(saturationDrive));
  const compensationDb = 20 * Math.log10(smallSignalGain);
  return {
    drive: normalizedDrive,
    output: clampUnit(clampUnit(output, 0.5) - compensationDb / 24),
  };
};

const legendHardwarePreviewModule = (module, parameters) => {
  const model = clampUnit(parameters.model, 0);
  if (module.type === "legend_preamp") {
    const gainStaging = levelMatchedSoftClip(
      0.035 + 0.24 * clampUnit(parameters.drive, 0.38) * (0.9 + 0.2 * model),
      parameters.output ?? 0.5,
    );
    return {
      type: "soft_clip",
      parameters: {
        drive: gainStaging.drive,
        character: clampUnit(0.72 * clampUnit(parameters.color, 0.52) + 0.28 * model),
        output: gainStaging.output,
      },
    };
  }
  if (module.type === "legend_compressor") {
    const amount = clampUnit(parameters.amount, 0.42);
    return {
      type: "linked_compressor",
      parameters: {
        compress: amount,
        threshold: clampUnit(0.76 - 0.46 * amount - 0.08 * model),
        ratio: clampUnit(0.18 + 0.5 * amount + 0.12 * model),
        attack: clampUnit(clampUnit(parameters.attack, 0.38) + 0.12 * (model - 0.5)),
        release: clampUnit(clampUnit(parameters.release, 0.46) + 0.08 * model),
        makeup: clampUnit(parameters.makeup ?? 0.12),
      },
    };
  }
  if (module.type === "legend_eq") {
    return {
      type: "tone_shaper",
      parameters: {
        tone: clampUnit(0.45 + 0.1 * model),
        low: clampUnit(parameters.low ?? 0.5),
        mid: clampUnit(parameters.mid ?? 0.5),
        high: clampUnit(0.72 * clampUnit(parameters.high ?? 0.5) + 0.28 * clampUnit(parameters.air ?? 0.5)),
      },
    };
  }
  if (module.type === "legend_tape") {
    const speed = clampUnit(parameters.speed, 0.5);
    const age = clampUnit(parameters.age, 0.16);
    const gainStaging = levelMatchedSoftClip(
      0.025 + 0.19 * clampUnit(parameters.drive, 0.34) + 0.04 * age + 0.02 * (1 - speed),
      parameters.output ?? 0.46,
    );
    return {
      type: "soft_clip",
      parameters: {
        drive: gainStaging.drive,
        character: clampUnit(0.42 + 0.32 * model + 0.16 * age),
        output: gainStaging.output,
      },
    };
  }
  return null;
};

const resolveModule = (module, controls = [], modules = []) => {
  const option = dspRackOption(module.type);
  const explicitParameters = Object.keys(module.parameters || {});
  const parameters = Object.fromEntries((option?.parameters || []).map((definition) => [
    definition.key,
    clampUnit(module.parameters?.[definition.key], definition.defaultValue),
  ]));
  const macroParameter = Object.entries(INTERNAL_DSP_MACRO_BINDINGS)
    .find(([, binding]) => binding.type === module.type && binding.parameter === option?.parameter)?.[0];
  if (macroParameter && internalDspMacroTarget(modules, macroParameter)?.id === module.id) {
    parameters[option.parameter] = macroValue(controls, macroParameter, parameters[option.parameter]);
  } else if (option?.parameter && !explicitParameters.includes(option.parameter)) {
    const [, fallback] = LEGACY_PARAMETERS[module.type] || [option.parameter, option.defaultValue ?? 0];
    parameters[option.parameter] = macroValue(controls, option.parameter, fallback);
  }
  const resolved = {
    id: module.id,
    type: module.type,
    bypassed: module.bypassed === true,
    mix: clampUnit(module.mix, 1),
    parameters,
    explicitParameters,
  };
  const legendPreview = legendHardwarePreviewModule(module, parameters);
  return legendPreview ? {
    ...resolved,
    type: legendPreview.type,
    parameters: legendPreview.parameters,
    explicitParameters: Object.keys(legendPreview.parameters),
    sourceType: module.type,
  } : resolved;
};

export const createDspPreviewPlan = (engineModules, controls = [], customImpulses = {}, samplerGroupId = null) => {
  const allModules = normalizeDspRack(engineModules);
  const modules = allModules.filter((module) => (module.samplerGroupId || null) === (samplerGroupId || null));
  if (modules.length) return modules.map((module) => {
    const resolved = resolveModule(module, controls, modules);
    const impulse = customImpulses?.[module.id];
    return impulse && module.type === "cabinet_ir" ? { ...resolved, customImpulse: impulse } : resolved;
  });
  if (allModules.length || samplerGroupId) return [];
  return LEGACY_MODULE_TYPES.map((type) => dspRackOption(type)).map((option) => {
    const [parameter, fallback] = LEGACY_PARAMETERS[option.type];
    return resolveModule({
      id: `legacy-${option.type}`,
      type: option.type,
      bypassed: false,
      mix: 1,
      parameters: { [parameter]: macroValue(controls, parameter, fallback) },
    });
  });
};

export const createDspAuditionPlan = (engineModules, controls = [], customImpulses = {}) => (
  normalizeDspRack(engineModules).length
    ? createDspPreviewPlan(engineModules, controls, customImpulses)
    : []
);

export const dspPreviewPlanTopology = (plan = []) => (Array.isArray(plan) ? plan : [])
  .map(({ id, type }) => `${id}:${type}`)
  .join("|");

export const applyDspPreviewPlanUpdate = (graph, plan = []) => {
  if (!graph?.processor?.port) return false;
  const topology = dspPreviewPlanTopology(plan);
  // Replacing processor topology while a MediaElement is feeding the worklet
  // is not reliable across browsers. Stop the audition graph and let the user
  // resume it with a freshly constructed worklet instead.
  if (graph.topology !== topology) return false;
  try {
    graph.processor.port.postMessage({ type: "plan", plan });
    graph.topology = topology;
    return true;
  } catch {
    return false;
  }
};

export const dspPreviewModuleSettings = (module) => {
  const parameters = module?.parameters || {};
  const explicit = new Set(module?.explicitParameters || []);
  switch (module?.type) {
    case "input_trim": {
      const value = parameters.input ?? 0.5;
      return { gain: value <= 0 ? 0 : 10 ** ((value * 24 - 12) / 20) };
    }
    case "soft_clip":
      return {
        drive: parameters.drive ?? 0.24,
        character: parameters.character ?? 0.5,
        outputGain: 10 ** ((((parameters.output ?? 0.5) - 0.5) * 24) / 20),
      };
    case "linked_compressor": {
      const amount = parameters.compress ?? 0.35;
      return {
        threshold: explicit.has("threshold") ? -48 + (parameters.threshold * 48) : -6 - (amount * 24),
        ratio: explicit.has("ratio") ? 1 + (parameters.ratio * 19) : 1 + (amount * 7),
        attack: explicit.has("attack") ? 0.0001 * (1000 ** parameters.attack) : 0.008,
        release: explicit.has("release") ? 0.02 * (50 ** parameters.release) : 0.12,
        makeupGain: 10 ** (((parameters.makeup ?? 0) * 24) / 20),
      };
    }
    case "de_esser":
      return {
        amount: parameters.amount ?? 0.55,
        frequency: 3000 * (4 ** (parameters.frequency ?? 0.5)),
        threshold: -48 + ((parameters.threshold ?? 0.58) * 48),
        range: (parameters.range ?? 0.5) * 18,
        attack: 0.0001 * (200 ** (parameters.attack ?? 0.35)),
        release: 0.02 * (15 ** (parameters.release ?? 0.45)),
      };
    case "tone_shaper":
      return {
        tone: parameters.tone ?? 0.5,
        threeBand: ["low", "mid", "high"].some((parameter) => explicit.has(parameter)),
        lowGain: ((parameters.low ?? 0.5) - 0.5) * 24,
        midGain: ((parameters.mid ?? 0.5) - 0.5) * 24,
        highGain: ((parameters.high ?? 0.5) - 0.5) * 24,
      };
    case "stereo_width":
      return {
        width: (parameters.width ?? 0.5) * 2,
        monoBassCutoff: (parameters.mono_bass ?? 0) > 0 ? 40 * (10 ** parameters.mono_bass) : 0,
      };
    case "cross_delay": {
      const amount = parameters.space ?? 0.22;
      return {
        amount,
        time: explicit.has("time") ? 0.02 * (50 ** parameters.time) : 0.19,
        feedback: explicit.has("feedback") ? 0.05 + (parameters.feedback * 0.8) : 0.18 + (amount * 0.5),
        crossfeed: parameters.crossfeed ?? 1,
        filter: parameters.filter ?? 1,
      };
    }
    case "dry_wet": return { mix: parameters.mix ?? 1 };
    case "output_trim": {
      const value = parameters.output ?? 0.5;
      return { gain: value <= 0 ? 0 : 10 ** ((value * 16 - 12) / 20) };
    }
    default: return {};
  }
};

export const dspPreviewDryWetGains = (module) => {
  if (module?.bypassed === true) return { processedGain: 1, rackDryGain: 0 };
  const moduleMix = clampUnit(module?.mix, 1);
  const wetMix = clampUnit(module?.parameters?.mix, 1);
  const rackDryGain = (1 - wetMix) * moduleMix;
  return { processedGain: 1 - rackDryGain, rackDryGain };
};
