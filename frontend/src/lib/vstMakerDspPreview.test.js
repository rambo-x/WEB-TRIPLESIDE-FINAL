import { applyDspPreviewPlanUpdate, createDspAuditionPlan, createDspPreviewPlan, dspPreviewDryWetGains, dspPreviewModuleSettings, dspPreviewPlanTopology } from "./vstMakerDspPreview";
import { createNativeDspProcessorClass } from "./vstDspProcessor";
import { createLegendHardwareRack } from "./vstMakerDspRack";

class PreviewTestProcessorBase {
  constructor() { this.port = { onmessage: null, postMessage: () => {} }; }
}

const renderPlan = (plan, input, sampleRate = 48000) => {
  const Processor = createNativeDspProcessorClass(PreviewTestProcessorBase, sampleRate);
  const processor = new Processor({ processorOptions: { plan } });
  const left = new Float32Array(input.length);
  const right = new Float32Array(input.length);
  processor.process([[input, input]], [[left, right]]);
  return left;
};

const signalRms = (signal, start = 0) => Math.sqrt(
  signal.slice(start).reduce((sum, value) => sum + value * value, 0) / Math.max(1, signal.length - start),
);

describe("VST Maker browser DSP preview", () => {
  test("keeps an empty WAV audition rack dry at unity instead of applying legacy saturation", () => {
    const plan = createDspAuditionPlan([], [
      { parameter: "drive", value: 100, moduleId: null, kind: "knob" },
      { parameter: "compress", value: 100, moduleId: null, kind: "knob" },
    ]);
    expect(plan).toEqual([]);
    const input = Float32Array.from([0, 0.1, -0.2, 0.35, -0.5]);
    expect(Array.from(renderPlan(plan, input))).toEqual(Array.from(input));
    expect(createDspAuditionPlan([
      { id: "clip", type: "soft_clip", parameters: { drive: 0.2 } },
    ]).map(({ id, type }) => [id, type])).toEqual([["clip", "soft_clip"]]);
  });

  test("restarts WAV audition safely when the rack topology changes", () => {
    const postMessage = jest.fn();
    const originalPlan = [{ id: "legacy", type: "soft_clip" }];
    const graph = { processor: { port: { postMessage } }, topology: dspPreviewPlanTopology(originalPlan) };
    expect(applyDspPreviewPlanUpdate(graph, [{ ...originalPlan[0], parameters: { drive: 0.2 } }])).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(applyDspPreviewPlanUpdate(graph, [{ id: "legend", type: "soft_clip" }])).toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  test("contains a closed or rejected AudioWorklet port instead of crashing the page", () => {
    const plan = [{ id: "legend", type: "soft_clip" }];
    const graph = {
      topology: dspPreviewPlanTopology(plan),
      processor: { port: { postMessage: () => { throw new DOMException("Port closed", "InvalidStateError"); } } },
    };
    expect(applyDspPreviewPlanUpdate(graph, plan)).toBe(false);
  });

  test("lets an internal macro control the first matching explicit rack module", () => {
    const plan = createDspPreviewPlan([
      { id: "tone-a", type: "tone_shaper", parameters: { tone: 0.2 } },
      { id: "tone-b", type: "tone_shaper", parameters: { tone: 0.3 } },
    ], [{ id: "macro", kind: "knob", moduleId: null, parameter: "tone", value: 76 }]);
    expect(plan[0].parameters.tone).toBe(0.76);
    expect(plan[1].parameters.tone).toBe(0.3);
  });

  test("uses exact custom-rack compressor parameters", () => {
    const [compressor] = createDspPreviewPlan([{
      id: "comp",
      type: "linked_compressor",
      parameters: { compress: 0.2, threshold: 0.25, ratio: 0.5, attack: 0, release: 1, makeup: 0.5 },
    }]);
    const settings = dspPreviewModuleSettings(compressor);
    expect(settings).toEqual(expect.objectContaining({
      threshold: -36,
      ratio: 10.5,
      attack: 0.0001,
      release: 1,
    }));
    expect(settings.makeupGain).toBeCloseTo(3.9810717, 5);
  });

  test("keeps legacy amount laws until a detailed parameter is explicit", () => {
    const [compressor] = createDspPreviewPlan([{ id: "comp", type: "linked_compressor", parameters: { compress: 0.5 } }]);
    expect(dspPreviewModuleSettings(compressor)).toEqual(expect.objectContaining({ threshold: -18, ratio: 4.5, attack: 0.008, release: 0.12 }));
  });

  test("creates the compatibility rack from unbound macros only", () => {
    const plan = createDspPreviewPlan([], [
      { parameter: "compress", value: 80, moduleId: "some-module", kind: "knob" },
      { parameter: "compress", value: 25, moduleId: null, kind: "knob" },
    ]);
    expect(plan.map(({ type }) => type)).toEqual(["input_trim", "soft_clip", "linked_compressor", "tone_shaper", "stereo_width", "cross_delay", "dry_wet", "output_trim"]);
    expect(plan[2].parameters.compress).toBe(0.25);
  });

  test("custom modules without an explicit primary parameter follow the unbound legacy macro", () => {
    const [clip] = createDspPreviewPlan(
      [{ id: "clip", type: "soft_clip", parameters: { character: 0.8 } }],
      [{ parameter: "drive", value: 67, moduleId: null, kind: "knob" }],
    );
    expect(clip.parameters.drive).toBe(0.67);
    expect(clip.explicitParameters).toEqual(["character"]);
  });

  test("preserves rack order, bypass, and per-module mix", () => {
    const plan = createDspPreviewPlan([
      { id: "out", type: "output_trim", bypassed: true, mix: 0.3, parameters: { output: 0.75 } },
      { id: "clip", type: "soft_clip", parameters: { drive: 0.4 } },
    ]);
    expect(plan.map(({ id }) => id)).toEqual(["out", "clip"]);
    expect(plan[0]).toEqual(expect.objectContaining({ bypassed: true, mix: 0.3 }));
  });

  test("maps Legend Hardware to audible browser-preview processors without changing saved ids", () => {
    const plan = createDspPreviewPlan([
      { id: "pre", type: "legend_preamp", parameters: { model: 1 / 3, drive: 0.5, color: 0.6, high_pass: 0.2, output: 0.5 } },
      { id: "comp", type: "legend_compressor", parameters: { model: 2 / 3, amount: 0.55, attack: 0.4, release: 0.5, makeup: 0.1 } },
      { id: "eq", type: "legend_eq", parameters: { model: 0, low: 0.6, mid: 0.5, high: 0.55, air: 0.6 } },
      { id: "tape", type: "legend_tape", parameters: { model: 1 / 3, drive: 0.4, speed: 0.5, age: 0.2, wow_flutter: 0.1, output: 0.5 } },
    ]);
    expect(plan.map(({ id }) => id)).toEqual(["pre", "comp", "eq", "tape"]);
    expect(plan.map(({ type }) => type)).toEqual(["soft_clip", "linked_compressor", "tone_shaper", "soft_clip"]);
    expect(plan.map(({ sourceType }) => sourceType)).toEqual(["legend_preamp", "legend_compressor", "legend_eq", "legend_tape"]);
    expect(plan[1].parameters.compress).toBe(0.55);
    expect(plan[1].parameters.threshold).toBeCloseTo(0.4536666667, 8);
    expect(plan[1].parameters.ratio).toBeCloseTo(0.535, 8);
    expect(plan[1].parameters.attack).toBeCloseTo(0.42, 8);
    expect(plan[1].parameters.release).toBeCloseTo(0.5533333333, 8);
    expect(plan[1].parameters.makeup).toBe(0.1);
    expect(plan[2].parameters).toEqual(expect.objectContaining({ tone: 0.45, low: 0.6, mid: 0.5 }));
    expect(plan[2].parameters.high).toBeCloseTo(0.564, 8);
    expect(plan[3].parameters.drive).toBeCloseTo(0.119, 8);
    expect(plan[3].parameters.character).toBeCloseTo(0.5586666667, 8);
  });

  test("keeps the default Legend channel level-matched instead of jumping in volume", () => {
    let nextId = 0;
    const rack = createLegendHardwareRack(() => `legend-level-${nextId += 1}`);
    const plan = createDspPreviewPlan(rack);
    const input = Float32Array.from({ length: 8192 }, (_, index) => Math.sin(2 * Math.PI * 997 * index / 48000) * 0.08);
    const output = renderPlan(plan, input);
    expect(Array.from(output).every(Number.isFinite)).toBe(true);
    expect(signalRms(output, 2048)).toBeLessThanOrEqual(signalRms(input, 2048) * 1.05);
    expect(plan.map(({ type }) => type)).toEqual(["soft_clip", "linked_compressor", "tone_shaper", "soft_clip"]);
    expect(plan[0].parameters.output).toBeLessThan(0.5);
    expect(plan[3].parameters.output).toBeLessThan(0.5);
  });

  test("builds isolated master and sampler plans without leaking modules between groups", () => {
    const modules = [
      { id: "master", type: "output_trim", parameters: { output: 0.6 } },
      { id: "kick-a", type: "soft_clip", samplerGroupId: "kick", parameters: { drive: 0.7 } },
      { id: "snare", type: "tone_shaper", sampler_group_id: "snare", parameters: { tone: 0.4 } },
      { id: "kick-b", type: "linked_compressor", samplerGroupId: "kick", parameters: { compress: 0.5 } },
    ];

    expect(createDspPreviewPlan(modules).map(({ id }) => id)).toEqual(["master"]);
    expect(createDspPreviewPlan(modules, [], {}, "kick").map(({ id }) => id)).toEqual(["kick-a", "kick-b"]);
    expect(createDspPreviewPlan(modules, [], {}, "snare").map(({ id }) => id)).toEqual(["snare"]);
    expect(createDspPreviewPlan(modules, [], {}, "hat")).toEqual([]);
  });

  test("attaches a prepared custom impulse only to its cabinet module", () => {
    const impulse = { signature: "cab-ir", tapDelays: [0, 8], coefficients: [1, -0.2] };
    const plan = createDspPreviewPlan([
      { id: "cab", type: "cabinet_ir", parameters: {} },
      { id: "clip", type: "soft_clip", parameters: {} },
    ], [], { cab: impulse, clip: impulse });
    expect(plan[0].customImpulse).toBe(impulse);
    expect(plan[1].customImpulse).toBeUndefined();
  });

  test("matches native Dry/Wet direction and per-module mix", () => {
    expect(dspPreviewDryWetGains({ mix: 1, parameters: { mix: 0 } })).toEqual({ processedGain: 0, rackDryGain: 1 });
    expect(dspPreviewDryWetGains({ mix: 1, parameters: { mix: 1 } })).toEqual({ processedGain: 1, rackDryGain: 0 });
    expect(dspPreviewDryWetGains({ mix: 0.25, parameters: { mix: 0 } })).toEqual({ processedGain: 0.75, rackDryGain: 0.25 });
    expect(dspPreviewDryWetGains({ bypassed: true, mix: 1, parameters: { mix: 0 } })).toEqual({ processedGain: 1, rackDryGain: 0 });
  });
});
