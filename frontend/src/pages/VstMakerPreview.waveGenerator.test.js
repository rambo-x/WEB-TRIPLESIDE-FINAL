import fs from "fs";
import path from "path";

describe("VST Maker Wave Generator note routing", () => {
  const source = fs.readFileSync(path.join(__dirname, "VstMakerPreview.jsx"), "utf8");

  test("keeps the oscillator and full DSP active for Mapping, Designer, and Web MIDI", () => {
    expect(source).toContain("const playWaveGeneratorNote = (pitch, velocity, token, playbackOptions = null) => {");
    expect(source).toContain("const waveStarted = playWaveGeneratorNote(pitch, velocity, token);");
    expect(source).not.toContain('if (previewMode !== "instrument") return false;');
    expect(source).not.toContain('previewMode === "mapping"');
    expect(source).not.toContain('previewMode !== "mapping"');
    expect(source).toContain("midiPlayRef.current = playSamplerNote;");
    expect(source).toContain("onNoteOn={playSamplerNote}");
    expect(source).not.toContain("playMappedPreviewNote");
    expect(source).toContain("onNoteOn(pitch, noteVelocity, token, activePreviewArticulation, activePreviewMicPosition, selectedSamplerName);");
  });

  test("builds the expanded synth voice graph", () => {
    expect(source).toContain('const unisonVoices = 1 + Math.round(unit("unison_voices", 0) * 7);');
    expect(source).toContain('const glideSeconds = 2 * (unit("glide", 0) ** 2);');
    expect(source).toContain('vibratoLfo.frequency.value = 0.1 + unit("vibrato_rate", 0.45) * 11.9;');
    expect(source).toContain('filter.type = "lowpass";');
    expect(source).toContain('const sustainLevel = unit("sustain", 1);');
    expect(source).toContain('if (osc2Enabled && osc2Level > 0) createOscillatorSource');
    expect(source).toContain('if (noiseLevel > 0) createNoiseSource');
    expect(source).toContain("waveGeneratorVelocityGain(velocity, parameters)");
    expect(source).toContain(">Respons Velocity</div>");
    expect(source).toContain("const velocityParameters = option.parameters.filter(({ key }) => velocityKeys.has(key));");
    expect(source.indexOf(">Respons Velocity</div>")).toBeGreaterThan(source.indexOf("Bypass generator</label>"));
    expect(source).toContain('const monoMode = unit("voice_mode", 1) >= 0.5 && !playbackOptions?.patternScheduled;');
    expect(source).toContain('if (!retrigger) {');
  });

  test("separates both oscillators and defaults OSC2 to an explicit switch", () => {
    expect(source).toContain(">Oscillator 1</div>");
    expect(source).toContain(">Oscillator 2</div>");
    expect(source).toContain('role="switch" aria-checked={osc2Enabled}');
    expect(source).toContain('updateEngineModuleParameter(waveGeneratorModule.id, "osc2_enabled", osc2Enabled ? 0 : 1)');
  });

  test("offers five MIDI pattern generators with dedicated Wave Generator preview", () => {
    expect(source).toContain("<WaveGeneratorPatternStudio");
    expect(source).toContain("Generate {activeMode.label}");
    expect(source).toContain("playWavePatternNote");
    expect(source).toContain("patternScheduled: true");
    expect(source).toContain("onSequencesChange([...midiSequences, sequence].slice(-16))");
    expect(source).toContain("playWavePatternNote.prepareGroove = async () => {");
    expect(source).toContain('const immediate = playbackOptions?.forceRelease === true && playbackOptions?.scheduledAtPerformance == null;');
  });

  test("removes the hidden legacy instrument-effects compatibility UI and payload", () => {
    expect(source).not.toContain("Efek kompatibilitas project lama");
    expect(source).not.toContain("toggleEffect");
    expect(source).toContain("effects: {},");
  });

  test("turns keyboard and MIDI gestures into held live generator patterns", () => {
    expect(source).toContain('Live Trigger {live ? "ON" : "OFF"}');
    expect(source).toContain('sourceSequenceId: sequence.id');
    expect(source).toContain("livePatternStartRef.current = (pitch, velocity, token) => {");
    expect(source).toContain("triggerPitch: pitch");
    expect(source).toContain("if (!playbackOptions && livePatternStartRef.current?.(pitch, velocity, token)) return;");
    expect(source).toContain("if (!playbackOptions && livePatternStopRef.current?.(token)) return;");
    expect(source).toContain("const transientSequenceRef = useRef(null);");
  });

  test("plays one sustained chord per held key instead of the generated progression", () => {
    expect(source).toContain('if (liveWavePatternConfig.mode === "chord" && liveWavePatternConfig.chordMode === "single")');
    expect(source).toContain('.filter((event) => event.type === "note_on" && event.tick === 0)');
    expect(source).toContain("playWavePatternNote(event.note, chordVelocity, noteToken);");
    expect(source).toContain("stopLivePatternTrigger(trigger);");
    expect(source).toContain("Preset Live Trigger 1 Chord aktif.");
  });

  test("places a mutually exclusive Live Trigger beside each generated pattern preview", () => {
    const previewIndex = source.indexOf('{playing ? "Stop" : "Preview"}</button>');
    const liveIndex = source.indexOf('Live Trigger {live ? "ON" : "OFF"}</button>', previewIndex);
    expect(previewIndex).toBeGreaterThan(-1);
    expect(liveIndex).toBeGreaterThan(previewIndex);
    expect(source).toContain("Hanya satu pola dapat aktif.");
    expect(source).not.toContain("if (liveEnabled) onLiveConfigChange({ ...next, enabled: true });");
  });

  test("offers single and free-progression chord modes", () => {
    expect(source).toContain('<option value="single">1 Chord</option>');
    expect(source).toContain('<option value="progression">Chord Berjalan</option>');
    expect(source).toContain('value={config.customProgression}');
    expect(source).toContain("WAVE_SINGLE_CHORD_OPTIONS.map");
  });

  test("starts each keyboard gesture once and keeps mono held-note fallback", () => {
    const beginNoteBody = source.match(/const beginNote = \(pitch, event, tokenPrefix\) => \{([\s\S]*?)\n  \};\n  const endNote/)?.[1] || "";
    expect(beginNoteBody.match(/onNoteOn\(pitch, velocity, token\);/g)).toHaveLength(1);
    expect(source).toContain("heldWaveNotesRef.current.set(token");
    expect(source).toContain("const fallbackNote = monoMode ? selectedHeldWaveNote() : null;");
    expect(source).not.toContain("note_priority");
    expect(source).toContain("retargetWaveVoice(waveVoice, fallbackNote.pitch, fallbackNote.velocity, parameters);");
  });

  test("schedules the oscillator before awaiting a suspended audio context", () => {
    const previewBody = source.match(/const playSamplerNote = async[\s\S]*?\n  const releaseSamplerVoice/)?.[0] || "";
    expect(previewBody.indexOf("const waveStarted = playWaveGeneratorNote(pitch, velocity, token);")).toBeGreaterThan(-1);
    expect(previewBody.indexOf("const waveStarted = playWaveGeneratorNote(pitch, velocity, token);")).toBeLessThan(previewBody.indexOf("await previewContext.resume()"));
  });

  test("reuses expensive waveform data between notes", () => {
    expect(source).toContain("wavePeriodicWavesRef.current.get(cacheKey)");
    expect(source).toContain("waveNoiseBuffersRef.current.get(cacheKey)");
  });

  test("routes Wave Generator audio through the ordered DSP Rack", () => {
    expect(source).toContain('.filter(isPostSourceDspModule)');
    expect(source).toContain("createDspPreviewPlan(postRackModules, project.interfaceControls, customImpulseTaps)");
    expect(source).toContain("const rackGraph = ensureWaveDspGraph(context, rackPlan);");
    expect(source).toContain("masterGain.connect(rackGraph.input);");
    expect(source).toContain('graph.processor.port.postMessage({ type: "plan", plan });');
    expect(source).toContain("usesSharedRack: Boolean(rackGraph)");
    expect(source).toContain("if (!rackGraph && !rackPending) chorusLfo.start(now);");
  });

  test("shares one post-mix rack instead of creating a processor for every voice", () => {
    expect(source).toContain("const waveDspGraphRef = useRef(null);");
    expect(source).toContain("let graph = waveDspGraphRef.current;");
    expect(source).not.toContain("ampGain.connect(rackProcessor);");
    expect(source).not.toContain("voice.rackProcessor.port.postMessage");
  });

  test("updates preview rack topology in place without duplicating the active processor", () => {
    expect(source).toContain('graph.processor.port.postMessage({ type: "plan", plan });');
    expect(source).toContain("graph.planSignature !== planSignature");
    expect(source).not.toContain("const nextProcessor = createNativeDspWorkletNode(context, plan);");
    expect(source).not.toContain("graph.pendingPlan = plan;");
    expect(source).toContain("const rackPending = rackPlan.length > 0 && !rackGraph;");
    expect(source).toContain("activatePendingWaveDspGraph(context);");
    expect(source).toContain("pendingSharedRack: rackPending");
    expect(source).toContain("pendingDirectGain?.gain.linearRampToValueAtTime(0, now + 0.04);");
    expect(source).toContain("rackSendGain.gain.linearRampToValueAtTime(1, now + 0.04);");
    expect(source).toContain('processor.addEventListener?.("processorerror"');
    expect(source).toContain("input.connect(dryFallback); dryFallback.connect(output);");
  });

  test("repairs stale module parameters when switching a control to automatic DSP macro", () => {
    expect(source).toContain("const inferredMacro = Object.entries(INTERNAL_DSP_MACRO_BINDINGS)");
    expect(source).toContain("inferredMacro || currentAutomaticParameter || firstAvailableMacro");
    expect(source).toContain("engineModules.some((module) => module.type === binding.type)");
  });

  test("applies Pitch Bend directly to every active oscillator voice", () => {
    expect(source).toContain("const applyWaveGeneratorExpression = (bendValue, vibratoSemitones = 0) => {");
    expect(source).toContain("applyWaveGeneratorExpression(normalized);");
    expect(source).toContain("item.source.detune.cancelScheduledValues(now);");
    expect(source).toContain("item.source.detune.setTargetAtTime(targetCents, now, 0.003);");
  });

  test("applies the global tuning DSP before sampler and oscillator playback", () => {
    expect(source).toContain('const module = modules.find((item) => item.type === "tuning" && !item.bypassed);');
    expect(source).toContain("+ dspGlobalTuningSemitones(projectRef.current.engineModules)");
    expect(source).toContain("+ globalTuning * 100");
    expect(source).toContain("+ Number(mapping.tuneCents || 0) / 100 + globalTuning");
  });

  test("stores hidden DSP state in presets and restores the whole rack", () => {
    expect(source).toContain("module_values: Object.fromEntries(engineModules.map");
    expect(source).toContain("const snapshot = preset.module_values?.[module.id];");
    expect(source).toContain("onFeatureChange({ samplerGroups: nextGroups, engineModules: nextModules });");
  });

  test("persists text styling and applies the global resize mode", () => {
    expect(source).toContain('text_font: textFont || legacyTextFont || "space-grotesk"');
    expect(source).toContain('text_color: textColor || legacyTextColor || "#F4F4F5"');
    expect(source).toContain("preserveAspectRatio: resizeAspectLocked");
    expect(source).toContain('resizeAspectLocked ? <Lock aria-hidden="true" /> : <Unlock aria-hidden="true" />');
    expect(source).toContain("Font text");
    expect(source).toContain("Warna text");
  });

  test("offers distribution licenses in the final build step with clear customer wording", () => {
    expect(source).toContain("Lisensi Distribusi");
    expect(source).toContain("Pilih ini jika VST akan dijual massal");
    expect(source).toContain("Tanpa serial number");
    expect(source).toContain("Pilih build tanpa serial number untuk distribusi bebas");
    expect(source).toContain("Build tidak memerlukan serial number atau aktivasi perangkat.");
    expect(source).not.toContain("Administrator saat ini menonaktifkan proteksi lisensi.");
    expect(source).toContain("Saldo tersisa setelah build");
    expect(source).toContain("{count} komputer/serial");
    expect(source).not.toContain("distribution_license_credits?.[count] || 0))}/serial");
    expect(source).toContain("Harga setiap serial");
    expect(source).toContain("{distributionQuantity} serial × {formatCredits(distributionUnitCredits)}");
    expect(source).toContain("Diskon paket {distributionDiscount}%");
    expect(source).toContain("Total paket distribusi");
    expect(source).not.toMatch(/cache aman Windows DPAPI/i);
    expect(source).toContain('api.post("/customer/license-distributions/purchase"');
  });

  test("preserves an explicit zero-activation build choice", () => {
    expect(source).toContain("if (Number(value) === 0) return 0;");
    expect(source).toContain("license_max_activations: normalizeLicenseActivationChoice(project.licenseMaxActivations)");
  });

  test("lets admin hide the no-serial choice from the final build step", () => {
    expect(source).toContain("Opsi tanpa serial number");
    expect(source).toContain("Sembunyikan dari customer");
    expect(source).toContain("show_no_serial_option: event.target.value === \"visible\"");
    expect(source).toContain("showNoSerialOption ? [0] : []");
  });

  test("explains correction rebuild eligibility and savings before charging", () => {
    expect(source).toContain("Rebuild Koreksi tersedia");
    expect(source).toContain("Dihitung sebagai build baru");
    expect(source).toContain("Ketentuan Rebuild Koreksi");
    expect(source).toContain("Hemat {formatCredits(correction.savings_credits)}");
    expect(source).toContain("Kesempatan Rebuild Koreksi");
    expect(source).toContain("/build-quote");
    expect(source).toContain("Maksimal 3 komponen dan 3 sample baru");
    expect(source).toContain("harga item baru tetap dibayar");
    expect(source).toContain("Maksimal 3 komponen boleh berganti skin");
    expect(source).toContain('selectPlatformBuild("windows", buildActionMenuOpen === "rebuild")');
    expect(source).toContain('selectPlatformBuild("macos", buildActionMenuOpen === "rebuild")');
    expect(source).toContain('const hasRebuildSlots = customerMode && (windowsRebuildSlots > 0 || macRebuildSlots > 0);');
    expect(source).toContain('buildActionMenuOpen === "rebuild" ? "Rebuild Windows" : "Export Windows"');
    expect(source).toContain('buildActionMenuOpen === "rebuild" ? "Rebuild macOS" : "Export macOS"');
    expect(source).toContain("force_correction_rebuild");
  });

  test("groups export and rebuild platform choices into compact menus", () => {
    expect(source).toContain('<span>Export</span>');
    expect(source).toContain('<span>Rebuild</span>');
    expect(source).toContain('aria-label={buildActionMenuOpen === "rebuild" ? "Pilih platform rebuild" : "Pilih platform export"}');
    expect(source).toContain('disabled={buildActionMenuOpen === "rebuild" && windowsRebuildSlots <= 0}');
    expect(source).toContain('disabled={buildActionMenuOpen === "rebuild" && macRebuildSlots <= 0}');
    expect(source).toContain('!buildActionMenuRef.current?.contains(event.target)');
  });

});
