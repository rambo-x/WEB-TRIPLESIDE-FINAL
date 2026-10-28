import React, { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { InterfaceWorkspace } from "./VstMakerPreview";
import "./VstVisualRender.css";

const noop = () => {};

// No project lookup or credentials: the build process injects its immutable spec.
// Reuse the designer itself, including its layout, typography and control assets.
export default function VstVisualRender() {
  const [spec, setSpec] = useState(null);
  const [frame, setFrame] = useState({});
  useEffect(() => {
    document.body.classList.add("vst-visual-render");
    window.__vstVisual = {
      version: 1,
      setSpec: (value) => flushSync(() => { setSpec(value); setFrame({}); }),
      setFrame: (value) => flushSync(() => setFrame(value)),
    };
    return () => { delete window.__vstVisual; document.body.classList.remove("vst-visual-render"); };
  }, []);
  if (!spec) return null;
  const ui = spec.interface || {}, brand = spec.branding || {}, bg = ui.background || {};
  const controls = (ui.controls || []).map((c) => ({ ...c,
    showBackground: c.show_background, notePitch: c.note_pitch, keyCount: c.key_count, moduleId: c.module_id,
    labelPosition: c.label_position,
    labelGap: c.label_gap,
    stateLabelGap: c.state_label_gap,
    meterMode: c.meter_mode,
    waveformLineWidth: c.waveform_line_width,
    ringThickness: c.ring_thickness ?? (['open-led-ring', 'pan-open-led-ring'].includes(c.component_variant) ? c.waveform_line_width : undefined),
    barWidthRatio: c.bar_width_ratio,
    padColor: c.pad_color, padActiveColor: c.pad_active_color,
    controlColor: c.control_color, textColor: c.text_color,
    outputFontSize: c.output_font_size,
    faderMeterEnabled: c.fader_meter_enabled !== false,
    faderMeterPosition: c.fader_meter_position,
    faderMeterColor: c.fader_meter_color,
    faderMeterGap: c.fader_meter_gap,
    faderMeterWidth: c.fader_meter_width,
    faderMeterHeight: c.fader_meter_height,
    imageUrl: c.image_url, imageName: c.image_name,
    imageFit: c.image_fit, imageOpacity: c.image_opacity,
    parentPanelId: c.parent_panel_id,
    panelType: c.panel_type,
    panelX: c.panel_x, panelY: c.panel_y,
    panelWidth: c.panel_width, panelHeight: c.panel_height,
    mixerShowDefaultControls: c.mixer_show_default_controls !== false,
    indicatorSourceId: c.indicator_source_id,
    midiSequenceId: c.midi_sequence_id,
    value: frame.id === c.id ? frame.value : c.value,
    // Fader atlases keep only the empty meter track. Native draws the live
    // level on top, independently from the fader's parameter frame.
    captureLevel: frame.id === c.id ? (c.kind === "fader" ? 0 : frame.value / 100) : undefined,
  }));
  const pressed = new Set(frame.pitch === undefined ? [] : [frame.pitch]);
  const midiSequences = (spec.midi_sequences || []).map((sequence) => ({
    ...sequence,
    durationTicks: sequence.duration_ticks,
    generatorConfig: sequence.generator_config,
  }));
  const framedControl = controls.find((control) => control.id === frame.id);
  const framedMidiSequenceId = framedControl?.midiSequenceId ?? "";
  const framedMidiSequence = midiSequences.find((sequence) => sequence.id === framedMidiSequenceId);
  const livePatternConfig = framedMidiSequence?.generatorConfig && Number(frame.value) >= 50
    ? { ...framedMidiSequence.generatorConfig, enabled: true, sourceSequenceId: framedMidiSequence.id }
    : null;
  return <InterfaceWorkspace
    visualOpenPanelId={frame.panelId ?? null}
    accentColor={ui.accent_color} uiColor={ui.ui_color} pluginName={spec.name} manufacturerName={brand.manufacturer_name}
    pluginVersion={spec.build?.version} pluginKind={spec.plugin_kind} instrumentType="sampler"
    brandTagline={brand.tagline} brandFont={brand.font} brandSize={brand.font_size}
    brandX={brand.x} brandY={brand.y} brandAlign={brand.align} uiTemplate={ui.template}
    projectTemplate={spec.project_template} keyboardKeys={61}
    canvasWidth={ui.canvas_width || 1024} canvasHeight={ui.canvas_height || 460}
    backgroundImageUrl={bg.url} backgroundImageName={bg.name} backgroundFit={bg.fit}
    backgroundOpacity={bg.opacity} backgroundImageX={bg.x} backgroundImageY={bg.y}
    backgroundImageWidth={bg.width} backgroundImageHeight={bg.height}
    componentStyle={ui.component_style} gridSnapEnabled={false} gridSize={8}
    midiPressedPitches={pressed} activeHitPitches={pressed} velocity={100} sustainEnabled={false}
    pitchBendEnabled={spec.instrument?.pitchBendEnabled === true}
    modulationEnabled={spec.instrument?.modulationEnabled === true}
    controls={controls} engineModules={spec.engine_modules || []} selectedControlIds={[]}
    presets={spec.presets || []} midiSequences={midiSequences}
    samplerGroups={(spec.sampler_groups || []).map((group) => ({
      ...group,
      outputBus: group.output_bus === "separate" ? "separate" : "master",
    }))} onFeatureChange={noop}
    livePatternConfig={livePatternConfig} onLivePatternConfigChange={noop}
    onKeyboardKeysChange={noop} onCanvasChange={noop}
    onNoteOn={noop} onNoteOff={noop} onAdd={noop} onSelect={noop} onUpdate={noop}
    onUpdateMany={noop} onRemove={noop} onRemoveSelected={noop} onDrop={noop}
  />;
}
