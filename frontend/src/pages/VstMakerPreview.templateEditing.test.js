import fs from "fs";
import path from "path";

describe("VST Maker admin template editing", () => {
  const source = fs.readFileSync(path.join(__dirname, "VstMakerPreview.jsx"), "utf8");
  const visualRenderSource = fs.readFileSync(path.join(__dirname, "VstVisualRender.jsx"), "utf8");
  const templateSource = fs.readFileSync(path.join(__dirname, "../data/vstTemplates.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "VstMakerPreview.css"), "utf8");

  test("updates the active template by stable id instead of publishing a duplicate", () => {
    expect(source).toContain("appliedTemplateId");
    expect(source).toContain("/vst-maker/templates/${encodeURIComponent(appliedTemplateId)}/projects/${encodeURIComponent(saved.id)}");
    expect(source).toContain('appliedTemplateId ? "Perbarui template" : "Save to template"');
    expect(source).toContain("const saved = await saveProject();");
  });

  test("restores complete template assets and does not strip sampler or IR state", () => {
    expect(source).toContain("savedProjectSamples(template.project, assets)");
    expect(source).toContain("savedProjectImpulses(template.project, impulseAssets)");
    expect(source).not.toContain("sample_mappings: [],\n        impulse_responses: [],");
  });

  test("offers named DAW outputs and sampler-scoped DSP routing", () => {
    expect(source).toContain('outputBus: "master"');
    expect(source).toContain('<option value="separate">{samplerOutputLabel(samplerGroups, group.id)}</option>');
    expect(source).toContain('aria-label={`Target DSP ${module.name}`}');
    expect(source).toContain('<option value="" disabled={module.type === "tuning" && tuningTargetInUse(dspRackModules, null, module.id)}>DSP Master</option>');
    expect(source).toContain('{!isEffectProject && (');
    expect(source).not.toContain('{module.type !== "tuning" && !isEffectProject && (');
    expect(source).toContain('const tuningTarget = type === "tuning" ? nextDspTuningTarget(project.engineModules, project.samplerGroups) : null;');
    expect(source).toContain('disabled={module.type === "tuning" && tuningTargetInUse(dspRackModules, group.id, module.id)}');
    expect(source).not.toContain('["wave_generator", "tuning"].includes(type) && current.engineModules.some');
    expect(source).toContain('{dspModuleBindingLabel(module, engineModules, samplerGroups)}');
    expect(source).toContain('engineModules.filter((module) => module.type === "linked_compressor").map((module) => <option key={module.id} value={module.id}>{dspModuleBindingLabel(module, engineModules, samplerGroups)}</option>)');
    expect(source).toContain('selectedControl.kind === "solo" ? "Target Solo" : selectedControl.kind === "mute" ? "Target Mute" : "Target kontrol"');
    expect(source).toContain('output_bus: normalized.outputBus');
  });

  test("offers a build-safe multiple-output Combo Box bound to a sampler", () => {
    expect(source).toContain('{ id: "output-dropdown", category: "output", kind: "output_selector"');
    expect(source).toContain('label: "Combo Box Multiple Output"');
    expect(source).toContain('label: "Combo Box Output"');
    expect(source).not.toContain("const separateOutputSamplerGroups");
    expect(source).toContain("const outputSelectorDefaultValue");
    expect(source).toContain('control.kind === "output_selector"');
    expect(source).toContain('<option value="master">Master</option>');
    expect(source).toContain('samplerOutputLabel(samplerGroups, boundSampler.id)');
    expect(source).toContain('samplerOutputChoiceLabel(samplerGroups, boundSampler.id, controls)');
    expect(visualRenderSource).toContain('outputBus: group.output_bus === "separate" ? "separate" : "master"');
    expect(visualRenderSource).toContain("outputFontSize: c.output_font_size");
    expect(styles).toContain(".maker-output-selector");
    expect(styles).toContain("flex: 1 1 auto");
    expect(styles).toContain("--maker-output-font-size");
    expect(source).toContain('label="Warna combo box"');
    expect(source).toContain('label="Warna teks pilihan"');
    expect(source).toContain("output_font_size: normalizeOutputSelectorFontSize");
    expect(source).toContain("outputSelectorDefaultValue(samplerGroups, control.sampler_group_id)");
    expect(source).not.toContain("maker-canvas-control__drag-mark");
  });

  test("keeps the visible dB readout from resizing the live meter", () => {
    expect(styles).toContain("font-variant-numeric: tabular-nums");
    expect(styles).toContain("position: absolute");
    expect(styles).toContain("bottom: 2px");
    expect(styles).toContain("white-space: nowrap");
    expect(styles).toContain(".maker-canvas-control--gain_meter.is-label-empty");
    expect(styles).not.toContain("transition: height 55ms linear");
  });

  test("lights only the output selector border and restores its original label size", () => {
    const routedRule = styles.split(".maker-output-selector.is-routed {", 2)[1].split("}", 1)[0];
    const triggerRule = styles.split(".maker-output-selector__trigger {", 2)[1].split("}", 1)[0];
    expect(routedRule).toContain("border-color: var(--maker-accent");
    expect(routedRule).not.toContain("background:");
    expect(routedRule).not.toContain("box-shadow:");
    expect(triggerRule).toContain("font: inherit");
    expect(styles).toContain(".maker-output-selector__route-icon.is-active");
    expect(styles).toContain("color: var(--maker-accent, #fb7185)");
  });

  test("binds editable mixer controls to sampler state and can hide hardcoded controls", () => {
    expect(source).toContain('const SAMPLER_CONTROL_PARAMETERS = new Set(["volume", "pan", "mute", "solo"])');
    expect(source).toContain("samplerControlValue(boundSampler, control.parameter, control.value)");
    expect(source).toContain("samplerControlGroupUpdates(nextControl.parameter, updates.value)");
    expect(source).toContain("Kontrol bawaan Mixer");
    expect(source).toContain("mixerShowDefaultControls === false");
    expect(source).toContain("mappingRangeResetProps(() => onFeatureChange");
    expect(visualRenderSource).toContain("mixerShowDefaultControls: c.mixer_show_default_controls !== false");
    expect(source).toContain("const canChooseSamplerTarget");
    expect(source).toContain('Fader/knob baru otomatis menjadi Volume saat sampler dipilih');
    expect(source).toContain("Output awal · {selectedControlSampler.name}");
    expect(source).toContain('onUpdate(selectedControl.id, { value: event.target.value === "separate" ? 100 : 0 })');
  });

  test("keeps one browser DSP graph per sampler before the master rack", () => {
    expect(source).toContain("const samplerDspGraphsRef = useRef(new Map());");
    expect(source).toContain("const ensureSamplerDspGraph = (context, samplerGroupId, plan, destination) => {");
    expect(source).toContain("samplerDspGraphsRef.current.get(samplerGroupId)");
    expect(source).toContain("output.connect(destination);");
    expect(source).toContain("ensureSamplerMonitorRoute(context, samplerGroupId, masterGraph.input)");
    expect(source).toContain("ensureSamplerDspRoute(context, group?.id || null)");
    expect(source).toContain("createAudioEffects(audio, combinedPan, group?.id || null)");
  });

  test("uses an edited built-in override only once in the gallery", () => {
    expect(source).toContain("const publishedTemplateIds = new Set(publishedTemplates.map((template) => template.id));");
    expect(source).toContain("!publishedTemplateIds.has(template.id)");
    expect(source).toContain("builtInTemplate: template.built_in_template === true");
  });

  test("waits for the authoritative catalog before applying a template deep-link", () => {
    expect(source).toContain("templateCatalogLoaded");
    expect(source).toContain("if (!templateId || !templateCatalogLoaded) return;");
    expect(source).toContain("if (!allProjectTemplates.some((template) => template.id === templateId)) return;");
    expect(source).toContain("}, [allProjectTemplates, templateCatalogLoaded]);");
    expect(source).not.toContain('if (!PROJECT_TEMPLATE_OPTIONS.some((template) => template.id === templateId)) return;');
  });

  test("keeps the Neon fallback aligned with the current VST Studio hotspot layout", () => {
    expect(source).toContain("NEON_POP_DRUM_HITS.map");
    expect(templateSource).toContain('{ label: "Kick", notePitch: 36, x: 50.39, y: 61.25, width: 216, height: 208 }');
    expect(templateSource).toContain('{ label: "Ride", notePitch: 51, x: 83.2, y: 24.38, width: 264, height: 72 }');
    expect(source).toContain('component_variant: "smooth-diffuse-hit"');
    expect(templateSource).not.toContain('{ label: "Clap", notePitch: 39, x: 85, y: 60 }');
  });

  test("preserves saved mapping pitches instead of remapping zones from filenames", () => {
    expect(source).toContain("rootPitch: mapping.root_pitch");
    expect(source).toContain("lowPitch: mapping.low_pitch");
    expect(source).toContain("highPitch: mapping.high_pitch");
    expect(source).not.toContain("const migrateNeonOneKey");
  });

  test("offers original metal mixer fader and segmented LED meter components", () => {
    expect(source).toContain('{ id: "mixer-metal", category: "fader", kind: "fader"');
    expect(source).toContain('{ id: "studio-metal-db", category: "fader", kind: "fader"');
    expect(source).toContain('{ id: "studio-metal-long-cap", category: "fader", kind: "fader"');
    expect(source).toContain('{ id: "mixer-led-ladder", category: "meter", kind: "gain_meter"');
    expect(styles).toContain(".maker-fader--mixer-metal");
    expect(styles).toContain(".maker-fader--studio-metal-db");
    expect(styles).toContain(".maker-fader--studio-metal-long-cap");
    expect(styles).not.toContain(".maker-studio-metal-fader__scale");
    expect(source).toContain('isStudioMetalFaderVariant(control.component_variant) || (control.faderMeterEnabled');
    expect(source).toContain('meterVariant={isStudioMetalFaderVariant(control.component_variant) ? "continuous" : "led"}');
    expect(source).toContain('label="Warna badan cap fader"');
    expect(source).toContain('label="Warna garis indikator cap"');
    expect(styles).toContain("--maker-fader-cap-color");
    expect(styles).toContain("--maker-fader-indicator-color");
    expect(styles).toContain(".maker-meter--continuous");
    expect(styles).toContain(".maker-meter--mixer-led-ladder");
  });

  test("integrates configurable live metering into every fader", () => {
    expect(source).toContain("function FaderMeterLayout");
    expect(source).toContain("Metering di samping fader");
    expect(source).toContain("Posisi metering");
    expect(source).toContain("Jarak fader ke metering");
    expect(source).toContain("Lebar metering");
    expect(source).toContain("Tinggi metering");
    expect(source).toContain("Warna metering bergerak");
    expect(styles).toContain(".maker-fader-meter-layout");
    expect(styles).toContain("--maker-fader-meter-gap");
    expect(styles).toContain("--maker-fader-meter-color");
    expect(styles).toContain("--maker-fader-meter-width");
    expect(styles).toContain("--maker-fader-meter-height");
    expect(visualRenderSource).toContain("faderMeterEnabled: c.fader_meter_enabled !== false");
    expect(visualRenderSource).toContain("faderMeterWidth: c.fader_meter_width");
    expect(visualRenderSource).toContain("faderMeterHeight: c.fader_meter_height");
  });

  test("offers adjustable open-ring knob and bipolar pan variants", () => {
    expect(source).toContain('{ id: "open-led-ring", category: "knob", kind: "knob"');
    expect(source).toContain('{ id: "pan-open-led-ring", category: "pan", kind: "knob"');
    expect(source).toContain("function OpenRingKnobVisual");
    expect(source).toContain("Ketebalan ring");
    expect(source).toContain('max="16" step="0.5"');
    expect(source).toContain('label="Warna nyala ring"');
    expect(source).toContain("ring_thickness: normalizeOpenRingThickness");
    expect(source).toContain("pan && segmentLength > 0");
    expect(visualRenderSource).toContain("ringThickness: c.ring_thickness");
    expect(source).toContain("isOpenRingKnobVariant(control.component_variant)");
    expect(styles).toContain(".maker-knob--open-led-ring");
    expect(styles).toContain(".maker-knob--pan-open-led-ring");
    expect(styles).toContain("stroke-linecap: round");
  });

  test("offers a plate-free mechanical toggle in the button gallery", () => {
    expect(source).toContain('{ id: "mechanical-toggle", category: "button", kind: "button"');
    expect(styles).toContain(".maker-button--mechanical-toggle");
    expect(styles).not.toContain("maker-button--mechanical-toggle-red");
    expect(source).toContain('/images/vst-buttons/mechanical-toggle-off-v4.png');
    expect(source).toContain('mechanical-toggle-${active ? "on" : "off"}-v4.png');
    expect(styles).toContain(".maker-mechanical-toggle-image");
    expect(styles).toContain(".maker-panel-button.maker-button--mechanical-toggle.is-on");
    expect(styles).toContain("box-shadow: none !important");
    expect(styles).toMatch(/\.maker-panel-button\.maker-button--mechanical-toggle\s*\{[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/);
    expect(styles).not.toContain(".maker-mechanical-toggle__lever");
    expect(source).toContain("Jarak teks ON/OFF ke toggle");
    expect(source).toContain('"--maker-state-label-gap": normalizeMechanicalStateLabelGap');
    expect(styles).toContain("var(--maker-state-label-gap, 5)");
    expect(styles).toContain("--maker-mechanical-visual-bottom: calc(99.67% - 16.94px)");
    expect(styles).not.toContain("--maker-mechanical-visual-bottom: calc(77.96% - 13.25px)");
    expect(styles).toContain("top: calc(var(--maker-mechanical-visual-bottom) + (var(--maker-state-label-gap, 5) * 1px))");
    expect(styles).toMatch(/\.maker-canvas-control--button \.maker-panel-button\.maker-button--mechanical-toggle\s*\{[\s\S]*?aspect-ratio: 1;[\s\S]*?flex: none;/);
    expect(styles).not.toContain("top: calc(100% + (var(--maker-state-label-gap, 5) * 1px))");
  });

  test("offers a photorealistic PNG stomp footswitch as a frontend preview", () => {
    expect(source).toContain('{ id: "stomp-footswitch", category: "button", kind: "button"');
    expect(source).toContain('stomp-footswitch-${active ? "on" : "off"}-v1.png');
    expect(source).toContain("hasil VST3 native Windows/macOS");
    expect(styles).toContain(".maker-panel-button.maker-button--stomp-footswitch");
    expect(styles).toContain(".maker-stomp-footswitch-image");
    expect(fs.existsSync(path.join(__dirname, "../../public/images/vst-buttons/stomp-footswitch-off-v1.png"))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, "../../public/images/vst-buttons/stomp-footswitch-on-v1.png"))).toBe(true);
  });

  test("persists the mechanical status gap separately from generic label offsets", () => {
    expect(source).toContain("state_label_gap: normalizeMechanicalStateLabelGap");
    expect(source).toContain("label_y: Number(labelY ?? legacyLabelY ?? 0)");
    expect(visualRenderSource).toContain("stateLabelGap: c.state_label_gap");
    expect(source).not.toContain("labelY: stateLabelGap - DEFAULT_MECHANICAL_STATE_LABEL_GAP");
  });

  test("keeps hidden Plugin Basic as the source for Project baru", () => {
    expect(source).toContain('const basicTemplateId = pluginKind === "effect" ? "basicfx" : "basicvst";');
    expect(source).toContain("applyProjectTemplate(basicTemplateId, { includeHidden: true, showToast: false })");
    expect(source).toContain("publishedTemplates.find((option) => option.id === templateId)");
    expect(source).toContain("!BASIC_PROJECT_TEMPLATE_IDS.has(template.id) && !templateSettings[template.id]?.hidden");
    expect(source).toContain('const basicTemplateId = pluginKind === "effect" ? "basicfx" : "basicvst";');
  });

  test("keeps the newest custom thumbnail while updating template contents", () => {
    expect(source).toContain("templateSettings[template.id]?.thumbnail_url || template.customThumbnail");
    expect(source).toContain("currentThumbnail?.customThumbnail");
    expect(source).toContain("thumbnailUrl: currentThumbnail.thumbnailUrl");
  });

  test("keeps stable template baselines without per-template pricing", () => {
    expect(source).toContain("createVstTemplateBaseline");
    expect(source).toContain('template.id === "basicvst"');
    expect(source).toContain('template.id === "basicfx"');
    expect(source).not.toContain("galleryBuildSettings");
    expect(source).not.toContain("templateStartingCredits");
    expect(source).not.toContain("Harga pilihan Project baru");
  });

  test("updates VST Basic and Plugin Basic through stable dedicated template ids", () => {
    expect(source).toContain('const BASIC_PROJECT_TEMPLATE_IDS = new Set(["basicvst", "basicfx"]);');
    expect(source).toContain('const basicTemplateId = pluginKind === "effect" ? "basicfx" : "basicvst";');
    expect(source).toContain("setAppliedTemplateId(template.id);");
    expect(source).toContain('/admin/vst-maker/templates/${encodeURIComponent(appliedTemplateId)}/projects/${encodeURIComponent(saved.id)}');
  });

  test("creates a brand-new template draft without an overwrite target", () => {
    expect(source).toContain("const startNewTemplateDraft = (pluginKind) => {");
    expect(source).toContain("setAppliedTemplateId(null);");
    expect(source).toContain('onClick={() => startNewTemplateDraft("instrument")}');
    expect(source).toContain('onClick={() => startNewTemplateDraft("effect")}');
    expect(source).toContain("Save to template akan membuat template baru");
  });

  test("does not show the red ADMIN badge on template cards", () => {
    expect(source).not.toContain('maker-project-template__admin-badge">ADMIN');
    expect(styles).not.toContain(".maker-project-template__admin-badge");
  });

  test("places the circular readiness indicator below FX & Processor and matches the build progress palette at 100 percent", () => {
    const soundTabIndex = source.indexOf('tab.id === "sound"');
    const readinessIndex = source.indexOf('className={`maker-readiness-card');
    expect(soundTabIndex).toBeGreaterThan(-1);
    expect(readinessIndex).toBeGreaterThan(soundTabIndex);
    expect(source).toContain('aria-label={`Kesiapan build ${readinessPercent}%`}');
    expect(styles).toContain(".maker-readiness-ring");
    expect(styles).toMatch(/\.maker-readiness-card\.is-ready \.maker-readiness-ring\s*\{[^}]*#0284c7[^}]*#38bdf8[^}]*#7dd3fc[^}]*box-shadow:/s);
    expect(styles).toMatch(/\.maker-readiness-list > button\s*\{[^}]*font-size:\s*0\.64rem;/s);
    expect(styles).toMatch(/\.maker-latest-download\s*\{[^}]*z-index:\s*220;[^}]*isolation:\s*isolate;/s);
  });

  test("derives queued build labels from the selected worker platform", () => {
    expect(source).toContain('const buildPlatformLabel = (build) => build?.target_platform === "macos" ? "macOS" : "Windows";');
    expect(source).toContain('`Menunggu worker ${buildPlatformLabel(build)}`');
    expect(source).toContain('Eksport VST {buildPlatformLabel(latestBuild)} terakhir');
    expect(source).not.toContain('queued: "Menunggu worker Windows"');
  });

  test("keeps the Designer heading and export actions below the fixed site navbar", () => {
    expect(source).toContain('<div className="maker-designer-heading-row" style={{ zIndex: 40 }}>');
    expect(styles).toMatch(/\.maker-designer-heading-row\s*\{[^}]*z-index:\s*40;/s);
  });

  test("keeps separate latest-ready downloads for Windows and macOS", () => {
    expect(source).toContain('const latestReadyWindowsBuild = buildJobs.find((job) => job.status === "ready" && job.target_platform !== "macos") || null;');
    expect(source).toContain('const latestReadyMacBuild = buildJobs.find((job) => job.status === "ready" && job.target_platform === "macos") || null;');
    expect(source).toContain('{ platform: "windows", label: "Windows", build: latestReadyWindowsBuild }');
    expect(source).toContain('{ platform: "macos", label: "macOS", build: latestReadyMacBuild }');
    expect(source).toContain('<span>Unduh build terakhir</span>');
    expect(source).toContain('<strong>Unduh {item.label} terakhir</strong>');
    expect(source).toContain('role="menu" aria-label="Pilih build terakhir untuk diunduh"');
    expect(source).not.toContain('Unduh build selesai terakhir');
  });

  test("saves the newest mapping and WAV snapshot on repeated project saves", () => {
    expect(source).toContain("const currentProject = projectRef.current;");
    expect(source).toContain("const currentSamples = samplesRef.current;");
    expect(source).toContain("commitMappings(latestMappingsRef.current.map");
    expect(source).toContain("samplesRef.current = nextSamples;");
  });

  test("offers one icon-only free or constant resize toggle beside grid snap", () => {
    expect(source).toContain('resizeAspectLocked = true');
    expect(source).toContain('className={`maker-resize-mode-toggle ${resizeAspectLocked ? "is-locked" : "is-free"}`}');
    expect(source).toContain("preserveAspectRatio: resizeAspectLocked");
    expect(source).toContain("resize_aspect_locked: project.resizeAspectLocked !== false");
    expect(styles).toContain(".maker-resize-mode-toggle");
  });

  test("places compact Undo and Redo beside Grid Snap without obsolete canvas hints", () => {
    const snapIndex = source.indexOf('className="maker-grid-snap-compact"');
    const historyIndex = source.indexOf('aria-label="Riwayat perubahan Designer"');
    const resizeIndex = source.indexOf('className={`maker-resize-mode-toggle');

    expect(snapIndex).toBeGreaterThan(-1);
    expect(historyIndex).toBeGreaterThan(snapIndex);
    expect(resizeIndex).toBeGreaterThan(historyIndex);
    expect(source).not.toContain("Ctrl/Cmd + D untuk duplikat pilihan");
    expect(source).not.toContain("tarik gambar untuk memindahkan");
    expect(source).not.toContain("tarik sudut kanan bawah untuk resize");
    expect(source).not.toContain(">Reset ukuran</button>");
    expect(source).not.toContain("Pilih kontrol di preview untuk mengubahnya.");
  });

  test("offers persistent rotation for every canvas component", () => {
    expect(source).toContain("const normalizeComponentRotation");
    expect(source).toContain('<FieldLabel>Rotasi komponen</FieldLabel>');
    expect(source).toContain('"--maker-component-rotation": `${normalizeComponentRotation(control.rotation)}deg`');
    expect(styles).toContain("rotate(var(--maker-component-rotation))");
  });

  test("renders hit pads as a short flash instead of following a held note", () => {
    expect(source).toContain("flashTimerRef.current = window.setTimeout(() => {");
    expect(source).toContain("flashFrameRef.current = window.requestAnimationFrame(showFlash);");
    expect(source).toContain("if (externalTrigger === observedExternalTriggerRef.current) return;");
    expect(source).not.toContain("externalPressed || externalTrigger > 0");
    expect(source).toContain("hitPad ? (visualRenderHoldsFrame ? externalPressed : flashActive)");
    expect(styles).toContain("transition: opacity 45ms ease-out, filter 70ms ease-out");
  });

  test("applies analyzer color to moving spectrum and exposes a drag grip without embedded sliders", () => {
    expect(source).toContain("hexColorWithAlpha(analyzerColor, 0.5)");
    expect(source).toContain('"--spectrum-color": isHexColor(accentColor)');
    expect(styles).toContain(".maker-canvas-control--spectrum > .maker-canvas-control__handle");
    expect(styles).toContain("var(--spectrum-color, #22d3ee) 28%");
    expect(styles).not.toContain('.maker-prism-spectrum__band-panel input[type="range"]');
  });

  test("offers pure FFT and stereo vectorscope as separate live analyzer components", () => {
    expect(source).toContain('id: "pure-spectrum"');
    expect(source).toContain('id: "stereo-vectorscope"');
    expect(source).toContain("<StereoVectorscopeDisplay");
    expect(source).toContain('interactive={control.component_variant !== "pure-spectrum"}');
    expect(styles).toContain(".maker-gallery-vectorscope");
  });

  test("offers a colorable realtime waveform in Spectrum and a linkable plain round LED", () => {
    expect(source).toContain('id: "realtime-waveform"');
    expect(source).toContain("<RealtimeWaveformDisplay");
    expect(source).toContain("getFloatTimeDomainData");
    expect(source).toContain("Ketebalan garis Realtime Waveform");
    expect(source).toContain("waveformLineWidth");
    expect(visualRenderSource).toContain("waveformLineWidth: c.waveform_line_width");
    expect(source).toContain("Math.min(8, Number(control.waveformLineWidth");
    expect(source).toContain('id: "round-indicator"');
    expect(source).toContain("indicator_source_id");
    expect(source).toContain("indicatorActiveFor");
    expect(styles).toContain(".maker-round-led-indicator.is-on");
    expect(styles).toContain(".maker-gallery-waveform");
    expect(styles).toMatch(/\.maker-canvas-control--indicator\s*\{[^}]*min-width:\s*12px;[^}]*min-height:\s*12px;/s);
  });

  test("persists adjustable Bar Spectrum thickness through preview and visual capture", () => {
    expect(source).toContain("Ketebalan batang Bar Spectrum");
    expect(source).toContain("barWidthRatio");
    expect(source).toContain("bar_width_ratio");
    expect(visualRenderSource).toContain("barWidthRatio: c.bar_width_ratio");
    expect(source).toContain("slot * Math.max(0.1");
    expect(source).toContain("const barWidthPixels = Math.max(1, Math.round(requestedBarWidth * ratio))");
    expect(source).toContain("const x = Math.round(centerPixel - (barWidthPixels / 2)) / ratio");
  });

  test("formats Tuning and Fine Tune knob readouts in musical units", () => {
    expect(source).toContain("tuningKnobValueText");
    expect(source).toContain('["tuning", "fine_tune"]');
    expect(source).toContain("formatDspParameterValue(definition");
    expect(visualRenderSource).toContain("moduleId: c.module_id");
    expect(visualRenderSource).toContain("engineModules={spec.engine_modules || []}");
  });

  test("offers relative chord scale for held-key live patterns", () => {
    expect(source).toContain('liveWavePatternConfig.scale === "relative"');
    expect(source).toContain("triggerPitches: heldNotes.map");
    expect(source).toContain("Scale Relative aktif");
  });

  test("offers a symmetric real-time bar spectrum as a frontend preview", () => {
    expect(source).toContain('id: "bar-spectrum-visualizer"');
    expect(source).toContain("function BarSpectrumVisualizer");
    expect(source).toContain("<BarSpectrumVisualizer");
    expect(source).toContain("analyser.fftSize = 2048");
    expect(source).toContain("analyser.smoothingTimeConstant = 0");
    expect(source).toContain("getFloatFrequencyData");
    expect(source).toContain("const barCount = 48");
    expect(source).toContain("power += 10 ** (db / 10)");
    expect(source).toContain("peakDb - 8");
    expect(source).toContain("4.5 * Math.log2(centerFrequency / 1000)");
    expect(source).toContain("measuredDb <= -99 ? 0");
    expect(source).toContain("Math.exp(-elapsedSeconds / timeConstant)");
    expect(source).toContain("(height - barHeight) / 2");
    expect(source).toContain("aktif pada preview browser dan hasil VST3 native");
    expect(styles).toContain(".maker-gallery-bar-spectrum");
    expect(styles).toContain(".maker-prism-spectrum.maker-bar-spectrum-visualizer");
  });

  test("binds interactive Spectrum Analyzer bands directly to the standalone Prism DSP", () => {
    expect(source).toContain('types: ["prism_eq", "parametric_eq"]');
    expect(source).toContain('current.engineModules.find((module) => module.type === "prism_eq")');
    expect(source).toContain('prismModule={engineModules.find((module) => module.id === control.moduleId');
    expect(source).toContain('onParameterChange?.(`band_${band.index}_q`, nextSlider / 1000)');
    expect(source).toContain('[`band_${band.index}_enabled`]: 1');
    expect(source).toContain('onParameterChange?.(`band_${selectedBandControl.index}_enabled`, 0)');
  });

  test("keeps one persisted contextual Prism control group with a reversible direct mode", () => {
    expect(source).toContain('const PRISM_CONTEXT_PARAMETERS = new Set(["prism_frequency", "prism_gain", "prism_q"]);');
    expect(source).toContain('prismControlMode: mode');
    expect(source).toContain('<option value="contextual">Contextual · 3 knob bersama</option>');
    expect(source).toContain('<option value="direct">Direct · node analyzer saja</option>');
    expect(source).toContain('prismContextModeFor(control) !== "contextual" ? "is-prism-context-hidden"');
    expect(source).toContain('const parameter = `band_${selectedPrismBandIndex}_${context}`;');
    expect(source).toContain('createTemplateControls("prismeq", 49, "direct")');
    expect(styles).toContain('.maker-canvas-control.is-prism-context-hidden');
    expect(templateSource).toContain('/images/vst-assets/prism-spectrum-eq-panel-v2.png');
    expect(templateSource).not.toContain('6 tonal macro');
  });

  test("keeps legacy components for effects while hiding sampler-only output routing", () => {
    expect(source).toContain("const availableComponentCategories = COMPONENT_CATEGORIES.filter");
    expect(source).toContain('pluginKind !== "effect" || category.id !== "output"');
    expect(source).toContain("COMPONENT_VARIANTS.filter((variant) => variant.category === componentCategory)");
    expect(source).not.toContain('pluginKind !== "effect" || !["pad", "hit_pad", "keyboard"].includes(category.id)');
    expect(source).not.toContain('pluginKind !== "effect" || !["pad", "keyboard", "solo", "mute"].includes(variant.kind)');
  });

  test("keeps replacement dialogs above every canvas component layer", () => {
    expect(styles).toMatch(/\.maker-component-replace-backdrop\s*\{[^}]*z-index:\s*1000;/s);
  });

  test("colors individual keyboard keys and shares a compact color clipboard", () => {
    expect(source).toContain("function DesignerColorField");
    expect(source).toContain("<ClipboardPaste");
    expect(source).toContain("Warna tuts terpilih");
    expect(source).toContain("Klik langsung satu tuts pada keyboard di canvas");
    expect(source).toContain("onKeySelect={(pitch) =>");
    expect(source).toContain("onKeySelect?.(pitch)");
    expect(source).toContain("const activeKeyboardColorPitch = keyboardColorSelection\n    && keyboardColorSelection.controlId === selectedControl?.id");
    expect(source).toContain('colorSelectedPitch === pitch ? "is-color-selected"');
    expect(source).toContain("normalizeKeyboardKeyColors");
    expect(source).toContain("key_colors: normalizeKeyboardKeyColors");
    expect(source).toContain("keyColors={control.keyColors ?? control.key_colors}");
    expect(source).toContain('"--maker-key-color": customColor');
    expect(styles).toContain(".maker-color-field__actions button");
    expect(styles).toContain(".maker-sampler-key.is-color-selected");
    expect(styles).toContain(".maker-sampler-key.has-custom-color");
  });

  test("keeps MIDI groove playback alive outside the panel with persisted loop controls", () => {
    expect(source).toContain("function useMidiGrooveTransport");
    expect(source).toContain("const midiTransport = useMidiGrooveTransport(midiSequences, onNoteOn, onNoteOff)");
    expect(source).toContain("latest?.loopEnabled === true");
    expect(source).toContain("loop_enabled: loopEnabled === true");
    expect(source).toContain("loopEnabled: loop_enabled === true");
    expect(source).toContain("maker-panel-midi-groove__loop");
    expect(source).not.toContain("useEffect(() => stopMidi, [])");
    expect(source).not.toContain("if (playingSequenceId) stopMidi();");
  });
});
