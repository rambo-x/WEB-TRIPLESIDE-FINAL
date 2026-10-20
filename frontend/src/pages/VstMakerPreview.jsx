import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import "./VstMakerPreview.css";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Coins,
  Copy,
  CreditCard,
  Download,
  FileAudio,
  LayoutTemplate,
  Lock,
  Loader2,
  Magnet,
  PackagePlus,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Redo2,
  Undo2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { controlsOnSameInteractionSurface, moveSelectedCanvasControls, offsetCanvasControlGroupWithinBounds, panelContentClientBounds, removeSelectedCanvasControls, resizeCanvasControlWithinBounds, shouldRemoveSelectedCanvasControls } from "../lib/vstMakerLayout";
import { hasPresetName, normalizePresetName } from "../lib/vstMakerPanel";
import {
  collapseMappingsToRoot,
  filenameRootPitch,
  fullChromaticPitchRange,
  normalizeChokeTargetPitches,
  oneKeyMappingPitches,
  planSampleFileDrop,
  scaleSourceBpm,
  stackMappingsAsVelocityLayers,
  velocityLayerRange,
} from "../lib/vstMakerMapping";
import { createTempoStretchPreviewVoice } from "../lib/signalsmithStretchPreview";
import { DSP_RACK_MODULE_OPTIONS, INTERNAL_DSP_MACRO_BINDINGS, appendDspRackModule, controlsShareDspBinding, createAmpSimulatorRack, createAmpSimulatorTemplateState, createHighGainAmpTemplateState, dspBindingValue, dspRackOption, formatDspParameterValue, isLegacyHighGainAmpRack, moveDspRackModule, normalizeDspRack, removeDspRackModule, serializeDspRack, syncControlsFromDspBinding, syncDspRackFromControl } from "../lib/vstMakerDspRack";
import { createDspPreviewPlan } from "../lib/vstMakerDspPreview";
import { createNativeDspWorkletNode, installNativeDspWorklet } from "../lib/vstDspProcessor";
import { samplerAttackMilliseconds, samplerReleaseMilliseconds } from "../lib/vstSamplerPreview";
import { decodeAndPreprocessImpulse, normalizeImpulseSettings } from "../lib/vstCabinetImpulse";
import { parseMidiFile } from "../lib/vstMidiFile";
import { MIDI_LOOKAHEAD_MS, MIDI_SCHEDULER_INTERVAL_MS, MIDI_START_DELAY_MS, buildMidiPlaybackTimeline } from "../lib/vstMidiScheduler";
import { DEFAULT_VST_PRICING, componentCreditPrice, createVstTemplatePricingBaseline, formatCredits, isCustomVstBackground, normalizeVstPricing, quoteVstProjectCredits } from "../lib/vstMakerPricing";
import { NEON_POP_DRUM_HITS, PREMIUM_PIANO_BACKGROUND_URL, REGENT_DEFAULT_CONTROLS, REGENT_WHITE_DEFAULT_CONTROLS, VST_PROJECT_TEMPLATES } from "../data/vstTemplates";
import { DEFAULT_VST_FILMSTRIP_SKIN, VST_KNOB_ASSETS, filmstripFrameStyle } from "../data/vstFilmstripSkins";
import VstMiniKeyboard from "../components/vst/VstMiniKeyboard";
export { InterfaceWorkspace };

const WindowsIcon = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M3 5.2 10.6 4v7.3H3V5.2Zm8.7-1.4L21 2.4v8.9h-9.3V3.8ZM3 12.7h7.6V20L3 18.8v-6.1Zm8.7 0H21v8.9l-9.3-1.4v-7.5Z" />
  </svg>
);

const MacIcon = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M16.7 12.9c0-2.8 2.3-4.2 2.4-4.3-1.3-1.9-3.4-2.2-4.1-2.2-1.8-.2-3.4 1-4.3 1s-2.2-1-3.7-1C5.1 6.5 3.3 7.6 2.3 9.3c-2 3.5-.5 8.7 1.4 11.6.9 1.4 2.1 3 3.6 2.9 1.4-.1 2-1 3.7-1s2.2 1 3.7 1c1.5 0 2.5-1.4 3.5-2.8 1.1-1.6 1.6-3.2 1.6-3.3-.1 0-3.1-1.2-3.1-4.8ZM13.8 4.6c.8-1 1.4-2.5 1.2-4-1.2.1-2.7.8-3.6 1.9-.8.9-1.5 2.4-1.3 3.8 1.4.1 2.8-.7 3.7-1.7Z" />
  </svg>
);

const DRAFT_STORAGE_KEY = "tripleside_admin_vst_maker_draft_v1";
const SAMPLE_STORAGE_KEY = "tripleside_admin_vst_maker_samples_v1";
const AMP_STACK_BACKGROUND_URL = "/images/vst-assets/original-cream-amp-stack-v2.png";
const LEGACY_AMP_BACKGROUND_URL = "/images/vst-assets/original-cream-amp-panel-v1.png";
const AMP_STACK_FIRST_ROW_LABELS = new Set(["Input", "Gate", "Release", "OD Drive", "OD Tone", "OD Level", "Amp Gain", "Master", "Output"]);
const AMP_STACK_SECOND_ROW_LABELS = new Set(["Bass", "Mid", "Treble", "Presence", "Cabinet", "Mic", "Resonance", "Cab Level"]);
const MAX_SAMPLE_BYTES = 512 * 1024 * 1024;
const MAX_IMPULSE_RESPONSE_BYTES = 32 * 1024 * 1024;
const STANDARD_DSP_MODULE_TYPES = ["input_trim", "soft_clip", "linked_compressor", "de_esser", "prism_eq", "parametric_eq", "multiband_compressor", "tone_shaper", "stereo_width", "cross_delay", "dry_wet", "output_trim"];
const DSP_MODULE_LIBRARY_GROUPS = [
  { id: "instrument", label: "Instrument Pitch", detail: "Tuning global untuk sampler dan synthesizer", types: ["tuning"] },
  { id: "amp", label: "Amp & Cabinet", detail: "Model amplifier, drive, gate, dan cabinet", types: ["dual_high_gain", "silk_bloom", "amp_model", "amp_overdrive", "noise_gate", "cabinet_ir"] },
  { id: "studio", label: "Studio Processor", detail: "Gain, dynamics, tone, stereo, dan output", types: ["input_trim", "soft_clip", "linked_compressor", "de_esser", "multiband_compressor", "tone_shaper", "stereo_width", "dry_wet", "output_trim"] },
  { id: "eq", label: "EQ & Filter", detail: "Spectrum EQ dan Parametric EQ dengan frequency, gain, dan Q", types: ["prism_eq", "parametric_eq"] },
  { id: "creative", label: "Modulation & Space", detail: "Delay, modulation, dan ambience", types: ["cross_delay", "chorus", "flanger", "tremolo", "vibrato", "digital_delay", "reverb", "shimmer"] },
];
const dspGlobalTuningSemitones = (modules = []) => {
  const module = modules.find((item) => item.type === "tuning" && !item.bypassed);
  if (!module) return 0;
  const tuning = Math.round(Math.max(0, Math.min(1, Number(module.parameters?.tuning ?? 0.5))) * 48) - 24;
  const fineTune = Math.max(0, Math.min(1, Number(module.parameters?.fine_tune ?? 0.5))) * 200 - 100;
  return tuning + fineTune / 100;
};
const isPostSourceDspModule = (module) => !["wave_generator", "tuning"].includes(module?.type);
const MAX_INTERFACE_CONTROLS = 96;
const PREMIUM_PIANO_CANVAS_WIDTH = 1024;
const PREMIUM_PIANO_CANVAS_HEIGHT = 640;
const DESIGNER_HISTORY_LIMIT = 50;
const DESIGNER_HISTORY_MERGE_MS = 400;
const DEFAULT_VST_BUILD_SETTINGS = {
  customer_license_enabled: true,
  show_no_serial_option: true,
  license_max_activations: 2,
};
const DESIGNER_HISTORY_KEYS = [
  "name", "manufacturerName", "pluginVersion", "instrumentType", "keyboardKeys",
  "uiTemplate", "uiColor", "accentColor", "brandTagline", "brandFont", "brandSize", "brandX", "brandY", "brandAlign",
  "canvasWidth", "canvasHeight", "backgroundImageUrl", "backgroundImageName", "backgroundFit", "backgroundOpacity",
  "backgroundImageX", "backgroundImageY", "backgroundImageWidth", "backgroundImageHeight",
  "componentStyle", "gridSnapEnabled", "gridSize", "resizeAspectLocked", "interfaceControls", "samplerGroups", "engineModules",
  "impulseResponses", "presets", "midiSequences",
  "pitchBendEnabled", "modulationEnabled",
];

const migrateAmpStackControls = (controls) => (Array.isArray(controls) ? controls : []).map((control) => {
  if (control.label === "Bypass" && !control.moduleId) return { ...control, x: 7, y: 27, width: 58, height: 62 };
  if (control.moduleId && AMP_STACK_FIRST_ROW_LABELS.has(control.label)) return { ...control, y: 16, width: 60, height: 64 };
  if (control.moduleId && AMP_STACK_SECOND_ROW_LABELS.has(control.label)) return { ...control, y: 27, width: 60, height: 64 };
  return control;
});

const captureDesignerSnapshot = (project) => Object.fromEntries(DESIGNER_HISTORY_KEYS.map((key) => (
  [key, Array.isArray(project[key]) ? project[key].map((item) => ({ ...item })) : project[key]]
)));

const designerSnapshotsMatch = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const CONTROL_OPTIONS = [
  { id: "input", label: "Input", description: "Gain sebelum processor" },
  { id: "drive", label: "Drive", description: "Saturasi harmonik" },
  { id: "compress", label: "Compress", description: "Kepadatan dynamics stereo" },
  { id: "volume", label: "Volume", description: "Level output instrumen" },
  { id: "tone", label: "Tone", description: "Warna dan kecerahan" },
  { id: "width", label: "Width", description: "Lebar stereo" },
  { id: "attack", label: "Attack", description: "Kecepatan awal suara" },
  { id: "release", label: "Release", description: "Panjang ekor suara" },
  { id: "space", label: "Space", description: "Reverb dan ruang" },
  { id: "mix", label: "Mix", description: "Dry/wet processor" },
  { id: "output", label: "Output", description: "Gain keluaran effect" },
  { id: "pan", label: "Pan L–R", description: "Posisi stereo keluaran plugin" },
  { id: "bypass", label: "Bypass", description: "Lewati seluruh DSP" },
  { id: "solo", label: "Solo", description: "Paksa output instrumen aktif" },
  { id: "mute", label: "Mute", description: "Bisukan output instrumen" },
  { id: "output_level", label: "Output level", description: "Meter level keluaran" },
];

const INTERFACE_CONTROL_OPTIONS = [
  { id: "button", label: "Button", description: "Tombol on/off" },
  { id: "knob", label: "Knob", description: "Kontrol putar" },
  { id: "fader", label: "Fader", description: "Kontrol geser" },
  { id: "pad", label: "Pad", description: "Pad trigger sample" },
  { id: "keyboard", label: "Piano keys", description: "Tuts piano interaktif" },
  { id: "pitch_bend", label: "Pitch Bend", description: "Bend nada dua arah" },
  { id: "modulation", label: "Modulation", description: "Kontrol vibrato MIDI" },
  { id: "solo", label: "Solo", description: "Tombol solo-safe output" },
  { id: "mute", label: "Mute", description: "Tombol bisukan output" },
  { id: "gain_meter", label: "Gain meter", description: "Peak meter stereo" },
  { id: "vu_meter", label: "VU meter", description: "Meter RMS analog" },
  { id: "visual", label: "Visual", description: "Dekorasi panel statis" },
  { id: "spectrum", label: "Spectrum Analyzer", description: "FFT keluaran audio secara real-time" },
  { id: "text", label: "Text", description: "Teks statis yang dapat ditempatkan di panel" },
  { id: "image", label: "Gambar", description: "Artwork yang dapat dipindah dan diubah ukurannya" },
  { id: "panel_button", label: "Panel Button", description: "Membuka panel fungsi yang dapat dipindah dan di-resize" },
];

const LABEL_POSITION_OPTIONS = [
  { id: "top-left", label: "Kiri atas" },
  { id: "top-center", label: "Tengah atas" },
  { id: "top-right", label: "Kanan atas" },
  { id: "bottom-left", label: "Kiri bawah" },
  { id: "bottom-center", label: "Tengah bawah" },
  { id: "bottom-right", label: "Kanan bawah" },
];
const LABEL_POSITIONS = new Set(LABEL_POSITION_OPTIONS.map((option) => option.id));
const normalizeLabelPosition = (value) => {
  const normalized = String(value || "");
  return LABEL_POSITIONS.has(normalized) ? normalized : "top-left";
};
const defaultLabelPosition = () => "top-left";
const DEFAULT_LABEL_GAP = 12;
const normalizeLabelGap = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(24, Math.round(numeric))) : DEFAULT_LABEL_GAP;
};
const normalizeComponentRotation = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const clamped = Math.max(-180, Math.min(180, numeric));
  return Object.is(clamped, -0) ? 0 : Math.round(clamped * 10) / 10;
};
const rotatedControlSize = (width, height, rotation) => {
  const radians = normalizeComponentRotation(rotation) * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: width * cosine + height * sine,
    height: width * sine + height * cosine,
  };
};

const controlLabelOrFallback = (control, index = 0) => {
  const currentLabel = String(control?.label || "").trim();
  if (currentLabel) return currentLabel.slice(0, control?.kind === "text" ? 80 : 24);
  const parameterLabel = CONTROL_OPTIONS.find((option) => option.id === control?.parameter)?.label;
  const kindLabel = INTERFACE_CONTROL_OPTIONS.find((option) => option.id === control?.kind)?.label;
  return String(parameterLabel || kindLabel || `Control ${index + 1}`).slice(0, control?.kind === "text" ? 80 : 24);
};

const controlsWithDefaultLabels = (controls = []) => controls.map((control, index) => ({
  ...control,
  label: controlLabelOrFallback(control, index),
}));

const waveGeneratorVelocityGain = (velocity, parameters = {}) => {
  const unit = (key, fallback) => Math.max(0, Math.min(1, Number(parameters[key] ?? fallback)));
  const normalized = Math.max(1, Math.min(127, Number(velocity) || 1)) / 127;
  const curve = unit("velocity_curve", 1);
  const curved = curve < 0.25 ? Math.sqrt(normalized) : curve < 0.75 ? normalized : normalized ** 2;
  const minimum = unit("velocity_min_level", 0);
  const sensitivity = unit("velocity_sensitivity", 1);
  const ranged = minimum + (1 - minimum) * curved;
  return 1 - sensitivity * (1 - ranged);
};

const EDITOR_TABS = [
  { id: "templates", label: "Plugin & VST Template", detail: "Pilih fondasi project" },
  { id: "interface", label: "Plugin & VST Designer", detail: "Tampilan & layout" },
  { id: "sampler", label: "Mapping", detail: "Project, sample & zone" },
  { id: "sound", label: "FX & Processor", detail: "Efek, modul & macro" },
  { id: "settings", label: "Settings", detail: "Build & lisensi" },
];

const ACTIVE_BUILD_STATUSES = ["queued", "preparing", "building", "validating", "retrying"];
const BUILD_STATUS_LABELS = {
  preparing: "Menyiapkan project",
  building: "Kompilasi sedang berjalan",
  validating: "Memvalidasi VST3",
  ready: "Build berhasil",
  failed: "Build gagal",
  canceled: "Build dibatalkan",
};
const buildPlatformLabel = (build) => build?.target_platform === "macos" ? "macOS" : "Windows";
const buildStatusLabel = (build) => ["queued", "retrying"].includes(build?.status)
  ? `Menunggu worker ${buildPlatformLabel(build)}`
  : BUILD_STATUS_LABELS[build?.status] || build?.status;
const BUILD_STAGES = [
  { id: "queued", label: "Antrean", detail: "Menunggu worker" },
  { id: "preparing", label: "Persiapan", detail: "Mengambil sample" },
  { id: "building", label: "Kompilasi", detail: "Membuat VST3" },
  { id: "validating", label: "Validasi", detail: "Memeriksa plugin" },
  { id: "ready", label: "Selesai", detail: "Siap diunduh" },
];

const buildStageIndex = (build) => {
  const knownIndex = BUILD_STAGES.findIndex((stage) => stage.id === build?.status);
  if (knownIndex >= 0) return knownIndex;
  const progress = Number(build?.progress) || 0;
  if (progress >= 92) return 3;
  if (progress >= 25) return 2;
  if (progress > 2) return 1;
  return 0;
};

const UI_TEMPLATE_OPTIONS = [
  { id: "mixforge", color: "#1f1712" },
  { id: "studio", color: "#09090b" },
  { id: "vintage", color: "#1b140e" },
  { id: "arctic", color: "#0b1624" },
  { id: "aurum", color: "#11100e" },
];
const defaultUiColor = (templateId) => UI_TEMPLATE_OPTIONS.find((option) => option.id === templateId)?.color || "#09090b";

const BRAND_FONT_OPTIONS = [
  { id: "outfit", name: "Outfit", family: "Outfit, sans-serif", mood: "Modern · Studio Noir" },
  { id: "manrope", name: "Manrope", family: "Manrope, sans-serif", mood: "Clean · Minimal" },
  { id: "space-grotesk", name: "Space Grotesk", family: "'Space Grotesk', sans-serif", mood: "Tech · Arctic Glass" },
  { id: "cinzel", name: "Cinzel", family: "Cinzel, serif", mood: "Cinematic · Orchestra" },
  { id: "cormorant-garamond", name: "Cormorant Garamond", family: "'Cormorant Garamond', serif", mood: "Luxury · Aurum" },
];

const BRAND_POSITION_PRESETS = [
  { id: "top-left", label: "Kiri atas", x: 18, y: 13, align: "left" },
  { id: "top-center", label: "Tengah atas", x: 50, y: 13, align: "center" },
  { id: "top-right", label: "Kanan atas", x: 82, y: 13, align: "right" },
  { id: "center", label: "Tengah", x: 50, y: 45, align: "center" },
];

const PROJECT_TEMPLATE_OPTIONS = VST_PROJECT_TEMPLATES;
const BACKGROUND_TEMPLATE_OPTIONS = VST_PROJECT_TEMPLATES.filter((template) => Boolean(template.backgroundUrl));
const projectTemplatesForCategory = (category, templates = PROJECT_TEMPLATE_OPTIONS) => {
  const vstTemplates = templates.filter((template) => template.pluginKind !== "effect");
  const ampTemplates = templates.filter((template) => template.templateCategory === "amp");
  const pluginTemplates = templates.filter((template) => template.pluginKind === "effect" && template.templateCategory !== "amp");
  if (category === "vst") return vstTemplates;
  if (category === "plugin") return pluginTemplates;
  if (category === "amp") return ampTemplates;
  return [...vstTemplates, ...pluginTemplates, ...ampTemplates];
};
const EFFECT_PROJECT_TEMPLATE_IDS = new Set(["basicfx", "ampsimulator", "obsidianhighgain", "regentstrip", "regentwhite", "mixforge", "vintageeq", "velofet", "azureeq", "prismeq", "modernreverb", "moderndelay", "modernsaturation"]);
const BASIC_PROJECT_TEMPLATE_IDS = new Set(["basicvst", "basicfx"]);
const PREMIUM_PROJECT_TEMPLATE_IDS = new Set(["regentstrip", "regentwhite", "mixforge", "vintageeq", "velofet", "azureeq", "prismeq", "modernreverb", "moderndelay", "modernsaturation", "premiumkeys", "analogsynth", "hybriddrums", "cinematicstrings", "electricbass"]);
const DRUM_PROJECT_TEMPLATE_IDS = new Set(["neonpopdrums", "hybriddrums", "drumpad", "performancegrid"]);
const PRISM_EQ_BANDS = {
  tone: { label: "Low Cut", frequency: 50, q: 0.707 },
  drive: { label: "Low Body", frequency: 120, q: 0.7 },
  compress: { label: "Mid Focus", frequency: 900, q: 0.85 },
  width: { label: "Presence", frequency: 3600, q: 0.9 },
  space: { label: "Air", frequency: 9000, q: 0.7 },
};
const PRISM_CONTEXT_PARAMETERS = new Set(["prism_frequency", "prism_gain", "prism_q"]);
const PRISM_CONTROL_MODES = new Set(["contextual", "direct"]);
const PRISM_CONTEXT_DEFINITIONS = [
  { context: "frequency", parameter: "prism_frequency", label: "Frequency", x: 28 },
  { context: "gain", parameter: "prism_gain", label: "Gain", x: 42 },
  { context: "q", parameter: "prism_q", label: "Q", x: 56 },
];
const ordinaryInterfaceControlCount = (controls = []) => controls.filter((control) => !PRISM_CONTEXT_PARAMETERS.has(control?.parameter)).length;
const PRISM_BAND_SLOTS = Object.entries(PRISM_EQ_BANDS).map(([parameter, defaults], index) => ({
  parameter, index: index + 1, ...defaults,
}));
const prismFrequencyToSlider = (frequency) => Math.round((Math.log(Math.max(10, Math.min(30000, Number(frequency) || 10)) / 10) / Math.log(3000)) * 1000);
const prismSliderToFrequency = (value) => Math.round(10 * (3000 ** (Number(value) / 1000)));
const prismQToSlider = (q) => Math.round((Math.log(Math.max(0.025, Math.min(40, Number(q) || 0.025)) / 0.025) / Math.log(1600)) * 1000);
const prismSliderToQ = (value) => Number((0.025 * (1600 ** (Number(value) / 1000))).toFixed(3));
const formatPrismFrequency = (frequency) => Number(frequency) >= 1000 ? `${(Number(frequency) / 1000).toFixed(Number(frequency) >= 10000 ? 1 : 2).replace(/\.0+$/, "")} kHz` : `${Math.round(Number(frequency))} Hz`;

const KEYBOARD_SIZE_OPTIONS = [25, 37, 49, 61];
const GRID_SIZE_OPTIONS = [4, 8, 16, 24];
const COMPONENT_CATEGORIES = [
  { id: "knob", label: "Knob", kinds: ["knob"] },
  { id: "pan", label: "Knob Pan", kinds: ["knob"] },
  { id: "button", label: "Button", kinds: ["button", "solo", "mute"] },
  { id: "fader", label: "Fader", kinds: ["fader"] },
  { id: "meter", label: "Meter", kinds: ["gain_meter", "vu_meter"] },
  { id: "visual", label: "Visual", kinds: ["visual"] },
  { id: "spectrum", label: "Spectrum", kinds: ["spectrum"] },
  { id: "text", label: "Text", kinds: ["text"] },
  { id: "pad", label: "Pad", kinds: ["pad"] },
  { id: "hit_pad", label: "Hit Pad", kinds: ["pad"] },
  { id: "keyboard", label: "Keyboard", kinds: ["keyboard"] },
  { id: "panel", label: "Panel Button", kinds: ["panel_button"] },
];
const COMPONENT_VARIANTS = [
  { id: "classic", category: "knob", kind: "knob", label: "Classic", detail: "Knob studio sederhana", style: "css" },
  { id: "heritage", category: "knob", kind: "knob", label: "Heritage 3D", detail: "Bakelite dan brass", style: "filmstrip" },
  { id: "pultec", category: "knob", kind: "knob", label: "Tube EQ", detail: "Scalloped Pultec-style", style: "filmstrip" },
  { id: "chicken-head", category: "knob", kind: "knob", label: "Black Chicken Head", detail: "Pointer analog · skala MIN/MAX", style: "css" },
  { id: "chicken-head-clean", category: "knob", kind: "knob", label: "Black Chicken Head Clean", detail: "Tanpa tulisan dan ring skala", style: "css" },
  { id: "orbit-encoder", category: "knob", kind: "knob", label: "Orbit Encoder", detail: "Aluminium · cyan light ring", style: "css" },
  { id: "modern-spectrum", category: "knob", kind: "knob", label: "Modern Spectrum", detail: "Graphite · cyan violet ring", style: "filmstrip" },
  { id: "studio-scallop", category: "knob", kind: "knob", label: "Studio Scallop", detail: "CSS presisi · black hardware", style: "css" },
  { id: "black-precision", category: "knob", kind: "knob", label: "Black Precision", detail: "Brushed metal · red pointer", style: "filmstrip" },
  { id: "crimson-wing", category: "knob", kind: "knob", label: "Crimson Wing", detail: "Bakelite merah · dual wing", style: "filmstrip" },
  { id: "black-crimson-wing", category: "knob", kind: "knob", label: "Black Crimson Wing", detail: "Graphite hitam · dual wing", style: "filmstrip" },
  { id: "regent-white-wing", category: "knob", kind: "knob", label: "Regent White Wing", detail: "Porcelain putih · dual wing · amber marker", style: "filmstrip" },
  { id: "black-dome", category: "knob", kind: "knob", label: "Black Dome", detail: "Graphite dome · indikator oranye", style: "css" },
  { id: "graphite-ridge", category: "knob", kind: "knob", label: "Graphite Ridge", detail: "CSS presisi · bilah diagonal", style: "css" },
  { id: "ivory-lever", category: "knob", kind: "knob", label: "Ivory Lever", detail: "Ivory · tuas aluminium · MIN/MAX", style: "css" },
  { id: "luminous", category: "knob", kind: "knob", label: "Luminous Ring", detail: "Ring menyala mengikuti nilai", style: "css" },
  { id: "regent-cap", category: "knob", kind: "knob", label: "Regent Console", detail: "Machined black cap · amber pointer", style: "css" },
  { id: "regent-white", category: "knob", kind: "knob", label: "Regent White", detail: "Classic white cap · amber pointer", style: "css" },
  { id: "regent-green", category: "knob", kind: "knob", label: "Regent Green", detail: "Emerald EQ cap · white pointer", style: "css" },
  { id: "regent-red", category: "knob", kind: "knob", label: "Regent Red", detail: "Crimson EQ cap · white pointer", style: "css" },
  { id: "regent-blue", category: "knob", kind: "knob", label: "Regent Blue", detail: "Blue EQ cap · white pointer", style: "css" },
  { id: "regent-brown", category: "knob", kind: "knob", label: "Regent Brown", detail: "Brown EQ cap · white pointer", style: "css" },
  { id: "regent-black", category: "knob", kind: "knob", label: "Regent Black", detail: "Black dynamics cap · white pointer", style: "css" },
  { id: "regent-gray", category: "knob", kind: "knob", label: "Regent Gray", detail: "Gray gain cap · white pointer", style: "css" },
  { id: "regent-white-green", category: "knob", kind: "knob", label: "Regent Green · White Binding", detail: "Emerald cap · bright white collar", style: "css" },
  { id: "regent-white-red", category: "knob", kind: "knob", label: "Regent Red · White Binding", detail: "Crimson cap · bright white collar", style: "css" },
  { id: "regent-white-blue", category: "knob", kind: "knob", label: "Regent Blue · White Binding", detail: "Blue cap · bright white collar", style: "css" },
  { id: "regent-white-brown", category: "knob", kind: "knob", label: "Regent Brown · White Binding", detail: "Brown cap · bright white collar", style: "css" },
  { id: "regent-white-black", category: "knob", kind: "knob", label: "Regent Black · White Binding", detail: "Black cap · bright white collar", style: "css" },
  { id: "regent-white-gray", category: "knob", kind: "knob", label: "Regent Gray · White Binding", detail: "Gray cap · bright white collar", style: "css" },
  { id: "pan", category: "pan", kind: "knob", label: "Pan L–R", detail: "Bipolar dengan center detent", style: "css", parameter: "pan", value: 50 },
  { id: "pan-unified", category: "pan", kind: "knob", label: "Pan Uniform Ring", detail: "Ring satu warna · center detent", style: "css", parameter: "pan", value: 50 },
  { id: "pan-ring-chicken-head-clean", category: "pan", kind: "knob", label: "Black Chicken Head · Ring", detail: "LED kontinu terpisah · center detent", style: "css", parameter: "pan", value: 50 },
  { id: "pan-chicken-head-clean", category: "pan", kind: "knob", label: "Black Chicken Head · Dots", detail: "LED titik terpisah · center detent", style: "css", parameter: "pan", value: 50 },
  { id: "pan-ring-ivory-lever", category: "pan", kind: "knob", label: "Ivory Lever · Ring", detail: "LED kontinu terpisah · center detent", style: "css", parameter: "pan", value: 50 },
  { id: "pan-ivory-lever", category: "pan", kind: "knob", label: "Ivory Lever · Dots", detail: "LED titik terpisah · center detent", style: "css", parameter: "pan", value: 50 },
  { id: "pan-ring-black-precision", category: "pan", kind: "knob", label: "Black Precision · Ring", detail: "LED kontinu terpisah · center detent", style: "filmstrip", parameter: "pan", value: 50 },
  { id: "pan-black-precision", category: "pan", kind: "knob", label: "Black Precision · Dots", detail: "LED titik terpisah · center detent", style: "filmstrip", parameter: "pan", value: 50 },
  { id: "pan-ring-black-crimson-wing", category: "pan", kind: "knob", label: "Black Crimson Wing · Ring", detail: "LED kontinu terpisah · center detent", style: "filmstrip", parameter: "pan", value: 50 },
  { id: "pan-black-crimson-wing", category: "pan", kind: "knob", label: "Black Crimson Wing · Dots", detail: "LED titik terpisah · center detent", style: "filmstrip", parameter: "pan", value: 50 },
  { id: "pan-ring-black-dome", category: "pan", kind: "knob", label: "Black Dome · Ring", detail: "LED kontinu terpisah · center detent", style: "css", parameter: "pan", value: 50 },
  { id: "pan-black-dome", category: "pan", kind: "knob", label: "Black Dome · Dots", detail: "LED titik terpisah · center detent", style: "css", parameter: "pan", value: 50 },
  { id: "silver", category: "knob", kind: "knob", label: "Silver Console", detail: "Machined aluminium", style: "css" },
  { id: "classic", category: "button", kind: "button", label: "Classic Toggle", detail: "Tombol bulat sederhana", style: "css" },
  { id: "heritage", category: "button", kind: "button", label: "Vintage Lamp", detail: "Lampu hardware 3D", style: "filmstrip" },
  { id: "square-led", category: "button", kind: "button", label: "Square LED", detail: "Push button console", style: "css" },
  { id: "square-led-label", category: "button", kind: "button", label: "Square LED Label", detail: "Square console key · editable text", style: "css", offLabel: "OFF", onLabel: "ON" },
  { id: "round-led-label", category: "button", kind: "button", label: "Round LED Label", detail: "Round console key · editable text", style: "css", offLabel: "OFF", onLabel: "ON" },
  { id: "capsule-led-label", category: "button", kind: "button", label: "Capsule LED Label", detail: "Capsule console key · editable text", style: "css", offLabel: "OFF", onLabel: "ON" },
  { id: "toggle", category: "button", kind: "button", label: "Toggle Switch", detail: "Saklar horizontal", style: "css" },
  { id: "mechanical-toggle", category: "button", kind: "button", label: "Mechanical Toggle", detail: "Tuas metal 3D · tanpa plat warna", style: "css", offLabel: "OFF", onLabel: "ON", width: 100, height: 132 },
  { id: "regent-switch", category: "button", kind: "button", label: "Regent Switch", detail: "Red square console key", style: "css" },
  { id: "regent-illuminated", category: "button", kind: "button", label: "Regent Illuminated", detail: "Light gray off · amber-orange on", style: "css" },
  { id: "solo-led", category: "button", kind: "solo", label: "Solo", detail: "Tombol solo kuning", style: "css" },
  { id: "mute-led", category: "button", kind: "mute", label: "Mute", detail: "Tombol mute merah", style: "css" },
  { id: "classic", category: "fader", kind: "fader", label: "Classic", detail: "Fader minimal", style: "css" },
  { id: "heritage", category: "fader", kind: "fader", label: "Heritage 3D", detail: "Fader studio vintage", style: "filmstrip" },
  { id: "console", category: "fader", kind: "fader", label: "Console", detail: "Cap lebar dan skala", style: "css" },
  { id: "luminous", category: "fader", kind: "fader", label: "LED Track", detail: "Track menyala mengikuti nilai", style: "css" },
  { id: "mixer-metal", category: "fader", kind: "fader", label: "Mixer Metal", detail: "Fader metal 3D · skala presisi · status LED", style: "css", width: 104, height: 260 },
  { id: "led", category: "meter", kind: "gain_meter", label: "LED Peak", detail: "Meter vertikal cepat", style: "css" },
  { id: "heritage", category: "meter", kind: "vu_meter", label: "Heritage VU", detail: "Meter jarum 3D", style: "filmstrip" },
  { id: "dark-vu", category: "meter", kind: "vu_meter", label: "Dark VU", detail: "Meter analog gelap", style: "css" },
  { id: "stereo-led", category: "meter", kind: "gain_meter", label: "Stereo LED", detail: "Dual bar console", style: "css" },
  { id: "regent-ladder", category: "meter", kind: "gain_meter", label: "Regent Ladder", detail: "Dual 18-segment console meter", style: "css" },
  { id: "mixer-led-ladder", category: "meter", kind: "gain_meter", label: "Mixer LED Ladder", detail: "Dual 16-segment · hijau, kuning, peak merah", style: "css", width: 112, height: 240 },
  { id: "scale-classic", category: "visual", kind: "visual", label: "Scale Classic", detail: "11 garis · MIN / MAX", style: "css", color: "#E8E0CF" },
  { id: "scale-fine", category: "visual", kind: "visual", label: "Scale Fine", detail: "21 garis presisi · MIN / MAX", style: "css", color: "#D8D4C8" },
  { id: "scale-dots", category: "visual", kind: "visual", label: "Scale Dots", detail: "15 titik · MIN / MAX", style: "css", color: "#E8E0CF" },
  { id: "scale-console", category: "visual", kind: "visual", label: "Scale Console", detail: "Major/minor tegas · 0–10", style: "css", color: "#D7B46A" },
  { id: "scale-arc", category: "visual", kind: "visual", label: "Scale Arc", detail: "Busur minimal · MIN / MAX", style: "css", color: "#C9CED3" },
  { id: "realtime-spectrum", category: "spectrum", kind: "spectrum", label: "Spectrum Analyzer", detail: "FFT output nyata · native live", style: "css", color: "#22D3EE", width: 640, height: 300 },
  { id: "pure-spectrum", category: "spectrum", kind: "spectrum", label: "Pure Spectrum Analyzer", detail: "FFT bergerak murni · tanpa band EQ", style: "css", color: "#34D399", width: 640, height: 300 },
  { id: "stereo-vectorscope", category: "spectrum", kind: "spectrum", label: "Stereo Vectorscope", detail: "Stereo phase scope · correlation −1 hingga +1", style: "css", color: "#F59E0B", width: 420, height: 320 },
  { id: "rubber", category: "pad", kind: "pad", label: "Rubber Pad", detail: "Pad sampler klasik", style: "css" },
  { id: "performance", category: "pad", kind: "pad", label: "Performance Rubber", detail: "Rubber terang dengan lampu warna saat ditekan", style: "css" },
  { id: "performance-dark", category: "pad", kind: "pad", label: "Performance Dark", detail: "Rubber gelap dengan lampu warna saat ditekan", style: "css" },
  { id: "neon", category: "pad", kind: "pad", label: "Neon Pad", detail: "Edge glow responsif", style: "css" },
  { id: "glass", category: "pad", kind: "pad", label: "Glass Pad", detail: "Translucent modern", style: "css" },
  { id: "hit-effect", category: "hit_pad", kind: "pad", label: "Hit Effect", detail: "Hotspot transparan · flash terang saat dipukul", style: "css", showBackground: false },
  { id: "diffuse-hit", category: "hit_pad", kind: "pad", label: "Diffuse Hit Pad", detail: "Hotspot transparan · cahaya lembut menyebar saat dipukul", style: "css", showBackground: false },
  { id: "smooth-diffuse-hit", category: "hit_pad", kind: "pad", label: "Smooth Diffuse Hit Pad", detail: "Hotspot transparan · gradasi ekstra halus dari tengah ke tepi", style: "css", showBackground: false },
  { id: "plain-text", category: "text", kind: "text", label: "Text", detail: "Teks statis · isi dapat diedit", style: "css", showBackground: false },
  { id: "classic", category: "keyboard", kind: "keyboard", label: "Studio Keys", detail: "Keyboard standar", style: "css" },
  { id: "ivory", category: "keyboard", kind: "keyboard", label: "Ivory Keys", detail: "Warna piano hangat", style: "css" },
  { id: "dark", category: "keyboard", kind: "keyboard", label: "Dark Keys", detail: "Keyboard synth gelap", style: "css" },
  { id: "pitch-bend", category: "keyboard", kind: "fader", label: "Pitch Bend", detail: "Wheel bipolar ±2 semitone · kembali ke tengah", style: "css", parameter: "pitch_bend", value: 50, width: 84, height: 150 },
  { id: "pitch-bend-led", category: "keyboard", kind: "fader", label: "Pitch Bend LED", detail: "Slider halus · panel meter · warna dapat diganti", style: "css", parameter: "pitch_bend", value: 50, width: 84, height: 150 },
  { id: "modulation", category: "keyboard", kind: "fader", label: "Modulation", detail: "Mod wheel MIDI · vibrato hingga ±0.5 semitone", style: "css", parameter: "modulation", value: 0, width: 84, height: 150 },
  { id: "modulation-led", category: "keyboard", kind: "fader", label: "Modulation LED", detail: "Slider halus · panel meter · warna dapat diganti", style: "css", parameter: "modulation", value: 0, width: 84, height: 150 },
  { id: "preset-browser", category: "panel", kind: "panel_button", label: "Preset Browser", detail: "Simpan, cari, dan muat snapshot suara", style: "css", panelType: "preset_browser" },
  { id: "mixer", category: "panel", kind: "panel_button", label: "Mixer", detail: "Volume, pan, mute, solo, dan meter sampler", style: "css", panelType: "mixer" },
  { id: "midi-map", category: "panel", kind: "panel_button", label: "MIDI Grooves", detail: "Browse, preview, dan drag groove MIDI ke DAW", style: "css", panelType: "midi_map" },
];
const componentVariantKey = (variant) => `${variant.category}:${variant.kind}:${variant.id}`;
const PAN_LED_KNOB_BASES = {
  "pan-ring-chicken-head-clean": "chicken-head-clean",
  "pan-chicken-head-clean": "chicken-head-clean",
  "pan-ring-ivory-lever": "ivory-lever",
  "pan-ivory-lever": "ivory-lever",
  "pan-ring-black-precision": "black-precision",
  "pan-black-precision": "black-precision",
  "pan-ring-black-crimson-wing": "black-crimson-wing",
  "pan-black-crimson-wing": "black-crimson-wing",
  "pan-ring-black-dome": "black-dome",
  "pan-black-dome": "black-dome",
};
const isPanLedKnobVariant = (variant) => Boolean(PAN_LED_KNOB_BASES[variant]);
const panLedStyleForVariant = (variant) => String(variant || "").startsWith("pan-ring-") ? "ring" : "dots";
const isPanKnobVariant = (variant) => variant === "pan" || variant === "pan-unified" || isPanLedKnobVariant(variant);
const resolveVariantParameter = (variant) => variant?.parameter;
const CSS_PROCEDURAL_KNOBS = new Set(["chicken-head-clean", "orbit-encoder", "studio-scallop", "graphite-ridge", "ivory-lever", "black-dome", "regent-cap", "regent-white", "regent-green", "regent-red", "regent-blue", "regent-brown", "regent-black", "regent-gray", "regent-white-green", "regent-white-red", "regent-white-blue", "regent-white-brown", "regent-white-black", "regent-white-gray", "pan-chicken-head-clean", "pan-ivory-lever", "pan-ring-chicken-head-clean", "pan-ring-ivory-lever", "pan-black-dome", "pan-ring-black-dome"]);
const effectiveComponentStyle = (control, panelStyle) => (
  control?.kind === "knob" && CSS_PROCEDURAL_KNOBS.has(control.component_variant)
    ? "css"
    : ["css", "filmstrip"].includes(control.component_style) ? control.component_style : panelStyle
);
const filmstripAssetFor = (control, panelStyle, assetKind) => {
  if (effectiveComponentStyle(control, panelStyle) !== "filmstrip") return null;
  if (assetKind === "knob") {
    if (control.component_variant === "pultec") return DEFAULT_VST_FILMSTRIP_SKIN.pultecKnob;
    if (control.component_variant === "modern-spectrum") return VST_KNOB_ASSETS.modernSpectrum;
    if (control.component_variant === "studio-scallop") return VST_KNOB_ASSETS.studioScallop;
    if (control.component_variant === "black-precision") return VST_KNOB_ASSETS.blackPrecision;
    if (control.component_variant === "pan-black-precision") return VST_KNOB_ASSETS.blackPrecision;
    if (control.component_variant === "pan-ring-black-precision") return VST_KNOB_ASSETS.blackPrecision;
    if (control.component_variant === "crimson-wing") return VST_KNOB_ASSETS.crimsonWing;
    if (["black-crimson-wing", "pan-black-crimson-wing", "pan-ring-black-crimson-wing"].includes(control.component_variant)) return VST_KNOB_ASSETS.blackCrimsonWing;
    if (control.component_variant === "regent-white-wing") return VST_KNOB_ASSETS.regentWhiteWing;
    if (control.component_variant === "graphite-ridge") return VST_KNOB_ASSETS.graphiteRidge;
  }
  return DEFAULT_VST_FILMSTRIP_SKIN[assetKind];
};

const neutralControlValue = (control, projectTemplate) => {
  const parameter = String(control?.parameter || "").toLowerCase();
  if (/low\s*cut/i.test(String(control?.label || "")) || (projectTemplate === "prismeq" && parameter === "tone")) return 0;
  if (control?.moduleId || isPanKnobVariant(control?.component_variant) || /^group_\d+_pan$/.test(parameter)) return 50;
  if (projectTemplate === "prismeq" && ["drive", "compress", "tone", "width", "space"].includes(parameter)) return 50;
  if (["input", "tone", "width"].includes(parameter)) return 50;
  if (parameter === "output") return 75;
  if (["volume", "mix"].includes(parameter)) return 100;
  if (["drive", "compress", "attack", "release", "space"].includes(parameter)) return 0;
  return 50;
};

const faderValueText = (control) => {
  const value = Math.max(0, Math.min(100, Number(control?.value) || 0));
  const parameter = String(control?.parameter || "").toLowerCase();
  const decibels = parameter === "input"
    ? (value * 0.24) - 12
    : parameter === "output"
      ? (value * 0.16) - 12
      : null;
  if (decibels === null) return `${Math.round(value)}%`;
  if (Math.abs(decibels) < 0.05) return "0 dB";
  return `${decibels > 0 ? "+" : ""}${decibels.toFixed(1)} dB`;
};

// Retained for backward-compatible parsing of piano-roll data in older drafts.
const PIANO_STEPS = 32;
const PIANO_PITCHES = Array.from({ length: 24 }, (_, index) => 71 - index);
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SAMPLER_MIN_PITCH = 0;
const SAMPLER_MAX_PITCH = 127;
const SAMPLER_PITCHES = Array.from({ length: SAMPLER_MAX_PITCH - SAMPLER_MIN_PITCH + 1 }, (_, index) => SAMPLER_MIN_PITCH + index);
const SAMPLER_WHITE_PITCHES = SAMPLER_PITCHES.filter((pitch) => ![1, 3, 6, 8, 10].includes(pitch % 12));
const SAMPLER_KEY_WIDTH = 30;
const SAMPLER_ZONE_COLORS = [
  "#fb7185", "#f59e0b", "#34d399", "#38bdf8", "#818cf8",
  "#a78bfa", "#e879f9", "#fb923c", "#2dd4bf", "#a3e635",
];
const samplerZoneColor = (mapping, fallbackIndex = 0) => {
  const identity = `${mapping?.sampleId || fallbackIndex}|${mapping?.articulation || "Sustain"}|${mapping?.micPosition || "Main"}`;
  let hash = 0;
  for (let index = 0; index < identity.length; index += 1) hash = ((hash * 31) + identity.charCodeAt(index)) | 0;
  return SAMPLER_ZONE_COLORS[Math.abs(hash) % SAMPLER_ZONE_COLORS.length];
};
const midiNoteName = (pitch) => `${PITCH_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
const isBlackKey = (pitch) => [1, 3, 6, 8, 10].includes(pitch % 12);
const samplerPitchCenter = (pitch) => {
  const whiteBefore = SAMPLER_WHITE_PITCHES.filter((whitePitch) => whitePitch < pitch).length;
  return isBlackKey(pitch)
    ? whiteBefore * SAMPLER_KEY_WIDTH
    : (whiteBefore * SAMPLER_KEY_WIDTH) + (SAMPLER_KEY_WIDTH / 2);
};
const samplerPitchBounds = (lowPitch, highPitch) => {
  const totalWidth = SAMPLER_WHITE_PITCHES.length * SAMPLER_KEY_WIDTH;
  const left = lowPitch <= SAMPLER_MIN_PITCH
    ? 0
    : (samplerPitchCenter(lowPitch - 1) + samplerPitchCenter(lowPitch)) / 2;
  const right = highPitch >= SAMPLER_MAX_PITCH
    ? totalWidth
    : (samplerPitchCenter(highPitch) + samplerPitchCenter(highPitch + 1)) / 2;
  return { left, width: Math.max(4, right - left) };
};
const createSampleMapping = (sampleId, rootPitch, lowPitch = rootPitch, highPitch = rootPitch) => ({
  id: makeId(),
  sampleId,
  rootPitch,
  lowPitch,
  highPitch,
  velocityLow: 1,
  velocityHigh: 127,
  groupName: DEFAULT_SAMPLER_NAME,
  articulation: "Sustain",
  roundRobin: 1,
  micPosition: "Main",
  sampleStart: 0,
  sampleEnd: 1,
  loopEnabled: false,
  loopStart: 0,
  loopEnd: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
  tuneSemitones: 0,
  tuneCents: 0,
  playbackMode: "sampler",
  sourceBpm: 120,
  sourceBpmConfirmed: false,
  chokeTargetPitches: [],
  gainDb: 0,
  pan: 0,
});
const bpmFromSampleName = (name) => {
  const text = String(name || "");
  const match = text.match(/(?:^|[\s_.-])(\d{2,3}(?:\.\d+)?)\s*bpm(?:[\s_.-]|$)/i)
    || text.match(/(?:^|[\s_.-])bpm[\s_.-]?(\d{2,3}(?:\.\d+)?)(?:[\s_.-]|$)/i);
  const bpm = Number(match?.[1]);
  return bpm >= 20 && bpm <= 300 ? bpm : null;
};
const estimateAudioBufferBpm = (audioBuffer) => {
  if (!audioBuffer || audioBuffer.duration < 1 || !audioBuffer.length) return null;
  const hopSeconds = 0.01;
  const hopSize = Math.max(128, Math.round(audioBuffer.sampleRate * hopSeconds));
  const frameCount = Math.min(12000, Math.floor(audioBuffer.length / hopSize));
  if (frameCount < 100) return null;
  const channels = Array.from({ length: Math.min(2, audioBuffer.numberOfChannels) }, (_, index) => audioBuffer.getChannelData(index));
  const onset = new Float32Array(frameCount);
  let previousEnergy = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    const end = Math.min(audioBuffer.length, start + hopSize);
    const step = Math.max(1, Math.floor((end - start) / 48));
    let energy = 0;
    let count = 0;
    for (let cursor = start; cursor < end; cursor += step) {
      channels.forEach((channel) => { energy += Math.abs(channel[cursor] || 0); });
      count += channels.length;
    }
    energy /= Math.max(1, count);
    onset[frame] = Math.max(0, energy - previousEnergy);
    previousEnergy = (previousEnergy * 0.72) + (energy * 0.28);
  }
  const scoreAt = (bpm) => {
    const lag = Math.max(1, Math.round(60 / (bpm * hopSeconds)));
    let score = 0;
    for (let index = lag; index < frameCount; index += 1) score += onset[index] * onset[index - lag];
    return score / Math.max(1, frameCount - lag);
  };
  let bestBpm = null;
  let bestScore = 0;
  for (let bpm = 40; bpm <= 240; bpm += 1) {
    const score = scoreAt(bpm)
      + (bpm <= 120 ? scoreAt(bpm * 2) * 0.35 : 0)
      + (bpm >= 80 ? scoreAt(bpm / 2) * 0.2 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  return bestScore > 0 ? bestBpm : null;
};
const detectSampleBpm = async (sample) => {
  const filenameBpm = bpmFromSampleName(sample?.name);
  if (filenameBpm) return filenameBpm;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!sample || !AudioContextClass) return null;
  let bytes;
  if (sample.file) bytes = await sample.file.arrayBuffer();
  else if (sample.previewUrl) {
    const response = await api.get(sample.previewUrl, { responseType: "arraybuffer", timeout: 120000 });
    bytes = response.data;
  }
  if (!bytes) return null;
  const context = new AudioContextClass();
  try {
    const audioBuffer = await context.decodeAudioData(bytes.slice ? bytes.slice(0) : bytes);
    return estimateAudioBufferBpm(audioBuffer);
  } finally {
    context.close().catch(() => {});
  }
};
const ARTICULATION_OPTIONS = ["Sustain", "Staccato", "Legato", "Marcato", "Pizzicato", "Spiccato", "Tremolo", "Muted", "Release"];
const MIC_POSITION_OPTIONS = ["Main", "Close", "Mid", "Room", "Ambient", "DI", "Amp"];
const DEFAULT_SAMPLER_NAME = "Sampler 1";
const normalizeSamplerName = (name) => {
  const normalized = String(name || "").trim();
  return !normalized || normalized === "Main" ? DEFAULT_SAMPLER_NAME : normalized;
};
const createSamplerGroup = (name = DEFAULT_SAMPLER_NAME) => ({ id: makeId(), name: normalizeSamplerName(name), volume: 100, pan: 0, mute: false, solo: false });
const normalizeSamplerGroup = (group, index = 0) => ({
  id: String(group?.id || makeId()),
  name: normalizeSamplerName(group?.name || `Sampler ${index + 1}`).slice(0, 48),
  volume: Math.max(0, Math.min(100, Number(group?.volume ?? 100))),
  pan: Math.max(-1, Math.min(1, Number(group?.pan ?? 0))),
  mute: !!group?.mute,
  solo: !!group?.solo,
});
const createOneKeyMappings = (sampleList, rootPitch, samplerName = DEFAULT_SAMPLER_NAME, options = {}) => {
  const pitches = oneKeyMappingPitches(sampleList, rootPitch, options);
  return sampleList.slice(0, 128).map((sample, index) => {
    const pitch = pitches[index];
    return { ...createSampleMapping(sample.id, pitch), groupName: samplerName };
  });
};
const clampUnit = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const clampPercent = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const normalizeLicenseActivationChoice = (value, fallback = 1) => {
  if (Number(value) === 0) return 0;
  const numeric = Number(value);
  return Math.max(1, Math.min(3, Number.isFinite(numeric) ? numeric : fallback));
};
const roundLayoutPercent = (value) => Math.round(value * 100) / 100;
const mappingRangeResetProps = (reset) => ({
  title: "Double-click atau Ctrl/Cmd + klik untuk kembali ke nilai netral",
  onDoubleClick: (event) => {
    event.preventDefault();
    event.stopPropagation();
    reset();
  },
  onPointerDown: (event) => {
    if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();
    reset();
  },
});
const snapControlCenter = (percent, canvasSize, controlSize, gridSize) => {
  const centrePx = (percent / 100) * canvasSize;
  const snappedLeft = Math.round((centrePx - controlSize / 2) / gridSize) * gridSize;
  return ((snappedLeft + controlSize / 2) / canvasSize) * 100;
};
const saturationCurve = (amount = 0) => {
  const curve = new Float32Array(44100);
  // Keep the curve close to unity gain. The previous tanh curve multiplied
  // quiet material by as much as 19x, which made drum hotspots much louder
  // and harsher than the same sample in Mapping preview.
  const drive = Math.max(0, Math.min(1, amount));
  for (let index = 0; index < curve.length; index += 1) {
    const input = (index * 2) / (curve.length - 1) - 1;
    curve[index] = (input * (1 + drive)) / (1 + (drive * Math.abs(input)));
  }
  return curve;
};
const createReverbImpulse = (context) => {
  const length = Math.max(1, Math.floor(context.sampleRate * 1.35));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const decay = (1 - index / length) ** 2.4;
      data[index] = (Math.random() * 2 - 1) * decay;
    }
  }
  return impulse;
};
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const CLASSIC_KNOB_DEFAULT_SIZE = Object.freeze({ width: 112, height: 122 });
const CONTROL_DEFAULT_SIZES = {
  button: { width: 120, height: 104 },
  knob: CLASSIC_KNOB_DEFAULT_SIZE,
  fader: { width: 104, height: 144 },
  pad: { width: 108, height: 120 },
  keyboard: { width: 560, height: 150 },
  solo: { width: 96, height: 92 },
  mute: { width: 96, height: 92 },
  gain_meter: { width: 92, height: 150 },
  vu_meter: { width: 170, height: 112 },
  visual: { width: 160, height: 160 },
  spectrum: { width: 640, height: 300 },
  image: { width: 240, height: 160 },
  text: { width: 144, height: 36 },
  panel_button: { width: 148, height: 64 },
};
const usesClassicKnobDefaultSize = (kind, variant) => (
  kind === "knob" && ["knob", "pan"].includes(variant?.category)
);
const defaultControlSize = (kind, variant = null) => (
  usesClassicKnobDefaultSize(kind, variant)
    ? CLASSIC_KNOB_DEFAULT_SIZE
    : CONTROL_DEFAULT_SIZES[kind] || CLASSIC_KNOB_DEFAULT_SIZE
);
const keyboardWidthForKeys = (keyCount) => ({ 25: 380, 37: 520, 49: 680, 61: 820 }[keyCount] || 680);
const HYBRID_PAD_LABELS = ["Kick Deep", "Kick Punch", "Snare Main", "Snare Rim", "Closed Hat", "Open Hat", "Clap", "Shaker", "Tom Low", "Tom Mid", "Tom High", "Perc", "Crash", "Ride", "Impact", "Sub Drop"];
const PERFORMANCE_PAD_COLORS = [
  "#ff5f68", "#ff8f70", "#ffb84d", "#ffc966",
  "#ffd85a", "#b9ef4a", "#65e34f", "#6ce68a",
  "#67e5b0", "#55d9ee", "#4ca9ff", "#697bff",
  "#8370ff", "#b465ff", "#ed5cc7", "#ff5d92",
];
const PAD_SURFACE_DEFAULTS = {
  rubber: "#17171b",
  performance: "#ceced1",
  "performance-dark": "#44444a",
  neon: "#111118",
  glass: "#30303a",
  "hit-effect": "#111118",
  "diffuse-hit": "#111118",
  "smooth-diffuse-hit": "#111118",
};
const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ""));
const hexColorWithAlpha = (value, alpha) => {
  const color = isHexColor(value) ? value : "#22D3EE";
  const numeric = Number.parseInt(color.slice(1), 16);
  return `rgba(${(numeric >> 16) & 255}, ${(numeric >> 8) & 255}, ${numeric & 255}, ${alpha})`;
};
const defaultPadSurfaceColor = (variant = "rubber") => PAD_SURFACE_DEFAULTS[variant] || PAD_SURFACE_DEFAULTS.rubber;
const defaultPadActiveColor = (variant, notePitch, accentColor) => (
  ["performance", "performance-dark"].includes(variant)
    ? PERFORMANCE_PAD_COLORS[(((Number(notePitch) || 60) - 36) % PERFORMANCE_PAD_COLORS.length + PERFORMANCE_PAD_COLORS.length) % PERFORMANCE_PAD_COLORS.length]
    : (isHexColor(accentColor) ? accentColor : "#fb7185")
);
const inferNeonDrumPitch = (filename, fallbackPitch) => {
  const normalized = String(filename || "").toLowerCase().replace(/[_-]+/g, " ");
  const rules = [
    [/\bkick\b/, 36],
    [/\bsnare\b/, 38],
    [/\bclap\b/, 39],
    [/(open\s*hat|hat\s*open|open\s*hi[ -]?hat)/, 46],
    [/(closed\s*hat|hat\s*closed|hi[ -]?hat|\bhat\b)/, 42],
    [/(floor\s*tom|tom\s*floor)/, 43],
    [/(tom\s*(?:2|mid)|mid\s*tom)/, 47],
    [/(tom\s*(?:1|high|rack)|rack\s*tom|high\s*tom)/, 48],
    [/(crash\s*(?:r|right)|right\s*crash)/, 57],
    [/(crash\s*(?:l|left)|left\s*crash|\bcrash\b)/, 49],
    [/\bsplash\b/, 55],
    [/\bride\b/, 51],
  ];
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] ?? fallbackPitch;
};
const createNeonDrumMappings = (sampleList, samplerName = DEFAULT_SAMPLER_NAME) => sampleList.slice(0, 128).map((sample, index) => {
  const fallback = NEON_POP_DRUM_HITS[index]?.notePitch ?? Math.min(127, 58 + index - NEON_POP_DRUM_HITS.length);
  return {
    ...createSampleMapping(sample.id, inferNeonDrumPitch(sample.name, fallback)),
    groupName: samplerName,
  };
});
const normalizeInterfaceControl = (control) => {
  const defaults = CONTROL_DEFAULT_SIZES[control.kind] || CONTROL_DEFAULT_SIZES.knob;
  const width = Number(control.width);
  const height = Number(control.height);
  const minimumWidth = control.kind === "keyboard" ? 240 : control.kind === "spectrum" ? 240 : control.kind === "text" ? 32 : 48;
  const minimumHeight = control.kind === "keyboard" ? 112 : control.kind === "spectrum" ? 120 : control.kind === "text" ? 24 : 48;
  const labelPosition = normalizeLabelPosition(control.labelPosition ?? control.label_position);
  const labelGap = normalizeLabelGap(control.labelGap ?? control.label_gap);
  const isTwoStateButton = control.kind === "button";
  const isMeter = ["gain_meter", "vu_meter"].includes(control.kind);
  const componentVariant = typeof control.component_variant === "string" ? control.component_variant.slice(0, 32) : undefined;
  const parameter = isPanKnobVariant(componentVariant) && control.parameter === "width"
    ? "pan"
    : isMeter && control.parameter === "output_level" && /gain reduction/i.test(String(control.label || ""))
      ? "gain_reduction"
      : control.parameter;
  return {
    ...control,
    parameter,
    width: Number.isFinite(width) ? Math.max(minimumWidth, Math.min(1600, width)) : defaults.width,
    height: Number.isFinite(height) ? Math.max(minimumHeight, Math.min(1024, height)) : defaults.height,
    labelPosition,
    labelGap,
    showBackground: control.showBackground !== false && control.show_background !== false,
    show_correlation_meter: control.showCorrelationMeter !== false && control.show_correlation_meter !== false,
    opacity: Math.max(0, Math.min(100, Number(control.opacity ?? 100))),
    rotation: normalizeComponentRotation(control.rotation),
    component_variant: componentVariant,
    ...(isMeter ? { meterMode: ["mono", "stereo"].includes(control.meterMode ?? control.meter_mode) ? (control.meterMode ?? control.meter_mode) : (control.kind === "gain_meter" ? "stereo" : "mono") } : {}),
    ...(control.kind === "pad" && isHexColor(control.padColor ?? control.pad_color) ? { padColor: control.padColor ?? control.pad_color } : {}),
    ...(control.kind === "pad" && isHexColor(control.padActiveColor ?? control.pad_active_color) ? { padActiveColor: control.padActiveColor ?? control.pad_active_color } : {}),
    ...(["visual", "spectrum"].includes(control.kind) && isHexColor(control.visualColor ?? control.visual_color) ? { visualColor: control.visualColor ?? control.visual_color } : {}),
    spectrumBand: control.spectrumBand === true || control.spectrum_band === true,
    ...(PRISM_CONTROL_MODES.has(control.prismControlMode ?? control.prism_control_mode) ? { prismControlMode: control.prismControlMode ?? control.prism_control_mode } : {}),
    ...(["frequency", "gain", "q"].includes(control.prismContext ?? control.prism_context) ? { prismContext: control.prismContext ?? control.prism_context } : {}),
    ...((control.prismOwnerId ?? control.prism_owner_id) ? { prismOwnerId: String(control.prismOwnerId ?? control.prism_owner_id).slice(0, 64) } : {}),
    ...(control.kind === "text" ? {
      textFont: BRAND_FONT_OPTIONS.some((option) => option.id === (control.textFont ?? control.text_font)) ? (control.textFont ?? control.text_font) : "space-grotesk",
      textColor: isHexColor(control.textColor ?? control.text_color) ? (control.textColor ?? control.text_color) : "#F4F4F5",
    } : {}),
    ...(isHexColor(control.controlColor ?? control.control_color) ? { controlColor: control.controlColor ?? control.control_color } : {}),
    ...(control.kind === "image" ? {
      imageUrl: control.imageUrl ?? control.image_url ?? "",
      imageName: control.imageName ?? control.image_name ?? "",
      imageFit: ["contain", "cover", "stretch"].includes(control.imageFit ?? control.image_fit) ? (control.imageFit ?? control.image_fit) : "contain",
      imageOpacity: Math.max(0, Math.min(100, Number(control.imageOpacity ?? control.image_opacity ?? 100))),
    } : {}),
    parentPanelId: control.kind === "panel_button" ? null : (control.parentPanelId ?? control.parent_panel_id ?? null),
    ...(control.kind === "panel_button" ? {
      panelType: ["preset_browser", "mixer", "midi_map"].includes(control.panelType ?? control.panel_type) ? (control.panelType ?? control.panel_type) : "preset_browser",
      panelX: clampPercent(control.panelX ?? control.panel_x ?? 50, 0, 100),
      panelY: clampPercent(control.panelY ?? control.panel_y ?? 52, 0, 100),
      panelWidth: clampPercent(control.panelWidth ?? control.panel_width ?? 88, 35, 96),
      panelHeight: clampPercent(control.panelHeight ?? control.panel_height ?? 78, 30, 92),
    } : {}),
    ...(isTwoStateButton ? {
      off_label: String(control.off_label ?? control.label ?? "").slice(0, 24),
      on_label: String(control.on_label ?? "ON").slice(0, 24),
    } : {}),
  };
};
const panelFeatureReferencesForControls = (controls, presets = []) => {
  const controlIds = new Set(controls.map((control) => control.id));
  return {
    presets: presets.map((preset) => ({
      ...preset,
      control_values: Object.fromEntries(Object.entries(preset.control_values || {}).filter(([controlId]) => controlIds.has(controlId))),
    })),
  };
};
const createTemplateControls = (templateId, keyboardKeys, prismControlMode = "contextual") => {
  if (templateId === "basicfx") return [];
  if (templateId === "regentstrip") {
    return REGENT_DEFAULT_CONTROLS.map((control) => ({ ...control, id: makeId() }));
  }
  if (templateId === "regentwhite") {
    return REGENT_WHITE_DEFAULT_CONTROLS.map((control) => ({ ...control, id: makeId() }));
  }
  if (templateId === "mixforge") {
    // Calibrated from the approved saved MixForge reference project.
    const macros = [
      ["Input", "input", 7.7, 37.97, 50], ["Drive", "drive", 18.67, 38.02, 24], ["Compress", "compress", 29.45, 37.97, 32],
      ["Tone", "tone", 70.4, 37.71, 50], ["Width", "width", 81.4, 37.97, 50], ["Output", "output", 92.35, 37.84, 75],
      ["Space", "space", 43.3, 61.11, 18], ["Mix", "mix", 55.2, 61.11, 100],
    ];
    return [
      ...macros.map(([label, parameter, x, y, value]) => ({
        id: makeId(), kind: "knob", label, parameter, moduleId: null, x, y,
        value, notePitch: 60, width: y < 50 ? 144 : 138, height: y < 50 ? 164 : 156, showBackground: false,
      })),
      { id: makeId(), kind: "button", label: "Bypass", parameter: "bypass", moduleId: null, x: 29.3, y: 61.5, value: 0, notePitch: 60, width: 88, height: 76, showBackground: false },
      { id: makeId(), kind: "vu_meter", label: "Gain Reduction", parameter: "gain_reduction", moduleId: null, x: 50, y: 38.5, value: 0, notePitch: 60, width: 290, height: 132, showBackground: false },
      { id: makeId(), kind: "gain_meter", label: "Stereo Output", parameter: "output_level", moduleId: null, x: 79.25, y: 60.66, value: 0, notePitch: 60, width: 312, height: 112, showBackground: false },
    ];
  }
  if (templateId === "vintageeq") {
    return [
      { id: makeId(), kind: "knob", label: "Low Boost", parameter: "drive", moduleId: null, x: 11.02, y: 35.6, value: 36, notePitch: 60, width: 138, height: 152, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "Low Atten", parameter: "compress", moduleId: null, x: 26.64, y: 35.42, value: 18, notePitch: 60, width: 138, height: 152, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "Low Freq", parameter: "tone", moduleId: null, x: 42.37, y: 35.42, value: 42, notePitch: 60, width: 138, height: 152, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "High Boost", parameter: "width", moduleId: null, x: 57.79, y: 35.42, value: 34, notePitch: 60, width: 138, height: 152, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "High Freq", parameter: "space", moduleId: null, x: 73.3, y: 35.32, value: 18, notePitch: 60, width: 138, height: 152, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "High Atten", parameter: "mix", moduleId: null, x: 88.83, y: 35.24, value: 17, notePitch: 60, width: 138, height: 152, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "Input", parameter: "input", moduleId: null, x: 33.79, y: 72.76, value: 50, notePitch: 60, width: 116, height: 130, component_style: "filmstrip", component_variant: "heritage", showBackground: false },
      { id: makeId(), kind: "knob", label: "Output", parameter: "output", moduleId: null, x: 66.2, y: 72.72, value: 58, notePitch: 60, width: 116, height: 130, component_style: "filmstrip", component_variant: "heritage", showBackground: false },
      { id: makeId(), kind: "button", label: "Bypass", off_label: "OFF", on_label: "ON", parameter: "bypass", moduleId: null, x: 89.06, y: 73.61, value: 0, notePitch: 60, width: 96, height: 112, component_style: "filmstrip", component_variant: "heritage", showBackground: false },
    ];
  }
  if (templateId === "velofet") {
    // Calibrated from the approved saved Velo FET reference project.
    return [
      { id: makeId(), kind: "knob", label: "Input", parameter: "input", moduleId: null, x: 16, y: 32.82, value: 58, notePitch: 60, width: 184, height: 192, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "Output", parameter: "output", moduleId: null, x: 15.87, y: 63, value: 68, notePitch: 60, width: 176, height: 188, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "Attack", parameter: "tone", moduleId: null, x: 84, y: 32.46, value: 36, notePitch: 60, width: 176, height: 188, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "knob", label: "Release", parameter: "space", moduleId: null, x: 84, y: 63.37, value: 55, notePitch: 60, width: 176, height: 188, component_style: "filmstrip", component_variant: "pultec", showBackground: false },
      { id: makeId(), kind: "button", label: "Bypass", parameter: "bypass", moduleId: null, x: 68.09, y: 70, value: 0, notePitch: 60, width: 78, height: 76, showBackground: false },
      { id: makeId(), kind: "vu_meter", label: "Gain Reduction", parameter: "gain_reduction", moduleId: null, x: 44, y: 43, value: 0, notePitch: 60, width: 350, height: 190, showBackground: false },
    ];
  }
  if (templateId === "azureeq") {
    // Calibrated from the approved saved Azure Tube EQ reference project.
    const controls = [
      ["Low Boost", "drive", 12.2, 38, 35], ["Low Atten", "compress", 27, 38, 15], ["Low Select", "tone", 41.7, 38, 42],
      ["High Boost", "width", 58.3, 38, 34], ["High Select", "space", 73, 38, 58], ["High Atten", "mix", 87.8, 38, 20],
      ["Input", "input", 26.9, 63.73, 50], ["Output", "output", 73.1, 63.91, 56],
    ];
    return [
      ...controls.map(([label, parameter, x, y, value]) => ({ id: makeId(), kind: "knob", label, parameter, moduleId: null, x, y, value, notePitch: 60, width: y > 50 ? 112 : 150, height: y > 50 ? 126 : 166, showBackground: false })),
      { id: makeId(), kind: "button", label: "Bypass", parameter: "bypass", moduleId: null, x: 49.82, y: 64, value: 0, notePitch: 60, width: 128, height: 128, showBackground: false },
    ];
  }
  if (templateId === "prismeq") {
    // Calibrated from the approved saved Prism Spectrum EQ reference project.
    const analyzerId = makeId();
    const mode = PRISM_CONTROL_MODES.has(prismControlMode) ? prismControlMode : "contextual";
    return [
      { id: makeId(), kind: "fader", label: "Input", parameter: "input", moduleId: null, x: 4.3, y: 36.3, value: 50, notePitch: 60, width: 72, height: 360, component_style: "css", component_variant: "luminous", showBackground: false },
      { id: analyzerId, kind: "spectrum", label: "Spectrum Analyzer", parameter: "output_level", moduleId: null, x: 50, y: 37.1, value: 0, notePitch: 60, width: 820, height: 380, component_style: "css", component_variant: "realtime-spectrum", visualColor: "#22D3EE", showBackground: false, prismControlMode: mode },
      ...PRISM_CONTEXT_DEFINITIONS.map(({ context, parameter, label, x }) => ({
        id: `${analyzerId}-prism-${context}`,
        kind: "knob", label, parameter, prismContext: context, prismOwnerId: analyzerId,
        moduleId: null, x, y: 82, value: 50, notePitch: 60, width: 112, height: 128,
        component_style: "css", component_variant: "luminous", showBackground: false,
      })),
      { id: makeId(), kind: "knob", label: "Mix", parameter: "mix", moduleId: null, x: 72, y: 82, value: 100, notePitch: 60, width: 112, height: 128, component_style: "css", component_variant: "luminous", showBackground: false },
      { id: makeId(), kind: "fader", label: "Output", parameter: "output", moduleId: null, x: 95.7, y: 36.3, value: 62, notePitch: 60, width: 72, height: 360, component_style: "css", component_variant: "luminous", showBackground: false },
      { id: makeId(), kind: "button", label: "Bypass", off_label: "Bypass", on_label: "ON", parameter: "bypass", moduleId: null, x: 90.1, y: 81.02, value: 0, notePitch: 60, width: 72, height: 78, component_style: "css", component_variant: "square-led", showBackground: false },
    ];
  }
  if (templateId === "modernreverb") {
    // Calibrated from the approved saved Nebula Modern Reverb project.
    const controls = [
      ["Input", "input", 12.4, 77.6, 50], ["Decay", "space", 25, 77.6, 58], ["Size", "width", 37.5, 77.6, 62],
      ["Damping", "tone", 50, 77.6, 46], ["Diffusion", "compress", 62.5, 77.93, 68], ["Mix", "mix", 75, 77.93, 38],
      ["Output", "output", 87.41, 77.93, 72],
    ];
    return [
      ...controls.map(([label, parameter, x, y, value]) => ({ id: makeId(), kind: "knob", label, parameter, moduleId: null, x, y, value, notePitch: 60, width: 112, height: 126, component_style: "css", component_variant: "luminous", showBackground: false })),
      { id: makeId(), kind: "button", label: "Bypass", off_label: "OFF", on_label: "ON", parameter: "bypass", moduleId: null, x: 96.09, y: 68.06, value: 0, notePitch: 60, width: 80, height: 80, component_style: "css", component_variant: "square-led", showBackground: false },
    ];
  }
  if (templateId === "moderndelay") {
    // Calibrated from the approved saved Vector Modern Delay project.
    const controls = [
      ["Time", "tone", 8.84, 28, 42], ["Feedback", "compress", 23.18, 27.83, 48],
      ["Width", "width", 8.74, 60.33, 72], ["Color", "space", 23.18, 60.5, 54],
      ["Input", "input", 77.37, 27.83, 50], ["Drive", "drive", 91.56, 27.67, 18],
      ["Mix", "mix", 77.09, 60.33, 35], ["Output", "output", 91.74, 60.5, 72],
    ];
    return [
      ...controls.map(([label, parameter, x, y, value]) => ({ id: makeId(), kind: "knob", label, parameter, moduleId: null, x, y, value, notePitch: 60, width: 144, height: 160, component_style: "css", component_variant: "luminous", showBackground: false })),
      { id: makeId(), kind: "button", label: "Bypass", off_label: "OFF", on_label: "ON", parameter: "bypass", moduleId: null, x: 92.97, y: 85.5, value: 100, notePitch: 60, width: 96, height: 89, component_style: "css", component_variant: "square-led", showBackground: false },
    ];
  }
  if (templateId === "modernsaturation") {
    // Calibrated from the approved saved Ember Modern Saturation project.
    const controls = [
      ["Input", "input", 8.89, 58.35, 50, 112], ["Tone", "tone", 21.59, 58.35, 52, 112], ["Density", "compress", 34.09, 58.35, 38, 112],
      ["Drive", "drive", 50.09, 57.51, 44, 158], ["Width", "width", 66.09, 58.35, 55, 112], ["Mix", "mix", 78.59, 58.35, 100, 112],
      ["Output", "output", 91.29, 58.35, 72, 112],
    ];
    return [
      ...controls.map(([label, parameter, x, y, value, width]) => ({ id: makeId(), kind: "knob", label, parameter, moduleId: null, x, y, value, notePitch: 60, width, height: width > 130 ? 170 : 126, component_style: "css", component_variant: "luminous", showBackground: false })),
      { id: makeId(), kind: "button", label: "Bypass", off_label: "OFF", on_label: "ON", parameter: "bypass", moduleId: null, x: 94, y: 80, value: 0, notePitch: 60, width: 88, height: 104, component_style: "css", component_variant: "square-led", showBackground: false },
    ];
  }
  if (templateId === "neonpopdrums") {
    return [
      ...NEON_POP_DRUM_HITS.map((hit) => ({
        id: makeId(), kind: "pad", label: hit.label, parameter: "tone", moduleId: null,
        x: hit.x, y: hit.y, value: 0, notePitch: hit.notePitch,
        width: hit.width, height: hit.height, component_style: "css",
        component_variant: "smooth-diffuse-hit", showBackground: false,
      })),
      { id: makeId(), kind: "knob", label: "Room", parameter: "space", moduleId: null, x: 39, y: 87, value: 46, notePitch: 60, width: 92, height: 96, showBackground: false },
      { id: makeId(), kind: "knob", label: "Drive", parameter: "tone", moduleId: null, x: 61, y: 87, value: 34, notePitch: 60, width: 92, height: 96, showBackground: false },
      { id: makeId(), kind: "gain_meter", label: "Output", parameter: "output_level", moduleId: null, x: 94, y: 78, value: 0, notePitch: 60, ...CONTROL_DEFAULT_SIZES.gain_meter, showBackground: true },
    ];
  }
  if (templateId === "performancegrid") {
    // Calibrated from the approved saved Pulse Performance Grid project.
    const padXs = [45, 58, 71, 84];
    const padYs = [33, 50, 67, 84];
    const macroControls = [
      ["Tone", "tone", 42, 42], ["Attack", "attack", 51, 18], ["Release", "release", 60, 30],
      ["Space", "space", 69, 24], ["Volume", "volume", 78, 82], ["Pan Sampler", "group_0_pan", 87, 50],
    ];
    return [
      ...macroControls.map(([label, parameter, x, value]) => ({
        id: makeId(), kind: "knob", label, parameter, moduleId: null, x, y: 14, value,
        notePitch: 60, width: 82, height: 92, component_style: "css", component_variant: "black-dome", showBackground: false,
      })),
      { id: makeId(), kind: "fader", label: "Sample Level", parameter: "group_0_volume", moduleId: null, x: 13, y: 43, value: 86, notePitch: 60, width: 78, height: 246, component_style: "css", component_variant: "console", showBackground: false },
      { id: makeId(), kind: "mute", label: "Stop", off_label: "STOP", on_label: "STOP", parameter: "mute", moduleId: null, x: 10, y: 74, value: 0, notePitch: 60, width: 82, height: 84, component_style: "css", component_variant: "mute-led", showBackground: false },
      { id: makeId(), kind: "solo", label: "Play", off_label: "PLAY", on_label: "PLAY", parameter: "solo", moduleId: null, x: 20, y: 74, value: 0, notePitch: 60, width: 82, height: 84, component_style: "css", component_variant: "solo-led", showBackground: false },
      ...Array.from({ length: 16 }, (_, index) => ({
        id: makeId(), kind: "pad", label: `Pad ${index + 1}`, parameter: "tone", moduleId: null,
        x: padXs[index % 4], y: padYs[Math.floor(index / 4)], value: 0, notePitch: 36 + index,
        width: 112, height: 112, component_style: "css", component_variant: "performance-dark", showBackground: false,
      })),
      { id: makeId(), kind: "gain_meter", label: "Output", parameter: "output_level", moduleId: null, x: 95, y: 52, value: 0, notePitch: 60, width: 72, height: 250, component_style: "css", component_variant: "stereo-led", showBackground: false },
    ];
  }
  if (["drumpad", "hybriddrums"].includes(templateId)) {
    return Array.from({ length: 16 }, (_, index) => ({
      id: makeId(),
      kind: "pad",
      label: templateId === "hybriddrums" ? HYBRID_PAD_LABELS[index] : `Pad ${index + 1}`,
      parameter: "tone",
      moduleId: null,
      x: templateId === "hybriddrums" ? [25, 42, 58, 75][index % 4] : [17, 39, 61, 83][index % 4],
      y: templateId === "hybriddrums" ? [25, 40, 55, 70][Math.floor(index / 4)] : [24, 42, 60, 78][Math.floor(index / 4)],
      value: 0,
      notePitch: 36 + index,
      ...CONTROL_DEFAULT_SIZES.pad,
      ...(templateId === "hybriddrums" ? { width: 112, height: 110 } : {}),
      showBackground: templateId !== "hybriddrums",
    }));
  }

  const macroDefinitions = templateId === "premiumkeys"
    ? [
      ["Dynamics", "volume", 14, 72], ["Tone", "tone", 32, 58], ["Attack", "attack", 50, 24],
      ["Release", "release", 68, 62], ["Concert Hall", "space", 86, 48],
    ]
    : ["synth", "analogsynth"].includes(templateId)
    ? [
      ["Osc Mix", "tone", 15], ["Cutoff", "tone", 29], ["Resonance", "tone", 43],
      ["Attack", "attack", 57], ["Release", "release", 71], ["Space", "space", 85],
    ]
    : templateId === "cinematicstrings"
    ? [
      ["Dynamics", "volume", 14, 70], ["Expression", "tone", 32, 62], ["Bow Attack", "attack", 50, 32],
      ["Release", "release", 68, 58], ["Concert Hall", "space", 86, 68],
    ]
    : templateId === "electricbass"
    ? [
      ["Amp Drive", "volume", 18, 64], ["Tone", "tone", 34, 55], ["Attack", "attack", 50, 28],
      ["Release", "release", 66, 48], ["Room", "space", 82, 36],
    ]
    : [
      ["Tone", "tone", 20], ["Attack", "attack", 40], ["Release", "release", 60], ["Space", "space", 80],
    ];
  return [
    ...macroDefinitions.map(([label, parameter, x, value = 50]) => ({
      id: makeId(), kind: "knob", label, parameter, moduleId: null, x, y: ["premiumkeys", "analogsynth", "cinematicstrings", "electricbass"].includes(templateId) ? 27 : 27, value, notePitch: 60,
      ...CONTROL_DEFAULT_SIZES.knob, showBackground: !["premiumkeys", "analogsynth", "cinematicstrings", "electricbass"].includes(templateId),
    })),
    {
      id: makeId(), kind: templateId === "premiumkeys" ? "vu_meter" : "gain_meter", label: templateId === "premiumkeys" ? "Master VU" : "Output", parameter: "output_level", moduleId: null,
      x: templateId === "premiumkeys" ? 90 : 94, y: templateId === "premiumkeys" ? 46 : 42, value: 0, notePitch: 60,
      ...(templateId === "premiumkeys" ? CONTROL_DEFAULT_SIZES.vu_meter : CONTROL_DEFAULT_SIZES.gain_meter), showBackground: true,
    },
    {
      id: makeId(), kind: "keyboard", label: `${keyboardKeys} Keys`, parameter: "tone", moduleId: null,
      x: 50, y: ["premiumkeys", "analogsynth", "cinematicstrings", "electricbass"].includes(templateId) ? 76 : 70, value: 0, notePitch: 60, keyCount: keyboardKeys,
      ...CONTROL_DEFAULT_SIZES.keyboard, width: keyboardWidthForKeys(keyboardKeys), showBackground: !["premiumkeys", "analogsynth", "cinematicstrings", "electricbass"].includes(templateId),
    },
  ];
};

const noteNameToMidi = (noteName) => {
  const match = /^([A-G])(#?)(-?\d+)$/.exec(noteName || "");
  if (!match) return 48;
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return (Number(match[3]) + 1) * 12 + semitones[match[1]] + (match[2] ? 1 : 0);
};

const EFFECT_OPTIONS = [
  { id: "reverb", label: "Reverb", detail: "Ruang dan ambience" },
  { id: "delay", label: "Delay", detail: "Echo bertempo" },
  { id: "chorus", label: "Chorus", detail: "Lebar dan gerak stereo" },
  { id: "saturation", label: "Saturation", detail: "Warna harmonik" },
];

const hasInterfaceParameter = (controls, parameter) => (
  Array.isArray(controls) && controls.some((control) => control?.parameter === parameter)
);

const withRequiredSpectrum = (templateId, controls = []) => {
  if (templateId !== "prismeq") return controls;
  const defaults = createTemplateControls("prismeq", 49, "direct");
  let next = controls.filter((control) => !control.spectrumBand);
  if (!next.some((control) => control?.kind === "spectrum")) {
    const spectrum = defaults.find((control) => control.kind === "spectrum");
    if (spectrum) next = [spectrum, ...next];
  }
  const analyzer = next.find((control) => control.kind === "spectrum" && (control.component_variant || "realtime-spectrum") === "realtime-spectrum");
  if (!analyzer) return next;
  const mode = PRISM_CONTROL_MODES.has(analyzer.prismControlMode ?? analyzer.prism_control_mode)
    ? (analyzer.prismControlMode ?? analyzer.prism_control_mode)
    : "direct";
  next = next.map((control) => control.id === analyzer.id ? { ...control, prismControlMode: mode } : control);
  const aliases = new Set();
  next = next.filter((control) => {
    if (!PRISM_CONTEXT_PARAMETERS.has(control.parameter)) return true;
    if (aliases.has(control.parameter)) return false;
    aliases.add(control.parameter);
    return true;
  }).map((control) => {
    const definition = PRISM_CONTEXT_DEFINITIONS.find((item) => item.parameter === control.parameter);
    return definition ? { ...control, prismContext: definition.context, prismOwnerId: analyzer.id } : control;
  });
  if (mode === "contextual") {
    PRISM_CONTEXT_DEFINITIONS.forEach(({ context, parameter, label, x }) => {
      if (aliases.has(parameter)) return;
      next.push({
        id: `${analyzer.id}-prism-${context}`,
        kind: "knob", label, parameter, prismContext: context, prismOwnerId: analyzer.id,
        moduleId: analyzer.moduleId || null, x, y: 82, value: 50, notePitch: 60, width: 112, height: 128,
        component_style: "css", component_variant: "luminous", showBackground: false,
      });
    });
  }
  return next;
};

const withPrismSpectrumDsp = (templateId, controls = [], modules = []) => {
  const analyzers = controls.filter((control) => control.kind === "spectrum" && (control.component_variant || "realtime-spectrum") === "realtime-spectrum");
  if (!analyzers.length && templateId !== "prismeq") return { controls, modules };
  const existing = modules.find((module) => module.type === "prism_eq");
  if (existing) return {
    modules,
    controls: withRequiredSpectrum(templateId, controls).map((control) => (
      ((control.kind === "spectrum" && (control.component_variant || "realtime-spectrum") === "realtime-spectrum") || PRISM_CONTEXT_PARAMETERS.has(control.parameter)) && !control.moduleId
        ? { ...control, moduleId: existing.id }
        : control
    )),
  };
  const moduleId = makeId();
  const legacyBands = controls.filter((control) => PRISM_EQ_BANDS[control.parameter]);
  const base = appendDspRackModule(modules, "prism_eq", moduleId);
  const nextModules = normalizeDspRack(base.map((module) => module.id !== moduleId ? module : {
    ...module,
    parameters: {
      ...module.parameters,
      ...Object.fromEntries(PRISM_BAND_SLOTS.flatMap((band) => {
        const legacy = legacyBands.find((control) => control.parameter === band.parameter);
        const enabled = legacy ? 1 : legacyBands.length ? 0 : 1;
        return [
          [`band_${band.index}_enabled`, enabled],
          [`band_${band.index}_frequency`, prismFrequencyToSlider(legacy?.frequency ?? band.frequency) / 1000],
          [`band_${band.index}_gain`, band.index === 1 ? 0.5 : clampUnit(Number(legacy?.value ?? 50) / 100)],
          [`band_${band.index}_q`, prismQToSlider(legacy?.q ?? band.q) / 1000],
        ];
      })),
    },
  }));
  return {
    modules: nextModules,
    controls: withRequiredSpectrum(templateId, controls).map((control) => (control.kind === "spectrum" && control.component_variant !== "pure-spectrum") || PRISM_CONTEXT_PARAMETERS.has(control.parameter)
      ? { ...control, moduleId }
      : control),
  };
};

const createDraft = (pluginKind = "instrument") => {
  const effectProject = pluginKind === "effect";
  return ({
  projectId: `draft-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`}`,
  name: effectProject ? "Untitled Plugin FX" : "Untitled Instrument",
  manufacturerName: "TripleSide Studio",
  brandTagline: effectProject ? "SIGNATURE AUDIO EFFECT" : "SIGNATURE INSTRUMENT",
  brandFont: "outfit",
  brandSize: 24,
  brandX: 18,
  brandY: 13,
  brandAlign: "left",
  pluginVersion: "1.0.0",
  pluginKind: effectProject ? "effect" : "instrument",
  instrumentType: effectProject ? "Audio Effect" : "Keys",
  rootNote: "C3",
  noteRange: "C1–C6",
  velocityLayers: effectProject ? 1 : 2,
  polyphony: effectProject ? 8 : 32,
  tempoBpm: 120,
  sustainEnabled: false,
  pitchBendEnabled: false,
  modulationEnabled: false,
  projectTemplate: effectProject ? "basicfx" : "basicvst",
  pricingTemplateId: effectProject ? "basicfx" : "basicvst",
  pricingTemplateBaseline: null,
  licenseMaxActivations: 1,
  keyboardKeys: 49,
  canvasWidth: 0,
  canvasHeight: effectProject ? 576 : 0,
  backgroundImageUrl: "",
  backgroundImageName: "",
  backgroundFit: "cover",
  backgroundOpacity: effectProject ? 100 : 70,
  backgroundImageX: 50,
  backgroundImageY: 50,
  backgroundImageWidth: 100,
  backgroundImageHeight: 100,
  componentStyle: "css",
  gridSnapEnabled: true,
  gridSize: 8,
  resizeAspectLocked: true,
  uiTemplate: "studio",
  uiColor: "#09090b",
  accentColor: "#f43f5e",
  effects: { reverb: false, delay: false, chorus: false, saturation: false },
  controls: effectProject ? [] : ["tone", "attack", "release", "space"],
  interfaceControls: createTemplateControls(effectProject ? "basicfx" : "basicvst", 49),
  presets: [],
  midiMappings: [],
  midiSequences: [],
  samplerGroups: [createSamplerGroup()],
  engineModules: [],
  impulseResponses: [],
  pianoNotes: [],
  sampleMappings: [],
  });
};

const normalizeSampleMapping = (mapping) => ({
  ...mapping,
  groupName: normalizeSamplerName(mapping.groupName),
  articulation: mapping.articulation || "Sustain",
  roundRobin: Number(mapping.roundRobin) || 1,
  micPosition: mapping.micPosition || "Main",
  sampleStart: Number.isFinite(Number(mapping.sampleStart)) ? Number(mapping.sampleStart) : 0,
  sampleEnd: Number.isFinite(Number(mapping.sampleEnd)) ? Number(mapping.sampleEnd) : 1,
  loopEnabled: !!mapping.loopEnabled,
  loopStart: Number.isFinite(Number(mapping.loopStart)) ? Number(mapping.loopStart) : 0,
  loopEnd: Number.isFinite(Number(mapping.loopEnd)) ? Number(mapping.loopEnd) : 1,
  loopCrossfadeMs: Math.max(0, Math.min(100, Number(mapping.loopCrossfadeMs) || 8)),
  fadeInMs: Number(mapping.fadeInMs) || 0,
  fadeOutMs: Number(mapping.fadeOutMs) || 0,
  tuneSemitones: Number(mapping.tuneSemitones) || 0,
  tuneCents: Number(mapping.tuneCents) || 0,
  playbackMode: mapping.playbackMode === "tempo_sync" ? "tempo_sync" : "sampler",
  sourceBpm: Math.max(20, Math.min(300, Number(mapping.sourceBpm) || 120)),
  sourceBpmConfirmed: mapping.sourceBpmConfirmed === true,
  chokeTargetPitches: normalizeChokeTargetPitches(mapping.chokeTargetPitches),
  gainDb: Number(mapping.gainDb) || 0,
  pan: Number(mapping.pan) || 0,
});

const readDraft = () => {
  const fresh = createDraft();
  try {
    const stored = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object") return fresh;
    const migrateLumaOpto = stored.projectTemplate === "lumaopto";
    const storedBackgroundUrl = typeof stored.backgroundImageUrl === "string" && (/^https:\/\//.test(stored.backgroundImageUrl) || /^\/images\//.test(stored.backgroundImageUrl))
      ? stored.backgroundImageUrl
      : "";
    const migrateAmpStack = stored.projectTemplate === "ampsimulator"
      && (!storedBackgroundUrl || storedBackgroundUrl === LEGACY_AMP_BACKGROUND_URL);
    const migrateObsidianDsp = stored.projectTemplate === "obsidianhighgain" && isLegacyHighGainAmpRack(stored.engineModules);
    const migratedObsidianState = migrateObsidianDsp ? createHighGainAmpTemplateState(() => makeId()) : null;
    const migrateMixforgePanel = stored.projectTemplate === "mixforge" && (!storedBackgroundUrl || storedBackgroundUrl.endsWith("/mixforge-channel-strip-panel-v1.png"));
    const migratePrismControls = stored.projectTemplate === "prismeq" && Array.isArray(stored.interfaceControls)
      && stored.interfaceControls.some((control) => (control.kind === "knob" && Number(control.width) === 126) || (control.kind === "button" && Number(control.width) === 80));
    const premiumBackgroundUrl = migrateLumaOpto
      ? "/images/vst-assets/vintage-passive-eq-panel-v1.png"
      : migrateAmpStack
      ? AMP_STACK_BACKGROUND_URL
      : migrateMixforgePanel
      ? "/images/vst-assets/mixforge-vintage-rack-panel-v2.png"
      : stored.projectTemplate === "premiumkeys" && !storedBackgroundUrl ? PREMIUM_PIANO_BACKGROUND_URL : storedBackgroundUrl;
    const migratePremiumCanvas = stored.projectTemplate === "premiumkeys" && (!Number(stored.canvasHeight) || Number(stored.canvasHeight) === 520);
    const draft = {
      ...fresh,
      ...stored,
      projectTemplate: migrateLumaOpto ? "vintageeq" : PROJECT_TEMPLATE_OPTIONS.some((option) => option.id === stored.projectTemplate) ? stored.projectTemplate : fresh.projectTemplate,
      pricingTemplateId: typeof stored.pricingTemplateId === "string" ? stored.pricingTemplateId.slice(0, 100) : (migrateLumaOpto ? "vintageeq" : stored.projectTemplate || fresh.projectTemplate),
      licenseMaxActivations: 1,
      keyboardKeys: KEYBOARD_SIZE_OPTIONS.includes(Number(stored.keyboardKeys)) ? Number(stored.keyboardKeys) : fresh.keyboardKeys,
      tempoBpm: Math.max(20, Math.min(300, Number(stored.tempoBpm) || fresh.tempoBpm)),
      sustainEnabled: stored.sustainEnabled === true,
      canvasWidth: Math.max(0, Math.min(1024, Number(stored.canvasWidth) || 0)),
      canvasHeight: migrateMixforgePanel ? 576 : migratePremiumCanvas ? PREMIUM_PIANO_CANVAS_HEIGHT : Math.max(0, Math.min(1024, Number(stored.canvasHeight) || 0)),
      backgroundImageUrl: premiumBackgroundUrl,
      backgroundImageName: migrateLumaOpto ? "Vintage Passive EQ Panel" : migrateAmpStack ? "Original Cream British Amp Stack" : migrateMixforgePanel ? "MixForge Vintage Rack Panel" : premiumBackgroundUrl === PREMIUM_PIANO_BACKGROUND_URL ? "Aurum Concert Grand Piano" : typeof stored.backgroundImageName === "string" ? stored.backgroundImageName.slice(0, 160) : "",
      backgroundFit: ["cover", "contain", "stretch"].includes(stored.backgroundFit) ? stored.backgroundFit : "cover",
      backgroundOpacity: Number.isFinite(Number(stored.backgroundOpacity)) ? Math.max(0, Math.min(100, Number(stored.backgroundOpacity))) : fresh.backgroundOpacity,
      backgroundImageX: clampPercent(stored.backgroundImageX ?? fresh.backgroundImageX, 0, 100),
      backgroundImageY: clampPercent(stored.backgroundImageY ?? fresh.backgroundImageY, 0, 100),
      backgroundImageWidth: clampPercent(stored.backgroundImageWidth ?? fresh.backgroundImageWidth, 10, 200),
      backgroundImageHeight: clampPercent(stored.backgroundImageHeight ?? fresh.backgroundImageHeight, 10, 200),
      componentStyle: ["filmstrip", "css"].includes(stored.componentStyle) ? stored.componentStyle : fresh.componentStyle,
      gridSnapEnabled: typeof stored.gridSnapEnabled === "boolean" ? stored.gridSnapEnabled : fresh.gridSnapEnabled,
      gridSize: GRID_SIZE_OPTIONS.includes(Number(stored.gridSize)) ? Number(stored.gridSize) : fresh.gridSize,
      resizeAspectLocked: typeof stored.resizeAspectLocked === "boolean" ? stored.resizeAspectLocked : fresh.resizeAspectLocked,
      uiTemplate: migrateLumaOpto ? "vintage" : UI_TEMPLATE_OPTIONS.some((option) => option.id === stored.uiTemplate) ? stored.uiTemplate : fresh.uiTemplate,
      uiColor: isHexColor(stored.uiColor) ? stored.uiColor : defaultUiColor(migrateLumaOpto ? "vintage" : stored.uiTemplate || fresh.uiTemplate),
      accentColor: migrateLumaOpto ? "#d6b56d" : migrateMixforgePanel ? "#b32620" : stored.accentColor || fresh.accentColor,
      brandFont: migrateLumaOpto ? "cinzel" : BRAND_FONT_OPTIONS.some((option) => option.id === stored.brandFont) ? stored.brandFont : fresh.brandFont,
      brandTagline: migrateLumaOpto ? "PASSIVE PROGRAM EQUALIZER" : typeof stored.brandTagline === "string" ? stored.brandTagline.slice(0, 80) : fresh.brandTagline,
      brandSize: migrateAmpStack ? 16 : clampPercent(stored.brandSize ?? fresh.brandSize, 12, 64),
      brandX: migrateAmpStack ? 17 : clampPercent(stored.brandX ?? fresh.brandX, 4, 96),
      brandY: migrateAmpStack ? 7 : clampPercent(stored.brandY ?? fresh.brandY, 7, 93),
      brandAlign: migrateAmpStack ? "left" : ["left", "center", "right"].includes(stored.brandAlign) ? stored.brandAlign : fresh.brandAlign,
      effects: { ...fresh.effects, ...(stored.effects || {}) },
      controls: Array.isArray(stored.controls) ? stored.controls : fresh.controls,
      interfaceControls: migratedObsidianState?.interfaceControls || (migrateLumaOpto ? createTemplateControls("vintageeq", 49) : migrateMixforgePanel ? createTemplateControls("mixforge", 49) : migratePrismControls ? createTemplateControls("prismeq", 49, "direct") : Array.isArray(stored.interfaceControls) ? (migrateAmpStack ? migrateAmpStackControls : (controls) => controls)(stored.interfaceControls.map((control) => normalizeInterfaceControl({ ...control, moduleId: control.moduleId || null, notePitch: Number.isInteger(control.notePitch) ? control.notePitch : 60, keyCount: KEYBOARD_SIZE_OPTIONS.includes(Number(control.keyCount)) ? Number(control.keyCount) : undefined }))) : []),
      presets: Array.isArray(stored.presets) ? stored.presets.slice(0, 128) : [],
      midiMappings: [],
      midiSequences: Array.isArray(stored.midiSequences) ? stored.midiSequences.slice(0, 16) : [],
      samplerGroups: Array.isArray(stored.samplerGroups) && stored.samplerGroups.length ? stored.samplerGroups.slice(0, 16).map(normalizeSamplerGroup) : fresh.samplerGroups,
      engineModules: migratedObsidianState?.engineModules || normalizeDspRack(stored.engineModules),
      impulseResponses: Array.isArray(stored.impulseResponses) ? stored.impulseResponses.slice(0, 16) : [],
      pianoNotes: Array.isArray(stored.pianoNotes) ? stored.pianoNotes : [],
      sampleMappings: Array.isArray(stored.sampleMappings) ? stored.sampleMappings.map(normalizeSampleMapping) : [],
    };
    const prismState = withPrismSpectrumDsp(draft.projectTemplate, draft.interfaceControls, draft.engineModules);
    draft.interfaceControls = prismState.controls;
    draft.engineModules = prismState.modules;
    return {
      ...draft,
      pitchBendEnabled: typeof stored.pitchBendEnabled === "boolean" ? stored.pitchBendEnabled : hasInterfaceParameter(draft.interfaceControls, "pitch_bend"),
      modulationEnabled: typeof stored.modulationEnabled === "boolean" ? stored.modulationEnabled : hasInterfaceParameter(draft.interfaceControls, "modulation"),
    };
  } catch {
    return fresh;
  }
};

const readSampleMetadata = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SAMPLE_STORAGE_KEY) || "[]");
    return Array.isArray(stored)
      ? stored.filter((sample) => sample && typeof sample.id === "string" && typeof sample.name === "string" && /\.wav$/i.test(sample.name) && Number.isFinite(sample.size)).map((sample) => ({ ...sample, file: null }))
      : [];
  } catch {
    return [];
  }
};

const formatBytes = (bytes) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const toProjectPayload = (project, samples) => {
  const effectProject = project.pluginKind === "effect";
  const wavSampleIds = new Set(effectProject ? [] : samples.filter((sample) => /\.wav$/i.test(String(sample.name || ""))).map((sample) => sample.id));
  return ({
  name: project.name.trim(),
  manufacturer_name: project.manufacturerName.trim(),
  brand_tagline: project.brandTagline.trim(),
  brand_font: project.brandFont,
  brand_size: Number(project.brandSize),
  brand_x: Number(project.brandX),
  brand_y: clampPercent(project.brandY, 4, 93),
  brand_align: project.brandAlign,
  plugin_version: project.pluginVersion,
  plugin_kind: project.pluginKind || "instrument",
  instrument_type: project.instrumentType,
  root_note: project.rootNote,
  note_range: project.noteRange,
  velocity_layers: Number(project.velocityLayers),
  polyphony: Number(project.polyphony),
  tempo_bpm: Math.max(20, Math.min(300, Number(project.tempoBpm) || 120)),
  project_template: project.projectTemplate,
  pricing_template_id: project.pricingTemplateId || project.projectTemplate,
  license_max_activations: normalizeLicenseActivationChoice(project.licenseMaxActivations),
  keyboard_keys: Number(project.keyboardKeys),
  canvas_width: Number(project.canvasWidth) || 0,
  canvas_height: Number(project.canvasHeight) || 0,
  background_image_url: project.backgroundImageUrl || null,
  background_image_name: project.backgroundImageName || null,
  background_fit: project.backgroundFit || "cover",
  background_opacity: Number(project.backgroundOpacity) || 0,
  background_image_x: clampPercent(project.backgroundImageX, 0, 100),
  background_image_y: clampPercent(project.backgroundImageY, 0, 100),
  background_image_width: clampPercent(project.backgroundImageWidth, 10, 200),
  background_image_height: clampPercent(project.backgroundImageHeight, 10, 200),
  component_style: project.componentStyle || (project.pluginKind === "effect" ? "filmstrip" : "css"),
  grid_snap_enabled: project.gridSnapEnabled !== false,
  grid_size: Number(project.gridSize) || 8,
  resize_aspect_locked: project.resizeAspectLocked !== false,
  ui_template: project.uiTemplate,
  ui_color: project.uiColor,
  accent_color: project.accentColor,
  effects: project.effects,
  controls: project.controls,
  sustain_enabled: project.sustainEnabled === true,
  pitch_bend_enabled: project.pitchBendEnabled === true,
  modulation_enabled: project.modulationEnabled === true,
  interface_controls: project.interfaceControls.map((rawControl) => {
    const normalized = normalizeInterfaceControl(rawControl);
    const { notePitch, moduleId, keyCount, showBackground, show_background: legacyShowBackground, labelPosition, label_position: legacyLabelPosition, labelGap, label_gap: legacyLabelGap, labelX, labelY, label_x: legacyLabelX, label_y: legacyLabelY, meterMode, meter_mode: legacyMeterMode, padColor, padActiveColor, pad_color: legacyPadColor, pad_active_color: legacyPadActiveColor, visualColor, visual_color: legacyVisualColor, spectrumBand, spectrum_band: legacySpectrumBand, prismControlMode, prism_control_mode: legacyPrismControlMode, prismContext, prism_context: legacyPrismContext, prismOwnerId, prism_owner_id: legacyPrismOwnerId, textFont, text_font: legacyTextFont, textColor, text_color: legacyTextColor, controlColor, control_color: legacyControlColor, imageUrl, imageName, imageFit, imageOpacity, image_url: legacyImageUrl, image_name: legacyImageName, image_fit: legacyImageFit, image_opacity: legacyImageOpacity, parentPanelId, parent_panel_id: legacyParentPanelId, panelType, panel_type: legacyPanelType, panelX, panel_x: legacyPanelX, panelY, panel_y: legacyPanelY, panelWidth, panel_width: legacyPanelWidth, panelHeight, panel_height: legacyPanelHeight, ...control } = normalized;
    return {
      ...control,
      module_id: moduleId || null,
      note_pitch: notePitch ?? 60,
      show_background: (showBackground ?? legacyShowBackground) !== false,
      label_position: labelPosition ?? legacyLabelPosition ?? defaultLabelPosition(control.kind),
      label_gap: normalizeLabelGap(labelGap ?? legacyLabelGap),
      parent_panel_id: parentPanelId || legacyParentPanelId || null,
      panel_type: control.kind === "panel_button" ? (panelType || legacyPanelType) : null,
      panel_x: panelX ?? legacyPanelX ?? 50,
      panel_y: panelY ?? legacyPanelY ?? 52,
      panel_width: panelWidth ?? legacyPanelWidth ?? 88,
      panel_height: panelHeight ?? legacyPanelHeight ?? 78,
      ...(["gain_meter", "vu_meter"].includes(control.kind) ? { meter_mode: meterMode || legacyMeterMode || (control.kind === "gain_meter" ? "stereo" : "mono") } : {}),
      ...(control.kind === "pad" && isHexColor(padColor ?? legacyPadColor) ? { pad_color: padColor ?? legacyPadColor } : {}),
      ...(control.kind === "pad" && isHexColor(padActiveColor ?? legacyPadActiveColor) ? { pad_active_color: padActiveColor ?? legacyPadActiveColor } : {}),
      ...(["visual", "spectrum"].includes(control.kind) && isHexColor(visualColor ?? legacyVisualColor) ? { visual_color: visualColor ?? legacyVisualColor } : {}),
      ...(spectrumBand === true || legacySpectrumBand === true ? { spectrum_band: true } : {}),
      ...(PRISM_CONTROL_MODES.has(prismControlMode ?? legacyPrismControlMode) ? { prism_control_mode: prismControlMode ?? legacyPrismControlMode } : {}),
      ...(["frequency", "gain", "q"].includes(prismContext ?? legacyPrismContext) ? { prism_context: prismContext ?? legacyPrismContext } : {}),
      ...((prismOwnerId ?? legacyPrismOwnerId) ? { prism_owner_id: prismOwnerId ?? legacyPrismOwnerId } : {}),
      ...(control.kind === "text" ? { text_font: textFont || legacyTextFont || "space-grotesk", text_color: textColor || legacyTextColor || "#F4F4F5" } : {}),
      ...(isHexColor(controlColor ?? legacyControlColor) ? { control_color: controlColor ?? legacyControlColor } : {}),
      ...(control.kind === "image" ? {
        image_url: imageUrl || legacyImageUrl || null,
        image_name: imageName || legacyImageName || null,
        image_fit: imageFit || legacyImageFit || "contain",
        image_opacity: Math.max(0, Math.min(100, Number(imageOpacity ?? legacyImageOpacity ?? 100))),
      } : {}),
      ...(control.kind === "keyboard" ? { key_count: keyCount ?? project.keyboardKeys } : {}),
    };
  }),
  presets: project.presets || [],
  midi_mappings: [],
  midi_sequences: (project.midiSequences || []).map(({ durationTicks, loopEnabled, ...sequence }) => ({ ...sequence, duration_ticks: durationTicks, loop_enabled: loopEnabled === true })),
  sampler_groups: (project.samplerGroups || [createSamplerGroup()]).map((group, index) => {
    const normalized = normalizeSamplerGroup(group, index);
    return { id: normalized.id, name: normalized.name, volume: normalized.volume, pan: normalized.pan, mute: normalized.mute, solo: normalized.solo };
  }),
  engine_modules: serializeDspRack(project.engineModules),
  impulse_responses: (project.impulseResponses || []).map((impulse) => ({
    id: impulse.id,
    module_id: impulse.moduleId,
    filename: impulse.name,
    size_bytes: impulse.size,
    normalize: impulse.normalize !== false,
    auto_trim: impulse.autoTrim !== false,
    trim_start: Number(impulse.trimStart ?? 0),
    trim_end: Number(impulse.trimEnd ?? 1),
    polarity_inverted: impulse.polarityInverted === true,
    phase_ms: Number(impulse.phaseMs ?? 0),
  })),
  piano_roll_notes: project.pianoNotes,
  sample_mappings: project.sampleMappings.filter((mapping) => wavSampleIds.has(mapping.sampleId)).map((mapping) => ({
    id: mapping.id,
    sample_id: mapping.sampleId,
    root_pitch: mapping.rootPitch,
    low_pitch: mapping.lowPitch,
    high_pitch: mapping.highPitch,
    velocity_low: mapping.velocityLow,
    velocity_high: mapping.velocityHigh,
    group_name: normalizeSamplerName(mapping.groupName),
    articulation: mapping.articulation?.trim() || "Sustain",
    round_robin: mapping.roundRobin,
    mic_position: mapping.micPosition?.trim() || "Main",
    sample_start: mapping.sampleStart ?? 0,
    sample_end: mapping.sampleEnd ?? 1,
    loop_enabled: !!mapping.loopEnabled,
    loop_start: mapping.loopStart ?? mapping.sampleStart ?? 0,
    loop_end: mapping.loopEnd ?? mapping.sampleEnd ?? 1,
    loop_crossfade_ms: Math.max(0, Math.min(100, Number(mapping.loopCrossfadeMs) || 0)),
    fade_in_ms: mapping.fadeInMs ?? 0,
    fade_out_ms: mapping.fadeOutMs ?? 0,
    tune_semitones: mapping.tuneSemitones ?? 0,
    tune_cents: mapping.tuneCents ?? 0,
    playback_mode: mapping.playbackMode === "tempo_sync" ? "tempo_sync" : "sampler",
    source_bpm: Math.max(20, Math.min(300, Number(mapping.sourceBpm) || 120)),
    source_bpm_confirmed: mapping.sourceBpmConfirmed === true,
    choke_target_pitches: normalizeChokeTargetPitches(mapping.chokeTargetPitches),
    gain_db: mapping.gainDb ?? 0,
    pan: mapping.pan ?? 0,
  })),
  samples: samples.filter((sample) => wavSampleIds.has(sample.id)).map(({ id, name, size }) => ({ id, filename: name, size_bytes: size })),
  });
};

const fromSavedProject = (saved) => {
  const migrateLumaOpto = saved.project_template === "lumaopto";
  const savedBackgroundUrl = typeof saved.background_image_url === "string" ? saved.background_image_url : "";
  const migrateAmpStack = saved.project_template === "ampsimulator"
    && (!savedBackgroundUrl || savedBackgroundUrl === LEGACY_AMP_BACKGROUND_URL);
  const migrateObsidianDsp = saved.project_template === "obsidianhighgain" && isLegacyHighGainAmpRack(saved.engine_modules);
  const migratedObsidianState = migrateObsidianDsp ? createHighGainAmpTemplateState(() => makeId()) : null;
  const savedWavSamples = (saved.samples || [])
    .filter((sample) => /\.wav$/i.test(String(sample.filename || "")));
  const wavSampleIds = new Set(savedWavSamples
    .map((sample) => sample.id));
  const project = {
  projectId: saved.id,
  name: migrateLumaOpto && saved.name === "Luma Opto Leveler" ? "Vintage EQ" : saved.name,
  manufacturerName: saved.manufacturer_name || "TripleSide Studio",
  brandTagline: migrateLumaOpto ? "PASSIVE PROGRAM EQUALIZER" : saved.brand_tagline || "",
  brandFont: migrateLumaOpto ? "cinzel" : BRAND_FONT_OPTIONS.some((option) => option.id === saved.brand_font) ? saved.brand_font : "outfit",
  brandSize: migrateLumaOpto ? 25 : migrateAmpStack ? 16 : clampPercent(saved.brand_size ?? 24, 12, 64),
  brandX: migrateAmpStack ? 17 : clampPercent(saved.brand_x ?? 18, 4, 96),
  brandY: migrateLumaOpto ? 11 : migrateAmpStack ? 7 : clampPercent(saved.brand_y ?? 13, 7, 93),
  brandAlign: migrateAmpStack ? "left" : ["left", "center", "right"].includes(saved.brand_align) ? saved.brand_align : "left",
  pluginVersion: saved.plugin_version || "1.0.0",
  pluginKind: saved.plugin_kind || "instrument",
  instrumentType: saved.instrument_type,
  rootNote: saved.root_note,
  noteRange: saved.note_range,
  velocityLayers: saved.velocity_layers,
  polyphony: saved.polyphony,
  tempoBpm: Math.max(20, Math.min(300, Number(saved.tempo_bpm) || 120)),
  sustainEnabled: saved.sustain_enabled === true,
  projectTemplate: migrateLumaOpto ? "vintageeq" : saved.project_template || "sampler",
  pricingTemplateId: saved.pricing_template_id || (migrateLumaOpto ? "vintageeq" : saved.project_template || "sampler"),
  pricingTemplateBaseline: saved.pricing_template_baseline || null,
  licenseMaxActivations: 1,
  keyboardKeys: KEYBOARD_SIZE_OPTIONS.includes(Number(saved.keyboard_keys)) ? Number(saved.keyboard_keys) : 49,
  canvasWidth: Math.max(0, Math.min(1024, Number(saved.canvas_width) || 0)),
  canvasHeight: saved.project_template === "premiumkeys" && (!Number(saved.canvas_height) || Number(saved.canvas_height) === 520) ? PREMIUM_PIANO_CANVAS_HEIGHT : Math.max(0, Math.min(1024, Number(saved.canvas_height) || 0)),
  backgroundImageUrl: migrateLumaOpto ? "/images/vst-assets/vintage-passive-eq-panel-v1.png" : migrateAmpStack ? AMP_STACK_BACKGROUND_URL : savedBackgroundUrl || (saved.project_template === "premiumkeys" ? PREMIUM_PIANO_BACKGROUND_URL : ""),
  backgroundImageName: migrateLumaOpto ? "Vintage Passive EQ Panel" : migrateAmpStack ? "Original Cream British Amp Stack" : typeof saved.background_image_name === "string" && saved.background_image_name ? saved.background_image_name : saved.project_template === "premiumkeys" ? "Aurum Concert Grand Piano" : "",
  backgroundFit: ["cover", "contain", "stretch"].includes(saved.background_fit) ? saved.background_fit : "cover",
  backgroundOpacity: Number.isFinite(Number(saved.background_opacity)) ? Math.max(0, Math.min(100, Number(saved.background_opacity))) : 70,
  backgroundImageX: clampPercent(saved.background_image_x ?? 50, 0, 100),
  backgroundImageY: clampPercent(saved.background_image_y ?? 50, 0, 100),
  backgroundImageWidth: clampPercent(saved.background_image_width ?? 100, 10, 200),
  backgroundImageHeight: clampPercent(saved.background_image_height ?? 100, 10, 200),
  componentStyle: ["filmstrip", "css"].includes(saved.component_style) ? saved.component_style : saved.plugin_kind === "effect" ? "filmstrip" : "css",
  gridSnapEnabled: typeof saved.grid_snap_enabled === "boolean" ? saved.grid_snap_enabled : true,
  gridSize: GRID_SIZE_OPTIONS.includes(Number(saved.grid_size)) ? Number(saved.grid_size) : 8,
  resizeAspectLocked: typeof saved.resize_aspect_locked === "boolean" ? saved.resize_aspect_locked : true,
  uiTemplate: migrateLumaOpto ? "vintage" : saved.ui_template || "studio",
  uiColor: isHexColor(saved.ui_color) ? saved.ui_color : defaultUiColor(migrateLumaOpto ? "vintage" : saved.ui_template || "studio"),
  accentColor: migrateLumaOpto ? "#d6b56d" : saved.accent_color,
  effects: saved.effects || {},
  controls: saved.controls || [],
  interfaceControls: migratedObsidianState?.interfaceControls || (migrateLumaOpto ? createTemplateControls("vintageeq", 49) : (migrateAmpStack ? migrateAmpStackControls : (controls) => controls)((saved.interface_controls || []).map(({ note_pitch, module_id, key_count, show_background, label_position, pad_color, pad_active_color, visual_color, spectrum_band, prism_control_mode, prism_context, prism_owner_id, text_font, text_color, control_color, image_url, image_name, image_fit, image_opacity, parent_panel_id, panel_type, panel_x, panel_y, panel_width, panel_height, ...control }) => normalizeInterfaceControl({ ...control, moduleId: module_id || null, notePitch: note_pitch ?? 60, keyCount: key_count || undefined, showBackground: show_background !== false, labelPosition: label_position, padColor: pad_color, padActiveColor: pad_active_color, visualColor: visual_color, spectrumBand: spectrum_band === true, prismControlMode: prism_control_mode, prismContext: prism_context, prismOwnerId: prism_owner_id, textFont: text_font, textColor: text_color, controlColor: control_color, imageUrl: image_url, imageName: image_name, imageFit: image_fit, imageOpacity: image_opacity, parentPanelId: parent_panel_id, panelType: panel_type, panelX: panel_x, panelY: panel_y, panelWidth: panel_width, panelHeight: panel_height })))),
  presets: Array.isArray(saved.presets) ? saved.presets : [],
  midiMappings: [],
  midiSequences: (saved.midi_sequences || []).map(({ duration_ticks, loop_enabled, ...sequence }) => ({ ...sequence, durationTicks: duration_ticks, loopEnabled: loop_enabled === true })),
  samplerGroups: Array.isArray(saved.sampler_groups) && saved.sampler_groups.length ? saved.sampler_groups.slice(0, 16).map(normalizeSamplerGroup) : [createSamplerGroup()],
  engineModules: migratedObsidianState?.engineModules || normalizeDspRack(saved.engine_modules),
  impulseResponses: (saved.impulse_responses || []).map((impulse) => ({
    id: impulse.id,
    moduleId: impulse.module_id,
    name: impulse.filename,
    size: impulse.size_bytes,
    uploaded: false,
    ...normalizeImpulseSettings({
      normalize: impulse.normalize,
      autoTrim: impulse.auto_trim,
      trimStart: impulse.trim_start,
      trimEnd: impulse.trim_end,
      polarityInverted: impulse.polarity_inverted,
      phaseMs: impulse.phase_ms,
    }),
  })),
  pianoNotes: saved.piano_roll_notes || [],
  sampleMappings: (saved.sample_mappings || []).filter((mapping) => wavSampleIds.has(mapping.sample_id)).map((mapping) => ({
    id: mapping.id,
    sampleId: mapping.sample_id,
    // Saved mapping coordinates are authoritative. Inferring a drum note from
    // the filename here used to move every similarly named sample (for
    // example multiple "Tom Rack" velocity layers) onto the same key after
    // each save/reload.
    rootPitch: mapping.root_pitch,
    lowPitch: mapping.low_pitch,
    highPitch: mapping.high_pitch,
    velocityLow: mapping.velocity_low,
    velocityHigh: mapping.velocity_high,
    groupName: normalizeSamplerName(mapping.group_name),
    articulation: mapping.articulation || "Sustain",
    roundRobin: mapping.round_robin || 1,
    micPosition: mapping.mic_position || "Main",
    sampleStart: mapping.sample_start ?? 0,
    sampleEnd: mapping.sample_end ?? 1,
    loopEnabled: !!mapping.loop_enabled,
    loopStart: mapping.loop_start ?? mapping.sample_start ?? 0,
    loopEnd: mapping.loop_end ?? mapping.sample_end ?? 1,
    loopCrossfadeMs: Math.max(0, Math.min(100, Number(mapping.loop_crossfade_ms) || 0)),
    fadeInMs: mapping.fade_in_ms ?? 0,
    fadeOutMs: mapping.fade_out_ms ?? 0,
    tuneSemitones: mapping.tune_semitones ?? 0,
    tuneCents: mapping.tune_cents ?? 0,
    playbackMode: mapping.playback_mode === "tempo_sync" ? "tempo_sync" : "sampler",
    sourceBpm: Math.max(20, Math.min(300, Number(mapping.source_bpm) || 120)),
    sourceBpmConfirmed: mapping.source_bpm_confirmed === true,
    chokeTargetPitches: normalizeChokeTargetPitches(mapping.choke_target_pitches),
    gainDb: mapping.gain_db ?? 0,
    pan: mapping.pan ?? 0,
  })),
  };
  const prismState = withPrismSpectrumDsp(project.projectTemplate, project.interfaceControls, project.engineModules);
  project.interfaceControls = prismState.controls;
  project.engineModules = prismState.modules;
  return {
    ...project,
    pitchBendEnabled: typeof saved.pitch_bend_enabled === "boolean" ? saved.pitch_bend_enabled : hasInterfaceParameter(project.interfaceControls, "pitch_bend"),
    modulationEnabled: typeof saved.modulation_enabled === "boolean" ? saved.modulation_enabled : hasInterfaceParameter(project.interfaceControls, "modulation"),
  };
};

const savedProjectSamples = (saved, assets = []) => {
  const assetsBySample = new Map(assets.map((asset) => [asset.sample_id, asset]));
  return (saved.samples || []).filter((sample) => /\.wav$/i.test(String(sample.filename || ""))).map((sample) => {
    const asset = assetsBySample.get(sample.id);
    return {
      id: sample.id || makeId(),
      name: sample.filename,
      size: sample.size_bytes,
      file: null,
      uploaded: !!asset,
      assetId: asset?.id || null,
      sha256: asset?.sha256 || null,
      uploadedAt: asset?.uploaded_at || null,
      previewUrl: asset?.preview_url || null,
    };
  });
};

const savedProjectImpulses = (saved, assets = []) => {
  const assetsByImpulse = new Map(assets.map((asset) => [asset.impulse_id, asset]));
  return (saved.impulse_responses || []).map((impulse) => {
    const asset = assetsByImpulse.get(impulse.id);
    return {
      id: impulse.id,
      moduleId: impulse.module_id,
      name: impulse.filename,
      size: impulse.size_bytes,
      uploaded: !!asset,
      assetId: asset?.id || null,
      sha256: asset?.sha256 || null,
      uploadedAt: asset?.uploaded_at || null,
      previewUrl: asset ? `${asset.preview_url || ""}` : null,
      ...normalizeImpulseSettings({
        normalize: impulse.normalize,
        autoTrim: impulse.auto_trim,
        trimStart: impulse.trim_start,
        trimEnd: impulse.trim_end,
        polarityInverted: impulse.polarity_inverted,
        phaseMs: impulse.phase_ms,
      }),
    };
  });
};

const fetchSavedProjects = async (apiBase) => {
  const pageSize = 100;
  const projects = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data } = await api.get(`${apiBase}/projects`, { params: { limit: pageSize, offset } });
    const page = Array.isArray(data) ? data : [];
    projects.push(...page);
    if (page.length < pageSize) return projects;
  }
};

const normalizePublishedTemplate = (template) => {
  const project = template.project || {};
  const baseTemplate = PROJECT_TEMPLATE_OPTIONS.find((item) => item.id === project.project_template);
  const hasCustomBackground = !!project.background_image_url && project.background_image_url !== baseTemplate?.backgroundUrl;
  return {
    id: template.id,
    sourceProjectId: template.source_project_id || null,
    name: template.name,
    description: template.description,
    templateCategory: template.template_category,
    pluginKind: template.plugin_kind,
    instrumentType: template.instrument_type,
    symbol: template.symbol || (template.plugin_kind === "effect" ? "FX" : "VST"),
    accentColor: template.accent_color,
    backgroundUrl: template.background_url || "",
    thumbnailUrl: template.thumbnail_url || template.background_url || "",
    customThumbnail: Boolean(template.thumbnail_url),
    brandTagline: template.brand_tagline || "ADMIN TEMPLATE",
    highlights: Array.isArray(template.highlights) ? template.highlights : ["Template admin"],
    project,
    publishedByAdmin: true,
    builtInTemplate: template.built_in_template === true || PROJECT_TEMPLATE_OPTIONS.some((item) => item.id === template.id),
    requiresPremium: PREMIUM_PROJECT_TEMPLATE_IDS.has(project.project_template)
      || ["aurum", "mixforge"].includes(project.ui_template)
      || hasCustomBackground,
  };
};

export default function VstMakerPreview({ customerMode = false, entitlement = null }) {
  const apiBase = customerMode ? "/customer/vst-maker" : "/admin/vst-maker";
  const canUseFeature = (feature) => !customerMode || entitlement?.features?.includes(feature);
  const planSampleFileLimit = customerMode
    ? ({ free: 25_000_000, creator: 100_000_000, pro: 250_000_000, studio: MAX_SAMPLE_BYTES, ultimate: MAX_SAMPLE_BYTES, credit: MAX_SAMPLE_BYTES }[entitlement?.tier] || 0)
    : MAX_SAMPLE_BYTES;
  const [project, setProject] = useState(readDraft);
  const [samples, setSamples] = useState(readSampleMetadata);
  const [sampleMessage, setSampleMessage] = useState("");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [r2Storage, setR2Storage] = useState(null);
  const [savedProjects, setSavedProjects] = useState([]);
  const [publishedTemplates, setPublishedTemplates] = useState([]);
  const [templateCatalogLoaded, setTemplateCatalogLoaded] = useState(false);
  const [templateSettings, setTemplateSettings] = useState({});
  const [pricing, setPricing] = useState(DEFAULT_VST_PRICING);
  const [pricingDraft, setPricingDraft] = useState(DEFAULT_VST_PRICING);
  const [savingPricing, setSavingPricing] = useState(false);
  const [buildSettings, setBuildSettings] = useState(DEFAULT_VST_BUILD_SETTINGS);
  const [buildSettingsDraft, setBuildSettingsDraft] = useState(DEFAULT_VST_BUILD_SETTINGS);
  const [savingBuildSettings, setSavingBuildSettings] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantCredits, setGrantCredits] = useState(100);
  const [grantNote, setGrantNote] = useState("");
  const [grantBusy, setGrantBusy] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [savingProject, setSavingProject] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState(null);
  const [uploadingTemplateThumbnailId, setUploadingTemplateThumbnailId] = useState(null);
  const [reorderingTemplateId, setReorderingTemplateId] = useState(null);
  const [sampleUploadProgress, setSampleUploadProgress] = useState({});
  const [impulseUploadProgress, setImpulseUploadProgress] = useState({});
  const [customImpulseTaps, setCustomImpulseTaps] = useState({});
  const [buildJobs, setBuildJobs] = useState([]);
  const [queueingBuild, setQueueingBuild] = useState(false);
  const [buildPanelExpanded, setBuildPanelExpanded] = useState(false);
  const [buildLicenseDialogOpen, setBuildLicenseDialogOpen] = useState(false);
  const [buildRequestMode, setBuildRequestMode] = useState("export");
  const [buildTargetPlatform, setBuildTargetPlatform] = useState("windows");
  const [authoritativeBuildQuote, setAuthoritativeBuildQuote] = useState(null);
  const [distributionBuildChoice, setDistributionBuildChoice] = useState({ enabled: false, quantity: 10, maxActivations: 1 });
  const [liveCustomerActivity, setLiveCustomerActivity] = useState({ items: [], editing_count: 0, building_count: 0, updated_at: "" });
  const [creditBalance, setCreditBalance] = useState(() => Number(entitlement?.build_credits || 0));
  const [selectedInterfaceControlIds, setSelectedInterfaceControlIds] = useState([]);
  const selectedInterfaceControlId = selectedInterfaceControlIds.at(-1) || null;
  const [, setDesignerHistoryVersion] = useState(0);
  const [activeEditorTab, setActiveEditorTab] = useState("interface");
  const [dspModuleLibraryOpen, setDspModuleLibraryOpen] = useState(false);
  const [expandedDspModuleId, setExpandedDspModuleId] = useState(null);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [newTemplateDialogOpen, setNewTemplateDialogOpen] = useState(false);
  const [projectTemplateCategory, setProjectTemplateCategory] = useState("all");
  const [draftListOpen, setDraftListOpen] = useState(false);
  const [appliedTemplateId, setAppliedTemplateId] = useState(null);
  const [samplerVelocity, setSamplerVelocity] = useState(100);
  const [samplerSustain, setSamplerSustain] = useState(() => project.sustainEnabled === true);
  const [pitchBendValue, setPitchBendValue] = useState(50);
  const [modulationValue, setModulationValue] = useState(0);
  const [samplerAudioStatus, setSamplerAudioStatus] = useState("Pilih atau unggah sampel untuk mencoba keyboard.");
  const [waveformPlayback, setWaveformPlayback] = useState(null);
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState("");
  const [midiStatus, setMidiStatus] = useState("Belum terhubung");
  const [midiPressedPitches, setMidiPressedPitches] = useState(() => new Set());
  const [previewPressedPitches, setPreviewPressedPitches] = useState(() => new Set());
  const projectRef = useRef(project);
  const samplesRef = useRef(samples);
  const designerHistoryPastRef = useRef([]);
  const designerHistoryFutureRef = useRef([]);
  const designerHistoryLastMutationRef = useRef({ at: 0, key: null });
  const midiAccessRef = useRef(null);
  const midiHeldTokensRef = useRef(new Map());
  const midiPlayRef = useRef(null);
  const midiStopRef = useRef(null);
  const midiSustainRef = useRef(null);
  const midiNoteSequenceRef = useRef(0);
  const sampleAudioUrlsRef = useRef(new Map());
  const samplePreviewRequestsRef = useRef(new Map());
  const decodedSampleBuffersRef = useRef(new Map());
  const decodedSampleRequestsRef = useRef(new Map());
  const activeSamplerVoicesRef = useRef(new Map());
  const activeGrooveVoicesRef = useRef(new Map());
  const grooveFallbackTokensRef = useRef(new Set());
  const grooveFallbackTimersRef = useRef(new Map());
  const grooveVisualTimersRef = useRef(new Map());
  const activeWaveVoicesRef = useRef(new Map());
  const heldWaveNotesRef = useRef(new Map());
  const waveNoteSequenceRef = useRef(0);
  const lastWavePitchRef = useRef(null);
  const pendingPreviewTokensRef = useRef(new Set());
  const pendingPreviewVoiceMetaRef = useRef(new Map());
  const releasedPreviewTokensRef = useRef(new Set());
  const audioContextRef = useRef(null);
  const meterAnalyserRef = useRef(null);
  const reverbImpulseRef = useRef(null);
  const impulseFilesRef = useRef(new Map());
  const impulseBuffersRef = useRef(new Map());
  const saturationCurvesRef = useRef(new Map());
  const wavePeriodicWavesRef = useRef(new Map());
  const waveNoiseBuffersRef = useRef(new Map());
  const dspWorkletReadyContextRef = useRef(null);
  const waveDspGraphRef = useRef(null);
  const samplerEffectsGraphRef = useRef(null);
  const hitPitchTokensRef = useRef(new Map());
  const roundRobinCursorRef = useRef(new Map());
  const samplerSustainRef = useRef(project.sustainEnabled === true);
  const samplerSustainPedalRef = useRef(false);
  const pitchBendRef = useRef(50);
  const modulationRef = useRef(0);
  const editorTabsRef = useRef(null);
  const newProjectMenuRef = useRef(null);
  const savedProjectsMenuRef = useRef(null);
  const initialTemplateAppliedRef = useRef(false);
  const isEffectProject = project.pluginKind === "effect";
  const waveGeneratorModule = project.engineModules.find((module) => module.type === "wave_generator") || null;
  const dspRackModules = project.engineModules.filter((module) => module.type !== "wave_generator");
  const hasActiveWaveGenerator = !!waveGeneratorModule && !waveGeneratorModule.bypassed;
  const buildCreditQuote = useMemo(
    () => quoteVstProjectCredits({ ...project, samples }, pricing, buildSettings),
    [project, samples, pricing, buildSettings],
  );
  const templateIncludedSampleIds = useMemo(() => new Set(
    (project.pricingTemplateBaseline?.samples || []).map((sample) => String(sample.id || sample.sample_id || "")),
  ), [project.pricingTemplateBaseline]);
  const buildDialogQuote = useMemo(() => {
    if (!authoritativeBuildQuote) return buildCreditQuote;
    if (Number(authoritativeBuildQuote.licenseMaxActivations) === Number(buildCreditQuote.licenseMaxActivations)) {
      return authoritativeBuildQuote;
    }
    return {
      ...buildCreditQuote,
      standardTotalCredits: buildCreditQuote.totalCredits,
      correctionRebuild: {
        mode: "new_build",
        eligible: false,
        reasons: ["Pilihan serial atau kapasitas perangkat berubah"],
        full_price_credits: buildCreditQuote.totalCredits,
        charged_credits: buildCreditQuote.totalCredits,
        savings_credits: 0,
      },
    };
  }, [authoritativeBuildQuote, buildCreditQuote]);
  const insufficientCredits = customerMode && creditBalance < buildCreditQuote.totalCredits;

  useEffect(() => {
    setCreditBalance(Number(entitlement?.build_credits || 0));
  }, [entitlement?.build_credits]);
  const isPrismEqProject = project.projectTemplate === "prismeq";
  const allProjectTemplates = useMemo(() => {
    const publishedTemplateIds = new Set(publishedTemplates.map((template) => template.id));
    const templates = [
      ...publishedTemplates
        .filter((template) => !BASIC_PROJECT_TEMPLATE_IDS.has(template.id) && !templateSettings[template.id]?.hidden)
        .map((template) => ({
        ...template,
        thumbnailUrl: templateSettings[template.id]?.thumbnail_url || template.thumbnailUrl || template.backgroundUrl || "",
        customThumbnail: Boolean(templateSettings[template.id]?.thumbnail_url || template.customThumbnail),
      })),
      ...PROJECT_TEMPLATE_OPTIONS
        .filter((template) => !BASIC_PROJECT_TEMPLATE_IDS.has(template.id) && !templateSettings[template.id]?.hidden && !publishedTemplateIds.has(template.id))
        .map((template) => ({
          ...template,
          thumbnailUrl: templateSettings[template.id]?.thumbnail_url || template.backgroundUrl || "",
          customThumbnail: Boolean(templateSettings[template.id]?.thumbnail_url),
          builtInTemplate: true,
        })),
    ];
    return templates
      .map((template, index) => ({ template, index, order: Number.isInteger(templateSettings[template.id]?.sort_order) ? templateSettings[template.id].sort_order : 10000 + index }))
      .sort((left, right) => left.order - right.order || left.index - right.index)
      .map(({ template }) => template);
  }, [publishedTemplates, templateSettings]);
  const hiddenBuiltInTemplates = useMemo(
    () => PROJECT_TEMPLATE_OPTIONS.filter((template) => !BASIC_PROJECT_TEMPLATE_IDS.has(template.id) && templateSettings[template.id]?.hidden),
    [templateSettings],
  );

  useEffect(() => {
    if (!newProjectDialogOpen) return undefined;
    const closeNewProjectMenu = (event) => {
      if (event.key === "Escape") setNewProjectDialogOpen(false);
      if (event.type === "pointerdown" && !newProjectMenuRef.current?.contains(event.target)) setNewProjectDialogOpen(false);
    };
    window.addEventListener("keydown", closeNewProjectMenu);
    window.addEventListener("pointerdown", closeNewProjectMenu);
    return () => {
      window.removeEventListener("keydown", closeNewProjectMenu);
      window.removeEventListener("pointerdown", closeNewProjectMenu);
    };
  }, [newProjectDialogOpen]);

  useEffect(() => {
    if (!buildLicenseDialogOpen) return undefined;
    const closeBuildDialog = (event) => {
      if (event.key === "Escape" && !queueingBuild) setBuildLicenseDialogOpen(false);
    };
    window.addEventListener("keydown", closeBuildDialog);
    return () => window.removeEventListener("keydown", closeBuildDialog);
  }, [buildLicenseDialogOpen, queueingBuild]);

  useEffect(() => {
    if (!draftListOpen) return undefined;
    const closeSavedProjectsMenu = (event) => {
      if (event.key === "Escape") setDraftListOpen(false);
      if (event.type === "pointerdown" && !savedProjectsMenuRef.current?.contains(event.target)) setDraftListOpen(false);
    };
    window.addEventListener("keydown", closeSavedProjectsMenu);
    window.addEventListener("pointerdown", closeSavedProjectsMenu);
    return () => {
      window.removeEventListener("keydown", closeSavedProjectsMenu);
      window.removeEventListener("pointerdown", closeSavedProjectsMenu);
    };
  }, [draftListOpen]);

  const sampleIds = new Set(samples.map((sample) => sample.id));
  const moduleIds = new Set(project.engineModules.map((module) => module.id));
  const mappingsValid = project.sampleMappings.length > 0 && project.sampleMappings.every((mapping) => (
    sampleIds.has(mapping.sampleId)
    && mapping.lowPitch <= mapping.rootPitch
    && mapping.rootPitch <= mapping.highPitch
    && mapping.velocityLow <= mapping.velocityHigh
    && (mapping.playbackMode !== "tempo_sync" || (mapping.sourceBpmConfirmed === true && Number(mapping.sourceBpm) >= 20 && Number(mapping.sourceBpm) <= 300))
    && (mapping.sampleStart ?? 0) < (mapping.sampleEnd ?? 1)
    && (!mapping.loopEnabled || (
      (mapping.sampleStart ?? 0) <= (mapping.loopStart ?? 0)
      && (mapping.loopStart ?? 0) < (mapping.loopEnd ?? 1)
      && (mapping.loopEnd ?? 1) <= (mapping.sampleEnd ?? 1)
    ))
    && !!mapping.groupName?.trim()
    && !!mapping.articulation?.trim()
    && !!mapping.micPosition?.trim()
  ));
  const bindingsValid = project.interfaceControls.length > 0 && project.interfaceControls.every((control, index) => (
    !!controlLabelOrFallback(control, index)
    && (["visual", "text"].includes(control.kind) || !!String(control.parameter || "").trim())
    && (!control.moduleId || moduleIds.has(control.moduleId))
  ));
  const readinessItems = [
    { label: "Identitas & versi", ready: !!project.name.trim() && !["Untitled Instrument", "Untitled Plugin FX"].includes(project.name.trim()) && !!project.manufacturerName.trim() && /^\d+\.\d+\.\d+$/.test(project.pluginVersion), tab: "interface" },
    ...(!isEffectProject ? [
      { label: "Sumber audio", ready: samples.length > 0 || hasActiveWaveGenerator, tab: samples.length ? "sampler" : "sound" },
      { label: "Audio tersimpan privat", ready: samples.length > 0 ? samples.every((sample) => !!sample.uploaded) : hasActiveWaveGenerator, tab: "sampler" },
      { label: "Sample mapping valid", ready: samples.length > 0 ? mappingsValid : hasActiveWaveGenerator, tab: "sampler" },
    ] : [{ label: "Stereo input DSP", ready: EFFECT_PROJECT_TEMPLATE_IDS.has(project.projectTemplate), tab: "sound" }]),
    { label: "Panel & binding", ready: bindingsValid, tab: "interface" },
    { label: "Konfigurasi sound", ready: project.controls.length > 0 || project.engineModules.length > 0 || Object.values(project.effects).some(Boolean), tab: "sound" },
  ];
  const visibleEditorTabs = EDITOR_TABS.filter((tab) => (
    !(isEffectProject && ["sampler", "settings"].includes(tab.id))
    && !((customerMode || isEffectProject) && tab.id === "settings")
  ));
  const readinessCount = readinessItems.filter((item) => item.ready).length;
  const readinessPercent = Math.round((readinessCount / readinessItems.length) * 100);
  const latestBuild = buildJobs[0] || null;
  const latestReadyWindowsBuild = buildJobs.find((job) => job.status === "ready" && job.target_platform !== "macos") || null;
  const latestReadyMacBuild = buildJobs.find((job) => job.status === "ready" && job.target_platform === "macos") || null;
  const latestReadyBuildDownloads = [
    { platform: "windows", label: "Windows", build: latestReadyWindowsBuild },
    { platform: "macos", label: "macOS", build: latestReadyMacBuild },
  ].filter((item) => !!item.build);
  const isPersistedProject = !!project.projectId && !project.projectId.startsWith("draft-");
  const buildInProgress = ACTIVE_BUILD_STATUSES.includes(latestBuild?.status);
  const presentedBuild = queueingBuild && !buildInProgress
    ? { id: "", status: "queued", progress: 0, target_platform: buildTargetPlatform, status_message: "Menyimpan project dan memasukkan build ke antrean…" }
    : latestBuild;
  const showExpandedBuildPanel = !!presentedBuild && (queueingBuild || buildInProgress || buildPanelExpanded);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  useEffect(() => {
    if (!customerMode) return undefined;
    let active = true;
    const heartbeat = () => {
      if (!active || document.visibilityState === "hidden") return;
      const currentProject = projectRef.current;
      api.post("/customer/vst-maker/presence", {
        project_id: currentProject.projectId?.startsWith("draft-") ? "" : currentProject.projectId || "",
        project_name: currentProject.name || "Untitled",
        editor_tab: activeEditorTab,
      }).catch(() => { /* Presence must never interrupt editing. */ });
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 15000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", heartbeat);
      api.delete("/customer/vst-maker/presence").catch(() => {});
    };
  }, [customerMode, activeEditorTab]);

  useEffect(() => {
    if (customerMode) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await api.get("/admin/vst-maker/live-customers");
        if (active) setLiveCustomerActivity(data || { items: [], editing_count: 0, building_count: 0, updated_at: "" });
      } catch {
        // Keep the last snapshot visible and retry automatically.
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [customerMode]);

  useEffect(() => {
    const enabled = project.sustainEnabled === true || samplerSustainPedalRef.current;
    samplerSustainRef.current = enabled;
    setSamplerSustain(enabled);
    if (!enabled) {
      activeSamplerVoicesRef.current.forEach((voice, token) => {
        if (!voice.held) releaseSamplerVoice(token, voice);
      });
    }
  // Sustain latch is project data; pedal state remains transient.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.projectId, project.sustainEnabled]);

  useEffect(() => {
    if (customerMode) return;
    api.get("/admin/vst-maker/storage")
      .then(({ data }) => setR2Storage(data))
      .catch(() => setR2Storage(null));
  }, [customerMode]);

  useEffect(() => {
    const projectId = project.projectId;
    setBuildPanelExpanded(false);
    setBuildJobs([]);
    if (!projectId || projectId.startsWith("draft-")) return undefined;
    let active = true;
    api.get(`${apiBase}/projects/${encodeURIComponent(projectId)}/builds`)
      .then(({ data }) => { if (active) setBuildJobs(Array.isArray(data) ? data : []); })
      .catch(() => { /* Build state will be retried when the project is opened or refreshed. */ });
    return () => { active = false; };
  }, [apiBase, project.projectId]);

  useEffect(() => {
    if (buildInProgress) setBuildPanelExpanded(true);
  }, [buildInProgress, latestBuild?.id]);

  useEffect(() => {
    const projectId = project.projectId;
    if (!projectId || projectId.startsWith("draft-") || !ACTIVE_BUILD_STATUSES.includes(latestBuild?.status)) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await api.get(`${apiBase}/projects/${encodeURIComponent(projectId)}/builds`);
        if (active) setBuildJobs(Array.isArray(data) ? data : []);
      } catch {
        // Keep the current status visible and retry on the next interval.
      }
    };
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [apiBase, project.projectId, latestBuild?.id, latestBuild?.status]);

  useEffect(() => {
    let active = true;
    fetchSavedProjects(apiBase)
      .then((projects) => {
        if (!active) return;
        setSavedProjects(projects);
        const activeProjectId = projectRef.current.projectId;
        const staleServerProject = activeProjectId
          && !activeProjectId.startsWith("draft-")
          && !projects.some((item) => item.id === activeProjectId);
        if (staleServerProject) {
          // A deleted server project may still be present in localStorage after
          // a reload. Clear its sample metadata and orphan mapping zones.
          try {
            window.localStorage.removeItem(DRAFT_STORAGE_KEY);
            window.localStorage.removeItem(SAMPLE_STORAGE_KEY);
          } catch {
            // State cleanup below is still sufficient for this browser session.
          }
          const freshProject = createDraft();
          projectRef.current = freshProject;
          setProject(freshProject);
          setSamples([]);
          setSampleMessage("");
          setBuildJobs([]);
          setSelectedInterfaceControlIds([]);
        }
      })
      .catch((error) => {
        if (active) toast.error(error.userMessage || "Project gagal dimuat dari server");
      })
      .finally(() => { if (active) setLoadingProjects(false); });
    return () => { active = false; };
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    api.get(`${apiBase}/template-settings`)
      .then(({ data }) => {
        if (!active) return;
        setTemplateSettings(Object.fromEntries((Array.isArray(data) ? data : []).map((item) => [item.template_id, item])));
      })
      .catch((error) => {
        if (active) toast.error(error.userMessage || "Pengaturan template gagal dimuat");
      });
    return () => { active = false; };
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    api.get(`${apiBase}/pricing`)
      .then(({ data }) => {
        if (!active) return;
        const normalized = normalizeVstPricing(data);
        setPricing(normalized);
        setPricingDraft(normalized);
      })
      .catch((error) => {
        if (active) toast.error(error.userMessage || "Harga kredit gagal dimuat");
      });
    return () => { active = false; };
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    api.get(`${apiBase}/build-settings`)
      .then(({ data }) => {
        if (!active) return;
        const normalized = {
          customer_license_enabled: data?.customer_license_enabled !== false,
          show_no_serial_option: data?.show_no_serial_option !== false,
          license_max_activations: Math.max(1, Math.min(3, Number(data?.license_max_activations) || 2)),
        };
        setBuildSettings(normalized);
        setBuildSettingsDraft(normalized);
      })
      .catch((error) => {
        if (active) toast.error(error.userMessage || "Pengaturan lisensi build gagal dimuat");
      });
    return () => { active = false; };
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    api.get(`${apiBase}/templates`)
      .then(({ data }) => {
        if (active) setPublishedTemplates((Array.isArray(data) ? data : []).map(normalizePublishedTemplate));
      })
      .catch((error) => {
        if (active) toast.error(error.userMessage || "Template admin gagal dimuat");
      })
      .finally(() => {
        if (active) setTemplateCatalogLoaded(true);
      });
    return () => { active = false; };
  }, [apiBase]);

  useEffect(() => {
    if (project.pricingTemplateBaseline) return;
    const template = publishedTemplates.find((item) => item.id === project.pricingTemplateId && item.project);
    if (!template) return;
    const templateProject = { ...fromSavedProject(template.project), pricingTemplateId: template.id };
    const baseline = createVstTemplatePricingBaseline(templateProject, savedProjectSamples(template.project));
    setProject((current) => {
      if (current.pricingTemplateBaseline || current.pricingTemplateId !== template.id) return current;
      const next = { ...current, pricingTemplateBaseline: baseline };
      projectRef.current = next;
      return next;
    });
  }, [project.pricingTemplateBaseline, project.pricingTemplateId, publishedTemplates]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(project));
      setSavedAt(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [project]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAMPLE_STORAGE_KEY, JSON.stringify(samples.map(({ id, name, size, uploaded, assetId, sha256, uploadedAt }) => ({ id, name, size, uploaded, assetId, sha256, uploadedAt }))));
    } catch {
      setStorageAvailable(false);
    }
  }, [samples]);

  useEffect(() => {
    setProject((current) => {
      const existing = current.samplerGroups?.length ? current.samplerGroups.map(normalizeSamplerGroup) : [createSamplerGroup()];
      const normalizedMappings = current.sampleMappings.map((mapping) => ({ ...mapping, groupName: normalizeSamplerName(mapping.groupName) }));
      const names = Array.from(new Set(normalizedMappings.map((mapping) => mapping.groupName)));
      const missing = names.filter((name) => !existing.some((group) => group.name === name));
      const groupsChanged = JSON.stringify(existing) !== JSON.stringify(current.samplerGroups || []);
      const mappingsChanged = normalizedMappings.some((mapping, index) => mapping.groupName !== current.sampleMappings[index]?.groupName);
      if (!missing.length && !groupsChanged && !mappingsChanged) return current;
      return {
        ...current,
        samplerGroups: [...existing, ...missing.map((name) => createSamplerGroup(name))].slice(0, 16),
        sampleMappings: normalizedMappings,
      };
    });
  }, [project.sampleMappings]);

  // A draft from before the WAV-only contract can still contain mapping rows
  // for a non-WAV sample that is no longer loaded into the sample list.
  // Drop those orphan rows before the next save or build.
  useEffect(() => {
    const availableSampleIds = new Set(samples.map((sample) => sample.id));
    setProject((current) => {
      const filteredMappings = current.sampleMappings.filter((mapping) => availableSampleIds.has(mapping.sampleId));
      return filteredMappings.length === current.sampleMappings.length
        ? current
        : { ...current, sampleMappings: filteredMappings };
    });
  }, [samples]);

  // Older drafts interpreted note numbers in filenames three octaves too
  // high (for example C0 was stored as C3). That makes the mapping keyboard
  // display C3 while playing the original C0 recording at normal speed, which
  // sounds unnaturally huge and low. Repair only that exact legacy offset so
  // deliberate user transpositions remain untouched.
  useEffect(() => {
    if (!samples.length) return;
    const samplesById = new Map(samples.map((sample) => [sample.id, sample]));
    setProject((current) => {
      let repaired = 0;
      const sampleMappings = current.sampleMappings.map((mapping) => {
        const detectedPitch = filenameRootPitch(samplesById.get(mapping.sampleId)?.name);
        if (detectedPitch === null || Number(mapping.rootPitch) - detectedPitch !== 36) return mapping;
        const shift = detectedPitch - Number(mapping.rootPitch);
        repaired += 1;
        return {
          ...mapping,
          rootPitch: detectedPitch,
          lowPitch: Math.max(0, Math.min(127, Number(mapping.lowPitch) + shift)),
          highPitch: Math.max(0, Math.min(127, Number(mapping.highPitch) + shift)),
        };
      });
      if (!repaired) return current;
      window.setTimeout(() => toast.success(`${repaired} root note lama dikoreksi dari nama WAV agar pitch preview natural`), 0);
      return { ...current, sampleMappings };
    });
  }, [samples]);

  useEffect(() => {
    const blockUnscopedFileDrop = (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      const carriesSample = types.includes("Files") || types.includes("application/x-vst-sample-id");
      if (!carriesSample) return;
      const allowedTarget = event.target instanceof Element && event.target.closest('[data-vst-drop-target="true"]');
      if (allowedTarget) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      if (event.type === "drop") {
        const message = "Drop ditolak. Letakkan audio hanya di Sumber suara atau tepat di atas tuts pada Sampler mapping.";
        setSampleMessage(message);
        toast.warning(message);
      }
    };
    window.addEventListener("dragover", blockUnscopedFileDrop);
    window.addEventListener("drop", blockUnscopedFileDrop);
    return () => {
      window.removeEventListener("dragover", blockUnscopedFileDrop);
      window.removeEventListener("drop", blockUnscopedFileDrop);
    };
  }, []);

  useEffect(() => {
    const projectId = project.projectId;
    if (!projectId || projectId.startsWith("draft-")) return undefined;
    let active = true;
    api.get(`${apiBase}/projects/${encodeURIComponent(projectId)}/samples`)
      .then(({ data }) => {
        if (!active || !Array.isArray(data)) return;
        const assets = new Map(data.map((asset) => [asset.sample_id, asset]));
        setSamples((current) => current.map((sample) => {
          const asset = assets.get(sample.id);
          return asset ? {
            ...sample,
            uploaded: true,
            assetId: asset.id,
            sha256: asset.sha256,
            uploadedAt: asset.uploaded_at,
            previewUrl: `${apiBase}/projects/${encodeURIComponent(projectId)}/samples/${encodeURIComponent(sample.id)}/preview`,
          } : sample;
        }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [apiBase, project.projectId]);

  const macroValue = (parameter, fallback = 50) => {
    const matchingControls = project.interfaceControls.filter((item) => item.parameter === parameter);
    // Pads use `tone` as their trigger binding in older saved drum projects.
    // Prefer an actual macro control so the first pad (value 0) cannot override
    // the Neon template's Drive knob.
    const control = matchingControls.find((item) => !["pad", "keyboard", "gain_meter", "vu_meter"].includes(item.kind))
      || matchingControls[0];
    if (!control) return fallback;
    return Math.max(0, Math.min(100, Number(control.value) || 0));
  };

  const applyWaveGeneratorExpression = (bendValue, vibratoSemitones = 0) => {
    const bendSemitones = projectRef.current.pitchBendEnabled === true
      ? ((Math.max(0, Math.min(100, Number(bendValue) || 0)) - 50) / 50) * 2
      : 0;
    const context = audioContextRef.current;
    const now = context?.currentTime || 0;
    activeWaveVoicesRef.current.forEach((voice) => {
      voice.sources?.forEach((item) => {
        if (item.noise || !item.source?.detune) return;
        const targetCents = (item.baseDetune || 0) + (bendSemitones + vibratoSemitones) * 100;
        item.source.detune.cancelScheduledValues(now);
        item.source.detune.setTargetAtTime(targetCents, now, 0.003);
      });
    });
  };

  const setPerformancePitchBend = (value) => {
    const normalized = projectRef.current.pitchBendEnabled === true
      ? Math.max(0, Math.min(100, Number(value) || 0))
      : 50;
    pitchBendRef.current = normalized;
    applyWaveGeneratorExpression(normalized);
    setPitchBendValue(normalized);
  };

  const setPerformanceModulation = (value) => {
    const normalized = projectRef.current.modulationEnabled === true
      ? Math.max(0, Math.min(100, Number(value) || 0))
      : 0;
    modulationRef.current = normalized;
    setModulationValue(normalized);
  };

  useEffect(() => {
    pitchBendRef.current = pitchBendValue;
    modulationRef.current = modulationValue;
    let animationFrame = 0;
    const updateExpression = (timestamp = 0) => {
      const bendSemitones = projectRef.current.pitchBendEnabled === true ? ((pitchBendRef.current - 50) / 50) * 2 : 0;
      const modulationDepth = projectRef.current.modulationEnabled === true ? (modulationRef.current / 100) * 0.5 : 0;
      const vibratoSemitones = modulationDepth > 0 ? Math.sin((timestamp / 1000) * Math.PI * 10) * modulationDepth : 0;
      const expressionRate = 2 ** ((bendSemitones + vibratoSemitones) / 12);
      activeSamplerVoicesRef.current.forEach((voice) => voice.audios.forEach((audio) => {
        if (audio._vstTempoStretch) {
          audio._vstSetExpressionSemitones?.((Number(audio._vstBaseSemitones) || 0) + bendSemitones + vibratoSemitones);
          return;
        }
        const baseRate = Number(audio._vstBasePlaybackRate) || 1;
        audio.playbackRate = baseRate * expressionRate;
      }));
      applyWaveGeneratorExpression(pitchBendRef.current, vibratoSemitones);
      if (modulationRef.current > 0) animationFrame = window.requestAnimationFrame(updateExpression);
    };
    updateExpression(typeof performance !== "undefined" ? performance.now() : 0);
    return () => { if (animationFrame) window.cancelAnimationFrame(animationFrame); };
  }, [pitchBendValue, modulationValue]);

  useEffect(() => {
    const targetBpm = Math.max(20, Math.min(300, Number(project.tempoBpm) || 120));
    activeSamplerVoicesRef.current.forEach((voice) => voice.audios.forEach((audio) => {
      if (!audio._vstTempoStretch) return;
      const sourceBpm = Math.max(20, Math.min(300, Number(audio._vstSourceBpm) || 120));
      audio._vstSetTempoRate?.(targetBpm / sourceBpm);
    }));
  }, [project.tempoBpm]);

  useEffect(() => {
    const mappingsById = new Map((project.sampleMappings || []).map((mapping) => [mapping.id, mapping]));
    activeSamplerVoicesRef.current.forEach((voice) => {
      voice.audios.forEach((audio) => {
        const mapping = mappingsById.get(audio._vstMappingId);
        if (!mapping) return;
        audio._vstTempoSyncMode = mapping.playbackMode === "tempo_sync";
        audio._vstLoopEnabled = !!mapping.loopEnabled;
        audio._vstLoopStartFraction = mapping.loopStart ?? mapping.sampleStart ?? 0;
        audio._vstLoopEndFraction = mapping.loopEnd ?? mapping.sampleEnd ?? 1;
        audio._vstSetLoop?.(audio._vstLoopEnabled, audio._vstLoopStartFraction, audio._vstLoopEndFraction);
      });
      voice.retriggerExclusive = voice.audios.some((audio) => audio._vstLoopEnabled || audio._vstTempoSyncMode);
    });
  }, [project.sampleMappings]);

  useEffect(() => {
    if (project.pitchBendEnabled !== true) {
      pitchBendRef.current = 50;
      setPitchBendValue(50);
    }
    if (project.modulationEnabled !== true) {
      modulationRef.current = 0;
      setModulationValue(0);
    }
  }, [project.modulationEnabled, project.pitchBendEnabled]);

  const ensureAudioContext = () => {
    if (typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContextClass({ latencyHint: "interactive" });
      } catch {
        audioContextRef.current = new AudioContextClass();
      }
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      analyser.connect(audioContextRef.current.destination);
      attachStereoMeterTap(audioContextRef.current, analyser);
      meterAnalyserRef.current = analyser;
      installNativeDspWorklet(audioContextRef.current)
        .then(() => {
          const context = audioContextRef.current;
          dspWorkletReadyContextRef.current = context;
          activatePendingWaveDspGraph(context);
        })
        .catch(() => { dspWorkletReadyContextRef.current = null; });
    }
    if (audioContextRef.current.state === "suspended") audioContextRef.current.resume().catch(() => {});
    return audioContextRef.current;
  };

  useEffect(() => {
    if (!(project.engineModules || []).some((module) => module.type !== "wave_generator")) return;
    const context = ensureAudioContext();
    if (!context) return;
    installNativeDspWorklet(context)
      .then(() => {
        dspWorkletReadyContextRef.current = context;
        activatePendingWaveDspGraph(context);
      })
      .catch(() => { dspWorkletReadyContextRef.current = null; });
  // Load the shared processor ahead of the first key press; installation is cached per AudioContext.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.engineModules.length]);

  const warmSamplerAudio = () => {
    const context = ensureAudioContext();
    if (!context) return;
    const prepareSharedDsp = () => {
      if (project.effects.reverb && !reverbImpulseRef.current) {
        reverbImpulseRef.current = createReverbImpulse(context);
      }
      if (project.effects.saturation) {
        const drive = macroValue("tone", 50) / 100;
        const amount = project.projectTemplate === "neonpopdrums" ? drive * 0.55 : drive;
        const key = amount.toFixed(3);
        if (!saturationCurvesRef.current.has(key)) saturationCurvesRef.current.set(key, saturationCurve(amount));
      }
    };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(prepareSharedDsp, { timeout: 500 });
    else window.setTimeout(prepareSharedDsp, 0);
  };

  const cleanupAudioNodes = (nodes) => {
    if (!nodes) return;
    try { nodes.chorusLfo?.stop(); } catch { /* oscillator already stopped */ }
    Object.values(nodes).forEach((node) => {
      if (node && typeof node.disconnect === "function") {
        try { node.disconnect(); } catch { /* node already disconnected */ }
      }
    });
  };

  const releaseWaveDspGraph = () => {
    const graph = waveDspGraphRef.current;
    if (!graph) return;
    [graph.input, graph.processor, graph.processorGain, graph.dryFallback, graph.output, graph.masterGain, graph.masterPanner].forEach((node) => {
      try { node?.disconnect(); } catch { /* graph already disconnected */ }
    });
    waveDspGraphRef.current = null;
  };

  const releaseSamplerEffectsGraph = () => {
    const graph = samplerEffectsGraphRef.current;
    if (!graph) return;
    try { graph.chorusLfo?.stop(); } catch { /* oscillator already stopped */ }
    [graph.input, graph.toneFilter, graph.saturation, graph.dryGain, graph.reverb, graph.reverbGain,
      graph.delay, graph.delayFeedback, graph.delayGain, graph.chorus, graph.chorusGain,
      graph.chorusLfo, graph.chorusDepth, graph.masterGain, graph.masterPanner].forEach((node) => {
      try { node?.disconnect(); } catch { /* graph already disconnected */ }
    });
    samplerEffectsGraphRef.current = null;
  };

  const updateSamplerEffectsGraph = (graph = samplerEffectsGraphRef.current) => {
    if (!graph) return;
    const liveProject = projectRef.current;
    const tone = macroValue("tone", 50);
    const space = macroValue("space", 50) / 100;
    const isNeonDrums = liveProject.projectTemplate === "neonpopdrums";
    const muted = macroValue("mute", 0) >= 50 && macroValue("solo", 0) < 50;
    const saturationAmount = isNeonDrums ? (tone / 100) * 0.55 : tone / 100;
    const saturationKey = saturationAmount.toFixed(3);
    if (liveProject.effects?.saturation && !saturationCurvesRef.current.has(saturationKey)) {
      saturationCurvesRef.current.set(saturationKey, saturationCurve(saturationAmount));
    }
    graph.toneFilter.frequency.value = isNeonDrums ? 3500 : 500 + (tone * 65);
    graph.toneFilter.gain.value = isNeonDrums ? 0 : (tone - 50) * 0.24;
    graph.saturation.curve = liveProject.effects?.saturation ? saturationCurvesRef.current.get(saturationKey) : null;
    graph.dryGain.gain.value = isNeonDrums ? 0.92 : 1;
    graph.reverbGain.gain.value = liveProject.effects?.reverb ? (isNeonDrums ? 0.02 + (space * 0.12) : 0.08 + (space * 0.25)) : 0;
    graph.delay.delayTime.value = 30 / Math.max(20, Math.min(300, Number(liveProject.tempoBpm) || 120));
    graph.delayGain.gain.value = liveProject.effects?.delay ? (isNeonDrums ? space * 0.08 : 0.06 + (space * 0.18)) : 0;
    graph.chorusGain.gain.value = liveProject.effects?.chorus ? (isNeonDrums ? space * 0.06 : 0.04 + (space * 0.12)) : 0;
    graph.masterGain.gain.value = (macroValue("volume", 100) / 100) * (muted ? 0 : 1);
    graph.masterPanner.pan.value = Math.max(-1, Math.min(1, (macroValue("pan", 50) - 50) / 50));
  };

  const ensureSamplerEffectsGraph = (context) => {
    if (!context) return null;
    let graph = samplerEffectsGraphRef.current;
    if (graph?.context === context) {
      updateSamplerEffectsGraph(graph);
      return graph;
    }
    releaseSamplerEffectsGraph();
    const input = context.createGain();
    const toneFilter = context.createBiquadFilter(); toneFilter.type = "highshelf";
    const saturation = context.createWaveShaper(); saturation.oversample = "2x";
    const dryGain = context.createGain();
    const reverb = context.createConvolver();
    if (projectRef.current.effects?.reverb && !reverbImpulseRef.current) reverbImpulseRef.current = createReverbImpulse(context);
    reverb.buffer = projectRef.current.effects?.reverb ? reverbImpulseRef.current : null;
    const reverbGain = context.createGain();
    const delay = context.createDelay(1.5);
    const delayFeedback = context.createGain(); delayFeedback.gain.value = 0.2;
    const delayGain = context.createGain();
    const chorus = context.createDelay(0.2); chorus.delayTime.value = 0.028;
    const chorusGain = context.createGain();
    const chorusLfo = context.createOscillator(); chorusLfo.frequency.value = 0.8;
    const chorusDepth = context.createGain(); chorusDepth.gain.value = 0.008;
    const masterGain = context.createGain();
    const masterPanner = context.createStereoPanner();
    input.connect(toneFilter); toneFilter.connect(saturation);
    saturation.connect(dryGain); dryGain.connect(masterGain);
    saturation.connect(reverb); reverb.connect(reverbGain); reverbGain.connect(masterGain);
    saturation.connect(delay); delay.connect(delayFeedback); delayFeedback.connect(delay); delay.connect(delayGain); delayGain.connect(masterGain);
    saturation.connect(chorus); chorus.connect(chorusGain); chorusGain.connect(masterGain);
    chorusLfo.connect(chorusDepth); chorusDepth.connect(chorus.delayTime);
    masterGain.connect(masterPanner); masterPanner.connect(meterAnalyserRef.current || context.destination);
    chorusLfo.start();
    graph = { context, input, toneFilter, saturation, dryGain, reverb, reverbGain, delay, delayFeedback, delayGain, chorus, chorusGain, chorusLfo, chorusDepth, masterGain, masterPanner };
    samplerEffectsGraphRef.current = graph;
    updateSamplerEffectsGraph(graph);
    return graph;
  };

  const ensureWaveDspGraph = (context, plan) => {
    if (!context || !plan.length || dspWorkletReadyContextRef.current !== context) return null;
    const topology = plan.map(({ id, type }) => `${id}:${type}`).join("|");
    let graph = waveDspGraphRef.current;
    if (!graph || graph.context !== context) {
      releaseWaveDspGraph();
      const input = context.createGain();
      const output = context.createGain();
      const masterGain = context.createGain();
      const masterPanner = context.createStereoPanner();
      const muted = macroValue("mute", 0) >= 50 && macroValue("solo", 0) < 50;
      masterGain.gain.value = (macroValue("volume", 100) / 100) * (muted ? 0 : 1);
      masterPanner.pan.value = Math.max(-1, Math.min(1, (macroValue("pan", 50) - 50) / 50));
      const processor = createNativeDspWorkletNode(context, plan);
      attachDspMeterTarget(processor, meterAnalyserRef.current);
      const processorGain = context.createGain();
      const dryFallback = context.createGain();
      processorGain.gain.value = 0;
      dryFallback.gain.value = 1;
      input.connect(processor); processor.connect(processorGain); processorGain.connect(output);
      input.connect(dryFallback); dryFallback.connect(output);
      output.connect(masterGain); masterGain.connect(masterPanner); masterPanner.connect(meterAnalyserRef.current || context.destination);
      graph = { context, input, output, masterGain, masterPanner, processor, processorGain, dryFallback, topology, processorFailed: false, processorReady: false };
      whenDspProcessorReady(processor, () => {
        if (waveDspGraphRef.current !== graph || graph.processor !== processor || graph.processorFailed) return;
        const now = context.currentTime;
        graph.processorReady = true;
        processorGain.gain.cancelScheduledValues(now); processorGain.gain.setValueAtTime(0, now);
        dryFallback.gain.cancelScheduledValues(now); dryFallback.gain.setValueAtTime(dryFallback.gain.value, now);
        processorGain.gain.linearRampToValueAtTime(1, now + 0.04);
        dryFallback.gain.linearRampToValueAtTime(0, now + 0.04);
      });
      processor.addEventListener?.("processorerror", () => {
        if (waveDspGraphRef.current !== graph || graph.processor !== processor) return;
        const now = context.currentTime;
        graph.processorFailed = true;
        graph.processorReady = true;
        processorGain.gain.cancelScheduledValues(now); processorGain.gain.setTargetAtTime(0, now, 0.003);
        dryFallback.gain.cancelScheduledValues(now); dryFallback.gain.setTargetAtTime(1, now, 0.003);
        setSamplerAudioStatus("DSP preview terlalu berat; audio dialihkan ke jalur aman agar tidak mati.");
      });
      waveDspGraphRef.current = graph;
      return graph;
    }
    if (graph.topology !== topology) {
      // Preserve all stateful modules already running in the worklet and let it
      // construct only genuinely new nodes. Rebuilding a second complete
      // amp/cabinet rack here can overload the realtime thread while a key is held.
      graph.processor.port.postMessage({ type: "plan", plan });
      graph.topology = topology;
    } else {
      graph.processor.port.postMessage({ type: "plan", plan });
    }
    return graph;
  };

  const activatePendingWaveDspGraph = (context) => {
    if (!context || context !== audioContextRef.current) return;
    const modules = (projectRef.current.engineModules || []).filter(isPostSourceDspModule);
    if (!modules.length) return;
    const plan = createDspPreviewPlan(modules, projectRef.current.interfaceControls, customImpulseTaps);
    const graph = ensureWaveDspGraph(context, plan);
    if (!graph) return;
    activeWaveVoicesRef.current.forEach((voice) => {
      if (!voice.pendingSharedRack) return;
      const now = context.currentTime;
      const rackSendGain = context.createGain();
      rackSendGain.gain.setValueAtTime(0, now);
      voice.masterGain?.connect(rackSendGain).connect(graph.input);
      rackSendGain.gain.linearRampToValueAtTime(1, now + 0.04);
      voice.pendingDirectGain?.gain.cancelScheduledValues(now);
      voice.pendingDirectGain?.gain.setValueAtTime(voice.pendingDirectGain.gain.value, now);
      voice.pendingDirectGain?.gain.linearRampToValueAtTime(0, now + 0.04);
      window.setTimeout(() => {
        try { voice.masterGain?.disconnect(voice.pendingDirectGain); voice.pendingDirectGain?.disconnect(); } catch { /* voice already released */ }
      }, 70);
      voice.rackSendGain = rackSendGain;
      voice.pendingSharedRack = false;
      voice.usesSharedRack = true;
    });
  };

  const stopSamplerVoice = (token, voice) => {
    if (!voice) return;
    if (voice.releaseFrame) {
      if (typeof window !== "undefined" && window.cancelAnimationFrame) window.cancelAnimationFrame(voice.releaseFrame);
      else clearTimeout(voice.releaseFrame);
    }
    voice.audios.forEach((audio) => {
      if (audio._vstEnvelopeFrame) window.cancelAnimationFrame?.(audio._vstEnvelopeFrame);
      audio.pause();
      audio.currentTime = 0;
    });
    setWaveformPlayback((current) => (current && voice.audios.includes(current.audio) ? null : current));
    voice.audioNodes?.forEach((nodes) => cleanupAudioNodes(nodes));
    activeSamplerVoicesRef.current.delete(token);
    pendingPreviewVoiceMetaRef.current.delete(token);
  };

  const stopWaveVoice = (token, voice, immediate = false) => {
    if (!voice) return;
    const context = audioContextRef.current;
    const now = context?.currentTime || 0;
    const releaseSeconds = immediate ? 0.005 : voice.releaseSeconds;
    try {
      voice.ampGain.gain.cancelScheduledValues(now);
      voice.ampGain.gain.setValueAtTime(Math.max(0.0001, voice.ampGain.gain.value), now);
      voice.ampGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds);
      voice.sources.forEach(({ source }) => source.stop(now + releaseSeconds + 0.02));
      voice.vibratoLfo?.stop(now + releaseSeconds + 0.02);
      voice.effectNodes?.chorusLfo?.stop(now + releaseSeconds + 0.02);
    } catch { /* voice already stopped */ }
    activeWaveVoicesRef.current.delete(token);
  };

  const selectedHeldWaveNote = () => {
    const notes = Array.from(heldWaveNotesRef.current.entries()).map(([token, note]) => ({ token, ...note }));
    if (!notes.length) return null;
    return notes.reduce((selected, note) => note.age > selected.age ? note : selected);
  };

  const retargetWaveVoice = (voice, pitch, velocity, parameters) => {
    const context = audioContextRef.current;
    if (!voice || !context) return;
    const unit = (key, fallback) => Math.max(0, Math.min(1, Number(parameters[key] ?? fallback)));
    const octave = Math.round(Number(parameters.octave ?? 0.5) * 4) - 2;
    const semitone = Math.round(Number(parameters.semitone ?? 0.5) * 24) - 12;
    const fine = Number(parameters.fine ?? 0.5) * 200 - 100;
    const baseSemitones = octave * 12 + semitone + fine / 100 + dspGlobalTuningSemitones(projectRef.current.engineModules);
    const osc2Octave = Math.round(unit("osc2_octave", 0.5) * 4) - 2;
    const frequencyFor = (midiPitch, additionalSemitones = 0) => 440 * (2 ** ((midiPitch - 69 + baseSemitones + additionalSemitones) / 12));
    const glideSeconds = 2 * (unit("glide", 0) ** 2);
    const now = context.currentTime;
    voice.sources?.forEach((item) => {
      if (item.noise || !item.source?.frequency) return;
      const offset = item.role === "osc2" ? osc2Octave * 12 : item.role === "sub" ? -12 : 0;
      const target = frequencyFor(pitch, offset);
      item.source.frequency.cancelScheduledValues(now);
      item.source.frequency.setValueAtTime(Math.max(0.001, item.source.frequency.value), now);
      if (glideSeconds > 0) item.source.frequency.exponentialRampToValueAtTime(target, now + glideSeconds);
      else item.source.frequency.setValueAtTime(target, now);
    });
    const targetGain = Math.max(0.0001, waveGeneratorVelocityGain(velocity, parameters) * 0.32);
    voice.ampGain.gain.cancelScheduledValues(now);
    voice.ampGain.gain.setTargetAtTime(targetGain * unit("sustain", 1), now, 0.005);
    voice.pitch = pitch;
    voice.held = true;
    voice.targetGain = targetGain;
    lastWavePitchRef.current = pitch;
  };

  const playWaveGeneratorNote = (pitch, velocity, token) => {
    const module = (projectRef.current.engineModules || []).find((item) => item.type === "wave_generator" && !item.bypassed);
    const context = ensureAudioContext();
    if (!module || !context) return false;
    const parameters = module.parameters || {};
    const unit = (key, fallback) => Math.max(0, Math.min(1, Number(parameters[key] ?? fallback)));
    const waveformIndex = Math.min(4, Math.round(unit("waveform", 0) * 4));
    const octave = Math.round(Number(parameters.octave ?? 0.5) * 4) - 2;
    const semitone = Math.round(Number(parameters.semitone ?? 0.5) * 24) - 12;
    const fine = Number(parameters.fine ?? 0.5) * 200 - 100;
    const level = unit("level", 0.65);
    const moduleMix = Math.max(0, Math.min(1, Number(module.mix ?? 1)));
    const baseSemitones = octave * 12 + semitone + fine / 100 + dspGlobalTuningSemitones(projectRef.current.engineModules);
    const frequencyFor = (midiPitch, additionalSemitones = 0) => 440 * (2 ** ((midiPitch - 69 + baseSemitones + additionalSemitones) / 12));
    const unisonVoices = 1 + Math.round(unit("unison_voices", 0) * 7);
    const unisonDetune = unit("unison_detune", 0.12) * 50;
    const stereoSpread = unit("stereo_spread", 0);
    const osc2Level = unit("osc2_level", 0);
    const osc2Enabled = parameters.osc2_enabled == null ? osc2Level > 0 : unit("osc2_enabled", 0) >= 0.5;
    const osc2Waveform = Math.min(4, Math.round(unit("osc2_waveform", 0) * 4));
    const osc2Octave = Math.round(unit("osc2_octave", 0.5) * 4) - 2;
    const osc2Detune = unit("osc2_detune", 0.5) * 200 - 100;
    const subLevel = unit("sub_level", 0);
    const noiseLevel = unit("noise_level", 0);
    const monoMode = unit("voice_mode", 1) >= 0.5;
    const retrigger = unit("retrigger", 1) >= 0.5;
    heldWaveNotesRef.current.set(token, { pitch, velocity, age: ++waveNoteSequenceRef.current });
    if (monoMode && activeWaveVoicesRef.current.size > 0) {
      const [existingToken, existingVoice] = activeWaveVoicesRef.current.entries().next().value;
      const selectedNote = selectedHeldWaveNote();
      if (!selectedNote || selectedNote.token !== token) return true;
      if (!retrigger) {
        retargetWaveVoice(existingVoice, pitch, velocity, parameters);
        activeWaveVoicesRef.current.delete(existingToken);
        activeWaveVoicesRef.current.set(token, existingVoice);
        return true;
      }
      activeWaveVoicesRef.current.forEach((voice, voiceToken) => stopWaveVoice(voiceToken, voice, true));
    }
    const mixBus = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.5 + unit("filter_resonance", 0) * 19.5;
    const keyTracking = unit("filter_key_tracking", 0);
    const baseCutoff = Math.min(context.sampleRate * 0.45, 20 * (1000 ** unit("filter_cutoff", 1)) * (2 ** (((pitch - 60) * keyTracking) / 12)));
    const filterEnvelopeSemitones = (unit("filter_env_amount", 0.5) - 0.5) * 96;
    const ampGain = context.createGain();
    const masterGain = context.createGain();
    const masterPanner = context.createStereoPanner();
    masterPanner.pan.value = Math.max(-1, Math.min(1, (macroValue("pan", 50) - 50) / 50));
    const muted = macroValue("mute", 0) >= 50 && macroValue("solo", 0) < 50;
    masterGain.gain.value = moduleMix * (macroValue("volume", 100) / 100) * (muted ? 0 : 1);
    const toneFilter = context.createBiquadFilter();
    toneFilter.type = "highshelf";
    toneFilter.frequency.value = 500 + macroValue("tone", 50) * 65;
    toneFilter.gain.value = (macroValue("tone", 50) - 50) * 0.24;
    const saturation = context.createWaveShaper();
    saturation.oversample = "2x";
    const saturationAmount = macroValue("tone", 50) / 100;
    const saturationKey = saturationAmount.toFixed(3);
    if (project.effects.saturation && !saturationCurvesRef.current.has(saturationKey)) saturationCurvesRef.current.set(saturationKey, saturationCurve(saturationAmount));
    saturation.curve = project.effects.saturation ? saturationCurvesRef.current.get(saturationKey) : null;
    const dryGain = context.createGain(); dryGain.gain.value = 1;
    const reverb = context.createConvolver();
    if (project.effects.reverb && !reverbImpulseRef.current) reverbImpulseRef.current = createReverbImpulse(context);
    reverb.buffer = project.effects.reverb ? reverbImpulseRef.current : null;
    const reverbGain = context.createGain();
    const delay = context.createDelay(1.5); delay.delayTime.value = 30 / Math.max(20, Math.min(300, Number(project.tempoBpm) || 120));
    const delayFeedback = context.createGain(); delayFeedback.gain.value = 0.2;
    const delayGain = context.createGain();
    const chorus = context.createDelay(0.2); chorus.delayTime.value = 0.028;
    const chorusGain = context.createGain();
    const chorusLfo = context.createOscillator(); chorusLfo.frequency.value = 0.8;
    const chorusDepth = context.createGain(); chorusDepth.gain.value = 0.008;
    const space = macroValue("space", 50) / 100;
    reverbGain.gain.value = project.effects.reverb ? 0.08 + space * 0.25 : 0;
    delayGain.gain.value = project.effects.delay ? 0.06 + space * 0.18 : 0;
    chorusGain.gain.value = project.effects.chorus ? 0.04 + space * 0.12 : 0;
    const postRackModules = (project.engineModules || []).filter(isPostSourceDspModule);
    const rackPlan = postRackModules.length
      ? createDspPreviewPlan(postRackModules, project.interfaceControls, customImpulseTaps)
      : [];
    const rackGraph = ensureWaveDspGraph(context, rackPlan);
    const rackPending = rackPlan.length > 0 && !rackGraph;
    let pendingDirectGain = null;
    mixBus.connect(filter);
    filter.connect(ampGain);
    if (rackGraph) {
      masterGain.gain.value = moduleMix;
      ampGain.connect(masterGain);
      masterGain.connect(rackGraph.input);
    } else if (rackPending) {
      // Keep the note path immediate while the shared worklet is loading. The
      // voice is moved into the rack as soon as installation completes.
      ampGain.connect(masterGain);
      masterGain.gain.value = moduleMix;
      pendingDirectGain = context.createGain();
      pendingDirectGain.gain.value = (macroValue("volume", 100) / 100) * (muted ? 0 : 1);
      masterGain.connect(pendingDirectGain).connect(masterPanner).connect(meterAnalyserRef.current || context.destination);
    } else {
      ampGain.connect(toneFilter);
      toneFilter.connect(saturation);
      saturation.connect(dryGain); dryGain.connect(masterGain);
      saturation.connect(reverb); reverb.connect(reverbGain); reverbGain.connect(masterGain);
      saturation.connect(delay); delay.connect(delayFeedback); delayFeedback.connect(delay); delay.connect(delayGain); delayGain.connect(masterGain);
      saturation.connect(chorus); chorus.connect(chorusGain); chorusGain.connect(masterGain); chorusLfo.connect(chorusDepth); chorusDepth.connect(chorus.delayTime);
      masterGain.connect(masterPanner).connect(meterAnalyserRef.current || context.destination);
    }

    const sources = [];
    const createNoiseSource = (colorValue, sourceLevel, pan = 0, role = "noise") => {
      const color = colorValue < 1 / 3 ? "brown" : colorValue < 2 / 3 ? "pink" : "white";
      const cacheKey = `${context.sampleRate}:${color}`;
      let buffer = waveNoiseBuffersRef.current.get(cacheKey);
      if (!buffer) {
        const length = Math.max(1, Math.round(context.sampleRate * 2));
        buffer = context.createBuffer(1, length, context.sampleRate);
        const data = buffer.getChannelData(0);
        let brown = 0;
        const pink = [0, 0, 0, 0, 0, 0, 0];
        for (let index = 0; index < length; index += 1) {
          const white = Math.random() * 2 - 1;
          if (color === "brown") { brown = (brown + 0.02 * white) / 1.02; data[index] = brown * 3.5; }
          else if (color === "pink") {
            pink[0] = 0.99886 * pink[0] + white * 0.0555179; pink[1] = 0.99332 * pink[1] + white * 0.0750759;
            pink[2] = 0.969 * pink[2] + white * 0.153852; pink[3] = 0.8665 * pink[3] + white * 0.3104856;
            pink[4] = 0.55 * pink[4] + white * 0.5329522; pink[5] = -0.7616 * pink[5] - white * 0.016898;
            data[index] = (pink[0] + pink[1] + pink[2] + pink[3] + pink[4] + pink[5] + pink[6] + white * 0.5362) * 0.11; pink[6] = white * 0.115926;
          } else data[index] = white;
        }
        waveNoiseBuffersRef.current.set(cacheKey, buffer);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const sourceGain = context.createGain(); sourceGain.gain.value = sourceLevel;
      const panner = context.createStereoPanner(); panner.pan.value = pan;
      source.connect(sourceGain); sourceGain.connect(panner); panner.connect(mixBus);
      sources.push({ source, sourceGain, panner, baseDetune: 0, noise: true, role });
      return source;
    };
    const createOscillatorSource = (shape, targetFrequency, sourceLevel, pan, detuneCents, pulseWidth, role) => {
      if (shape === 4) return createNoiseSource(unit("noise_color", 0.5), sourceLevel, pan, role);
      const source = context.createOscillator();
      if (shape === 3) {
        const duty = 0.05 + pulseWidth * 0.9;
        const cacheKey = duty.toFixed(3);
        let periodicWave = wavePeriodicWavesRef.current.get(cacheKey);
        if (!periodicWave) {
          const harmonics = 64;
          const real = new Float32Array(harmonics);
          const imag = new Float32Array(harmonics);
          for (let harmonic = 1; harmonic < harmonics; harmonic += 1) imag[harmonic] = (2 / (harmonic * Math.PI)) * Math.sin(harmonic * Math.PI * duty);
          periodicWave = context.createPeriodicWave(real, imag, { disableNormalization: false });
          wavePeriodicWavesRef.current.set(cacheKey, periodicWave);
        }
        source.setPeriodicWave(periodicWave);
      } else source.type = ["sine", "triangle", "sawtooth"][shape];
      const glideSeconds = 2 * (unit("glide", 0) ** 2);
      const legatoOnly = unit("glide_mode", 0) >= 0.5;
      const shouldGlide = glideSeconds > 0 && lastWavePitchRef.current !== null && (!legatoOnly || activeWaveVoicesRef.current.size > 0);
      const startFrequency = shouldGlide ? targetFrequency * (2 ** ((lastWavePitchRef.current - pitch) / 12)) : targetFrequency;
      source.frequency.setValueAtTime(startFrequency, context.currentTime);
      if (shouldGlide) source.frequency.exponentialRampToValueAtTime(targetFrequency, context.currentTime + glideSeconds);
      source.detune.value = detuneCents;
      const sourceGain = context.createGain(); sourceGain.gain.value = sourceLevel;
      const panner = context.createStereoPanner(); panner.pan.value = pan;
      source.connect(sourceGain); sourceGain.connect(panner); panner.connect(mixBus);
      sources.push({ source, sourceGain, panner, baseDetune: detuneCents, noise: false, role });
      return source;
    };
    for (let index = 0; index < unisonVoices; index += 1) {
      const position = unisonVoices === 1 ? 0 : (index / (unisonVoices - 1)) * 2 - 1;
      const detune = position * unisonDetune;
      createOscillatorSource(waveformIndex, frequencyFor(pitch), level / Math.sqrt(unisonVoices), position * stereoSpread, detune, unit("pulse_width", 0.5), "osc1");
      if (osc2Enabled && osc2Level > 0) createOscillatorSource(osc2Waveform, frequencyFor(pitch, osc2Octave * 12), osc2Level / Math.sqrt(unisonVoices), -position * stereoSpread, detune + osc2Detune, unit("osc2_pulse_width", 0.5), "osc2");
    }
    if (subLevel > 0) createOscillatorSource(0, frequencyFor(pitch, -12), subLevel, 0, 0, 0.5, "sub");
    if (noiseLevel > 0) createNoiseSource(unit("noise_color", 0.5), noiseLevel, 0, "noise");
    lastWavePitchRef.current = pitch;

    const bendSemitones = projectRef.current.pitchBendEnabled === true ? ((pitchBendRef.current - 50) / 50) * 2 : 0;
    sources.forEach((item) => { if (!item.noise && item.source.detune) item.source.detune.value = item.baseDetune + bendSemitones * 100; });
    const velocityGain = waveGeneratorVelocityGain(velocity, parameters);
    const targetGain = Math.max(0.0001, velocityGain * 0.32);
    const now = context.currentTime;
    const attackSeconds = 5 * (unit("attack", 0) ** 2.5);
    const decaySeconds = 0.01 + 4.99 * (unit("decay", 0.2) ** 2.2);
    const sustainLevel = unit("sustain", 1);
    const releaseSeconds = 0.01 + 9.99 * (unit("release", 0.18) ** 2.2);
    ampGain.gain.setValueAtTime(attackSeconds > 0.001 ? 0.0001 : targetGain, now);
    if (attackSeconds > 0.001) ampGain.gain.exponentialRampToValueAtTime(targetGain, now + attackSeconds);
    ampGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, targetGain * sustainLevel), now + attackSeconds + decaySeconds);
    const envelopeCutoff = Math.max(20, Math.min(context.sampleRate * 0.45, baseCutoff * (2 ** (filterEnvelopeSemitones / 12))));
    filter.frequency.setValueAtTime(envelopeCutoff, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, baseCutoff), now + attackSeconds + decaySeconds);
    const vibratoLfo = context.createOscillator();
    const vibratoGain = context.createGain();
    vibratoLfo.frequency.value = 0.1 + unit("vibrato_rate", 0.45) * 11.9;
    const vibratoDepth = unit("vibrato_depth", 0) * 100;
    const vibratoDelay = unit("vibrato_delay", 0) * 2;
    vibratoGain.gain.setValueAtTime(vibratoDelay > 0 ? 0 : vibratoDepth, now);
    if (vibratoDelay > 0) vibratoGain.gain.linearRampToValueAtTime(vibratoDepth, now + vibratoDelay);
    vibratoLfo.connect(vibratoGain);
    sources.forEach((item) => { if (!item.noise && item.source.detune) vibratoGain.connect(item.source.detune); });
    const effectNodes = { saturation, dryGain, reverb, reverbGain, delay, delayFeedback, delayGain, chorus, chorusGain, chorusLfo, chorusDepth };
    const voice = { sources, ampGain, filter, masterGain, masterPanner, toneFilter, vibratoLfo, vibratoGain, effectNodes, usesSharedRack: Boolean(rackGraph), pendingSharedRack: rackPending, pendingDirectGain: rackPending ? pendingDirectGain : null, rackSendGain: null, rackInputGain: moduleMix, pitch, held: true, targetGain, releaseSeconds };
    let endedSources = 0;
    sources.forEach(({ source }) => { source.onended = () => {
      endedSources += 1;
      if (endedSources < sources.length) return;
      try { mixBus.disconnect(); filter.disconnect(); ampGain.disconnect(); toneFilter.disconnect(); masterGain.disconnect(); masterPanner.disconnect(); vibratoLfo.disconnect(); vibratoGain.disconnect(); cleanupAudioNodes(effectNodes); } catch { /* already disconnected */ }
      if (activeWaveVoicesRef.current.get(token) === voice) activeWaveVoicesRef.current.delete(token);
    }; });
    activeWaveVoicesRef.current.set(token, voice);
    sources.forEach(({ source, noise }) => {
      if (noise && source.buffer?.duration) source.start(now, Math.random() * source.buffer.duration);
      else source.start(now);
    });
    vibratoLfo.start(now);
    if (!rackGraph && !rackPending) chorusLfo.start(now);
    return true;
  };

  useEffect(() => {
    const module = (project.engineModules || []).find((item) => item.type === "wave_generator");
    if (!module) return;
    const parameters = module.parameters || {};
    const unit = (key, fallback) => Math.max(0, Math.min(1, Number(parameters[key] ?? fallback)));
    const osc2Enabled = parameters.osc2_enabled == null ? unit("osc2_level", 0) > 0 : unit("osc2_enabled", 0) >= 0.5;
    const unisonVoices = 1 + Math.round(unit("unison_voices", 0) * 7);
    const muted = macroValue("mute", 0) >= 50 && macroValue("solo", 0) < 50;
    const rackInputGain = module.bypassed ? 0 : Math.max(0, Math.min(1, Number(module.mix ?? 1)));
    const outputVolume = (macroValue("volume", 100) / 100) * (muted ? 0 : 1);
    const volume = rackInputGain * outputVolume;
    const masterPan = Math.max(-1, Math.min(1, (macroValue("pan", 50) - 50) / 50));
    const now = audioContextRef.current?.currentTime || 0;
    const postRackModules = (project.engineModules || []).filter(isPostSourceDspModule);
    const rackPlan = postRackModules.length ? createDspPreviewPlan(postRackModules, project.interfaceControls, customImpulseTaps) : [];
    if (rackPlan.length && audioContextRef.current) ensureWaveDspGraph(audioContextRef.current, rackPlan);
    else if (waveDspGraphRef.current) {
      activeWaveVoicesRef.current.forEach((voice, token) => stopWaveVoice(token, voice, true));
      releaseWaveDspGraph();
    }
    activeWaveVoicesRef.current.forEach((voice) => {
      voice.rackInputGain = rackInputGain;
      voice.masterGain?.gain.setTargetAtTime((voice.usesSharedRack || voice.pendingSharedRack) ? rackInputGain : volume, now, 0.01);
      voice.pendingDirectGain?.gain.setTargetAtTime(outputVolume, now, 0.01);
      voice.masterPanner?.pan.setTargetAtTime(masterPan, now, 0.01);
      if (voice.toneFilter) {
        voice.toneFilter.frequency.setTargetAtTime(500 + macroValue("tone", 50) * 65, now, 0.01);
        voice.toneFilter.gain.setTargetAtTime((macroValue("tone", 50) - 50) * 0.24, now, 0.01);
      }
      if (voice.filter) {
        const cutoff = Math.min((audioContextRef.current?.sampleRate || 44100) * 0.45, 20 * (1000 ** unit("filter_cutoff", 1)) * (2 ** (((voice.pitch - 60) * unit("filter_key_tracking", 0)) / 12)));
        voice.filter.frequency.setTargetAtTime(Math.max(20, cutoff), now, 0.01);
        voice.filter.Q.setTargetAtTime(0.5 + unit("filter_resonance", 0) * 19.5, now, 0.01);
      }
      if (voice.vibratoLfo) voice.vibratoLfo.frequency.setTargetAtTime(0.1 + unit("vibrato_rate", 0.45) * 11.9, now, 0.01);
      if (voice.vibratoGain) voice.vibratoGain.gain.setTargetAtTime(unit("vibrato_depth", 0) * 100, now, 0.01);
      if (!voice.usesSharedRack && voice.effectNodes) {
        const space = macroValue("space", 50) / 100;
        voice.effectNodes.reverbGain.gain.setTargetAtTime(project.effects.reverb ? 0.08 + space * 0.25 : 0, now, 0.01);
        voice.effectNodes.delayGain.gain.setTargetAtTime(project.effects.delay ? 0.06 + space * 0.18 : 0, now, 0.01);
        voice.effectNodes.chorusGain.gain.setTargetAtTime(project.effects.chorus ? 0.04 + space * 0.12 : 0, now, 0.01);
      }
      voice.sources?.forEach((item) => {
        const level = item.role === "osc1" ? unit("level", 0.65) / Math.sqrt(unisonVoices)
          : item.role === "osc2" ? (osc2Enabled ? unit("osc2_level", 0) : 0) / Math.sqrt(unisonVoices)
            : item.role === "sub" ? unit("sub_level", 0) : unit("noise_level", 0);
        item.sourceGain?.gain.setTargetAtTime(level, now, 0.01);
      });
    });
    if (waveDspGraphRef.current?.masterGain) waveDspGraphRef.current.masterGain.gain.setTargetAtTime((macroValue("volume", 100) / 100) * (muted ? 0 : 1), now, 0.01);
    if (waveDspGraphRef.current?.masterPanner) waveDspGraphRef.current.masterPanner.pan.setTargetAtTime(masterPan, now, 0.01);
  // Module/control objects are the authoritative realtime preview state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.effects, project.engineModules, project.interfaceControls]);

  // Audio cleanup intentionally uses stable refs from the initial render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    activeSamplerVoicesRef.current.forEach((voice, token) => stopSamplerVoice(token, voice));
    activeGrooveVoicesRef.current.forEach((voice) => voice.layers.forEach(({ source }) => { try { source.stop(); } catch { /* already stopped */ } }));
    activeGrooveVoicesRef.current.clear();
    grooveVisualTimersRef.current.forEach((timers) => timers.forEach((timer) => window.clearTimeout(timer)));
    grooveVisualTimersRef.current.clear();
    grooveFallbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    grooveFallbackTimersRef.current.clear();
    activeWaveVoicesRef.current.forEach((voice, token) => stopWaveVoice(token, voice, true));
    sampleAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    try { meterAnalyserRef.current?.disconnect(); } catch { /* graph already disconnected */ }
    releaseWaveDspGraph();
    releaseSamplerEffectsGraph();
    try { audioContextRef.current?.close(); } catch { /* context already closed */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearSamplerPreview = () => {
    activeSamplerVoicesRef.current.forEach((voice, token) => stopSamplerVoice(token, voice));
    activeGrooveVoicesRef.current.forEach((voice) => voice.layers.forEach(({ source }) => { try { source.stop(); } catch { /* already stopped */ } }));
    activeGrooveVoicesRef.current.clear();
    grooveFallbackTokensRef.current.clear();
    grooveFallbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    grooveFallbackTimersRef.current.clear();
    grooveVisualTimersRef.current.forEach((timers) => timers.forEach((timer) => window.clearTimeout(timer)));
    grooveVisualTimersRef.current.clear();
    activeWaveVoicesRef.current.forEach((voice, token) => stopWaveVoice(token, voice, true));
    heldWaveNotesRef.current.clear();
    roundRobinCursorRef.current.clear();
    pendingPreviewTokensRef.current.clear();
    pendingPreviewVoiceMetaRef.current.clear();
    releasedPreviewTokensRef.current.clear();
    hitPitchTokensRef.current.clear();
    setPreviewPressedPitches(new Set());
    samplerSustainPedalRef.current = false;
    samplerSustainRef.current = projectRef.current.sustainEnabled === true;
    setSamplerSustain(projectRef.current.sustainEnabled === true);
    sampleAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    sampleAudioUrlsRef.current.clear();
    decodedSampleBuffersRef.current.clear();
    decodedSampleRequestsRef.current.clear();
    setWaveformPlayback(null);
    setSamplerAudioStatus("Pilih atau unggah sampel untuk mencoba keyboard.");
  };

  const applyAudioEffectSettings = (nodes) => {
    if (!nodes) return;
    if (nodes.sharedRack) return;
    const tone = macroValue("tone", 50);
    const space = macroValue("space", 50) / 100;
    const previewTempo = Math.max(20, Math.min(300, Number(project.tempoBpm) || 120));
    const isNeonDrums = project.projectTemplate === "neonpopdrums";
    nodes.toneFilter.frequency.value = isNeonDrums ? 3500 : 500 + (tone * 65);
    nodes.toneFilter.gain.value = isNeonDrums ? 0 : (tone - 50) * 0.24;
    const saturationAmount = isNeonDrums ? (tone / 100) * 0.55 : tone / 100;
    const saturationKey = saturationAmount.toFixed(3);
    if (project.effects.saturation && !saturationCurvesRef.current.has(saturationKey)) {
      saturationCurvesRef.current.set(saturationKey, saturationCurve(saturationAmount));
    }
    nodes.saturation.curve = project.effects.saturation ? saturationCurvesRef.current.get(saturationKey) : null;
    nodes.dryGain.gain.value = isNeonDrums ? 0.92 : 1;
    nodes.reverbGain.gain.value = project.effects.reverb ? (isNeonDrums ? 0.02 + (space * 0.12) : 0.08 + (space * 0.25)) : 0;
    nodes.delay.delayTime.value = 30 / previewTempo;
    nodes.delayGain.gain.value = project.effects.delay ? (isNeonDrums ? space * 0.08 : 0.06 + (space * 0.18)) : 0;
    nodes.chorusGain.gain.value = project.effects.chorus ? (isNeonDrums ? space * 0.06 : 0.04 + (space * 0.12)) : 0;
  };

  const createAudioEffects = (audio, pan = 0) => {
    const context = ensureAudioContext();
    if (!context) return null;
    try {
      const postRackModules = (projectRef.current.engineModules || []).filter(isPostSourceDspModule);
      const rackPlan = postRackModules.length
        ? createDspPreviewPlan(postRackModules, projectRef.current.interfaceControls, customImpulseTaps)
        : [];
      const sharedRack = rackPlan.length ? ensureWaveDspGraph(context, rackPlan) : null;
      if (sharedRack) {
        const source = context.createMediaElementSource(audio);
        const stereoPanner = context.createStereoPanner();
        stereoPanner.pan.value = Math.max(-1, Math.min(1, Number(pan) || 0));
        source.connect(stereoPanner);
        stereoPanner.connect(sharedRack.input);
        return { source, stereoPanner, sharedRack: true };
      }
      const samplerGraph = ensureSamplerEffectsGraph(context);
      if (!samplerGraph) return null;
      const source = context.createMediaElementSource(audio);
      const stereoPanner = context.createStereoPanner();
      stereoPanner.pan.value = Math.max(-1, Math.min(1, Number(pan) || 0));
      source.connect(stereoPanner);
      stereoPanner.connect(samplerGraph.input);
      return { source, stereoPanner, sharedRack: true, sharedSamplerGraph: true };
    } catch {
      return null;
    }
  };

  const volumeMacroValue = macroValue("volume", 100);
  const muteMacroValue = macroValue("mute", 0);
  const soloMacroValue = macroValue("solo", 0);
  const toneMacroValue = macroValue("tone", 50);
  const spaceMacroValue = macroValue("space", 50);
  const attackMacroValue = macroValue("attack", 0);
  const releaseMacroValue = macroValue("release", 0);
  const panMacroValue = macroValue("pan", 50);
  const samplerGroupSignature = JSON.stringify(project.samplerGroups || []);

  useEffect(() => {
    const volumeFactor = (volumeMacroValue / 100) * (muteMacroValue >= 50 && soloMacroValue < 50 ? 0 : 1);
    const attackMs = samplerAttackMilliseconds(attackMacroValue / 100);
    const releaseMs = samplerReleaseMilliseconds(releaseMacroValue / 100);
    const now = audioContextRef.current?.currentTime || 0;
    waveDspGraphRef.current?.masterGain?.gain.setTargetAtTime(volumeFactor, now, 0.01);
    waveDspGraphRef.current?.masterPanner?.pan.setTargetAtTime(Math.max(-1, Math.min(1, (panMacroValue - 50) / 50)), now, 0.01);
    updateSamplerEffectsGraph();
    activeSamplerVoicesRef.current.forEach((voice) => {
      voice.volumeFactor = volumeFactor;
      voice.releaseMs = releaseMs;
      voice.audioNodes?.forEach((nodes) => applyAudioEffectSettings(nodes));
      if (!voice.releasing) {
        voice.audios.forEach((audio) => {
          audio._vstGlobalAttackMs = attackMs;
          const group = (project.samplerGroups || []).find((item) => item.name === voice.audioGroups?.get(audio));
          const anySolo = (project.samplerGroups || []).some((item) => item.solo);
          const audible = anySolo ? !!group?.solo : !group?.mute;
          const groupVolume = audible ? Math.max(0, Math.min(100, Number(group?.volume ?? 100))) / 100 : 0;
          const baseVolume = (voice.mappingGains?.get(audio) || 0) * groupVolume;
          voice.baseVolumes?.set(audio, baseVolume);
          const nodes = voice.audioNodes?.get(audio);
          if (nodes?.stereoPanner) nodes.stereoPanner.pan.value = Math.max(-1, Math.min(1, Number(voice.mappingPans?.get(audio) || 0) + Number(group?.pan || 0)));
          if (nodes?.masterPanner) nodes.masterPanner.pan.value = Math.max(-1, Math.min(1, (panMacroValue - 50) / 50));
          else if (audio._vstTempoStretch && nodes?.stereoPanner) nodes.stereoPanner.pan.value = Math.max(-1, Math.min(1, Number(voice.mappingPans?.get(audio) || 0) + Number(group?.pan || 0) + (panMacroValue - 50) / 50));
          audio.volume = clampUnit(baseVolume * (nodes?.sharedRack ? 1 : voice.volumeFactor) * (audio._vstEnvelopeGain ?? 1));
        });
      }
    });
    // Audio nodes are kept in refs; these values intentionally drive the live preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.effects, project.tempoBpm, samplerGroupSignature, volumeMacroValue, muteMacroValue, soloMacroValue, toneMacroValue, spaceMacroValue, attackMacroValue, releaseMacroValue, panMacroValue]);

  useEffect(() => {
    const context = audioContextRef.current;
    if (!context) return;
    const postRackModules = (project.engineModules || []).filter(isPostSourceDspModule);
    if (postRackModules.length) {
      ensureWaveDspGraph(context, createDspPreviewPlan(postRackModules, project.interfaceControls, customImpulseTaps));
      return;
    }
    if (!waveDspGraphRef.current) return;
    activeSamplerVoicesRef.current.forEach((voice, token) => stopSamplerVoice(token, voice));
    activeWaveVoicesRef.current.forEach((voice, token) => stopWaveVoice(token, voice, true));
    releaseWaveDspGraph();
  // Keep every active instrument source on the same current ordered rack.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customImpulseTaps, project.engineModules, project.interfaceControls]);

  const updateProject = (key, value) => {
    setProject((current) => {
      const next = { ...current, [key]: value };
      projectRef.current = next;
      return next;
    });
  };

  const updateDesignerProject = (updater, mergeKey = null) => {
    const current = projectRef.current;
    const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
    const currentSnapshot = captureDesignerSnapshot(current);
    const nextSnapshot = captureDesignerSnapshot(next);
    if (designerSnapshotsMatch(currentSnapshot, nextSnapshot)) return;

    const now = Date.now();
    const previousMutation = designerHistoryLastMutationRef.current;
    if (!mergeKey || previousMutation.key !== mergeKey || now - previousMutation.at > DESIGNER_HISTORY_MERGE_MS) {
      designerHistoryPastRef.current = [...designerHistoryPastRef.current.slice(-(DESIGNER_HISTORY_LIMIT - 1)), currentSnapshot];
    }
    designerHistoryLastMutationRef.current = { at: now, key: mergeKey };
    designerHistoryFutureRef.current = [];
    projectRef.current = next;
    setProject(next);
    setDesignerHistoryVersion((version) => version + 1);
  };

  const restoreDesignerSnapshot = (snapshot) => {
    const next = {
      ...projectRef.current,
      ...snapshot,
      interfaceControls: snapshot.interfaceControls.map((control) => ({ ...control })),
      samplerGroups: snapshot.samplerGroups.map((group) => ({ ...group })),
    };
    projectRef.current = next;
    setProject(next);
    const availableIds = new Set(next.interfaceControls.map((control) => control.id));
    setSelectedInterfaceControlIds((current) => current.filter((id) => availableIds.has(id)));
  };

  const undoDesigner = () => {
    const previous = designerHistoryPastRef.current.at(-1);
    if (!previous) return;
    designerHistoryPastRef.current = designerHistoryPastRef.current.slice(0, -1);
    designerHistoryFutureRef.current = [captureDesignerSnapshot(projectRef.current), ...designerHistoryFutureRef.current].slice(0, DESIGNER_HISTORY_LIMIT);
    designerHistoryLastMutationRef.current = { at: 0, key: null };
    restoreDesignerSnapshot(previous);
    setDesignerHistoryVersion((version) => version + 1);
  };

  const redoDesigner = () => {
    const nextSnapshot = designerHistoryFutureRef.current[0];
    if (!nextSnapshot) return;
    designerHistoryFutureRef.current = designerHistoryFutureRef.current.slice(1);
    designerHistoryPastRef.current = [...designerHistoryPastRef.current.slice(-(DESIGNER_HISTORY_LIMIT - 1)), captureDesignerSnapshot(projectRef.current)];
    designerHistoryLastMutationRef.current = { at: 0, key: null };
    restoreDesignerSnapshot(nextSnapshot);
    setDesignerHistoryVersion((version) => version + 1);
  };

  const clearDesignerHistory = () => {
    designerHistoryPastRef.current = [];
    designerHistoryFutureRef.current = [];
    designerHistoryLastMutationRef.current = { at: 0, key: null };
    setDesignerHistoryVersion((version) => version + 1);
  };

  const updateSamplerGroup = (groupId, updates) => {
    setProject((current) => ({
      ...current,
      samplerGroups: current.samplerGroups.map((group) => group.id === groupId ? normalizeSamplerGroup({ ...group, ...updates }) : group),
    }));
  };

  const renameSamplerGroup = (groupId, requestedName) => {
    const name = String(requestedName || "").trim().slice(0, 48);
    if (!name) return;
    setProject((current) => {
      const source = current.samplerGroups.find((group) => group.id === groupId);
      if (!source || source.name === name) return current;
      if (current.samplerGroups.some((group) => group.id !== groupId && group.name.toLowerCase() === name.toLowerCase())) {
        toast.error("Nama sampler harus unik");
        return current;
      }
      return {
        ...current,
        samplerGroups: current.samplerGroups.map((group) => group.id === groupId ? { ...group, name } : group),
        sampleMappings: current.sampleMappings.map((mapping) => mapping.groupName === source.name ? { ...mapping, groupName: name } : mapping),
      };
    });
  };

  const addSamplerGroup = () => {
    if (project.samplerGroups.length >= 16) {
      toast.error("Maksimal 16 sampler dalam satu project");
      return;
    }
    let number = project.samplerGroups.length + 1;
    let name = `Sampler ${number}`;
    while (project.samplerGroups.some((group) => group.name === name)) name = `Sampler ${++number}`;
    const sampler = createSamplerGroup(name);
    updateProject("samplerGroups", [...project.samplerGroups, sampler]);
    return sampler;
  };

  const removeSamplerGroup = (groupId) => {
    const sampler = project.samplerGroups.find((group) => group.id === groupId);
    if (!sampler) return null;
    if (project.samplerGroups.length <= 1) {
      toast.error("Project harus memiliki minimal satu sampler");
      return null;
    }
    const zoneCount = project.sampleMappings.filter((mapping) => normalizeSamplerName(mapping.groupName) === sampler.name).length;
    if (!window.confirm(`Hapus sampler “${sampler.name}”${zoneCount ? ` beserta ${zoneCount} zona mapping` : ""}? File audio tetap tersedia di Sumber suara.`)) return null;
    const remaining = project.samplerGroups.filter((group) => group.id !== groupId);
    setProject((current) => ({
      ...current,
      samplerGroups: current.samplerGroups.filter((group) => group.id !== groupId),
      sampleMappings: current.sampleMappings.filter((mapping) => normalizeSamplerName(mapping.groupName) !== sampler.name),
    }));
    toast.success(`Sampler “${sampler.name}” dihapus`);
    return remaining[0]?.id || null;
  };

  const removeSamples = async (sampleIds) => {
    const uniqueIds = [...new Set(sampleIds)].filter(Boolean);
    if (!uniqueIds.length) return;
    const projectId = project.projectId;
    let removedIds = uniqueIds;
    let failedCount = 0;
    if (projectId && !projectId.startsWith("draft-")) {
      const results = await Promise.allSettled(uniqueIds.map((sampleId) => api.delete(
          `${apiBase}/projects/${encodeURIComponent(projectId)}/samples/${encodeURIComponent(sampleId)}`,
      )));
      removedIds = uniqueIds.filter((sampleId, index) => (
        results[index].status === "fulfilled" || results[index].reason?.response?.status === 404
      ));
      failedCount = uniqueIds.length - removedIds.length;
      if (!removedIds.length) {
        const firstError = results.find((result) => result.status === "rejected")?.reason;
        toast.error(firstError?.userMessage || "Audio sample gagal dihapus dari penyimpanan");
        return;
      }
    }
    removedIds.forEach((sampleId) => {
      const audioUrl = sampleAudioUrlsRef.current.get(sampleId);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      sampleAudioUrlsRef.current.delete(sampleId);
      samplePreviewRequestsRef.current.delete(sampleId);
      decodedSampleBuffersRef.current.delete(sampleId);
      decodedSampleRequestsRef.current.delete(sampleId);
    });
    activeSamplerVoicesRef.current.forEach((voice, token) => stopSamplerVoice(token, voice));
    activeGrooveVoicesRef.current.forEach((voice, token) => stopGrooveVoice(token, null, true));
    setSamples((current) => current.filter((sample) => !removedIds.includes(sample.id)));
    setProject((current) => ({
      ...current,
      sampleMappings: current.sampleMappings.filter((mapping) => !removedIds.includes(mapping.sampleId)),
    }));
    if (failedCount) {
      toast.warning(`${removedIds.length} audio sample dan zonanya dihapus; ${failedCount} sample gagal dihapus`);
    } else {
      toast.success(`${removedIds.length} audio sample dan seluruh zonanya dihapus`);
    }
  };

  const removeSample = (sampleId) => removeSamples([sampleId]);

  const ensureSamplePreviewFile = async (sample) => {
    if (sample?.file) return sample;
    if (!sample?.previewUrl) return null;
    let request = samplePreviewRequestsRef.current.get(sample.id);
    if (!request) {
      request = api.get(sample.previewUrl, { responseType: "blob", timeout: 0 })
        .then(({ data, headers }) => {
          const file = new File([data], sample.name, { type: headers["content-type"] || data.type || "application/octet-stream" });
          const hydrated = { ...sample, file };
          setSamples((current) => current.map((item) => item.id === sample.id ? { ...item, file } : item));
          return hydrated;
        })
        .catch(() => null)
        .finally(() => samplePreviewRequestsRef.current.delete(sample.id));
      samplePreviewRequestsRef.current.set(sample.id, request);
    }
    return request;
  };

  const ensureDecodedSampleBuffer = async (sample) => {
    if (!sample?.id) return null;
    const cached = decodedSampleBuffersRef.current.get(sample.id);
    if (cached) return cached;
    let request = decodedSampleRequestsRef.current.get(sample.id);
    if (!request) {
      request = (async () => {
        const hydrated = sample.file ? sample : await ensureSamplePreviewFile(sample);
        const context = ensureAudioContext();
        if (!hydrated?.file || !context) return null;
        const buffer = await context.decodeAudioData(await hydrated.file.arrayBuffer());
        decodedSampleBuffersRef.current.set(sample.id, buffer);
        return buffer;
      })().catch(() => null).finally(() => decodedSampleRequestsRef.current.delete(sample.id));
      decodedSampleRequestsRef.current.set(sample.id, request);
    }
    return request;
  };

  const groovePlayableMappings = (pitch, velocity) => {
    const liveProject = projectRef.current;
    const groups = liveProject.samplerGroups || [];
    const anyGroupSoloed = groups.some((group) => group.solo);
    return (liveProject.sampleMappings || []).filter((mapping) => {
      const group = groups.find((item) => item.name === normalizeSamplerName(mapping.groupName));
      const audible = anyGroupSoloed ? !!group?.solo : !group?.mute;
      return audible
        && pitch >= mapping.lowPitch && pitch <= mapping.highPitch
        && velocity >= mapping.velocityLow && velocity <= mapping.velocityHigh
        && mapping.playbackMode !== "tempo_sync";
    });
  };

  const selectGrooveMappings = (pitch, velocity) => {
    const buckets = new Map();
    groovePlayableMappings(pitch, velocity).forEach((mapping) => {
      const key = normalizeSamplerName(mapping.groupName);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(mapping);
    });
    return Array.from(buckets.entries()).map(([layerKey, bucket]) => {
      const nearestDistance = Math.min(...bucket.map((mapping) => Math.abs(pitch - mapping.rootPitch)));
      const nearest = bucket.filter((mapping) => Math.abs(pitch - mapping.rootPitch) === nearestDistance);
      const anchor = [...nearest].sort((left, right) => (
        (left.velocityHigh - left.velocityLow) - (right.velocityHigh - right.velocityLow)
        || (left.highPitch - left.lowPitch) - (right.highPitch - right.lowPitch)
      ))[0];
      const roundRobins = nearest.filter((mapping) => (
        mapping.rootPitch === anchor.rootPitch
        && mapping.lowPitch === anchor.lowPitch && mapping.highPitch === anchor.highPitch
        && mapping.velocityLow === anchor.velocityLow && mapping.velocityHigh === anchor.velocityHigh
      )).sort((left, right) => (left.roundRobin || 1) - (right.roundRobin || 1));
      const cursorKey = `groove|${layerKey}|${anchor.rootPitch}|${anchor.lowPitch}-${anchor.highPitch}|${anchor.velocityLow}-${anchor.velocityHigh}|${pitch}`;
      const cursor = roundRobinCursorRef.current.get(cursorKey) || 0;
      roundRobinCursorRef.current.set(cursorKey, cursor + 1);
      return roundRobins[cursor % roundRobins.length];
    });
  };

  const prepareGroovePlayback = async (sequence) => {
    // Resume/create the context synchronously from the Play gesture before any
    // private sample download yields and browser autoplay permission expires.
    ensureAudioContext();
    setSamplerAudioStatus("Menyiapkan buffer audio groove…");
    const sampleIds = new Set();
    (sequence?.events || []).filter((event) => event.type === "note_on").forEach((event) => {
      groovePlayableMappings(event.note, event.velocity).forEach((mapping) => sampleIds.add(mapping.sampleId));
    });
    const liveSamples = samplesRef.current;
    const buffers = await Promise.all(Array.from(sampleIds).map((sampleId) => ensureDecodedSampleBuffer(liveSamples.find((sample) => sample.id === sampleId))));
    setSamplerAudioStatus(sampleIds.size > 0 && buffers.every(Boolean)
      ? "Groove siap · playback memakai scheduler audio presisi."
      : "Sebagian audio memakai jalur kompatibilitas browser.");
  };

  const scheduleGrooveVisual = (token, pitch, delayMs, active) => {
    const timer = window.setTimeout(() => {
      const timers = grooveVisualTimersRef.current.get(token) || [];
      grooveVisualTimersRef.current.set(token, timers.filter((item) => item !== timer));
      if (active) hitPitchTokensRef.current.set(token, pitch);
      else hitPitchTokensRef.current.delete(token);
      setPreviewPressedPitches((current) => {
        const next = new Set(current);
        if (active) next.add(pitch);
        else if (!Array.from(hitPitchTokensRef.current.values()).some((value) => value === pitch)) next.delete(pitch);
        return next;
      });
    }, Math.max(0, delayMs));
    const timers = grooveVisualTimersRef.current.get(token) || [];
    grooveVisualTimersRef.current.set(token, [...timers, timer]);
  };

  const stopGrooveVoice = (token, scheduledAtPerformance = null, immediate = false) => {
    const voice = activeGrooveVoicesRef.current.get(token);
    const delayMs = scheduledAtPerformance == null ? 0 : Math.max(0, scheduledAtPerformance - performance.now());
    if (voice) {
      const context = voice.context;
      const releaseAt = immediate ? context.currentTime : context.currentTime + delayMs / 1000;
      const releaseSeconds = immediate ? 0.005 : Math.max(0.005, samplerReleaseMilliseconds(macroValue("release", 0) / 100) / 1000);
      voice.layers.forEach(({ source, gain }) => {
        try {
          gain.gain.cancelScheduledValues(releaseAt);
          gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), releaseAt);
          gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt + releaseSeconds);
          source.stop(releaseAt + releaseSeconds + 0.01);
        } catch { /* source already ended */ }
      });
      voice.releasing = true;
      voice.held = false;
    }
    const pitch = voice?.pitch ?? hitPitchTokensRef.current.get(token);
    if (immediate) {
      (grooveVisualTimersRef.current.get(token) || []).forEach((timer) => window.clearTimeout(timer));
      grooveVisualTimersRef.current.delete(token);
      hitPitchTokensRef.current.delete(token);
      if (Number.isInteger(pitch)) setPreviewPressedPitches((current) => {
        const next = new Set(current);
        if (!Array.from(hitPitchTokensRef.current.values()).some((value) => value === pitch)) next.delete(pitch);
        return next;
      });
    } else {
      scheduleGrooveVisual(token, pitch, delayMs + 90, false);
    }
  };

  const playGrooveSamplerNote = (pitch, velocity, token, scheduledAtPerformance) => {
    const context = ensureAudioContext();
    if (!context) return false;
    const mappings = selectGrooveMappings(pitch, velocity);
    if (!mappings.length) return false;
    const liveSamples = samplesRef.current;
    const layers = mappings.map((mapping) => ({
      mapping,
      sample: liveSamples.find((sample) => sample.id === mapping.sampleId),
      buffer: decodedSampleBuffersRef.current.get(mapping.sampleId),
    })).filter(({ buffer }) => buffer);
    if (layers.length !== mappings.length) return false;
    const delayMs = Math.max(0, scheduledAtPerformance - performance.now());
    const startAt = context.currentTime + delayMs / 1000;
    const chokeTargets = new Set(mappings.flatMap((mapping) => mapping.chokeTargetPitches || []).map(Number));
    activeGrooveVoicesRef.current.forEach((voice, activeToken) => {
      if (chokeTargets.has(voice.pitch)) stopGrooveVoice(activeToken, scheduledAtPerformance);
    });
    const postRackModules = (projectRef.current.engineModules || []).filter(isPostSourceDspModule);
    const sharedRack = postRackModules.length
      ? ensureWaveDspGraph(context, createDspPreviewPlan(postRackModules, projectRef.current.interfaceControls, customImpulseTaps))
      : null;
    const graph = sharedRack || ensureSamplerEffectsGraph(context);
    if (!graph?.input) return false;
    const normalizedVelocity = velocity / 127;
    const layerVolume = Math.max(0.001, Math.min(1, ((normalizedVelocity * normalizedVelocity) * 0.85) / Math.sqrt(layers.length)));
    const globalTuning = dspGlobalTuningSemitones(projectRef.current.engineModules);
    const attackSeconds = samplerAttackMilliseconds(macroValue("attack", 0) / 100) / 1000;
    const voice = { context, pitch, layers: [], releasing: false, held: true };
    layers.forEach(({ mapping, buffer }) => {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const panner = context.createStereoPanner();
      const group = (projectRef.current.samplerGroups || []).find((item) => item.name === normalizeSamplerName(mapping.groupName));
      const groupVolume = Math.max(0, Math.min(1, Number(group?.volume ?? 100) / 100));
      const targetGain = clampUnit(layerVolume * groupVolume * (10 ** ((mapping.gainDb || 0) / 20)));
      const semitones = Math.max(-60, Math.min(60, pitch - mapping.rootPitch)) + Number(mapping.tuneSemitones || 0) + Number(mapping.tuneCents || 0) / 100 + globalTuning;
      source.buffer = buffer;
      source.playbackRate.value = 2 ** (semitones / 12);
      panner.pan.value = Math.max(-1, Math.min(1, Number(mapping.pan || 0) + Number(group?.pan || 0)));
      source.connect(gain); gain.connect(panner); panner.connect(graph.input);
      const startOffset = buffer.duration * Math.max(0, Math.min(0.999, mapping.sampleStart ?? 0));
      const endOffset = buffer.duration * Math.max(0.001, Math.min(1, mapping.sampleEnd ?? 1));
      if (mapping.loopEnabled) {
        source.loop = true;
        source.loopStart = buffer.duration * Math.max(mapping.sampleStart ?? 0, Math.min(mapping.sampleEnd ?? 1, mapping.loopStart ?? mapping.sampleStart ?? 0));
        source.loopEnd = buffer.duration * Math.max(mapping.sampleStart ?? 0, Math.min(mapping.sampleEnd ?? 1, mapping.loopEnd ?? mapping.sampleEnd ?? 1));
      }
      const zoneAttack = Math.max(attackSeconds, Math.max(0, Number(mapping.fadeInMs) || 0) / 1000);
      gain.gain.setValueAtTime(zoneAttack > 0 ? 0.0001 : targetGain, startAt);
      if (zoneAttack > 0) gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, targetGain), startAt + zoneAttack);
      if (source.loop) source.start(startAt, startOffset);
      else source.start(startAt, startOffset, Math.max(0.001, endOffset - startOffset));
      const layer = { source, gain, panner };
      source.onended = () => {
        try { source.disconnect(); gain.disconnect(); panner.disconnect(); } catch { /* already disconnected */ }
        voice.layers = voice.layers.filter((item) => item !== layer);
        if (!voice.layers.length) activeGrooveVoicesRef.current.delete(token);
      };
      voice.layers.push(layer);
    });
    activeGrooveVoicesRef.current.set(token, voice);
    scheduleGrooveVisual(token, pitch, delayMs, true);
    return true;
  };

  const playSamplerNote = async (pitch, velocity, token, articulation = null, micPosition = null, samplerName = null, playbackOptions = null) => {
    if (playbackOptions?.grooveScheduled) {
      if (playGrooveSamplerNote(pitch, velocity, token, playbackOptions.scheduledAtPerformance)) return;
      const delay = Math.max(0, playbackOptions.scheduledAtPerformance - performance.now());
      grooveFallbackTokensRef.current.add(token);
      const timer = window.setTimeout(() => {
        grooveFallbackTimersRef.current.delete(token);
        if (!grooveFallbackTokensRef.current.has(token)) return;
        playSamplerNote(pitch, velocity, token);
      }, delay);
      grooveFallbackTimersRef.current.set(token, timer);
      return;
    }
    const previewContext = ensureAudioContext();
    hitPitchTokensRef.current.set(token, pitch);
    setPreviewPressedPitches((current) => new Set(current).add(pitch));
    const waveStarted = playWaveGeneratorNote(pitch, velocity, token);
    // Build and schedule the oscillator synchronously inside the user gesture.
    // Waiting for resume() first adds first-note latency and can lose a quick
    // key-up before the voice/token has been registered.
    if (previewContext?.state === "suspended") {
      try { await previewContext.resume(); } catch { /* direct playback remains available as a fallback */ }
    }
    const samplerGroups = project.samplerGroups || [];
    const anyGroupSoloed = samplerGroups.some((group) => group.solo);
    const groupForMapping = (mapping) => samplerGroups.find((group) => group.name === normalizeSamplerName(mapping.groupName));
    const playablePitchMappings = project.sampleMappings.filter((mapping) => {
      const group = groupForMapping(mapping);
      const groupAudible = anyGroupSoloed ? !!group?.solo : !group?.mute;
      return groupAudible
      && (!samplerName || normalizeSamplerName(mapping.groupName) === samplerName)
      && (
      pitch >= mapping.lowPitch
      && pitch <= mapping.highPitch
      && velocity >= mapping.velocityLow
      && velocity <= mapping.velocityHigh
      );
    });
    const selectedPitchMappings = playablePitchMappings.filter((mapping) => (
      (!articulation || (mapping.articulation || "Sustain") === articulation)
      && (!micPosition || (mapping.micPosition || "Main") === micPosition)
    ));
    // A selector value from the previous render must not mute the only zone.
    const pitchMatchedMappings = selectedPitchMappings.length
      ? selectedPitchMappings
      : playablePitchMappings.length === 1 ? playablePitchMappings : [];
    // Auditioning is deliberately strict: Designer and Mapping play only the
    // zones stored in the mapping. Templates never invent or infer a sound.
    const matchingMappings = pitchMatchedMappings;
    if (!matchingMappings.length) {
      setSamplerAudioStatus(waveStarted
        ? `Wave Generator aktif · ${midiNoteName(pitch)} · velocity ${velocity}.`
        : `Tidak ada zona sampel untuk ${midiNoteName(pitch)} pada velocity ${velocity}.`);
      return;
    }

    const layerBuckets = new Map();
    matchingMappings.forEach((mapping) => {
      const key = normalizeSamplerName(mapping.groupName);
      if (!layerBuckets.has(key)) layerBuckets.set(key, []);
      layerBuckets.get(key).push(mapping);
    });
    const selectedMappings = Array.from(layerBuckets.entries()).map(([layerKey, bucket]) => {
      const nearestDistance = Math.min(...bucket.map((mapping) => Math.abs(pitch - mapping.rootPitch)));
      const nearestMappings = bucket.filter((mapping) => Math.abs(pitch - mapping.rootPitch) === nearestDistance);
      const setAnchor = [...nearestMappings].sort((left, right) => (
        (left.velocityHigh - left.velocityLow) - (right.velocityHigh - right.velocityLow)
        || (left.highPitch - left.lowPitch) - (right.highPitch - right.lowPitch)
      ))[0];
      const roundRobins = nearestMappings
        .filter((mapping) => (
          mapping.rootPitch === setAnchor.rootPitch
          && mapping.lowPitch === setAnchor.lowPitch
          && mapping.highPitch === setAnchor.highPitch
          && mapping.velocityLow === setAnchor.velocityLow
          && mapping.velocityHigh === setAnchor.velocityHigh
        ))
        .sort((left, right) => (left.roundRobin || 1) - (right.roundRobin || 1));
      const cursorKey = `${articulation || "all"}|${micPosition || "all"}|${layerKey}|${setAnchor.rootPitch}|${setAnchor.lowPitch}-${setAnchor.highPitch}|${setAnchor.velocityLow}-${setAnchor.velocityHigh}|${pitch}`;
      const cursor = roundRobinCursorRef.current.get(cursorKey) || 0;
      roundRobinCursorRef.current.set(cursorKey, cursor + 1);
      return roundRobins[cursor % roundRobins.length];
    });
    const chokeTargetPitches = new Set(matchingMappings.flatMap((mapping) => (
      Array.isArray(mapping.chokeTargetPitches) ? mapping.chokeTargetPitches : []
    )).map(Number).filter((targetPitch) => (
      Number.isInteger(targetPitch) && targetPitch >= 0 && targetPitch <= 127 && targetPitch !== pitch
    )));
    if (chokeTargetPitches.size) {
      activeSamplerVoicesRef.current.forEach((voice, activeToken) => {
        if (chokeTargetPitches.has(voice.pitch)) releaseSamplerVoice(activeToken, voice, 8);
      });
      pendingPreviewVoiceMetaRef.current.forEach((meta, pendingToken) => {
        if (chokeTargetPitches.has(meta.pitch)) releasedPreviewTokensRef.current.add(pendingToken);
      });
    }
    // Under Sustain, loops and Tempo Sync voices retrigger on the same pitch
    // instead of stacking. Ordinary one-shots remain fully polyphonic.
    activeSamplerVoicesRef.current.forEach((voice, activeToken) => {
      if (voice.pitch === pitch && voice.retriggerExclusive) releaseSamplerVoice(activeToken, voice, 8);
    });
    pendingPreviewVoiceMetaRef.current.forEach((meta, pendingToken) => {
      if (meta.pitch === pitch && meta.retriggerExclusive) releasedPreviewTokensRef.current.add(pendingToken);
    });
    pendingPreviewVoiceMetaRef.current.set(token, {
      pitch,
      retriggerExclusive: selectedMappings.some((mapping) => (
        mapping.loopEnabled || mapping.playbackMode === "tempo_sync"
      )),
    });
    const candidateLayers = selectedMappings.map((mapping) => ({ mapping, sample: samples.find((item) => item.id === mapping.sampleId), group: groupForMapping(mapping) }));
    const needsPrivatePreview = candidateLayers.some(({ sample }) => !sample?.file && sample?.previewUrl);
    let playableLayers;
    if (needsPrivatePreview) {
      setSamplerAudioStatus("Memuat audio privat untuk preview…");
      pendingPreviewTokensRef.current.add(token);
      playableLayers = (await Promise.all(candidateLayers.map(async ({ mapping, sample, group }) => ({
        mapping,
        sample: await ensureSamplePreviewFile(sample),
        group,
      })))).filter(({ sample }) => sample?.file);
      pendingPreviewTokensRef.current.delete(token);
      if (releasedPreviewTokensRef.current.delete(token)) {
        pendingPreviewVoiceMetaRef.current.delete(token);
        if (playableLayers.length) setSamplerAudioStatus("Audio privat sudah siap. Tekan tuts sekali lagi untuk memainkannya.");
        return;
      }
    } else {
      playableLayers = candidateLayers.filter(({ sample }) => sample?.file);
    }
    if (!playableLayers.length) {
      pendingPreviewVoiceMetaRef.current.delete(token);
      setSamplerAudioStatus("Audio preview tidak dapat dimuat. Simpan project atau periksa koneksi penyimpanan.");
      return;
    }

    // Match the native sampler's expressive velocity curve. A squared curve
    // makes a single sample respond clearly from pianissimo to fortissimo.
    const normalizedVelocity = velocity / 127;
    const velocityGain = normalizedVelocity * normalizedVelocity;
    const layerVolume = Math.max(0.001, Math.min(1, (velocityGain * 0.85) / Math.sqrt(playableLayers.length)));
    const previewMuted = macroValue("mute", 0) >= 50 && macroValue("solo", 0) < 50;
    const volumeFactor = (macroValue("volume", 100) / 100) * (previewMuted ? 0 : 1);
    const releaseMs = samplerReleaseMilliseconds(macroValue("release", 0) / 100);
    // Tempo-stretch setup is asynchronous. Track the token during that setup so
    // a pointer-up/Sustain-Off which happens before the voice is registered is
    // not lost and cannot leave an orphaned looping voice behind.
    pendingPreviewTokensRef.current.add(token);
    let audios;
    try {
      audios = await Promise.all(playableLayers.map(async ({ mapping, sample, group }) => {
      // Keep the full MIDI interval available so one sample can cover a 61-key
      // chromatic keyboard. The previous ±24-semitone limit made every note
      // above C5 sound identical when the root note was C3.
      const transposition = Math.max(-60, Math.min(60, pitch - mapping.rootPitch));
      const globalTuning = dspGlobalTuningSemitones(projectRef.current.engineModules);
      const pitchRate = 2 ** ((
        transposition * 100
        + (mapping.tuneSemitones || 0) * 100
        + (mapping.tuneCents || 0)
        + globalTuning * 100
      ) / 1200);
      const tempoSyncEnabled = mapping.playbackMode === "tempo_sync" && mapping.sourceBpmConfirmed === true;
      const sourceBpm = Math.max(20, Math.min(300, Number(mapping.sourceBpm) || 120));
      const targetBpm = Math.max(20, Math.min(300, Number(projectRef.current.tempoBpm) || 120));
      const baseSemitones = transposition + Number(mapping.tuneSemitones || 0) + Number(mapping.tuneCents || 0) / 100 + globalTuning;
      const bendSemitones = ((pitchBendRef.current - 50) / 50) * 2;
      const groupVolume = Math.max(0, Math.min(1, Number(group?.volume ?? 100) / 100));
      const baseVolume = clampUnit(layerVolume * groupVolume * (10 ** ((mapping.gainDb || 0) / 20)));
      const zoneFadeInMs = Math.max(0, Number(mapping.fadeInMs) || 0);
      const globalAttackMs = samplerAttackMilliseconds(macroValue("attack", 0) / 100);
      const combinedPan = Math.max(-1, Math.min(1, Number(mapping.pan || 0) + Number(group?.pan || 0)));
      const tempoPreviewPan = Math.max(-1, Math.min(1, combinedPan + (macroValue("pan", 50) - 50) / 50));
      let audio;
      let audioNodes;
      if (tempoSyncEnabled && previewContext) {
        const postRackModules = (projectRef.current.engineModules || []).filter(isPostSourceDspModule);
        const rackPlan = postRackModules.length
          ? createDspPreviewPlan(postRackModules, projectRef.current.interfaceControls, customImpulseTaps)
          : [];
        const sharedRack = rackPlan.length
          ? ensureWaveDspGraph(previewContext, rackPlan)
          : null;
        audio = await createTempoStretchPreviewVoice({
          context: previewContext,
          destination: sharedRack?.input || meterAnalyserRef.current,
          file: sample.file,
          startFraction: mapping.sampleStart ?? 0,
          endFraction: mapping.sampleEnd ?? 1,
          loopEnabled: !!mapping.loopEnabled,
          loopStartFraction: mapping.loopStart ?? mapping.sampleStart ?? 0,
          loopEndFraction: mapping.loopEnd ?? mapping.sampleEnd ?? 1,
          tempoRate: targetBpm / sourceBpm,
          semitones: baseSemitones + bendSemitones,
          pan: sharedRack ? combinedPan : tempoPreviewPan,
        });
        audio._vstSourceBpm = sourceBpm;
        audio._vstBaseSemitones = baseSemitones;
        audioNodes = audio._vstAudioNodes;
        if (sharedRack && audioNodes) audioNodes.sharedRack = true;
      } else {
        let audioUrl = sampleAudioUrlsRef.current.get(sample.id);
        if (!audioUrl) {
          audioUrl = URL.createObjectURL(sample.file);
          sampleAudioUrlsRef.current.set(sample.id, audioUrl);
        }
        audio = new Audio(audioUrl);
        audio.preload = "auto";
        audio.muted = false;
        audio.defaultMuted = false;
        audio._vstBasePlaybackRate = pitchRate;
        audio.playbackRate = audio._vstBasePlaybackRate * (2 ** (bendSemitones / 12));
        if ("preservesPitch" in audio) audio.preservesPitch = false;
        if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = false;
        audioNodes = createAudioEffects(audio, combinedPan);
      }
      audio._vstGlobalAttackMs = globalAttackMs;
      audio._vstEnvelopeGain = zoneFadeInMs > 0 || globalAttackMs > 0 ? 0 : 1;
      audio.volume = clampUnit(baseVolume * (audioNodes?.sharedRack ? 1 : volumeFactor) * audio._vstEnvelopeGain);
      let hasLooped = false;
      const removeAudioFromVoice = () => {
        if (audio._vstEnvelopeFrame) window.cancelAnimationFrame?.(audio._vstEnvelopeFrame);
        setWaveformPlayback((current) => (current?.audio === audio ? null : current));
        const voice = activeSamplerVoicesRef.current.get(token);
        if (!voice) return;
        voice.audios = voice.audios.filter((item) => item !== audio);
        const nodes = voice.audioNodes?.get(audio) || audioNodes;
        cleanupAudioNodes(nodes);
        voice.audioNodes?.delete(audio);
        if (!voice.audios.length) activeSamplerVoicesRef.current.delete(token);
      };
      audio.onloadedmetadata = () => {
        audio.currentTime = audio.duration * Math.max(0, Math.min(0.999, mapping.sampleStart ?? 0));
      };
      const updateAudioPosition = () => {
        if (!Number.isFinite(audio.duration) || !audio.duration) return;
        const startAt = audio.duration * Math.max(0, Math.min(0.999, mapping.sampleStart ?? 0));
        const endAt = audio.duration * Math.max(0.001, Math.min(1, mapping.sampleEnd ?? 1));
        const loopStartAt = audio.duration * Math.max(mapping.sampleStart ?? 0, Math.min(mapping.sampleEnd ?? 1, mapping.loopStart ?? mapping.sampleStart ?? 0));
        const loopEndAt = audio.duration * Math.max(mapping.sampleStart ?? 0, Math.min(mapping.sampleEnd ?? 1, mapping.loopEnd ?? mapping.sampleEnd ?? 1));
        if (audio._vstLoopEnabled && loopEndAt > loopStartAt && audio.currentTime >= loopEndAt) {
          audio.currentTime = loopStartAt;
          hasLooped = true;
          return;
        }
        if (audio.currentTime >= endAt) {
          audio.pause();
          removeAudioFromVoice();
          return;
        }
        const elapsedMs = Math.max(0, (audio.currentTime - startAt) * 1000);
        const remainingMs = Math.max(0, (endAt - audio.currentTime) * 1000);
        const voice = activeSamplerVoicesRef.current.get(token);
        const currentVolumeFactor = voice?.volumeFactor ?? volumeFactor;
        const currentBaseVolume = voice?.baseVolumes?.get(audio) ?? baseVolume;
        const zoneFadeIn = zoneFadeInMs > 0 && !hasLooped ? Math.min(1, elapsedMs / zoneFadeInMs) : 1;
        const currentAttackMs = Math.max(0, Number(audio._vstGlobalAttackMs) || 0);
        const globalAttack = currentAttackMs > 0 ? Math.min(1, elapsedMs / currentAttackMs) : 1;
        const fadeOut = mapping.fadeOutMs > 0 && !audio._vstLoopEnabled ? Math.min(1, remainingMs / mapping.fadeOutMs) : 1;
        audio._vstEnvelopeGain = Math.min(zoneFadeIn * globalAttack, fadeOut);
        audio.volume = clampUnit(currentBaseVolume * (audio._vstUsesSharedRack ? 1 : currentVolumeFactor) * audio._vstEnvelopeGain);
      };
      const animateEnvelope = () => {
        updateAudioPosition();
        if (!audio.paused && !audio.ended) audio._vstEnvelopeFrame = window.requestAnimationFrame?.(animateEnvelope);
      };
      const needsRealtimeEnvelope = audio._vstLoopEnabled
        || Number(mapping.sampleStart ?? 0) > 0
        || Number(mapping.sampleEnd ?? 1) < 1
        || zoneFadeInMs > 0
        || globalAttackMs > 0
        || Number(mapping.fadeOutMs) > 0;
      audio.ontimeupdate = updateAudioPosition;
      audio.onplay = () => {
        setWaveformPlayback({ audio, sampleId: sample.id, mappingId: mapping.id });
        setSamplerAudioStatus(`Audio aktif · ${sample.name} · ${midiNoteName(pitch)}${tempoSyncEnabled ? ` · sync ${sourceBpm}→${targetBpm} BPM` : ""} · volume ${Math.round(baseVolume * volumeFactor * 100)}%.`);
        if (audio._vstEnvelopeFrame) window.cancelAnimationFrame?.(audio._vstEnvelopeFrame);
        if (needsRealtimeEnvelope) animateEnvelope();
      };
      audio.onpause = () => {
        if (audio._vstEnvelopeFrame) window.cancelAnimationFrame?.(audio._vstEnvelopeFrame);
        setWaveformPlayback((current) => (current?.audio === audio ? null : current));
      };
      audio.onended = removeAudioFromVoice;
      audio.onerror = () => {
        const mediaErrors = {
          1: "pemutaran dibatalkan",
          2: "file tidak dapat dibaca",
          3: "format WAV gagal didekode",
          4: "codec audio tidak didukung Chrome",
        };
        setSamplerAudioStatus(`Gagal memutar ${sample.name}: ${mediaErrors[audio.error?.code] || "kesalahan audio tidak diketahui"}.`);
        removeAudioFromVoice();
      };
      audio._vstAudioNodes = audioNodes;
      audio._vstUsesSharedRack = audioNodes?.sharedRack === true;
      audio._vstMappingId = mapping.id;
      audio._vstTempoSyncMode = mapping.playbackMode === "tempo_sync";
      audio._vstLoopEnabled = !!mapping.loopEnabled;
      audio._vstLoopStartFraction = mapping.loopStart ?? mapping.sampleStart ?? 0;
      audio._vstLoopEndFraction = mapping.loopEnd ?? mapping.sampleEnd ?? 1;
      return audio;
      }));
    } catch {
      pendingPreviewTokensRef.current.delete(token);
      pendingPreviewVoiceMetaRef.current.delete(token);
      releasedPreviewTokensRef.current.delete(token);
      setSamplerAudioStatus("Mesin Tempo Sync gagal menyiapkan audio preview. Coba tekan tuts kembali.");
      return;
    }
    pendingPreviewTokensRef.current.delete(token);
    pendingPreviewVoiceMetaRef.current.delete(token);
    const liveMappingsById = new Map((projectRef.current.sampleMappings || []).map((mapping) => [mapping.id, mapping]));
    audios.forEach((audio) => {
      const liveMapping = liveMappingsById.get(audio._vstMappingId);
      if (!liveMapping) return;
      audio._vstLoopEnabled = !!liveMapping.loopEnabled;
      audio._vstLoopStartFraction = liveMapping.loopStart ?? liveMapping.sampleStart ?? 0;
      audio._vstLoopEndFraction = liveMapping.loopEnd ?? liveMapping.sampleEnd ?? 1;
      audio._vstSetLoop?.(audio._vstLoopEnabled, audio._vstLoopStartFraction, audio._vstLoopEndFraction);
    });
    if (releasedPreviewTokensRef.current.delete(token)) {
      audios.forEach((audio) => {
        audio.pause();
        cleanupAudioNodes(audio._vstAudioNodes);
      });
      return;
    }
    activeSamplerVoicesRef.current.set(token, {
      audios,
      pitch,
      retriggerExclusive: audios.some((audio) => audio._vstLoopEnabled || audio._vstTempoSyncMode),
      held: true,
      releasing: false,
      releaseMs,
      volumeFactor,
      pausedByVolume: new Set(),
      baseVolumes: new Map(playableLayers.map(({ mapping, group }, index) => [audios[index], clampUnit(layerVolume * (Math.max(0, Math.min(100, Number(group?.volume ?? 100))) / 100) * (10 ** ((mapping.gainDb || 0) / 20)))])),
      mappingGains: new Map(playableLayers.map(({ mapping }, index) => [audios[index], clampUnit(layerVolume * (10 ** ((mapping.gainDb || 0) / 20)))])),
      mappingPans: new Map(playableLayers.map(({ mapping }, index) => [audios[index], Number(mapping.pan || 0)])),
      audioGroups: new Map(playableLayers.map(({ mapping }, index) => [audios[index], normalizeSamplerName(mapping.groupName)])),
      audioNodes: new Map(audios.map((audio) => [audio, audio._vstAudioNodes]).filter(([, nodes]) => nodes)),
    });
    setSamplerAudioStatus(`Memainkan ${midiNoteName(pitch)} · ${articulation || "semua articulation"} · ${audios.length} layer.`);
    const results = await Promise.allSettled(audios.map((audio) => audio.play()));
    const rejectedAudios = audios.filter((_, index) => results[index].status === "rejected");
    if (rejectedAudios.length) {
      const voice = activeSamplerVoicesRef.current.get(token);
      rejectedAudios.forEach((audio) => {
        cleanupAudioNodes(voice?.audioNodes?.get(audio) || audio._vstAudioNodes);
        voice?.audioNodes?.delete(audio);
      });
      if (voice) voice.audios = voice.audios.filter((audio) => !rejectedAudios.includes(audio));
    }
    if (results.every((result) => result.status === "rejected")) {
      stopSamplerVoice(token, activeSamplerVoicesRef.current.get(token));
      setSamplerAudioStatus("Browser gagal memutar file ini. Coba file WAV lain.");
    }
  };
  playSamplerNote.prepareGroove = prepareGroovePlayback;

  const releaseSamplerVoice = (token, voice, durationOverride = null) => {
    if (!voice || (voice.releasing && durationOverride === null)) return;
    if (voice.releaseFrame) {
      if (typeof window !== "undefined" && window.cancelAnimationFrame) window.cancelAnimationFrame(voice.releaseFrame);
      else clearTimeout(voice.releaseFrame);
      voice.releaseFrame = null;
    }
    const duration = Math.max(0, durationOverride === null ? (Number(voice.releaseMs) || 0) : Number(durationOverride));
    if (!duration) {
      stopSamplerVoice(token, voice);
      return;
    }
    voice.releasing = true;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const initialVolumes = new Map(voice.audios.map((audio) => [audio, audio.volume]));
    const tick = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const progress = Math.min(1, (now - startedAt) / duration);
      voice.audios.forEach((audio) => {
        audio.volume = clampUnit((initialVolumes.get(audio) || 0) * (1 - progress));
      });
      if (progress >= 1) {
        stopSamplerVoice(token, voice);
        return;
      }
      voice.releaseFrame = typeof window !== "undefined" && window.requestAnimationFrame
        ? window.requestAnimationFrame(tick)
        : setTimeout(tick, 16);
    };
    tick();
  };

  const stopSamplerNote = (token, playbackOptions = null) => {
    if (playbackOptions?.forceRelease && grooveFallbackTokensRef.current.has(token)) {
      grooveFallbackTokensRef.current.delete(token);
      const pendingTimer = grooveFallbackTimersRef.current.get(token);
      window.clearTimeout(pendingTimer);
      grooveFallbackTimersRef.current.delete(token);
      if (pendingTimer !== undefined) return;
    }
    if (playbackOptions?.grooveScheduled) {
      const delay = Math.max(0, playbackOptions.scheduledAtPerformance - performance.now());
      if (grooveFallbackTokensRef.current.has(token)) {
        window.setTimeout(() => {
          grooveFallbackTokensRef.current.delete(token);
          stopSamplerNote(token);
        }, delay);
      } else if (samplerSustainRef.current && !playbackOptions.forceRelease) {
        const voice = activeGrooveVoicesRef.current.get(token);
        if (voice) voice.held = false;
        scheduleGrooveVisual(token, voice?.pitch ?? hitPitchTokensRef.current.get(token), delay + 90, false);
      } else {
        stopGrooveVoice(token, playbackOptions.scheduledAtPerformance);
      }
      return;
    }
    if (activeGrooveVoicesRef.current.has(token)) {
      stopGrooveVoice(token, null, true);
      return;
    }
    const releasedPitch = hitPitchTokensRef.current.get(token);
    hitPitchTokensRef.current.delete(token);
    if (Number.isInteger(releasedPitch)) {
      window.setTimeout(() => {
        const stillActive = Array.from(hitPitchTokensRef.current.values()).some((pitch) => pitch === releasedPitch);
        if (!stillActive) setPreviewPressedPitches((current) => {
          const next = new Set(current);
          next.delete(releasedPitch);
          return next;
        });
      }, 90);
    }
    const voice = activeSamplerVoicesRef.current.get(token);
    const waveVoice = activeWaveVoicesRef.current.get(token);
    heldWaveNotesRef.current.delete(token);
    if (waveVoice) {
      const module = (projectRef.current.engineModules || []).find((item) => item.type === "wave_generator" && !item.bypassed);
      const parameters = module?.parameters || {};
      const monoMode = Math.max(0, Math.min(1, Number(parameters.voice_mode ?? 1))) >= 0.5;
      const fallbackNote = monoMode ? selectedHeldWaveNote() : null;
      if (fallbackNote) {
        retargetWaveVoice(waveVoice, fallbackNote.pitch, fallbackNote.velocity, parameters);
        activeWaveVoicesRef.current.delete(token);
        activeWaveVoicesRef.current.set(fallbackNote.token, waveVoice);
      } else {
        waveVoice.held = false;
        if (!samplerSustainRef.current) stopWaveVoice(token, waveVoice);
      }
    }
    if (!voice) {
      if (pendingPreviewTokensRef.current.has(token)) releasedPreviewTokensRef.current.add(token);
      return;
    }
    voice.held = false;
    if (samplerSustainRef.current) return;
    releaseSamplerVoice(token, voice);
  };

  const setSamplerSustainEffectiveState = (enabled) => {
    samplerSustainRef.current = enabled;
    setSamplerSustain(enabled);
    if (!enabled) {
      activeSamplerVoicesRef.current.forEach((voice, token) => {
        if (voice.held) return;
        releaseSamplerVoice(token, voice);
      });
      activeGrooveVoicesRef.current.forEach((voice, token) => {
        if (voice.held) return;
        stopGrooveVoice(token, null, true);
      });
      activeWaveVoicesRef.current.forEach((voice, token) => {
        if (!voice.held) stopWaveVoice(token, voice);
      });
    }
  };

  const setSamplerSustainState = (pedalEnabled) => {
    samplerSustainPedalRef.current = pedalEnabled;
    setSamplerSustainEffectiveState(projectRef.current.sustainEnabled === true || pedalEnabled);
  };

  midiPlayRef.current = playSamplerNote;
  midiStopRef.current = stopSamplerNote;
  midiSustainRef.current = setSamplerSustainState;

  const connectMidi = async () => {
    if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
      setMidiStatus("Browser ini belum mendukung Web MIDI. Gunakan Chrome atau Edge desktop.");
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      midiAccessRef.current = access;
      const refreshInputs = () => {
        const inputs = Array.from(access.inputs.values()).map((input) => ({ id: input.id, name: input.name || "MIDI controller", manufacturer: input.manufacturer || "" }));
        setMidiInputs(inputs);
        setSelectedMidiInputId((current) => current && inputs.some((input) => input.id === current) ? current : inputs[0]?.id || "");
        setMidiStatus(inputs.length ? `${inputs.length} perangkat MIDI tersedia` : "Tidak ada controller MIDI terdeteksi");
      };
      access.onstatechange = refreshInputs;
      refreshInputs();
    } catch (error) {
      setMidiStatus(error?.name === "SecurityError" ? "Izin MIDI ditolak oleh browser" : "Akses MIDI gagal dibuka");
    }
  };

  useEffect(() => {
    const access = midiAccessRef.current;
    if (!access) return undefined;
    const input = access.inputs.get(selectedMidiInputId);
    access.inputs.forEach((item) => { item.onmidimessage = null; });
    if (!input) return undefined;
    input.onmidimessage = (event) => {
      const [status, data1, data2] = event.data || [];
      const command = status & 0xf0;
      if (command === 0xb0 && data1 === 64) {
        const enabled = data2 >= 64;
        midiSustainRef.current?.(enabled);
        setMidiStatus(`MIDI sustain: ${enabled ? "On" : "Off"}`);
        return;
      }
      if (command === 0xb0 && data1 === 1) {
        if (projectRef.current.modulationEnabled !== true) return;
        const value = Math.round((data2 / 127) * 100);
        setPerformanceModulation(value);
        setMidiStatus(`MIDI modulation: ${value}%`);
        return;
      }
      if (command === 0xe0) {
        if (projectRef.current.pitchBendEnabled !== true) return;
        const rawValue = (data2 << 7) | data1;
        const value = Math.max(0, Math.min(100, Math.round((rawValue / 16383) * 100)));
        setPerformancePitchBend(value);
        setMidiStatus(`MIDI pitch bend: ${value === 50 ? "Center" : `${((value - 50) / 25).toFixed(2)} st`}`);
        return;
      }
      if (command !== 0x90 && command !== 0x80) return;
      const note = data1;
      const velocity = data2;
      if (command === 0x90 && velocity > 0) {
        const previousToken = midiHeldTokensRef.current.get(note);
        if (previousToken) midiStopRef.current?.(previousToken);
        const token = `midi-${input.id}-${note}-${++midiNoteSequenceRef.current}`;
        midiHeldTokensRef.current.set(note, token);
        setMidiPressedPitches((current) => new Set(current).add(note));
        setMidiStatus(`MIDI masuk: ${midiNoteName(note)} · velocity ${velocity}`);
        midiPlayRef.current?.(note, velocity, token);
      } else {
        const token = midiHeldTokensRef.current.get(note);
        midiHeldTokensRef.current.delete(note);
        setMidiPressedPitches((current) => {
          const next = new Set(current);
          next.delete(note);
          return next;
        });
        setMidiStatus(`MIDI lepas: ${midiNoteName(note)}`);
        if (token) midiStopRef.current?.(token);
      }
    };
    setMidiStatus(`Terhubung: ${input.name || "MIDI controller"}`);
    const heldTokens = midiHeldTokensRef.current;
    return () => {
      input.onmidimessage = null;
      heldTokens.forEach((token) => midiStopRef.current?.(token));
      heldTokens.clear();
      setMidiPressedPitches(new Set());
    };
  }, [selectedMidiInputId, midiInputs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const heldTokens = midiHeldTokensRef.current;
    return () => {
    midiAccessRef.current?.inputs.forEach((input) => { input.onmidimessage = null; });
    midiAccessRef.current && (midiAccessRef.current.onstatechange = null);
      heldTokens.forEach((token) => midiStopRef.current?.(token));
      heldTokens.clear();
      setMidiPressedPitches(new Set());
    };
  }, []);

  const toggleSamplerSustain = () => {
    const enabled = !projectRef.current.sustainEnabled;
    setProject((current) => {
      const next = { ...current, sustainEnabled: enabled };
      projectRef.current = next;
      return next;
    });
    setSamplerSustainEffectiveState(enabled || samplerSustainPedalRef.current);
  };

  const togglePitchBend = () => {
    updateDesignerProject((current) => ({ ...current, pitchBendEnabled: current.pitchBendEnabled !== true }));
  };

  const toggleModulation = () => {
    updateDesignerProject((current) => ({ ...current, modulationEnabled: current.modulationEnabled !== true }));
  };

  const applyProjectTemplate = async (templateId, { includeHidden = false, showToast = true } = {}) => {
    const template = allProjectTemplates.find((option) => option.id === templateId)
      || (includeHidden
        ? publishedTemplates.find((option) => option.id === templateId)
          || PROJECT_TEMPLATE_OPTIONS.find((option) => option.id === templateId)
        : null);
    if (!template) return false;
    if ((PREMIUM_PROJECT_TEMPLATE_IDS.has(template.id) || template.requiresPremium) && !canUseFeature("premium_templates")) {
      toast.error("Template artwork premium memerlukan paket Pro");
      return false;
    }
    if (template.publishedByAdmin && template.project) {
      const editorProjectId = customerMode
        ? `draft-${Date.now()}`
        : template.sourceProjectId || `draft-${Date.now()}`;
      const restored = fromSavedProject({
        ...template.project,
        id: editorProjectId,
      });
      clearDesignerHistory();
      clearSamplerPreview();
      setCustomImpulseTaps({});
      impulseFilesRef.current.clear();
      impulseBuffersRef.current.clear();
      const templateSamples = savedProjectSamples(template.project);
      const appliedProjectBase = { ...restored, pricingTemplateId: template.id, licenseMaxActivations: 1 };
      const appliedProject = {
        ...appliedProjectBase,
        pricingTemplateBaseline: createVstTemplatePricingBaseline(appliedProjectBase, templateSamples),
      };
      projectRef.current = appliedProject;
      setProject(appliedProject);
      setSamples(templateSamples);
      setSelectedInterfaceControlIds([]);
      setAppliedTemplateId(template.id);
      setActiveEditorTab("interface");
      try {
        const templateBase = `${apiBase}/templates/${encodeURIComponent(template.id)}`;
        const [sampleResponse, impulseResponse] = await Promise.all([
          api.get(`${templateBase}/samples`),
          api.get(`${templateBase}/impulse-responses`),
        ]);
        const assets = (Array.isArray(sampleResponse.data) ? sampleResponse.data : []).map((asset) => ({
          ...asset,
          preview_url: `${templateBase}/samples/${encodeURIComponent(asset.sample_id)}/preview`,
        }));
        setSamples(savedProjectSamples(template.project, assets));
        const impulseAssets = (Array.isArray(impulseResponse.data) ? impulseResponse.data : []).map((asset) => ({
          ...asset,
          preview_url: `${templateBase}/impulse-responses/${encodeURIComponent(asset.impulse_id)}/preview`,
        }));
        const impulses = savedProjectImpulses(template.project, impulseAssets);
        setProject((current) => {
          const next = { ...current, impulseResponses: impulses };
          projectRef.current = next;
          return next;
        });
        await Promise.all(impulses.filter((impulse) => impulse.previewUrl).map(async (impulse) => {
          try {
            const response = await api.get(impulse.previewUrl, { responseType: "arraybuffer" });
            impulseBuffersRef.current.set(impulse.id, response.data);
            await preprocessProjectImpulse(impulse, response.data);
          } catch {
            // A missing/undecodable template IR falls back to the procedural cabinet.
          }
        }));
        setSampleMessage(assets.length
          ? `${assets.length} sample template siap dimainkan dan ikut tersimpan.`
          : "Template diterapkan tanpa sample audio.");
        if (showToast) toast.success(`Template admin ${template.name} diterapkan lengkap dengan Mapping, Sample, Wave Generator, dan DSP`);
      } catch (error) {
        setSampleMessage(error.userMessage || "Aset audio template gagal dimuat.");
        toast.error(error.userMessage || "Template diterapkan, tetapi aset audionya gagal dimuat");
      }
      return true;
    }
    if (template.id === "basicvst") {
      const freshProject = createDraft("instrument");
      clearDesignerHistory();
      clearSamplerPreview();
      projectRef.current = freshProject;
      setProject(freshProject);
      setSamples([]);
      setCustomImpulseTaps({});
      impulseFilesRef.current.clear();
      impulseBuffersRef.current.clear();
      setSampleMessage("");
      setSelectedInterfaceControlIds([]);
      setAppliedTemplateId(template.id);
      setActiveEditorTab("interface");
      if (showToast) toast.success("VST Basic diterapkan sebagai project instrumen kosong");
      return true;
    }
    const ampTemplateState = template.id === "ampsimulator"
      ? createAmpSimulatorTemplateState(() => makeId())
      : template.id === "obsidianhighgain"
        ? createHighGainAmpTemplateState(() => makeId())
        : null;
    const prismModuleId = template.id === "prismeq" ? makeId() : null;
    const prismRack = prismModuleId ? [
      ...appendDspRackModule([], "input_trim", makeId()),
      ...appendDspRackModule([], "prism_eq", prismModuleId).map((module) => ({ ...module, parameters: {
        ...module.parameters,
        band_1_enabled: 1, band_2_enabled: 1, band_3_enabled: 1, band_4_enabled: 1, band_5_enabled: 1,
      } })),
      ...appendDspRackModule([], "dry_wet", makeId()),
      ...appendDspRackModule([], "output_trim", makeId()),
    ] : null;
    clearDesignerHistory();
    setProject((current) => {
      const nextProject = {
      ...current,
      projectId: `draft-${Date.now()}`,
      licenseMaxActivations: 1,
      name: template.name,
      manufacturerName: template.manufacturerName || "TripleSide Studio",
      pluginKind: template.pluginKind || "instrument",
      componentStyle: template.componentStyle || (template.pluginKind === "effect" ? "filmstrip" : "css"),
      projectTemplate: template.id,
      pricingTemplateId: template.id,
      instrumentType: template.instrumentType,
      keyboardKeys: template.keyboardKeys || current.keyboardKeys,
      canvasWidth: template.canvasWidth ?? (template.id === "premiumkeys" || template.backgroundUrl ? PREMIUM_PIANO_CANVAS_WIDTH : 0),
      canvasHeight: template.canvasHeight ?? (template.pluginKind === "effect" ? 576 : template.id === "premiumkeys" || template.backgroundUrl ? PREMIUM_PIANO_CANVAS_HEIGHT : 0),
      velocityLayers: template.velocityLayers || (template.id === "premiumkeys" ? 4 : current.velocityLayers),
      polyphony: template.polyphony || (template.id === "premiumkeys" ? 64 : current.polyphony),
      uiTemplate: template.uiTemplate || current.uiTemplate,
      uiColor: template.uiColor || defaultUiColor(template.uiTemplate || current.uiTemplate),
      accentColor: template.accentColor || current.accentColor,
      backgroundImageUrl: template.backgroundUrl || (template.id === "premiumkeys" ? PREMIUM_PIANO_BACKGROUND_URL : ""),
      backgroundImageName: template.backgroundName || (template.id === "premiumkeys" ? "Aurum Concert Grand Piano" : ""),
      backgroundFit: template.id === "premiumkeys" || template.backgroundUrl ? "cover" : current.backgroundFit,
      backgroundOpacity: template.backgroundOpacity ?? (template.pluginKind === "effect" ? 100 : template.id === "premiumkeys" || template.backgroundUrl ? 82 : current.backgroundOpacity),
      backgroundImageX: template.id === "premiumkeys" || template.backgroundUrl ? template.backgroundImageX ?? 50 : current.backgroundImageX,
      backgroundImageY: template.id === "premiumkeys" || template.backgroundUrl ? 50 : current.backgroundImageY,
      backgroundImageWidth: template.id === "premiumkeys" || template.backgroundUrl ? 100 : current.backgroundImageWidth,
      backgroundImageHeight: template.id === "premiumkeys" || template.backgroundUrl ? 100 : current.backgroundImageHeight,
      brandTagline: template.brandTagline || current.brandTagline,
      brandFont: template.brandFont || current.brandFont,
      brandSize: template.brandSize || current.brandSize,
      brandX: template.brandX ?? current.brandX,
      brandY: template.brandY ?? current.brandY,
      brandAlign: template.brandAlign || current.brandAlign,
      controls: template.pluginKind === "effect"
        ? template.id === "basicfx" ? [] : ["input", "drive", "compress", "tone", "width", "space", "mix", "output", "bypass", "output_level"]
        : template.id === "premiumkeys" || template.backgroundUrl
        ? ["volume", "tone", "attack", "release", "space"]
        : template.id === "synth" ? ["tone", "attack", "release", "space"] : current.controls,
      effects: template.effects || (template.id === "premiumkeys"
        ? { reverb: true, delay: false, chorus: false, saturation: true }
        : ["drumpad", "performancegrid"].includes(template.id)
        ? { reverb: true, delay: false, chorus: false, saturation: true }
        : template.id === "synth"
          ? { reverb: true, delay: true, chorus: true, saturation: false }
          : template.id === "sampler"
            ? { reverb: false, delay: false, chorus: false, saturation: false }
            : { reverb: true, delay: false, chorus: false, saturation: false }),
      interfaceControls: ampTemplateState?.interfaceControls || createTemplateControls(template.id, template.keyboardKeys || current.keyboardKeys).map((control) => (
        prismModuleId && (control.kind === "spectrum" || PRISM_CONTEXT_PARAMETERS.has(control.parameter)) ? { ...control, moduleId: prismModuleId } : control
      )),
      presets: [],
      midiMappings: [],
      midiSequences: [],
      engineModules: ampTemplateState?.engineModules || prismRack || current.engineModules,
      impulseResponses: ampTemplateState ? [] : current.impulseResponses,
      pitchBendEnabled: false,
      modulationEnabled: false,
      sampleMappings: template.pluginKind === "effect" ? [] : current.sampleMappings,
      };
      return {
        ...nextProject,
        pricingTemplateBaseline: createVstTemplatePricingBaseline(nextProject, []),
      };
    });
    if (ampTemplateState) {
      setCustomImpulseTaps({});
      impulseFilesRef.current.clear();
      impulseBuffersRef.current.clear();
    }
    if (template.pluginKind === "effect") {
      clearSamplerPreview();
      setSamples([]);
    }
    setSelectedInterfaceControlIds([]);
    setAppliedTemplateId(template.id);
    setActiveEditorTab("interface");
    const appliedComponentStyle = template.componentStyle || (template.pluginKind === "effect" ? "filmstrip" : "css");
    if (showToast) toast.success(`Template ${template.name} diterapkan dengan komponen ${appliedComponentStyle === "filmstrip" ? "Filmstrip PNG" : "CSS"}`);
    return true;
  };

  useEffect(() => {
    if (initialTemplateAppliedRef.current) return;
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("tab") === "templates") setActiveEditorTab("templates");
    const templateId = searchParams.get("template");
    if (templateId === "basicvst") {
      initialTemplateAppliedRef.current = true;
      resetDraft("instrument");
      return;
    }
    if (!templateId || !templateCatalogLoaded) return;
    if (!allProjectTemplates.some((template) => template.id === templateId)) return;
    initialTemplateAppliedRef.current = true;
    applyProjectTemplate(templateId);
  // Wait for the authoritative published catalog so an edited built-in or
  // custom template never falls back to a stale local definition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProjectTemplates, templateCatalogLoaded]);

  const updateKeyboardKeys = (keyCount) => {
    if (!KEYBOARD_SIZE_OPTIONS.includes(keyCount)) return;
    updateDesignerProject((current) => ({
      ...current,
      keyboardKeys: keyCount,
      interfaceControls: current.interfaceControls.map((control) => (
        control.kind === "keyboard" ? { ...control, keyCount, label: `${keyCount} Keys` } : control
      )),
    }));
  };

  const selectEditorTab = (tabId) => {
    if (tabId === "sampler") warmSamplerAudio();
    if (tabId === "templates") setProjectTemplateCategory("all");
    setDraftListOpen(false);
    setActiveEditorTab(tabId);
    window.requestAnimationFrame(() => editorTabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const addInterfaceControl = (kind, position = null, style = "inherit", variantId = null, overrides = {}) => {
    if (ordinaryInterfaceControlCount(project.interfaceControls) >= MAX_INTERFACE_CONTROLS) {
      toast.error(`Maksimal ${MAX_INTERFACE_CONTROLS} kontrol dalam satu panel`);
      return;
    }
    const count = project.interfaceControls.length;
    const variant = COMPONENT_VARIANTS.find((option) => option.kind === kind && option.id === variantId);
    const defaultLabel = variant?.label || INTERFACE_CONTROL_OPTIONS.find((option) => option.id === kind)?.label || "Control";
    const defaultSize = defaultControlSize(kind, variant);
    const lockKnobDefaultSize = usesClassicKnobDefaultSize(kind, variant);
    const isToggle = kind === "button" || kind === "solo" || kind === "mute";
    const isMeter = kind === "gain_meter" || kind === "vu_meter";
    const isVisual = kind === "visual" || kind === "spectrum" || kind === "text" || kind === "image" || kind === "panel_button";
    const control = {
      id: makeId(),
      kind,
      component_style: isVisual ? "css" : (["css", "filmstrip"].includes(style) && !["pad", "keyboard"].includes(kind) ? style : "inherit"),
      component_variant: variantId || (style === "filmstrip" ? "heritage" : "classic"),
      label: `${defaultLabel} ${count + 1}`,
      ...(kind === "button" ? { off_label: variant?.offLabel || `${defaultLabel} ${count + 1}`, on_label: variant?.onLabel || "ON" } : {}),
      parameter: isVisual ? "visual" : resolveVariantParameter(variant) || (kind === "solo" ? "solo" : kind === "mute" ? "mute" : isMeter ? "output_level" : kind === "button" ? "space" : "tone"),
      moduleId: null,
      x: position?.x ?? (kind === "keyboard" ? 50 : 20 + (count % 3) * 30),
      y: position?.y ?? (kind === "keyboard" ? 68 : 28 + (Math.floor(count / 3) % 2) * 40),
      value: variant?.value ?? (isToggle || isMeter || isVisual || kind === "pad" || kind === "keyboard" ? 0 : 50),
      opacity: 100,
      ...(isMeter ? { meterMode: kind === "gain_meter" ? "stereo" : "mono" } : {}),
      notePitch: 60,
      ...defaultSize,
      ...(!lockKnobDefaultSize && Number.isFinite(variant?.width) ? { width: variant.width } : {}),
      ...(!lockKnobDefaultSize && Number.isFinite(variant?.height) ? { height: variant.height } : {}),
      ...(kind === "keyboard" ? { width: keyboardWidthForKeys(project.keyboardKeys) } : {}),
      showBackground: variant?.showBackground ?? !isVisual,
      ...(["visual", "spectrum"].includes(kind) ? { visualColor: variant?.color || (kind === "spectrum" ? "#22D3EE" : "#E8E0CF") } : {}),
      ...(kind === "text" ? { textFont: "space-grotesk", textColor: "#F4F4F5" } : {}),
      ...(["pitch-bend-led", "modulation-led"].includes(variantId) ? { controlColor: project.accentColor } : {}),
      ...(kind === "pad" ? {
        padColor: defaultPadSurfaceColor(variantId || "rubber"),
        padActiveColor: defaultPadActiveColor(variantId || "rubber", 60, project.accentColor),
      } : {}),
      ...(kind === "keyboard" ? { keyCount: project.keyboardKeys } : {}),
      ...(kind === "panel_button" ? {
        panelType: variant?.panelType || "preset_browser",
        panelX: 50,
        panelY: 52,
        panelWidth: 88,
        panelHeight: 78,
        parentPanelId: null,
      } : {}),
      ...overrides,
    };
    updateDesignerProject((current) => {
      const needsPrismDsp = kind === "spectrum" && (variantId || "realtime-spectrum") === "realtime-spectrum";
      const existingPrism = needsPrismDsp ? current.engineModules.find((module) => module.type === "prism_eq") : null;
      const prismModuleId = existingPrism?.id || (needsPrismDsp ? makeId() : null);
      const nextControl = prismModuleId ? { ...control, moduleId: prismModuleId, parameter: "output_level" } : control;
      return {
      ...current,
      interfaceControls: [...current.interfaceControls, nextControl],
      engineModules: prismModuleId && !existingPrism
        ? appendDspRackModule(current.engineModules, "prism_eq", prismModuleId)
        : current.engineModules,
      ...(control.parameter === "pitch_bend" ? { pitchBendEnabled: true } : {}),
      ...(control.parameter === "modulation" ? { modulationEnabled: true } : {}),
      };
    });
    setSelectedInterfaceControlIds([control.id]);
    return control.id;
  };

  const updateInterfaceControl = (controlId, updates) => {
    updateDesignerProject((current) => {
      const currentControl = current.interfaceControls.find((control) => control.id === controlId);
      let nextControl = currentControl ? { ...currentControl, ...updates } : null;
      const bindingChanged = updates.moduleId !== undefined || updates.parameter !== undefined;
      if (nextControl?.moduleId && bindingChanged && updates.value === undefined) {
        const module = current.engineModules.find((item) => item.id === nextControl.moduleId);
        const bindingValue = dspBindingValue(module, nextControl.parameter);
        if (bindingValue !== null) nextControl = { ...nextControl, value: bindingValue * 100 };
      }
      const panMatch = /^group_(\d+)_pan$/.exec(nextControl?.parameter || "");
      const shouldSyncParameterValue = updates.value !== undefined && Boolean(nextControl?.parameter) && !["output_level", "gain_reduction"].includes(nextControl.parameter);
      return {
        ...current,
        interfaceControls: current.interfaceControls.map((control) => {
          if (control.id === controlId) return nextControl;
          return shouldSyncParameterValue && controlsShareDspBinding(control, nextControl)
            ? { ...control, value: nextControl.value }
            : control;
        }),
        ...(shouldSyncParameterValue ? {
          engineModules: syncDspRackFromControl(current.engineModules, nextControl),
        } : {}),
        ...(panMatch && updates.value !== undefined ? {
          samplerGroups: current.samplerGroups.map((group, index) => index === Number(panMatch[1]) ? { ...group, pan: Math.max(-1, Math.min(1, (Number(updates.value) - 50) / 50)) } : group),
        } : {}),
      };
    }, `control:${controlId}:${Object.keys(updates).sort().join(",")}`);
  };

  const updateInterfaceControls = (controlUpdates) => {
    const updatesById = new Map(controlUpdates.map(({ id, updates }) => [id, updates]));
    const mergeKey = `controls:${controlUpdates.map(({ id, updates }) => `${id}:${Object.keys(updates).sort().join(",")}`).sort().join("|")}`;
    updateDesignerProject((current) => ({
      ...current,
      interfaceControls: current.interfaceControls.map((control) => (
        updatesById.has(control.id) ? { ...control, ...updatesById.get(control.id) } : control
      )),
    }), mergeKey);
  };

  const moveInterfaceControlsLayer = (direction) => {
    updateDesignerProject((current) => ({
      ...current,
      interfaceControls: moveSelectedCanvasControls(
        current.interfaceControls,
        selectedInterfaceControlIds,
        direction,
      ),
    }), `control-layers:${selectedInterfaceControlIds.slice().sort().join(",")}:${direction}`);
  };

  const removeInterfaceControl = (controlId) => {
    if (PRISM_CONTEXT_PARAMETERS.has(projectRef.current.interfaceControls.find((control) => control.id === controlId)?.parameter)) return;
    updateDesignerProject((current) => {
      const interfaceControls = current.interfaceControls.filter((control) => control.id !== controlId && control.parentPanelId !== controlId && (control.prismOwnerId ?? control.prism_owner_id) !== controlId);
      const featureReferences = panelFeatureReferencesForControls(interfaceControls, current.presets);
      return {
        ...current,
        interfaceControls,
        ...featureReferences,
        pitchBendEnabled: hasInterfaceParameter(interfaceControls, "pitch_bend") && current.pitchBendEnabled === true,
        modulationEnabled: hasInterfaceParameter(interfaceControls, "modulation") && current.modulationEnabled === true,
      };
    });
    setSelectedInterfaceControlIds((current) => current.filter((id) => id !== controlId));
  };

  const selectInterfaceControl = (controlId, additive = false) => {
    setSelectedInterfaceControlIds((current) => {
      if (!controlId) return [];
      if (!additive) return [controlId];
      return current.includes(controlId)
        ? current.filter((id) => id !== controlId)
        : [...current, controlId];
    });
  };

  const removeSelectedInterfaceControls = () => {
    if (!selectedInterfaceControlIds.length) return;
    updateDesignerProject((current) => {
      const protectedIds = new Set(current.interfaceControls.filter((control) => PRISM_CONTEXT_PARAMETERS.has(control.parameter)).map((control) => control.id));
      const removableIds = selectedInterfaceControlIds.filter((id) => !protectedIds.has(id));
      const selectedIds = new Set(removableIds);
      const panelIds = new Set(current.interfaceControls.filter((control) => selectedIds.has(control.id) && control.kind === "panel_button").map((control) => control.id));
      const interfaceControls = removeSelectedCanvasControls(current.interfaceControls, removableIds).filter((control) => !panelIds.has(control.parentPanelId) && !panelIds.has(control.prismOwnerId ?? control.prism_owner_id));
      const featureReferences = panelFeatureReferencesForControls(interfaceControls, current.presets);
      return {
        ...current,
        interfaceControls,
        ...featureReferences,
        pitchBendEnabled: hasInterfaceParameter(interfaceControls, "pitch_bend") && current.pitchBendEnabled === true,
        modulationEnabled: hasInterfaceParameter(interfaceControls, "modulation") && current.modulationEnabled === true,
      };
    });
    setSelectedInterfaceControlIds([]);
  };

  const duplicateSelectedInterfaceControls = () => {
    if (!selectedInterfaceControlIds.length) return;
    const selectedIds = new Set(selectedInterfaceControlIds);
    const sourceControls = projectRef.current.interfaceControls.filter((control) => selectedIds.has(control.id) && !PRISM_CONTEXT_PARAMETERS.has(control.parameter));
    if (!sourceControls.length) return;
    if (ordinaryInterfaceControlCount(projectRef.current.interfaceControls) + sourceControls.length > MAX_INTERFACE_CONTROLS) {
      toast.error(`Tidak cukup ruang. Panel dibatasi maksimal ${MAX_INTERFACE_CONTROLS} komponen.`);
      return;
    }
    const canvasWidth = Math.max(320, Number(projectRef.current.canvasWidth) || 1024);
    const canvasHeight = Math.max(320, Number(projectRef.current.canvasHeight) || 460);
    const offsetX = Math.max(1.5, (Number(projectRef.current.gridSize) || 8) / canvasWidth * 100);
    const offsetY = Math.max(1.5, (Number(projectRef.current.gridSize) || 8) / canvasHeight * 100);
    const shiftedControls = offsetCanvasControlGroupWithinBounds({
      controls: sourceControls.map((control) => ({
        ...control,
        width: control.width ?? CONTROL_DEFAULT_SIZES[control.kind]?.width ?? 112,
        height: control.height ?? CONTROL_DEFAULT_SIZES[control.kind]?.height ?? 122,
      })),
      boundsWidth: canvasWidth,
      boundsHeight: canvasHeight,
      offsetX,
      offsetY,
    });
    const duplicateIds = [];
    const duplicates = shiftedControls.map((control) => {
      const id = makeId();
      duplicateIds.push(id);
      return {
        ...control,
        id,
        label: `${control.label || "Control"} Copy`.slice(0, 24),
        x: roundLayoutPercent(control.x),
        y: roundLayoutPercent(control.y),
      };
    });
    updateDesignerProject((current) => ({
      ...current,
      interfaceControls: [...current.interfaceControls, ...duplicates],
      ...(hasInterfaceParameter(duplicates, "pitch_bend") ? { pitchBendEnabled: true } : {}),
      ...(hasInterfaceParameter(duplicates, "modulation") ? { modulationEnabled: true } : {}),
    }));
    setSelectedInterfaceControlIds(duplicateIds);
  };

  useEffect(() => {
    const handleDesignerShortcut = (event) => {
      if (activeEditorTab !== "interface" || event.repeat) return;
      const isFormField = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']");
      if (isFormField) return;
      const key = event.key.toLowerCase();
      if ((key === "delete" || key === "backspace") && selectedInterfaceControlIds.length) {
        event.preventDefault();
        removeSelectedInterfaceControls();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (key === "d" && selectedInterfaceControlIds.length) {
        event.preventDefault();
        duplicateSelectedInterfaceControls();
      } else if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoDesigner();
      } else if (key === "z") {
        event.preventDefault();
        undoDesigner();
      } else if (key === "y") {
        event.preventDefault();
        redoDesigner();
      }
    };
    window.addEventListener("keydown", handleDesignerShortcut);
    return () => window.removeEventListener("keydown", handleDesignerShortcut);
  });

  const placeDroppedControl = (event) => {
    event.preventDefault();
    const value = event.dataTransfer.getData("application/x-vst-control");
    if (!value) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const draggedControl = value.startsWith("control:")
      ? project.interfaceControls.find((control) => control.id === value.slice(8))
      : null;
    const droppedKind = value.startsWith("kind:") ? value.slice(5) : draggedControl?.kind;
    const droppedVariantId = event.dataTransfer.getData("application/x-vst-control-variant");
    const droppedVariant = COMPONENT_VARIANTS.find((option) => option.kind === droppedKind && option.id === droppedVariantId);
    const droppedSize = draggedControl || defaultControlSize(droppedKind, droppedVariant);
    const logicalWidth = event.currentTarget.offsetWidth || bounds.width;
    const logicalHeight = event.currentTarget.offsetHeight || bounds.height;
    const halfWidth = Math.min(50, ((droppedSize.width || 112) / logicalWidth) * 50);
    const halfHeight = Math.min(50, ((droppedSize.height || 122) / logicalHeight) * 50);
    const rawX = Math.max(halfWidth, Math.min(100 - halfWidth, ((event.clientX - bounds.left) / bounds.width) * 100));
    const rawY = Math.max(halfHeight, Math.min(100 - halfHeight, ((event.clientY - bounds.top) / bounds.height) * 100));
    const snapSize = GRID_SIZE_OPTIONS.includes(Number(project.gridSize)) ? Number(project.gridSize) : 8;
    const snapActive = project.gridSnapEnabled !== false && !event.ctrlKey;
    const position = {
      x: roundLayoutPercent(!snapActive ? rawX : Math.max(halfWidth, Math.min(100 - halfWidth, snapControlCenter(rawX, logicalWidth, droppedSize.width || 112, snapSize)))),
      y: roundLayoutPercent(!snapActive ? rawY : Math.max(halfHeight, Math.min(100 - halfHeight, snapControlCenter(rawY, logicalHeight, droppedSize.height || 122, snapSize)))),
    };
    if (value.startsWith("kind:")) {
      addInterfaceControl(value.slice(5), position, event.dataTransfer.getData("application/x-vst-control-style"), event.dataTransfer.getData("application/x-vst-control-variant"));
      return;
    }
    if (value.startsWith("control:")) {
      const controlId = value.slice(8);
      updateInterfaceControl(controlId, position);
      setSelectedInterfaceControlIds([controlId]);
    }
  };

  const showSampleSaveReminder = (acceptedCount, mappedFromDrop) => {
    toast.warning("Simpan project sebelum refresh", {
      id: "vst-maker-sample-save-reminder",
      position: "top-center",
      style: {
        border: "1px solid rgba(250, 204, 21, 0.9)",
        background: "linear-gradient(145deg, rgba(39, 35, 12, 0.98), rgba(14, 14, 16, 0.98))",
        boxShadow: "0 18px 55px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(250, 204, 21, 0.12)",
      },
      description: mappedFromDrop
        ? `${acceptedCount} zona mapping WAV masih tersimpan sementara di browser. Klik Simpan project agar mapping tidak hilang.`
        : `${acceptedCount} WAV dan mapping-nya masih tersimpan sementara di browser. Klik Simpan project agar audio dan mapping tidak hilang.`,
      duration: 12000,
      action: {
        label: "Lihat tombol Simpan",
        onClick: () => {
          const buttons = Array.from(document.querySelectorAll(".maker-designer-save-button"));
          const saveButton = buttons.find((button) => button.offsetParent !== null && !button.disabled) || buttons[0];
          saveButton?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          window.setTimeout(() => saveButton?.focus({ preventScroll: true }), 350);
        },
      },
    });
  };

  const addSampleFiles = (fileList, options = {}) => {
    const selected = Array.from(fileList || []);
    const validFiles = selected.filter((file) => /\.wav$/i.test(file.name) && file.size <= planSampleFileLimit);
    const mappingDrop = Number.isInteger(options.startPitch);
    const dropPlan = planSampleFileDrop(samples, validFiles, { allowExistingReferences: mappingDrop });
    const reattached = dropPlan.reattached;
    const added = dropPlan.added.map((sample) => ({ ...sample, id: makeId() }));
    const addedBySource = new Map(dropPlan.added.map((sample, index) => [sample, added[index]]));
    const resolvedSamples = dropPlan.resolvedSamples.map((sample) => addedBySource.get(sample) || sample);
    const reused = dropPlan.reused;
    const duplicates = dropPlan.duplicates;
    const acceptedCount = mappingDrop ? resolvedSamples.length : reattached.length + added.length;
    const rejected = selected.length - acceptedCount - duplicates;
    if (acceptedCount) {
      const reattachedById = new Map(reattached.map((sample) => [sample.id, sample]));
      const nextSamples = [...samples.map((sample) => reattachedById.get(sample.id) || sample), ...added];
      samplesRef.current = nextSamples;
      setSamples(nextSamples);
      setProject((current) => {
        let next;
        if (mappingDrop) {
          const droppedMappings = createOneKeyMappings(
            resolvedSamples,
            Math.max(0, Math.min(127, options.startPitch)),
            normalizeSamplerName(options.samplerName),
            { inferFilenamePitch: false },
          );
          next = { ...current, sampleMappings: [...current.sampleMappings, ...droppedMappings].slice(0, 128) };
          projectRef.current = next;
          return next;
        }
        // Auto-map a batch only when it is the first content in an empty
        // project. Adding more files later must preserve manual zones.
        if (!samples.length && added.length > 1 && !current.sampleMappings.length) {
          next = {
            ...current,
            sampleMappings: current.projectTemplate === "neonpopdrums"
              ? createNeonDrumMappings(nextSamples)
              : createOneKeyMappings(nextSamples, noteNameToMidi(current.rootNote)),
          };
          projectRef.current = next;
          return next;
        }
        const mappedSampleIds = new Set(current.sampleMappings.map((mapping) => mapping.sampleId));
        const unmappedSamples = [...reattached, ...added].filter((sample) => !mappedSampleIds.has(sample.id));
        const lastPitch = current.sampleMappings.length
          ? Math.max(...current.sampleMappings.map((mapping) => mapping.highPitch)) + 1
          : noteNameToMidi(current.rootNote);
        const missingZones = current.projectTemplate === "neonpopdrums"
          ? createNeonDrumMappings(unmappedSamples, normalizeSamplerName(current.samplerGroups?.[0]?.name))
          : createOneKeyMappings(unmappedSamples, Math.min(127, lastPitch));
        next = { ...current, sampleMappings: [...current.sampleMappings, ...missingZones] };
        projectRef.current = next;
        return next;
      });
      showSampleSaveReminder(acceptedCount, mappingDrop);
    }
    setSampleMessage(
      rejected
        ? `${acceptedCount ? `${acceptedCount} file disiapkan. ` : ""}${rejected} file dilewati. Hanya WAV yang diterima, maksimal 128 file hingga ${formatBytes(planSampleFileLimit)} per file.`
        : acceptedCount
          ? `${added.length} file ditambahkan, ${reattached.length} file project disambungkan, ${reused.length} referensi sample lama dipakai ulang, ${duplicates} duplikat diabaikan.${mappingDrop ? ` Dipetakan tepat mulai ${midiNoteName(options.startPitch)} tanpa menyimpan nama sample ganda.` : !samples.length && added.length > 1 ? " Auto-map awal: satu sample per tuts." : samples.length && added.length ? " Mapping lama dipertahankan; sample baru ditambahkan setelah zona terakhir." : added.length === 1 ? " Pilih Chromatic auto-map untuk membentangkan sample ke seluruh keyboard." : ""}`
          : duplicates
            ? `${duplicates} file duplikat diabaikan.`
          : "Pilih file WAV untuk menambahkan sumber suara.",
    );
  };

  const preprocessProjectImpulse = async (impulse, arrayBuffer) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Browser ini tidak mendukung decode WAV impulse response");
    const context = new AudioContextClass({ latencyHint: "interactive" });
    try {
      const processed = await decodeAndPreprocessImpulse(context, arrayBuffer, impulse);
      setCustomImpulseTaps((current) => ({
        ...current,
        [impulse.moduleId]: {
          tapDelays: processed.tapDelays,
          coefficients: processed.coefficients,
          signature: `${impulse.id}:${Date.now()}:${processed.processedLength}`,
        },
      }));
      return processed;
    } finally {
      await context.close().catch(() => {});
    }
  };

  const chooseCabinetImpulse = async (moduleId, file) => {
    if (!file) return;
    if (!/\.wav$/i.test(file.name) || file.size <= 12 || file.size > MAX_IMPULSE_RESPONSE_BYTES) {
      toast.error("Gunakan IR WAV valid maksimal 32 MB");
      return;
    }
    const existing = (projectRef.current.impulseResponses || []).find((item) => item.moduleId === moduleId);
    const impulse = {
      id: existing?.id || makeId(), moduleId, name: file.name, size: file.size,
      uploaded: false, assetId: null, sha256: null, uploadedAt: null,
      ...normalizeImpulseSettings(existing || {}),
    };
    try {
      const buffer = await file.arrayBuffer();
      await preprocessProjectImpulse(impulse, buffer);
      impulseFilesRef.current.set(impulse.id, file);
      impulseBuffersRef.current.set(impulse.id, buffer);
      setProject((current) => ({
        ...current,
        impulseResponses: [...(current.impulseResponses || []).filter((item) => item.moduleId !== moduleId), impulse],
      }));
      toast.success(`IR ${file.name} siap untuk preview dan akan diunggah saat project disimpan`);
    } catch (error) {
      toast.error(error.message || "Impulse response tidak dapat diproses");
    }
  };

  const updateCabinetImpulse = async (moduleId, changes) => {
    const currentImpulse = (projectRef.current.impulseResponses || []).find((item) => item.moduleId === moduleId);
    if (!currentImpulse) return;
    const impulse = { ...currentImpulse, ...changes };
    setProject((current) => ({
      ...current,
      impulseResponses: (current.impulseResponses || []).map((item) => item.id === impulse.id ? impulse : item),
    }));
    const buffer = impulseBuffersRef.current.get(impulse.id);
    if (buffer) {
      try { await preprocessProjectImpulse(impulse, buffer); }
      catch (error) { toast.error(error.message || "Pengaturan IR tidak dapat diterapkan"); }
    }
  };

  const removeCabinetImpulse = async (moduleId) => {
    const impulse = (projectRef.current.impulseResponses || []).find((item) => item.moduleId === moduleId);
    if (!impulse) return true;
    const savedId = projectRef.current.projectId;
    if (impulse.uploaded && savedId && !savedId.startsWith("draft-")) {
      try {
        await api.delete(`${apiBase}/projects/${encodeURIComponent(savedId)}/impulse-responses/${encodeURIComponent(impulse.id)}`);
      } catch (error) {
        toast.error(error.userMessage || "IR gagal dihapus dari penyimpanan");
        return false;
      }
    }
    impulseFilesRef.current.delete(impulse.id);
    impulseBuffersRef.current.delete(impulse.id);
    setCustomImpulseTaps((current) => {
      const next = { ...current }; delete next[moduleId]; return next;
    });
    setProject((current) => ({
      ...current,
      impulseResponses: (current.impulseResponses || []).filter((item) => item.id !== impulse.id),
    }));
    return true;
  };

  const uploadProjectImpulses = async (projectId, impulses) => {
    const uploadable = impulses.filter((impulse) => impulseFilesRef.current.has(impulse.id) && !impulse.uploaded);
    let nextImpulses = impulses;
    for (let index = 0; index < uploadable.length; index += 1) {
      const impulse = uploadable[index];
      const file = impulseFilesRef.current.get(impulse.id);
      const formData = new FormData(); formData.append("file", file, impulse.name);
      setSampleMessage(`Mengunggah IR ${index + 1}/${uploadable.length}: ${impulse.name}`);
      setImpulseUploadProgress((current) => ({ ...current, [impulse.id]: 0 }));
      try {
        const { data: asset } = await api.post(
          `${apiBase}/projects/${encodeURIComponent(projectId)}/impulse-responses/${encodeURIComponent(impulse.id)}`,
          formData,
          { timeout: 0, onUploadProgress: (event) => {
            if (!event.total) return;
            setImpulseUploadProgress((current) => ({ ...current, [impulse.id]: Math.min(100, Math.round((event.loaded / event.total) * 100)) }));
          } },
        );
        nextImpulses = nextImpulses.map((item) => item.id === impulse.id ? {
          ...item, uploaded: true, assetId: asset.id, sha256: asset.sha256, uploadedAt: asset.uploaded_at,
          previewUrl: `${apiBase}/projects/${encodeURIComponent(projectId)}/impulse-responses/${encodeURIComponent(impulse.id)}/preview`,
        } : item);
        setProject((current) => ({ ...current, impulseResponses: nextImpulses }));
      } finally {
        setImpulseUploadProgress((current) => { const next = { ...current }; delete next[impulse.id]; return next; });
      }
    }
    return nextImpulses;
  };

  const uploadProjectSamples = async (projectId, projectSamples) => {
    const uploadable = projectSamples.filter((sample) => sample.file && !sample.uploaded);
    if (!uploadable.length) return projectSamples;
    let nextSamples = projectSamples;
    for (let index = 0; index < uploadable.length; index += 1) {
      const sample = uploadable[index];
      const formData = new FormData();
      formData.append("file", sample.file, sample.name);
      setSampleMessage(`Mengunggah ${index + 1}/${uploadable.length}: ${sample.name}`);
      setSampleUploadProgress((current) => ({ ...current, [sample.id]: 0 }));
      try {
        const { data: asset } = await api.post(
          `${apiBase}/projects/${encodeURIComponent(projectId)}/samples/${encodeURIComponent(sample.id)}`,
          formData,
          {
            timeout: 0,
            onUploadProgress: (event) => {
              if (!event.total) return;
              const progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
              setSampleUploadProgress((current) => ({ ...current, [sample.id]: progress }));
            },
          },
        );
        nextSamples = nextSamples.map((item) => item.id === sample.id ? {
          ...item,
          uploaded: true,
          assetId: asset.id,
          sha256: asset.sha256,
          uploadedAt: asset.uploaded_at,
          previewUrl: `${apiBase}/projects/${encodeURIComponent(projectId)}/samples/${encodeURIComponent(sample.id)}/preview`,
        } : item);
        samplesRef.current = nextSamples;
        setSamples(nextSamples);
      } catch (error) {
        const message = error.userMessage || `Upload ${sample.name} gagal`;
        setSampleMessage(message);
        throw error;
      } finally {
        setSampleUploadProgress((current) => {
          const next = { ...current };
          delete next[sample.id];
          return next;
        });
      }
    }
    setSampleMessage(`${uploadable.length} sample tersimpan aman dan siap untuk build.`);
    return nextSamples;
  };

  const saveProject = async () => {
    const currentProject = projectRef.current;
    const currentSamples = samplesRef.current;
    if (!currentProject.name.trim()) {
      toast.error("Isi nama instrumen sebelum menyimpan project");
      return null;
    }
    if (!currentProject.manufacturerName.trim() || !/^\d+\.\d+\.\d+$/.test(currentProject.pluginVersion)) {
      setActiveEditorTab("sampler");
      toast.error("Isi nama developer dan versi plugin dengan format MAJOR.MINOR.PATCH");
      return null;
    }
    const labeledControls = controlsWithDefaultLabels(currentProject.interfaceControls);
    const labelsWereFilled = labeledControls.some((control, index) => control.label !== currentProject.interfaceControls[index]?.label);
    const projectToSave = labelsWereFilled ? { ...currentProject, interfaceControls: labeledControls } : currentProject;
    const currentSampleIds = new Set(currentSamples.map((sample) => sample.id));
    const currentMappingsValid = projectToSave.sampleMappings.length > 0 && projectToSave.sampleMappings.every((mapping) => (
      currentSampleIds.has(mapping.sampleId)
      && mapping.lowPitch <= mapping.rootPitch
      && mapping.rootPitch <= mapping.highPitch
      && mapping.velocityLow <= mapping.velocityHigh
      && (mapping.playbackMode !== "tempo_sync" || (mapping.sourceBpmConfirmed === true && Number(mapping.sourceBpm) >= 20 && Number(mapping.sourceBpm) <= 300))
      && (mapping.sampleStart ?? 0) < (mapping.sampleEnd ?? 1)
      && (!mapping.loopEnabled || (
        (mapping.sampleStart ?? 0) <= (mapping.loopStart ?? 0)
        && (mapping.loopStart ?? 0) < (mapping.loopEnd ?? 1)
        && (mapping.loopEnd ?? 1) <= (mapping.sampleEnd ?? 1)
      ))
      && !!mapping.groupName?.trim()
      && !!mapping.articulation?.trim()
      && !!mapping.micPosition?.trim()
    ));
    if (projectToSave.sampleMappings.length && !currentMappingsValid) {
      setActiveEditorTab("sampler");
      toast.error("Periksa sample, key range, velocity, trim, dan label pada zona mapping");
      return null;
    }
    if (projectToSave.interfaceControls.length && !projectToSave.interfaceControls.every((control) => (
      !!String(control.parameter || "").trim() && (!control.moduleId || moduleIds.has(control.moduleId))
    ))) {
      setActiveEditorTab("interface");
      toast.error("Periksa label dan binding parameter pada kontrol panel");
      return null;
    }
    if (labelsWereFilled) {
      projectRef.current = projectToSave;
      setProject(projectToSave);
    }
    setSavingProject(true);
    const payload = toProjectPayload(projectToSave, currentSamples);
    try {
      let response;
      const isSavedProject = projectToSave.projectId && !projectToSave.projectId.startsWith("draft-");
      if (isSavedProject) {
        try {
          response = await api.put(`${apiBase}/projects/${encodeURIComponent(projectToSave.projectId)}`, payload);
        } catch (error) {
          if (error.response?.status !== 404) throw error;
          response = await api.post(`${apiBase}/projects`, payload);
        }
      } else {
        response = await api.post(`${apiBase}/projects`, payload);
      }

      const saved = response.data;
      const restoredProject = fromSavedProject(saved);
      const persistedSamples = savedProjectSamples(saved).map((savedSample) => ({
        ...savedSample,
        ...(() => {
          const local = currentSamples.find((sample) => sample.id === savedSample.id);
          return {
            file: local?.file || null,
            uploaded: !!local?.uploaded,
            assetId: local?.assetId || null,
            sha256: local?.sha256 || null,
            uploadedAt: local?.uploadedAt || null,
            previewUrl: local?.uploaded
              ? `${apiBase}/projects/${encodeURIComponent(saved.id)}/samples/${encodeURIComponent(savedSample.id)}/preview`
              : null,
          };
        })(),
      }));
      samplesRef.current = persistedSamples;
      setSamples(persistedSamples);
      const persistedImpulses = savedProjectImpulses(saved).map((savedImpulse) => {
        const local = (projectToSave.impulseResponses || []).find((impulse) => impulse.id === savedImpulse.id);
        return {
          ...savedImpulse,
          uploaded: !!local?.uploaded,
          assetId: local?.assetId || null,
          sha256: local?.sha256 || null,
          uploadedAt: local?.uploadedAt || null,
          previewUrl: local?.uploaded
            ? `${apiBase}/projects/${encodeURIComponent(saved.id)}/impulse-responses/${encodeURIComponent(savedImpulse.id)}/preview`
            : null,
        };
      });
      const persistedProject = { ...restoredProject, impulseResponses: persistedImpulses };
      projectRef.current = persistedProject;
      setProject(persistedProject);
      setSavedProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      const uploadedSamples = await uploadProjectSamples(saved.id, persistedSamples);
      samplesRef.current = uploadedSamples;
      await uploadProjectImpulses(saved.id, persistedImpulses);
      toast.success(`Project, sample, dan IR tersimpan${customerMode ? ` · paket ${entitlement?.tier || "aktif"}` : " di server admin"}`);
      return saved;
    } catch (error) {
      toast.error(error.userMessage || "Project instrumen gagal disimpan");
      return null;
    } finally {
      setSavingProject(false);
    }
  };

  const saveProjectToTemplate = async () => {
    if (customerMode) return;
    setSavingTemplate(true);
    try {
      const saved = await saveProject();
      if (!saved?.id) return;
      let response;
      if (appliedTemplateId) {
        response = await api.put(
          `/admin/vst-maker/templates/${encodeURIComponent(appliedTemplateId)}/projects/${encodeURIComponent(saved.id)}`,
        );
      } else {
        response = await api.post(`/admin/vst-maker/projects/${encodeURIComponent(saved.id)}/template`);
      }
      const { data } = response;
      const normalizedTemplate = normalizePublishedTemplate(data);
      const currentThumbnail = allProjectTemplates.find((item) => item.id === normalizedTemplate.id);
      const template = currentThumbnail?.customThumbnail ? {
        ...normalizedTemplate,
        thumbnailUrl: currentThumbnail.thumbnailUrl,
        customThumbnail: true,
      } : normalizedTemplate;
      setPublishedTemplates((current) => [template, ...current.filter((item) => item.id !== template.id)]);
      setAppliedTemplateId(template.id);
      setProjectTemplateCategory(template.templateCategory || "all");
      setActiveEditorTab("templates");
      toast.success(appliedTemplateId
        ? `Template “${template.name}” berhasil diperbarui`
        : `“${template.name}” disimpan dan ditambahkan ke galeri template`);
    } catch (error) {
      toast.error(error.userMessage || "Project gagal disimpan sebagai template");
    } finally {
      setSavingTemplate(false);
    }
  };

  const deletePublishedTemplate = async (template) => {
    if (customerMode || !template || deletingTemplateId) return;
    const builtIn = template.builtInTemplate === true;
    const confirmed = window.confirm(
      `${builtIn ? "Sembunyikan template bawaan" : "Hapus template admin"} “${template.name}” dari galeri?${builtIn
        ? " Template ini dapat dipulihkan kembali."
        : " Project sumber dan file project tidak akan dihapus."}`,
    );
    if (!confirmed) return;
    setDeletingTemplateId(template.id);
    try {
      await api.delete(`/admin/vst-maker/templates/${encodeURIComponent(template.id)}`, { params: { confirm_name: template.name, confirm_scope: builtIn ? "built_in" : "admin" } });
      if (builtIn) {
        setTemplateSettings((current) => ({ ...current, [template.id]: { ...current[template.id], template_id: template.id, hidden: true } }));
      } else {
        setPublishedTemplates((current) => current.filter((item) => item.id !== template.id));
      }
      if (appliedTemplateId === template.id) setAppliedTemplateId(null);
      toast.success(`Template “${template.name}” dihapus dari galeri`);
    } catch (error) {
      toast.error(error.userMessage || "Template gagal dihapus");
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const uploadPublishedTemplateThumbnail = async (template, file) => {
    if (customerMode || !template || !file || uploadingTemplateThumbnailId) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("Thumbnail harus berupa JPG, PNG, atau WebP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Ukuran thumbnail maksimal 10 MB");
      return;
    }
    const payload = new FormData();
    payload.append("file", file);
    setUploadingTemplateThumbnailId(template.id);
    try {
      const { data } = await api.post(`/admin/vst-maker/templates/${encodeURIComponent(template.id)}/thumbnail`, payload, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 });
      if (template.builtInTemplate) {
        setTemplateSettings((current) => ({ ...current, [template.id]: { ...current[template.id], ...data } }));
      } else {
        const updated = normalizePublishedTemplate(data);
        setPublishedTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
      toast.success(`Thumbnail “${template.name}” berhasil diganti`);
    } catch (error) {
      toast.error(error.userMessage || "Thumbnail template gagal diunggah");
    } finally {
      setUploadingTemplateThumbnailId(null);
    }
  };

  const restoreBuiltInTemplate = async (template) => {
    try {
      const { data } = await api.post(`/admin/vst-maker/templates/${encodeURIComponent(template.id)}/restore`);
      setTemplateSettings((current) => ({ ...current, [template.id]: { ...current[template.id], ...data } }));
      toast.success(`Template “${template.name}” dipulihkan`);
    } catch (error) {
      toast.error(error.userMessage || "Template gagal dipulihkan");
    }
  };

  const movePublishedTemplate = async (template, direction) => {
    if (customerMode || reorderingTemplateId) return;
    const visible = projectTemplatesForCategory(projectTemplateCategory, allProjectTemplates);
    const visibleIndex = visible.findIndex((item) => item.id === template.id);
    const neighbor = visible[visibleIndex + direction];
    if (!neighbor) return;
    const orderedIds = allProjectTemplates.map((item) => item.id);
    const sourceIndex = orderedIds.indexOf(template.id);
    const targetIndex = orderedIds.indexOf(neighbor.id);
    [orderedIds[sourceIndex], orderedIds[targetIndex]] = [orderedIds[targetIndex], orderedIds[sourceIndex]];
    setReorderingTemplateId(template.id);
    try {
      const { data } = await api.put("/admin/vst-maker/template-order", { template_ids: orderedIds });
      setTemplateSettings((current) => ({
        ...current,
        ...Object.fromEntries(data.template_ids.map((templateId, index) => [templateId, { ...current[templateId], template_id: templateId, sort_order: index }])),
      }));
    } catch (error) {
      toast.error(error.userMessage || "Urutan template gagal disimpan");
    } finally {
      setReorderingTemplateId(null);
    }
  };

  const updatePricingDraft = (section, key, value, nestedKey = null) => {
    const credits = Math.max(0, Math.min(100000, Math.round(Number(value) || 0)));
    setPricingDraft((current) => nestedKey === null
      ? { ...current, [section]: { ...(current[section] || {}), [key]: credits } }
      : {
        ...current,
        [section]: {
          ...(current[section] || {}),
          [key]: { ...(current[section]?.[key] || {}), [nestedKey]: credits },
        },
      });
  };

  const savePricingSettings = async () => {
    if (customerMode || savingPricing) return;
    setSavingPricing(true);
    try {
      const payload = {
        credit_value_idr: Number(pricingDraft.credit_value_idr),
        base_build_credits: Number(pricingDraft.base_build_credits),
        included_instrument_samples: Number(pricingDraft.included_instrument_samples),
        extra_sample_credits: Number(pricingDraft.extra_sample_credits),
        included_effect_dsp: Number(pricingDraft.included_effect_dsp),
        custom_background_credits: Number(pricingDraft.custom_background_credits),
        component_prices: pricingDraft.component_prices,
        dsp_prices: pricingDraft.dsp_prices,
        instrument_effect_prices: pricingDraft.instrument_effect_prices,
        template_credits: pricingDraft.template_credits,
        license_activation_credits: pricingDraft.license_activation_credits,
        distribution_license_credits: pricingDraft.distribution_license_credits,
        distribution_pack_discounts: pricingDraft.distribution_pack_discounts,
      };
      const { data } = await api.put("/admin/vst-maker/pricing", payload);
      const normalized = normalizeVstPricing(data);
      setPricing(normalized);
      setPricingDraft(normalized);
      toast.success("Harga kredit VST Maker diperbarui");
    } catch (error) {
      toast.error(error.userMessage || "Harga kredit gagal disimpan");
    } finally {
      setSavingPricing(false);
    }
  };

  const saveBuildSettings = async () => {
    if (customerMode || savingBuildSettings) return;
    setSavingBuildSettings(true);
    try {
      const payload = {
        customer_license_enabled: buildSettingsDraft.customer_license_enabled !== false,
        show_no_serial_option: buildSettingsDraft.show_no_serial_option !== false,
        license_max_activations: Math.max(1, Math.min(3, Number(buildSettingsDraft.license_max_activations) || 2)),
      };
      const { data } = await api.put("/admin/vst-maker/build-settings", payload);
      setBuildSettings(data);
      setBuildSettingsDraft(data);
      toast.success("Pengaturan lisensi build diperbarui");
    } catch (error) {
      toast.error(error.userMessage || "Pengaturan lisensi build gagal disimpan");
    } finally {
      setSavingBuildSettings(false);
    }
  };

  const grantFreeCredits = async () => {
    const normalizedEmail = grantEmail.trim().toLowerCase();
    const credits = Math.max(1, Math.round(Number(grantCredits) || 0));
    if (!normalizedEmail || grantBusy) return;
    setGrantBusy("credits");
    try {
      const { data } = await api.post("/admin/vst-maker/credit-grants", { email: normalizedEmail, credits, note: grantNote.trim() });
      setGrantEmail("");
      setGrantNote("");
      toast.success(`${credits.toLocaleString("id-ID")} kredit diberikan ke ${data.customer_email} · saldo ${Number(data.balance).toLocaleString("id-ID")}`);
    } catch (error) {
      toast.error(error.userMessage || "Kredit gratis gagal diberikan");
    } finally {
      setGrantBusy("");
    }
  };

  const templateStartingCredits = (template) => {
    const galleryBuildSettings = { ...buildSettings, customer_license_enabled: false };
    if (template.publishedByAdmin && template.project) {
      const templateProject = { ...template.project, pricing_template_id: template.id };
      const templateSamples = template.project.samples || [];
      return quoteVstProjectCredits({
        ...templateProject,
        samples: templateSamples,
        pricing_template_baseline: createVstTemplatePricingBaseline(templateProject, templateSamples),
      }, pricing, galleryBuildSettings).totalCredits;
    }
    const ampState = template.id === "ampsimulator"
      ? createAmpSimulatorTemplateState(() => makeId())
      : template.id === "obsidianhighgain"
        ? createHighGainAmpTemplateState(() => makeId())
        : null;
    const fallbackEffects = ["drumpad", "performancegrid"].includes(template.id)
      ? { reverb: true, delay: false, chorus: false, saturation: true }
      : template.id === "synth"
        ? { reverb: true, delay: true, chorus: true, saturation: false }
        : template.id === "sampler"
          ? { reverb: false, delay: false, chorus: false, saturation: false }
          : { reverb: true, delay: false, chorus: false, saturation: false };
    const templateProject = {
      pluginKind: template.pluginKind || "instrument",
      projectTemplate: template.id,
      pricingTemplateId: template.id,
      interfaceControls: ampState?.interfaceControls || createTemplateControls(template.id, template.keyboardKeys || 49),
      engineModules: ampState?.engineModules || [],
      effects: template.effects || fallbackEffects,
      samples: [],
    };
    return quoteVstProjectCredits({
      ...templateProject,
      pricingTemplateBaseline: createVstTemplatePricingBaseline(templateProject, []),
    }, pricing, galleryBuildSettings).totalCredits;
  };

  const enqueuePlatformBuild = async (targetPlatform, distributionChoice = null, forceCorrectionRebuild = false) => {
    if (readinessCount !== readinessItems.length) {
      toast.error("Lengkapi seluruh pemeriksaan kesiapan sebelum mengantrekan build");
      return;
    }
    setBuildPanelExpanded(true);
    setQueueingBuild(true);
    try {
      const saved = await saveProject();
      if (!saved?.id) return;
      const { data: job } = await api.post(`${apiBase}/projects/${encodeURIComponent(saved.id)}/builds`, {
        force_correction_rebuild: forceCorrectionRebuild,
        target_platform: targetPlatform,
      });
      setBuildJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      if (customerMode && Number.isFinite(Number(job.credit_balance_after_charge))) setCreditBalance(Number(job.credit_balance_after_charge));
      if (customerMode && distributionChoice?.enabled) {
        try {
          const { data: purchase } = await api.post("/customer/license-distributions/purchase", {
            build_job_id: job.id,
            quantity: distributionChoice.quantity,
            max_activations: distributionChoice.maxActivations,
          });
          if (Number.isFinite(Number(purchase.balance))) setCreditBalance(Number(purchase.balance));
          if (purchase.api_key) {
            navigator.clipboard?.writeText(purchase.api_key).catch(() => {});
            toast.success(`${purchase.quantity} lisensi distribusi dibeli. API key baru disalin; pengelolaan tersedia di Dashboard.`);
          } else {
            toast.success(`${purchase.quantity} lisensi distribusi ditambahkan. Kelola serial di Dashboard.`);
          }
        } catch (distributionError) {
          toast.error(`Build sudah masuk antrean, tetapi paket distribusi gagal dibeli: ${distributionError.userMessage || "coba kembali melalui Dashboard"}`);
          return;
        }
      }
      const platformLabel = targetPlatform === "macos" ? "macOS" : "Windows";
      toast.success(job.duplicate ? `Eksport ${platformLabel} identik sudah tersedia atau berada di antrean` : `Eksport VST ${platformLabel} masuk antrean`);
    } catch (error) {
      const issues = error.response?.data?.detail?.issues;
      toast.error(Array.isArray(issues) ? issues.join(" · ") : error.userMessage || "Build gagal dimasukkan ke antrean");
    } finally {
      setQueueingBuild(false);
    }
  };

  const requestPlatformBuild = async (targetPlatform, forceCorrectionRebuild = false) => {
    if (readinessCount !== readinessItems.length) {
      toast.error("Lengkapi seluruh pemeriksaan kesiapan sebelum mengantrekan build");
      return;
    }
    if (customerMode) {
      const saved = await saveProject();
      if (!saved?.id) return;
      try {
        const { data } = await api.get(`${apiBase}/projects/${encodeURIComponent(saved.id)}/build-quote`, {
          params: { force_correction_rebuild: forceCorrectionRebuild, target_platform: targetPlatform },
        });
        setAuthoritativeBuildQuote({
          ...buildCreditQuote,
          totalCredits: Number(data.total_credits),
          standardTotalCredits: Number(data.standard_total_credits ?? data.total_credits),
          licenseMaxActivations: Number(data.license_max_activations || 0),
          licenseCredits: Number(data.license_credits || 0),
          correctionRebuild: data.correction_rebuild || null,
        });
        if (Number.isFinite(Number(data.balance))) setCreditBalance(Number(data.balance));
        setBuildRequestMode(forceCorrectionRebuild ? "correction" : "export");
        setBuildTargetPlatform(targetPlatform);
        setBuildLicenseDialogOpen(true);
      } catch (error) {
        toast.error(error.userMessage || "Perhitungan biaya build gagal dimuat");
      }
      return;
    }
    enqueuePlatformBuild(targetPlatform, null, forceCorrectionRebuild);
  };

  const updateBuildJob = async (job, action) => {
    try {
      const { data } = await api.post(`${apiBase}/builds/${encodeURIComponent(job.id)}/${action}`);
      setBuildJobs((current) => current.map((item) => item.id === data.id ? data : item));
      if (customerMode) {
        const nextBalance = action === "cancel" ? data.credit_balance_after_refund : data.credit_balance_after_charge;
        if (Number.isFinite(Number(nextBalance))) setCreditBalance(Number(nextBalance));
      }
      toast.success(action === "cancel" ? "Build dibatalkan" : "Build dimasukkan kembali ke antrean");
    } catch (error) {
      toast.error(error.userMessage || "Status build gagal diperbarui");
    }
  };

  const downloadBuildArtifact = async (job) => {
    try {
      const { data } = await api.get(`${apiBase}/builds/${encodeURIComponent(job.id)}/download`);
      if (!data?.download_url) throw new Error("Missing artifact URL");
      window.location.assign(data.download_url);
    } catch (error) {
      toast.error(error.userMessage || "Artifact build gagal diunduh");
    }
  };

  const openSavedProject = async (saved) => {
    setDraftListOpen(false);
    setAppliedTemplateId(null);
    clearSamplerPreview();
    const restoredProject = fromSavedProject(saved);
    clearDesignerHistory();
    projectRef.current = restoredProject;
    setProject(restoredProject);
    setCustomImpulseTaps({});
    impulseFilesRef.current.clear();
    impulseBuffersRef.current.clear();
    if (restoredProject.pluginKind === "effect") setActiveEditorTab("interface");
    setSamples(savedProjectSamples(saved));
    setSelectedInterfaceControlIds([]);
    setSampleMessage("Memeriksa penyimpanan sample…");
    try {
      const [assetsResponse, impulseAssetsResponse, buildsResponse] = await Promise.all([
        api.get(`${apiBase}/projects/${encodeURIComponent(saved.id)}/samples`),
        api.get(`${apiBase}/projects/${encodeURIComponent(saved.id)}/impulse-responses`),
        api.get(`${apiBase}/projects/${encodeURIComponent(saved.id)}/builds`),
      ]);
      const assets = (Array.isArray(assetsResponse.data) ? assetsResponse.data : []).map((asset) => ({
        ...asset,
        preview_url: `${apiBase}/projects/${encodeURIComponent(saved.id)}/samples/${encodeURIComponent(asset.sample_id)}/preview`,
      }));
      setBuildJobs(Array.isArray(buildsResponse.data) ? buildsResponse.data : []);
      setSamples(savedProjectSamples(saved, assets));
      const impulseAssets = (Array.isArray(impulseAssetsResponse.data) ? impulseAssetsResponse.data : []).map((asset) => ({
        ...asset,
        preview_url: `${apiBase}/projects/${encodeURIComponent(saved.id)}/impulse-responses/${encodeURIComponent(asset.impulse_id)}/preview`,
      }));
      const impulses = savedProjectImpulses(saved, impulseAssets);
      setProject((current) => ({ ...current, impulseResponses: impulses }));
      await Promise.all(impulses.filter((impulse) => impulse.previewUrl).map(async (impulse) => {
        try {
          const response = await api.get(impulse.previewUrl, { responseType: "arraybuffer" });
          impulseBuffersRef.current.set(impulse.id, response.data);
          await preprocessProjectImpulse(impulse, response.data);
        } catch {
          // A missing/undecodable IR falls back to the procedural cabinet.
        }
      }));
      setSampleMessage(assets.length
        ? `${assets.length}/${saved.samples?.length || 0} sample tersimpan privat dan siap dimuat saat dimainkan.`
        : "Belum ada audio tersimpan. Pilih ulang file lalu simpan project untuk mengunggahnya.");
    } catch (error) {
      setSampleMessage(error.userMessage || "Status penyimpanan sample gagal dimuat.");
    }
  };

  const deleteSavedProject = async (saved) => {
    if (!window.confirm(`Hapus project “${saved.name}” beserta sample dan hasil build-nya dari penyimpanan ${customerMode ? "akun Anda" : "admin"}?`)) return;
    const clearDeletedProject = () => {
      setSavedProjects((current) => current.filter((item) => item.id !== saved.id));
      if (projectRef.current.projectId === saved.id) {
        clearSamplerPreview();
        try {
          window.localStorage.removeItem(DRAFT_STORAGE_KEY);
          window.localStorage.removeItem(SAMPLE_STORAGE_KEY);
        } catch {
          // React state remains the source of truth when storage is unavailable.
        }
        const freshProject = createDraft();
        clearDesignerHistory();
        projectRef.current = freshProject;
        setProject(freshProject);
        setSamples([]);
        setCustomImpulseTaps({});
        impulseFilesRef.current.clear();
        impulseBuffersRef.current.clear();
        setSampleMessage("");
        setBuildJobs([]);
      }
    };
    try {
      await api.delete(`${apiBase}/projects/${encodeURIComponent(saved.id)}`);
      clearDeletedProject();
      toast.success("Project dihapus");
    } catch (error) {
      // The project row can already be gone even when a later sample/build
      // cleanup step makes DELETE return an error. Reconcile with the server
      // so a deleted project never remains as a stale card in this list.
      try {
        const projects = await fetchSavedProjects(apiBase);
        setSavedProjects(projects);
        if (!projects.some((item) => item.id === saved.id)) {
          clearDeletedProject();
          toast.success("Project dihapus");
          return;
        }
      } catch {
        // Keep the original DELETE error when the reconciliation also fails.
      }
      toast.error(error.userMessage || "Project gagal dihapus");
    }
  };

  const resetDraft = async (pluginKind) => {
    clearSamplerPreview();
    setAppliedTemplateId(null);
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      window.localStorage.removeItem(SAMPLE_STORAGE_KEY);
    } catch {
      // Draft baru tetap dapat dibuat ketika penyimpanan browser tidak tersedia.
    }
    setBuildJobs([]);
    setBuildPanelExpanded(false);
    setNewProjectDialogOpen(false);
    const basicTemplateId = pluginKind === "effect" ? "basicfx" : "basicvst";
    const applied = await applyProjectTemplate(basicTemplateId, { includeHidden: true, showToast: false });
    if (applied) {
      toast.success(`${pluginKind === "effect" ? "Plugin Basic" : "VST Basic"} siap. Project lama tetap tersimpan di server.`);
      return;
    }
    const freshProject = createDraft(pluginKind);
    clearDesignerHistory();
    projectRef.current = freshProject;
    setProject(freshProject);
    setSamples([]);
    setCustomImpulseTaps({});
    impulseFilesRef.current.clear();
    impulseBuffersRef.current.clear();
    setSampleMessage("");
    setSelectedInterfaceControlIds([]);
    setActiveEditorTab("interface");
    toast.success(`${pluginKind === "effect" ? "Plugin Basic" : "VST Basic"} siap. Project lama tetap tersimpan di server.`);
  };

  const startNewTemplateDraft = (pluginKind) => {
    clearSamplerPreview();
    setAppliedTemplateId(null);
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      window.localStorage.removeItem(SAMPLE_STORAGE_KEY);
    } catch {
      // Draft template tetap dapat dibuat ketika penyimpanan browser tidak tersedia.
    }
    const freshProject = createDraft(pluginKind);
    clearDesignerHistory();
    projectRef.current = freshProject;
    setProject(freshProject);
    setSamples([]);
    setCustomImpulseTaps({});
    impulseFilesRef.current.clear();
    impulseBuffersRef.current.clear();
    setSampleMessage("");
    setBuildJobs([]);
    setBuildPanelExpanded(false);
    setSelectedInterfaceControlIds([]);
    setProjectTemplateCategory(pluginKind === "effect" ? "plugin" : "vst");
    setNewTemplateDialogOpen(false);
    setNewProjectDialogOpen(false);
    setActiveEditorTab("interface");
    toast.success(`Draft ${pluginKind === "effect" ? "Plugin Basic" : "VST Basic"} untuk template baru siap. Save to template akan membuat template baru.`);
  };

  const toggleEffect = (effectId) => {
    setProject((current) => ({
      ...current,
      effects: { ...current.effects, [effectId]: !current.effects[effectId] },
    }));
  };

  const addEngineModule = (type) => {
    const moduleId = makeId();
    updateDesignerProject((current) => ({
      ...current,
      engineModules: ["wave_generator", "tuning"].includes(type) && current.engineModules.some((module) => module.type === type)
        ? current.engineModules
        : appendDspRackModule(current.engineModules, type, moduleId),
    }));
    if (type !== "wave_generator") {
      setExpandedDspModuleId(moduleId);
      setDspModuleLibraryOpen(false);
    }
  };

  const installStandardDspRack = () => {
    updateDesignerProject((current) => ({
      ...current,
      engineModules: normalizeDspRack([
        ...current.engineModules.filter((module) => ["wave_generator", "tuning"].includes(module.type)),
        ...STANDARD_DSP_MODULE_TYPES.reduce(
        (modules, type) => appendDspRackModule(modules, type, makeId()),
        [],
        ),
      ]),
      impulseResponses: [],
    }));
    setCustomImpulseTaps({});
    impulseFilesRef.current.clear();
    impulseBuffersRef.current.clear();
    toast.success("Rack DSP standar dipasang");
  };

  const installAmpSimulatorRack = () => {
    updateDesignerProject((current) => ({
      ...current,
      engineModules: normalizeDspRack([
        ...current.engineModules.filter((module) => ["wave_generator", "tuning"].includes(module.type)),
        ...createAmpSimulatorRack(() => makeId()),
      ]),
      impulseResponses: [],
    }));
    setCustomImpulseTaps({});
    impulseFilesRef.current.clear();
    impulseBuffersRef.current.clear();
    toast.success("Chain amp simulator orisinal dipasang");
  };

  const updateEngineModule = (moduleId, updates, mergeKey = null) => {
    updateDesignerProject((current) => {
      const engineModules = normalizeDspRack(current.engineModules.map((module) => (
        module.id === moduleId ? { ...module, ...updates } : module
      )));
      let interfaceControls = current.interfaceControls;
      if (updates.mix !== undefined) interfaceControls = syncControlsFromDspBinding(interfaceControls, moduleId, "module_mix", updates.mix, engineModules);
      if (updates.bypassed !== undefined) interfaceControls = syncControlsFromDspBinding(interfaceControls, moduleId, "bypass", updates.bypassed ? 1 : 0, engineModules);
      return { ...current, engineModules, interfaceControls };
    }, mergeKey);
  };

  const updateEngineModuleParameter = (moduleId, parameter, value) => {
    updateDesignerProject((current) => {
      const normalizedValue = Math.max(0, Math.min(1, Number(value) || 0));
      return {
        ...current,
        engineModules: normalizeDspRack(current.engineModules.map((module) => (
          module.id === moduleId
            ? { ...module, parameters: { ...module.parameters, [parameter]: normalizedValue } }
            : module
        ))),
        interfaceControls: syncControlsFromDspBinding(current.interfaceControls, moduleId, parameter, normalizedValue, current.engineModules),
      };
    }, `dsp:${moduleId}:${parameter}`);
  };

  const moveEngineModule = (moduleId, direction) => {
    updateDesignerProject((current) => ({
      ...current,
      engineModules: moveDspRackModule(current.engineModules, moduleId, direction),
    }));
  };

  const deleteEngineModule = async (moduleId) => {
    if (!(await removeCabinetImpulse(moduleId))) return;
    updateDesignerProject((current) => {
      const result = removeDspRackModule(current.engineModules, current.interfaceControls, moduleId);
      return {
        ...current,
        engineModules: result.modules,
        interfaceControls: result.controls,
        impulseResponses: (current.impulseResponses || []).filter((item) => item.moduleId !== moduleId),
        presets: (current.presets || []).map((preset) => ({
          ...preset,
          module_values: Object.fromEntries(Object.entries(preset.module_values || {}).filter(([presetModuleId]) => presetModuleId !== moduleId)),
        })),
      };
    });
    setExpandedDspModuleId((current) => current === moduleId ? null : current);
  };

  const toggleControl = (controlId) => {
    setProject((current) => ({
      ...current,
      controls: current.controls.includes(controlId)
        ? current.controls.filter((id) => id !== controlId)
        : [...current.controls, controlId],
    }));
  };

  const renderProjectActions = () => (
    <div className="maker-designer-project-actions">
      <div className="maker-midi-compact" title={`${midiStatus}${midiInputs.length ? ` · ${samplerAudioStatus}` : ""}`}>
        {midiInputs.length > 0 && (
          <select
            value={selectedMidiInputId}
            onChange={(event) => setSelectedMidiInputId(event.target.value)}
            className="maker-midi-compact__select"
            aria-label="Pilih MIDI controller"
          >
            <option value="" disabled>Pilih MIDI</option>
            {midiInputs.map((input) => <option key={input.id} value={input.id}>{input.name}</option>)}
          </select>
        )}
        <button
          type="button"
          onClick={connectMidi}
          disabled={typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function"}
          className="maker-midi-compact__button"
          aria-label={midiInputs.length ? "Refresh koneksi MIDI" : "Hubungkan MIDI controller"}
        >
          <span className={`maker-midi-compact__dot ${midiPressedPitches.size ? "is-playing" : midiInputs.length ? "is-connected" : ""}`} />
          <span>{midiInputs.length ? "MIDI aktif" : "Hubungkan MIDI"}</span>
        </button>
      </div>
      <div ref={savedProjectsMenuRef} className="maker-saved-projects-menu">
        <button
          type="button"
          onClick={() => {
            setDraftListOpen((open) => !open);
            setNewProjectDialogOpen(false);
          }}
          aria-expanded={draftListOpen}
          aria-haspopup="dialog"
          className="maker-saved-projects-trigger"
        >
          <span>Project tersimpan</span>
          <span className="maker-saved-projects-trigger__count">{savedProjects.length}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${draftListOpen ? "rotate-180" : ""}`} />
        </button>
        {draftListOpen && (
          <section role="dialog" aria-label="Project tersimpan" className="maker-saved-projects-popover">
            <div className="maker-saved-projects-popover__heading">
              <span>Project tersimpan</span>
              <span>{savedProjects.length} project</span>
            </div>
            {loadingProjects ? (
              <div className="maker-saved-projects-empty"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat project…</div>
            ) : savedProjects.length ? (
              <div className="maker-saved-projects-list">
                {savedProjects.map((saved) => (
                  <div key={saved.id} className={`maker-saved-project-item ${project.projectId === saved.id ? "is-active" : ""}`}>
                    <button type="button" onClick={() => openSavedProject(saved)} className="maker-saved-project-item__open">
                      <span className="truncate text-xs font-semibold text-zinc-200">{saved.name}</span>
                      <span className="mt-0.5 truncate text-[9px] text-zinc-600">{saved.instrument_type} · {saved.plugin_kind === "effect" ? "Plugin FX" : "VST Instrument"}</span>
                    </button>
                    {project.projectId === saved.id && <span className="maker-saved-project-item__active">Aktif</span>}
                    <button type="button" onClick={() => deleteSavedProject(saved)} className="maker-saved-project-item__delete" aria-label={`Hapus project ${saved.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="maker-saved-projects-empty">Belum ada project tersimpan.</div>
            )}
          </section>
        )}
      </div>
      <button type="button" onClick={saveProject} disabled={savingProject} className="maker-designer-save-button">
        {savingProject ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {savingProject ? "Menyimpan" : isPersistedProject ? "Simpan perubahan" : "Simpan project"}
      </button>
      {!customerMode && (
        <button type="button" onClick={saveProjectToTemplate} disabled={savingProject || savingTemplate} className="maker-designer-template-button">
          {savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayoutTemplate className="h-3.5 w-3.5" />}
          {savingTemplate ? "Menyimpan" : appliedTemplateId ? "Perbarui template" : "Save to template"}
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="mx-auto max-w-[1720px] px-4 md:px-8 xl:px-12">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <Link to={customerMode ? "/vst-maker" : "/admin"} className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-white transition-colors mb-5">
              <ArrowLeft className="w-3.5 h-3.5" /> {customerMode ? "Kembali ke VST Maker" : "Kembali ke dashboard admin"}
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-[Outfit] text-3xl md:text-4xl font-black tracking-tight">TripleSide <span className="text-[#e11d48]">VST</span> Studio</h1>
            </div>
            <p className="text-sm text-zinc-400 mt-2 max-w-2xl">
              Editor Plugin &amp; Vst
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!customerMode && r2Storage && <span className={`inline-flex items-center rounded-full border px-4 py-2.5 text-xs font-bold ${r2Storage.uploads_blocked ? "border-red-300/30 bg-red-300/10 text-red-200" : r2Storage.warning ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-white/10 bg-white/[0.03] text-zinc-400"}`}>
              R2 {formatBytes(r2Storage.used_bytes)} / 8 GB
            </span>}
            {customerMode && <Link to="/vst-maker/billing" className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-4 py-2.5 text-xs font-bold text-emerald-200 hover:bg-emerald-300/10">
              <CreditCard className="h-3.5 w-3.5" /> {formatCredits(creditBalance)}
            </Link>}
            {!customerMode && <Link to="/vst-maker/billing" className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-4 py-2.5 text-xs font-bold text-emerald-200 hover:bg-emerald-300/10">
              <CreditCard className="h-3.5 w-3.5" /> Billing & plans
            </Link>}
          </div>
        </div>

        {!customerMode && <LiveCustomerActivityPanel activity={liveCustomerActivity} />}

        <section className="mb-6 rounded-2xl border border-white/10 bg-[#0a0a0c] px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-44 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Kesiapan build</span>
                <span className={`font-mono text-xs font-bold ${readinessPercent === 100 ? "text-[#22c55e] drop-shadow-[0_0_8px_rgba(34,197,94,0.75)]" : "text-rose-400"}`}>{readinessPercent}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-label={`Kesiapan project ${readinessPercent}%`}>
                <div className={`h-full rounded-full transition-all ${readinessPercent === 100 ? "bg-[#22c55e] shadow-[0_0_12px_rgba(34,197,94,0.9)]" : "bg-rose-400"}`} style={{ width: `${readinessPercent}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {readinessItems.map((item) => (
                <button key={item.label} type="button" onClick={() => selectEditorTab(item.tab)} className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[9px] transition-colors ${item.ready ? "border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200/70" : "border-amber-300/15 bg-amber-300/[0.05] text-amber-100/70 hover:bg-amber-300/10"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${item.ready ? "bg-emerald-300" : "bg-amber-300"}`} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {showExpandedBuildPanel && <BuildProgressPanel
          build={presentedBuild}
          onCancel={buildInProgress ? () => updateBuildJob(latestBuild, "cancel") : null}
          onRetry={latestBuild && ["failed", "canceled"].includes(latestBuild.status) ? () => updateBuildJob(latestBuild, "retry") : null}
          downloadBuilds={latestReadyBuildDownloads}
          onDownload={downloadBuildArtifact}
          onCollapse={!buildInProgress && !queueingBuild ? () => setBuildPanelExpanded(false) : null}
        />}

        {latestBuild && !showExpandedBuildPanel && (
          <section className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-white/[0.08] bg-[#0a0a0c] px-4 py-3.5">
            <span className={`h-2.5 w-2.5 rounded-full ${latestBuild.status === "ready" ? "bg-emerald-300" : latestBuild.status === "failed" || latestBuild.status === "canceled" ? "bg-red-300" : "bg-sky-300"}`} />
            <div className="min-w-52 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">Eksport VST {buildPlatformLabel(latestBuild)} terakhir</div>
              <div className="mt-1 text-sm font-bold text-zinc-200">{buildStatusLabel(latestBuild)}</div>
            </div>
            <span className="font-mono text-xs font-bold text-zinc-500">{Number(latestBuild.progress) || 0}%</span>
            <button type="button" onClick={() => setBuildPanelExpanded(true)} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-zinc-300 hover:bg-white/5">Lihat detail</button>
            {latestReadyBuildDownloads.map((item) => (
              <button key={item.platform} type="button" onClick={() => downloadBuildArtifact(item.build)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] px-4 py-2.5 text-xs font-bold text-emerald-200 hover:bg-emerald-300/10">
                <Download className="h-3.5 w-3.5" />Unduh {item.label} terakhir
              </button>
            ))}
          </section>
        )}

        <div className="maker-editor-layout">
          <div ref={editorTabsRef} className="maker-editor-navigation">
            <div ref={newProjectMenuRef} className="maker-new-project-menu">
              <button type="button" onClick={() => { setNewProjectDialogOpen((open) => !open); setDraftListOpen(false); }} className="maker-new-project-tab" aria-expanded={newProjectDialogOpen} aria-haspopup="dialog">
                <Plus className="h-4 w-4" />
                <span className="min-w-0 text-left">
                  <span className="block text-xs font-bold">Project baru</span>
                  <span className="maker-new-project-tab__detail">VST Instrument atau Plugin FX</span>
                </span>
              </button>
              {newProjectDialogOpen && (
                <section role="dialog" aria-label="Pilih jenis project baru" className="maker-new-project-popover">
                  <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-300/80">Pilih jenis project</div>
                  <p className="mt-1 text-[9px] leading-4 text-zinc-500">Workspace saat ini akan diganti. Project server tetap aman.</p>
                  <div className="maker-new-project-options mt-3">
                    <button type="button" onClick={() => resetDraft("instrument")}>
                      <span className="maker-new-project-option__icon"><Sparkles className="h-4 w-4" /></span>
                      <span className="text-left">
                        <span className="block text-xs font-bold text-white">VST Basic</span>
                        <span className="mt-1 block text-[9px] leading-4 text-zinc-500">Project instrumen kosong</span>
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-black text-amber-200"><Coins className="h-3 w-3 text-amber-300" />{formatCredits(templateStartingCredits(publishedTemplates.find((template) => template.id === "basicvst") || PROJECT_TEMPLATE_OPTIONS.find((template) => template.id === "basicvst") || { id: "basicvst" }))}</span>
                      </span>
                    </button>
                    <button type="button" onClick={() => resetDraft("effect")}>
                      <span className="maker-new-project-option__icon"><Sliders className="h-4 w-4" /></span>
                      <span className="text-left">
                        <span className="block text-xs font-bold text-white">Plugin Basic</span>
                        <span className="mt-1 block text-[9px] leading-4 text-zinc-500">Project audio effect kosong</span>
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-black text-amber-200"><Coins className="h-3 w-3 text-amber-300" />{formatCredits(templateStartingCredits(publishedTemplates.find((template) => template.id === "basicfx") || PROJECT_TEMPLATE_OPTIONS.find((template) => template.id === "basicfx") || { id: "basicfx", pluginKind: "effect" }))}</span>
                      </span>
                    </button>
                  </div>
                </section>
              )}
            </div>
            <div className="maker-editor-tabs" role="tablist" aria-label="Bagian workspace instrumen" aria-orientation="vertical">
            {visibleEditorTabs.map((tab) => (
              <button
                key={tab.id}
                id={`maker-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeEditorTab === tab.id}
                aria-controls="maker-editor-panel"
                tabIndex={activeEditorTab === tab.id ? 0 : -1}
                onClick={() => selectEditorTab(tab.id)}
                onKeyDown={(event) => {
                  const currentIndex = visibleEditorTabs.findIndex((item) => item.id === activeEditorTab);
                  const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
                    ? (currentIndex + 1) % visibleEditorTabs.length
                    : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? (currentIndex - 1 + visibleEditorTabs.length) % visibleEditorTabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? visibleEditorTabs.length - 1
                          : currentIndex;
                  if (nextIndex === currentIndex) return;
                  event.preventDefault();
                  const nextTab = visibleEditorTabs[nextIndex].id;
                  selectEditorTab(nextTab);
                  window.requestAnimationFrame(() => document.getElementById(`maker-tab-${nextTab}`)?.focus());
                }}
                className={`maker-editor-tab ${activeEditorTab === tab.id ? "is-active" : ""}`}
              >
                <span className="min-w-0 text-left">
                  <span className="block text-xs font-semibold">{tab.label}</span>
                  <span className="maker-editor-tab__detail">{tab.detail}</span>
                </span>
              </button>
            ))}
            </div>
          </div>

          <div className="min-w-0">
          <div className="space-y-5 min-w-0">
            <div id="maker-editor-panel" role="tabpanel" aria-labelledby={`maker-tab-${activeEditorTab}`} className="flex flex-col gap-5">
            {isEffectProject && (
              <div
                className={["interface", "sound"].includes(activeEditorTab) ? "" : "hidden"}
                data-effect-preview-persistent="true"
              >
                <EffectPreviewLab
                  controls={project.interfaceControls}
                  engineModules={project.engineModules}
                  customImpulses={customImpulseTaps}
                  accentColor={project.accentColor}
                  projectTemplate={project.projectTemplate}
                  sharedAnalyserRef={meterAnalyserRef}
                />
              </div>
            )}
            {activeEditorTab === "sampler" && (
              <>
            <section className="order-2 rounded-3xl border border-white/10 bg-[#0a0a0c] p-5 md:p-7">
              <SectionHeading number="02" title="Sumber suara" description="Pilih sampel untuk rancangan instrumen ini." />
              <label
                data-vst-drop-target="true"
                onDragOver={(event) => { event.preventDefault(); setDraggingFiles(true); }}
                onDragLeave={() => setDraggingFiles(false)}
                onDrop={(event) => { event.preventDefault(); setDraggingFiles(false); addSampleFiles(event.dataTransfer.files); }}
                className={`mt-6 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-7 text-center transition-colors ${draggingFiles ? "border-[#fb7185] bg-[#fb7185]/10" : "border-white/15 bg-black/20 hover:border-white/30 hover:bg-white/[0.03]"}`}
              >
                <input type="file" multiple accept=".wav,audio/wav" className="sr-only" onChange={(event) => { addSampleFiles(event.target.files); event.target.value = ""; }} />
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fb7185]/10 text-[#fb7185]"><Upload className="h-5 w-5" /></span>
                <span className="text-sm font-semibold text-white">Tarik sampel ke sini atau pilih file</span>
                <span className="mt-1.5 text-xs text-zinc-500">WAV · maksimal {formatBytes(planSampleFileLimit)} per file{customerMode && entitlement?.storage_limit_bytes ? ` · kuota ${formatBytes(entitlement.storage_limit_bytes)}` : ""}</span>
                <span className="mt-3 text-[10px] text-emerald-200/80">Audio diunggah ke penyimpanan privat saat project disimpan. File lokal tetap dipakai untuk preview browser.</span>
              </label>
              {sampleMessage && <p className="mt-3 text-xs text-zinc-400" role="status">{sampleMessage}</p>}
              {samples.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {samples.map((sample, sampleIndex) => {
                    const included = buildCreditQuote.templateBundleActive
                      ? templateIncludedSampleIds.has(String(sample.id))
                      : sampleIndex < Number(pricing.included_instrument_samples);
                    return (
                    <div
                      key={sample.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("application/x-vst-sample-id", sample.id);
                        event.dataTransfer.setData("text/plain", sample.name);
                      }}
                      className="flex cursor-grab items-center gap-2 rounded-lg border border-white/5 bg-black/25 px-2.5 py-1.5 active:cursor-grabbing"
                    >
                      <FileAudio className="h-3.5 w-3.5 shrink-0 text-[#fb7185]" />
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{sample.name}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${included ? "border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200/75" : "border-amber-300/15 bg-amber-300/[0.05] text-amber-200/80"}`}>
                        {included ? "Termasuk" : `+${pricing.extra_sample_credits} kredit`}
                      </span>
                      <span className={`text-[9px] ${sampleUploadProgress[sample.id] !== undefined || sample.uploaded ? "text-emerald-300/80" : "text-amber-200/70"}`}>
                        {sampleUploadProgress[sample.id] !== undefined
                          ? `Upload ${sampleUploadProgress[sample.id]}%`
                          : sample.uploaded
                            ? sample.file || sample.previewUrl ? "Tersimpan · preview siap" : "Tersimpan privat"
                            : sample.file ? "Siap diunggah" : "Pilih ulang"}
                      </span>
                      <span className="text-[10px] text-zinc-600">{formatBytes(sample.size)}</span>
                      <button type="button" onClick={() => removeSample(sample.id)} className="rounded-md p-1 text-zinc-600 hover:bg-white/5 hover:text-white" aria-label={`Hapus ${sample.name}`}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-white/5 bg-black/20 px-4 py-3 text-xs text-zinc-600">Belum ada sampel dipilih.</div>
              )}
            </section>
              </>
            )}

            {activeEditorTab === "sampler" && (
            <section className="order-1 rounded-3xl border border-white/10 bg-[#0a0a0c] p-5 md:p-7">
              <SectionHeading number="01" title="Sampler mapping" description="Atur zona key dan velocity untuk tiap sample seperti peta sampler." />
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                <span className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-zinc-300">{project.name || "Untitled Instrument"} · v{project.pluginVersion || "1.0.0"}</span>
                <button type="button" onClick={() => selectEditorTab("interface")} className="rounded-lg border border-white/10 px-2.5 py-1.5 font-semibold text-zinc-400 transition hover:border-white/25 hover:text-white">Edit identitas di Designer</button>
              </div>
              <SamplerMappingEditor
                key={project.projectId}
                accentColor={project.accentColor}
                pluginName={project.name}
                manufacturerName={project.manufacturerName}
                brandTagline={project.brandTagline}
                brandFont={project.brandFont}
                brandSize={project.brandSize}
                brandX={project.brandX}
                brandY={project.brandY}
                brandAlign={project.brandAlign}
                samples={samples}
                pricing={pricing}
                includedSampleIds={buildCreditQuote.templateBundleActive ? templateIncludedSampleIds : null}
                mappings={project.sampleMappings}
                samplerGroups={project.samplerGroups}
                rootNote={project.rootNote}
                velocityLayers={project.velocityLayers}
                projectTempo={project.tempoBpm}
                velocity={samplerVelocity}
                sustainEnabled={samplerSustain}
                onSustainToggle={toggleSamplerSustain}
                pitchBendEnabled={project.pitchBendEnabled === true}
                onPitchBendToggle={togglePitchBend}
                modulationEnabled={project.modulationEnabled === true}
                onModulationToggle={toggleModulation}
                onVelocityChange={setSamplerVelocity}
                audioStatus={samplerAudioStatus}
                externalPressedPitches={midiPressedPitches}
                waveformPlayback={waveformPlayback}
                onEnsureSampleFile={ensureSamplePreviewFile}
                onNoteOn={playSamplerNote}
                onNoteOff={stopSamplerNote}
                onDropSampleFiles={(files, pitch, samplerName) => addSampleFiles(files, { startPitch: pitch, samplerName })}
                onDeleteSamples={removeSamples}
                onMappingsChange={(mappings) => updateProject("sampleMappings", mappings)}
                onVelocityLayersChange={(layerCount) => updateProject("velocityLayers", layerCount)}
                onProjectTempoChange={(tempoBpm) => updateProject("tempoBpm", tempoBpm)}
                onSamplerGroupChange={updateSamplerGroup}
                onSamplerGroupRename={renameSamplerGroup}
                onAddSamplerGroup={addSamplerGroup}
                onRemoveSamplerGroup={removeSamplerGroup}
                projectActions={renderProjectActions()}
              />
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                <label className="block">
                  <FieldLabel>Root note default</FieldLabel>
                  <select value={project.rootNote} onChange={(event) => updateProject("rootNote", event.target.value)} className="maker-input mt-2">
                    {["C2", "C3", "C4", "C5", "D3", "E3", "F3", "G3", "A3"].map((note) => <option key={note}>{note}</option>)}
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>Rentang nada</FieldLabel>
                  <select value={project.noteRange} onChange={(event) => updateProject("noteRange", event.target.value)} className="maker-input mt-2">
                    {["C1–C6", "C2–C5", "C2–C6", "C3–C6"].map((range) => <option key={range}>{range}</option>)}
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>Velocity layers</FieldLabel>
                  <select value={project.velocityLayers} onChange={(event) => updateProject("velocityLayers", event.target.value)} className="maker-input mt-2">
                    {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} layer{count > 1 ? "s" : ""}</option>)}
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>Polyphony</FieldLabel>
                  <select value={project.polyphony} onChange={(event) => updateProject("polyphony", event.target.value)} className="maker-input mt-2">
                    {[8, 16, 32, 64, 128].map((count) => <option key={count} value={count}>{count} voices</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-5 rounded-xl border border-sky-300/10 bg-sky-300/[0.04] px-4 py-3 text-xs leading-5 text-sky-100/70">
                Keyboard Mapping, Designer, dan MIDI memainkan engine lengkap yang sama: sample serta Wave Generator melewati macro dan DSP Rack aktif sebelum Master.
              </div>
            </section>
            )}

            {activeEditorTab === "templates" && (
            <>
            <section className="rounded-3xl border border-white/10 bg-[#0a0a0c] p-5 md:p-7">
              <SectionHeading number="01" title="Plugin & VST Template" description="Pilih fondasi project berdasarkan kategori VST instrument, plugin audio effect, atau amp simulator." />
              {!customerMode && (
                <>
                  <div className="mt-6 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-emerald-200">Tambah template baru</div>
                        <p className="mt-1 text-[10px] leading-4 text-zinc-500">Mulai dari fondasi kosong. Save to template akan membuat template baru dan tidak menimpa template mana pun.</p>
                      </div>
                      <button type="button" onClick={() => setNewTemplateDialogOpen((open) => !open)} aria-expanded={newTemplateDialogOpen} className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-black text-zinc-950 hover:bg-emerald-300">
                        <Plus className="h-3.5 w-3.5" /> Tambah template
                      </button>
                    </div>
                    {newTemplateDialogOpen && (
                      <section role="dialog" aria-label="Pilih jenis template baru" className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-300/80">Pilih jenis template</div>
                        <p className="mt-1 text-[9px] leading-4 text-zinc-500">Workspace saat ini akan diganti. Project server dan template lama tetap aman.</p>
                        <div className="maker-new-project-options mt-3">
                          <button type="button" onClick={() => startNewTemplateDraft("instrument")}>
                            <span className="maker-new-project-option__icon"><Sparkles className="h-4 w-4" /></span>
                            <span className="text-left">
                              <span className="block text-xs font-bold text-white">VST Basic</span>
                              <span className="mt-1 block text-[9px] leading-4 text-zinc-500">Template instrumen kosong</span>
                            </span>
                          </button>
                          <button type="button" onClick={() => startNewTemplateDraft("effect")}>
                            <span className="maker-new-project-option__icon"><Sliders className="h-4 w-4" /></span>
                            <span className="text-left">
                              <span className="block text-xs font-bold text-white">Plugin Basic</span>
                              <span className="mt-1 block text-[9px] leading-4 text-zinc-500">Template audio effect kosong</span>
                            </span>
                          </button>
                        </div>
                      </section>
                    )}
                  </div>
                  <FreeCreditAdminPanel
                    email={grantEmail}
                    credits={grantCredits}
                    note={grantNote}
                    busy={grantBusy}
                    onEmailChange={setGrantEmail}
                    onCreditsChange={setGrantCredits}
                    onNoteChange={setGrantNote}
                    onGrantCredits={grantFreeCredits}
                  />
                  <PricingAdminPanel
                    pricing={pricingDraft}
                    templates={allProjectTemplates}
                    variants={COMPONENT_VARIANTS}
                    dspOptions={DSP_RACK_MODULE_OPTIONS}
                    saving={savingPricing}
                    onScalarChange={(key, value) => setPricingDraft((current) => ({ ...current, [key]: Math.max(0, Math.round(Number(value) || 0)) }))}
                    onPriceChange={updatePricingDraft}
                    onSave={savePricingSettings}
                  />
                </>
              )}
              <div className="maker-template-category-filter mt-6" role="tablist" aria-label="Kategori template project">
                {[
                  { id: "all", label: "Semua", count: allProjectTemplates.length },
                  { id: "vst", label: "VST", count: allProjectTemplates.filter((template) => template.pluginKind !== "effect").length },
                  { id: "plugin", label: "Plugin", count: allProjectTemplates.filter((template) => template.pluginKind === "effect" && template.templateCategory !== "amp").length },
                  { id: "amp", label: "Amp", count: allProjectTemplates.filter((template) => template.templateCategory === "amp").length },
                ].map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    role="tab"
                    aria-selected={projectTemplateCategory === category.id}
                    aria-controls="maker-project-template-category"
                    onClick={() => setProjectTemplateCategory(category.id)}
                  >
                    <span>{category.label}</span>
                    <span className="maker-template-category-filter__count">{category.count}</span>
                  </button>
                ))}
              </div>
              {projectTemplateCategory !== "all" && <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 px-4 py-3">
                <div className="text-xs font-bold text-white">
                  {projectTemplateCategory === "vst" ? "VST Instrument" : projectTemplateCategory === "amp" ? "Amp Simulator" : "Plugin Audio Effect"}
                </div>
                <div className="mt-1 text-[10px] leading-4 text-zinc-500">
                  {projectTemplateCategory === "vst"
                    ? "Template instrumen untuk sampler, piano, synth, bass, strings, dan drum."
                    : projectTemplateCategory === "amp"
                    ? "Template amp dan cabinet untuk gitar atau bass dengan rack DSP native siap pakai."
                    : "Template processor audio untuk compressor, limiter, equalizer, dan stereo effect."}
                </div>
              </div>}
              {!customerMode && hiddenBuiltInTemplates.length > 0 && (
                <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-200">Template bawaan tersembunyi</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {hiddenBuiltInTemplates.map((template) => (
                      <button key={template.id} type="button" onClick={() => restoreBuiltInTemplate(template)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/15 px-2.5 py-1.5 text-[9px] font-semibold text-amber-100 hover:bg-amber-300/10">
                        <RotateCcw className="h-3 w-3" /> Pulihkan {template.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div id="maker-project-template-category" className="maker-project-template-grid mt-6">
                {projectTemplatesForCategory(projectTemplateCategory, allProjectTemplates).map((template, templateIndex, visibleTemplates) => (
                  <div
                    key={template.id}
                    className={`maker-project-template ${appliedTemplateId === template.id || (!appliedTemplateId && project.projectTemplate === template.id) ? "is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => applyProjectTemplate(template.id)}
                      aria-pressed={appliedTemplateId === template.id || (!appliedTemplateId && project.projectTemplate === template.id)}
                      className="maker-project-template__apply"
                    >
                    <span className={`maker-project-template__preview maker-project-template__preview--${template.id} ${template.customThumbnail ? "is-custom-thumbnail" : ""}`} style={{ backgroundImage: (template.thumbnailUrl || template.backgroundUrl) ? template.customThumbnail ? `url(${template.thumbnailUrl || template.backgroundUrl})` : `linear-gradient(rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.5)), url(${template.thumbnailUrl || template.backgroundUrl})` : undefined, "--template-accent": template.accentColor }} aria-hidden="true">
                      <CreditCoinBadge value={templateStartingCredits(template)} prefix="Mulai" />
                      {!template.customThumbnail && <span className="maker-project-template__mock-controls">{DRUM_PROJECT_TEMPLATE_IDS.has(template.id) ? Array.from({ length: 16 }, (_, index) => <i key={index} />) : Array.from({ length: template.templateCategory === "amp" ? 8 : 5 }, (_, index) => <i key={index} />)}</span>}
                      {!template.customThumbnail && !DRUM_PROJECT_TEMPLATE_IDS.has(template.id) && <span className="maker-project-template__mock-meter"><i /><i /></span>}
                      {!template.customThumbnail && !DRUM_PROJECT_TEMPLATE_IDS.has(template.id) && template.pluginKind !== "effect" && <VstMiniKeyboard className="maker-project-template__mock-keys" />}
                      {!template.customThumbnail && <span className="maker-project-template__mock-label">{template.brandTagline}</span>}
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-2 text-sm font-bold text-white">{template.name}<span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[8px] text-zinc-400">{template.symbol}</span>{!customerMode && template.builtInTemplate && <span className="maker-project-template__builtin-badge">BAWAAN</span>}</span>
                      <span className="mt-1 block text-[10px] leading-4 text-zinc-500">{template.description}</span>
                      <span className="mt-2 flex flex-wrap gap-1">{template.highlights?.map((highlight) => <span key={highlight} className="rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-1 text-[8px] font-semibold text-zinc-500">{highlight}</span>)}</span>
                    </span>
                    <span className="maker-project-template__check">{appliedTemplateId === template.id || (!appliedTemplateId && project.projectTemplate === template.id) ? <Check className="h-3.5 w-3.5" /> : null}</span>
                    </button>
                    {!customerMode && (
                      <div className="maker-project-template__actions">
                        <span className="maker-project-template__actions-label">Kelola {template.builtInTemplate ? "BAWAAN" : "ADMIN"} · {template.name}</span>
                        <button type="button" onClick={() => applyProjectTemplate(template.id)} className="maker-project-template__thumbnail" title={`Edit template ${template.name}`}>
                          <LayoutTemplate className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </button>
                        <button type="button" onClick={() => movePublishedTemplate(template, -1)} disabled={templateIndex === 0 || !!reorderingTemplateId} className="maker-project-template__delete" aria-label={`Naikkan template ${template.name}`} title="Naikkan urutan template">↑</button>
                        <button type="button" onClick={() => movePublishedTemplate(template, 1)} disabled={templateIndex === visibleTemplates.length - 1 || !!reorderingTemplateId} className="maker-project-template__delete" aria-label={`Turunkan template ${template.name}`} title="Turunkan urutan template">↓</button>
                        <label className={`maker-project-template__thumbnail ${uploadingTemplateThumbnailId ? "is-disabled" : ""}`} title="Ganti thumbnail template">
                          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!uploadingTemplateThumbnailId} onChange={(event) => { uploadPublishedTemplateThumbnail(template, event.target.files?.[0]); event.target.value = ""; }} />
                          {uploadingTemplateThumbnailId === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          <span>Thumbnail</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => deletePublishedTemplate(template)}
                          disabled={!!deletingTemplateId || !!uploadingTemplateThumbnailId}
                          className="maker-project-template__delete"
                          aria-label={`${template.builtInTemplate ? "Sembunyikan" : "Hapus"} template ${template.name}`}
                          title={template.builtInTemplate ? "Sembunyikan template bawaan dari galeri" : "Hapus template dari galeri"}
                        >
                          {deletingTemplateId === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
            </>
            )}

            {activeEditorTab === "interface" && (
            <>
            <section className="rounded-3xl border border-white/10 bg-[#0a0a0c] p-5 md:p-7">
              <div className="maker-designer-heading-row">
                <SectionHeading number="01" title="Plugin & VST Designer" description="Tambahkan knob, fader, pad, atau keyboard, lalu susun di kanvas." />
                <div className="maker-designer-project-actions">
                  {customerMode && (
                    <CreditEstimatePopup
                      quote={buildCreditQuote}
                      balance={creditBalance}
                      insufficient={insufficientCredits}
                    />
                  )}
                  {customerMode && Number(latestReadyWindowsBuild?.correction_rebuilds_remaining || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => requestPlatformBuild("windows", true)}
                      disabled={savingProject || queueingBuild || buildInProgress || readinessCount !== readinessItems.length}
                      title="Rebuild Koreksi khusus VST3 Windows"
                      className="inline-flex items-center gap-2 rounded-full border border-sky-300/25 bg-sky-300/[0.07] px-4 py-2.5 text-xs font-bold text-sky-200 hover:bg-sky-300/12 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <WindowsIcon className="h-3.5 w-3.5" />Rebuild Windows · {Number(latestReadyWindowsBuild.correction_rebuilds_remaining)}x
                    </button>
                  )}
                  {customerMode && Number(latestReadyMacBuild?.correction_rebuilds_remaining || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => requestPlatformBuild("macos", true)}
                      disabled={savingProject || queueingBuild || buildInProgress || readinessCount !== readinessItems.length}
                      title="Rebuild Koreksi khusus Universal VST3 macOS"
                      className="inline-flex items-center gap-2 rounded-full border border-zinc-200/25 bg-zinc-200/[0.07] px-4 py-2.5 text-xs font-bold text-zinc-100 hover:bg-zinc-200/12 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <MacIcon className="h-3.5 w-3.5" />Rebuild macOS · {Number(latestReadyMacBuild.correction_rebuilds_remaining)}x
                    </button>
                  )}
                  <button onClick={() => requestPlatformBuild("windows", false)} disabled={savingProject || queueingBuild || buildInProgress || readinessCount !== readinessItems.length} title={buildInProgress ? "Satu build sedang berjalan. Tunggu hingga selesai atau gagal." : readinessCount === readinessItems.length ? "Tinjau lisensi dan biaya sebelum mengantrekan build VST3 Windows" : "Simpan dan unggah seluruh sample terlebih dahulu"} className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/[0.07] px-4 py-2.5 text-xs font-bold text-sky-200 hover:bg-sky-300/10 disabled:cursor-not-allowed disabled:opacity-35">
                    {queueingBuild || buildInProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WindowsIcon className="h-3.5 w-3.5" />}
                    {queueingBuild ? "Mengantrekan" : buildInProgress ? "Eksport sedang berjalan" : "Eksport VST Windows"}
                  </button>
                  <button onClick={() => requestPlatformBuild("macos", false)} disabled={savingProject || queueingBuild || buildInProgress || readinessCount !== readinessItems.length} title={buildInProgress ? "Satu build sedang berjalan. Tunggu hingga selesai atau gagal." : readinessCount === readinessItems.length ? "Build Universal VST3 untuk Apple Silicon dan Intel" : "Simpan dan unggah seluruh sample terlebih dahulu"} className="inline-flex items-center gap-2 rounded-full border border-zinc-200/20 bg-zinc-200/[0.07] px-4 py-2.5 text-xs font-bold text-zinc-100 hover:bg-zinc-200/10 disabled:cursor-not-allowed disabled:opacity-35">
                    {queueingBuild || buildInProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MacIcon className="h-3.5 w-3.5" />}
                    {queueingBuild ? "Mengantrekan" : buildInProgress ? "Eksport sedang berjalan" : "Eksport VST macOS"}
                  </button>
                </div>
              </div>
              <InterfaceWorkspace
                previewActions={renderProjectActions()}
                accentColor={project.accentColor}
                uiColor={project.uiColor}
                pluginName={project.name}
                manufacturerName={project.manufacturerName}
                pluginVersion={project.pluginVersion}
                instrumentType={project.instrumentType}
                pluginKind={project.pluginKind}
                brandTagline={project.brandTagline}
                brandFont={project.brandFont}
                brandSize={project.brandSize}
                brandX={project.brandX}
                brandY={project.brandY}
                brandAlign={project.brandAlign}
                uiTemplate={project.uiTemplate}
                projectTemplate={project.projectTemplate}
                keyboardKeys={project.keyboardKeys}
                onKeyboardKeysChange={updateKeyboardKeys}
                canvasWidth={project.canvasWidth}
                canvasHeight={project.canvasHeight}
                backgroundImageUrl={project.backgroundImageUrl}
                backgroundImageName={project.backgroundImageName}
                backgroundFit={project.backgroundFit}
                backgroundOpacity={project.backgroundOpacity}
                backgroundImageX={project.backgroundImageX}
                backgroundImageY={project.backgroundImageY}
                backgroundImageWidth={project.backgroundImageWidth}
                backgroundImageHeight={project.backgroundImageHeight}
                componentStyle={project.componentStyle}
                pricing={pricing}
                gridSnapEnabled={project.gridSnapEnabled}
                gridSize={project.gridSize}
                resizeAspectLocked={project.resizeAspectLocked}
                backgroundUploadEndpoint={customerMode ? "/customer/vst-maker/background" : "/admin/upload"}
                customBackgroundEnabled={canUseFeature("custom_backgrounds")}
                imageUploadEndpoint={customerMode ? "/customer/vst-maker/images" : "/admin/vst-maker/images"}
                imageUploadEnabled
                onCanvasChange={(updates) => updateDesignerProject((current) => ({ ...current, ...updates }), `canvas:${Object.keys(updates).sort().join(",")}`)}
                canUndo={designerHistoryPastRef.current.length > 0}
                canRedo={designerHistoryFutureRef.current.length > 0}
                onUndo={undoDesigner}
                onRedo={redoDesigner}
                midiPressedPitches={midiPressedPitches}
                activeHitPitches={previewPressedPitches}
                velocity={samplerVelocity}
                sustainEnabled={samplerSustain}
                pitchBendEnabled={project.pitchBendEnabled === true}
                modulationEnabled={project.modulationEnabled === true}
                pitchBendValue={pitchBendValue}
                modulationValue={modulationValue}
                onPitchBendChange={setPerformancePitchBend}
                onModulationChange={setPerformanceModulation}
                meterAnalyserRef={meterAnalyserRef}
                controls={project.interfaceControls}
                engineModules={project.engineModules}
                presets={project.presets}
                midiSequences={project.midiSequences}
                samplerGroups={project.samplerGroups}
                onFeatureChange={(updates) => updateDesignerProject((current) => ({ ...current, ...updates }))}
                selectedControlId={selectedInterfaceControlId}
                selectedControlIds={selectedInterfaceControlIds}
                onNoteOn={playSamplerNote}
                onNoteOff={stopSamplerNote}
                onAdd={addInterfaceControl}
                onSelect={selectInterfaceControl}
                onUpdate={updateInterfaceControl}
                onUpdateMany={updateInterfaceControls}
                onMoveLayer={moveInterfaceControlsLayer}
                onRemove={removeInterfaceControl}
                onRemoveSelected={removeSelectedInterfaceControls}
                onDrop={placeDroppedControl}
              />
            </section>
            </>
            )}

            {activeEditorTab === "sound" && (
            <section className="rounded-3xl border border-white/10 bg-[#0a0a0c] p-5 md:p-7">
              <SectionHeading number="04" title="Sumber & DSP Processor" description={isEffectProject ? "Stereo Input diproses melalui DSP Rack yang sama dengan VST Instrument." : "Sampler dan Wave Generator diproses melalui DSP Rack berurutan sebelum Master."} />
              {isEffectProject && !isPrismEqProject && (
                <div className="mt-6 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.035] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">Sumber suara</div>
                  <div className="mt-1 text-sm font-black text-white">Stereo Input</div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">Audio dari DAW masuk ke rack di bawah. Gunakan pemutar WAV di atas untuk menguji chain yang sama di browser.</p>
                </div>
              )}
              {!isPrismEqProject && (
                <div className="maker-dsp-rack mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-4 md:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">DSP Rack native</div>
                        <span className="rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[9px] font-bold text-zinc-400">{dspRackModules.length} modul</span>
                        {dspRackModules.some((module) => module.bypassed) && <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-2 py-0.5 text-[9px] font-bold text-amber-200">{dspRackModules.filter((module) => module.bypassed).length} bypass</span>}
                      </div>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">Susun alur suara dari kiri ke kanan. Buka satu modul untuk mengedit parameternya.</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button type="button" onClick={installAmpSimulatorRack} className="rounded-xl border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-rose-200 hover:bg-rose-300/10">
                        Pasang amp simulator
                      </button>
                      <button type="button" onClick={installStandardDspRack} className="rounded-xl border border-sky-300/20 bg-sky-300/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-200 hover:bg-sky-300/10">
                        Pasang rack standar
                      </button>
                      <button type="button" aria-expanded={dspModuleLibraryOpen} onClick={() => setDspModuleLibraryOpen((open) => !open)} className="inline-flex items-center gap-1.5 rounded-xl border border-sky-300/30 bg-sky-300/[0.1] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-100 hover:bg-sky-300/15">
                        <Plus className="h-3.5 w-3.5" /> Tambah modul <ChevronDown className={`h-3.5 w-3.5 transition-transform ${dspModuleLibraryOpen ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                  </div>
                  {dspRackModules.length > 0 && (
                    <div className="maker-dsp-signal-flow mt-4" aria-label="Urutan jalur audio">
                      <span className="maker-dsp-signal-flow__endpoint">{isEffectProject ? "Stereo input" : "Source mix"}</span>
                      {dspRackModules.map((module, index) => (
                        <React.Fragment key={module.id}>
                          <span className="maker-dsp-signal-flow__arrow" aria-hidden="true">›</span>
                          <button type="button" onClick={() => setExpandedDspModuleId((current) => current === module.id ? null : module.id)} className={`maker-dsp-signal-flow__module ${module.bypassed ? "is-bypassed" : ""} ${expandedDspModuleId === module.id ? "is-selected" : ""}`} title={`Buka ${module.name}`}>
                            <span>{index + 1}</span>{module.name}
                          </button>
                        </React.Fragment>
                      ))}
                      <span className="maker-dsp-signal-flow__arrow" aria-hidden="true">›</span>
                      <span className="maker-dsp-signal-flow__endpoint">Master</span>
                    </div>
                  )}
                  {dspModuleLibraryOpen && (
                    <div className="maker-dsp-library mt-4">
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/[0.07] bg-[#111216]/95 px-3 py-2 backdrop-blur">
                        <div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-300">Pilih processor</div><div className="text-[9px] text-zinc-600">Modul baru ditambahkan ke akhir jalur</div></div>
                        <button type="button" onClick={() => setDspModuleLibraryOpen(false)} className="rounded-lg border border-white/10 p-1.5 text-zinc-500 hover:text-white" aria-label="Tutup daftar modul"><X className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="space-y-4 p-3">
                        {DSP_MODULE_LIBRARY_GROUPS.map((group) => (
                          <section key={group.id}>
                            <div className="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
                              <div><div className={`text-[10px] font-black uppercase tracking-[0.14em] ${group.id === "amp" ? "text-rose-200" : "text-zinc-400"}`}>{group.label}</div><div className="mt-0.5 text-[9px] text-zinc-600">{group.detail}</div></div>
                              <span className="text-[9px] font-bold text-zinc-700">{group.types.length} pilihan</span>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {group.types.map((type) => dspRackOption(type)).filter((option) => option && (!option.instrumentOnly || !isEffectProject)).map((option) => (
                                <button key={option.type} type="button" onClick={() => addEngineModule(option.type)} className={`group flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left ${group.id === "amp" ? "border-rose-300/10 bg-rose-300/[0.025] hover:border-rose-300/30 hover:bg-rose-300/[0.06]" : "border-white/[0.08] bg-black/20 hover:border-sky-300/25 hover:bg-sky-300/[0.05]"}`}>
                                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-white/[0.035] ${group.id === "amp" ? "border-rose-300/10 text-rose-300/70 group-hover:text-rose-200" : "border-white/[0.08] text-zinc-500 group-hover:text-sky-200"}`}><Plus className="h-3.5 w-3.5" /></span>
                                  <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-bold text-zinc-300 group-hover:text-white">{option.name}</span><span className="block text-[9px] text-zinc-600">{option.parameters?.length || 1} parameter</span></span>
                                  <span className="maker-inline-credit"><Coins aria-hidden="true" />{pricing.dsp_prices?.[option.type] ?? 15}</span>
                                </button>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  )}
                  {dspRackModules.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-600">
                      <Sliders className="mx-auto mb-2 h-5 w-5 text-zinc-700" />
                      Belum ada modul DSP. Gunakan <span className="font-bold text-zinc-400">Tambah modul</span> atau pasang rack siap pakai.
                    </div>
                  ) : (
                    <div className="maker-dsp-module-list mt-4 space-y-2">
                      {dspRackModules.map((module, index) => {
                        const option = dspRackOption(module.type);
                        const parameterDefinitions = option?.parameters || [{ key: option?.parameter || "normalized", label: "Parameter", defaultValue: option?.defaultValue ?? 0.5 }];
                        const primaryDefinition = parameterDefinitions[0];
                        const primaryValue = Number(module.parameters?.[primaryDefinition.key] ?? primaryDefinition.defaultValue);
                        const isExpanded = expandedDspModuleId === module.id;
                        const cabinetImpulse = module.type === "cabinet_ir"
                          ? (project.impulseResponses || []).find((impulse) => impulse.moduleId === module.id)
                          : null;
                        return (
                          <div key={module.id} className={`maker-dsp-module rounded-xl border ${isExpanded ? "is-expanded border-sky-300/20 bg-sky-300/[0.025]" : module.bypassed ? "border-amber-300/15 bg-amber-300/[0.025]" : "border-white/[0.08] bg-black/20"}`}>
                            <div className="flex min-h-14 flex-wrap items-center gap-2 p-2.5 md:flex-nowrap">
                              <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedDspModuleId((current) => current === module.id ? null : module.id)} className="flex min-w-[190px] flex-1 items-center gap-3 rounded-lg px-1.5 py-1 text-left hover:bg-white/[0.025]">
                                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${module.bypassed ? "bg-amber-300/10 text-amber-200" : "bg-sky-300/[0.08] text-sky-200"}`}>{index + 1}</span>
                                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-zinc-200">{module.name}</span><span className="block truncate text-[9px] text-zinc-600">{primaryDefinition.label} {formatDspParameterValue(primaryDefinition, primaryValue)} · Mix {Math.round(module.mix * 100)}%</span></span>
                                <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-600 transition-transform ${isExpanded ? "rotate-180 text-sky-300" : ""}`} />
                              </button>
                              <button type="button" disabled={index === 0} onClick={() => moveEngineModule(module.id, -1)} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-zinc-400 disabled:opacity-25" aria-label={`Naikkan ${module.name}`}>↑</button>
                              <button type="button" disabled={index === dspRackModules.length - 1} onClick={() => moveEngineModule(module.id, 1)} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-zinc-400 disabled:opacity-25" aria-label={`Turunkan ${module.name}`}>↓</button>
                              <button type="button" aria-pressed={module.bypassed} onClick={() => updateEngineModule(module.id, { bypassed: !module.bypassed })} className={`rounded-lg border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wide ${module.bypassed ? "border-amber-300/25 bg-amber-300/10 text-amber-200" : "border-white/10 text-zinc-500 hover:text-zinc-300"}`}>{module.bypassed ? "Bypass aktif" : "Bypass"}</button>
                              <button type="button" onClick={() => deleteEngineModule(module.id)} className="rounded-lg border border-red-300/10 p-1.5 text-red-300/60 hover:bg-red-300/10 hover:text-red-200" aria-label={`Hapus ${module.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                            {isExpanded && <div className="border-t border-white/[0.07] p-3 md:p-4">
                            <div className="mb-3 flex items-center justify-between gap-3"><span className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">Parameter modul</span><code className="text-[8px] text-zinc-700">{module.type} · {module.id.slice(0, 8)}</code></div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {parameterDefinitions.map((definition) => {
                                const parameterValue = Number(module.parameters?.[definition.key] ?? definition.defaultValue);
                                return (
                                  <label key={definition.key} className="text-[10px] font-semibold text-zinc-500">
                                    <span className="flex justify-between"><span>{definition.label}</span><span>{formatDspParameterValue(definition, parameterValue)}</span></span>
                                    {definition.format === "reverb_mode" ? (
                                      <select className="mt-1 w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-[10px] text-zinc-200" value={Math.min(3, Math.round(parameterValue * 3))} onChange={(event) => updateEngineModuleParameter(module.id, definition.key, Number(event.target.value) / 3)}>
                                        <option value="0">Room</option><option value="1">Spring</option><option value="2">Plate</option><option value="3">Hall</option>
                                      </select>
                                    ) : (
                                      <input className="mt-1 w-full accent-sky-300" type="range" min="0" max="1" step={definition.step || "0.01"} value={parameterValue} onChange={(event) => updateEngineModuleParameter(module.id, definition.key, event.target.value)} />
                                    )}
                                  </label>
                                );
                              })}
                              <label className="text-[10px] font-semibold text-zinc-500">
                                <span className="flex justify-between"><span>Module mix</span><span>{Math.round(module.mix * 100)}%</span></span>
                                <input className="mt-1 w-full accent-sky-300" type="range" min="0" max="1" step="0.01" value={module.mix} onChange={(event) => updateEngineModule(module.id, { mix: Number(event.target.value) }, `dsp:${module.id}:mix`)} />
                              </label>
                            </div>
                            {module.type === "cabinet_ir" && (
                              <div className="mt-4 rounded-xl border border-violet-300/15 bg-violet-300/[0.035] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-200">Custom Cabinet IR</div>
                                    <p className="mt-1 text-[10px] leading-4 text-zinc-500">WAV mono/stereo maksimal 32 MB. Browser dan VST3 memakai IR terproses hingga 2048 sample; tanpa file, kabinet prosedural tetap aktif.</p>
                                  </div>
                                  <label className="cursor-pointer rounded-lg border border-violet-300/20 bg-violet-300/[0.08] px-3 py-2 text-[10px] font-bold text-violet-100 hover:bg-violet-300/15">
                                    {cabinetImpulse ? "Ganti IR WAV" : "Pilih IR WAV"}
                                    <input className="sr-only" type="file" accept=".wav,audio/wav" onChange={(event) => { chooseCabinetImpulse(module.id, event.target.files?.[0]); event.target.value = ""; }} />
                                  </label>
                                </div>
                                {cabinetImpulse && (
                                  <div className="mt-3 space-y-3">
                                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                                      <FileAudio className="h-3.5 w-3.5 text-violet-300" />
                                      <span className="font-semibold text-zinc-200">{cabinetImpulse.name}</span>
                                      <span>{formatBytes(cabinetImpulse.size)}</span>
                                      <span className={cabinetImpulse.uploaded ? "text-emerald-300" : "text-amber-300"}>{cabinetImpulse.uploaded ? "Tersimpan" : "Belum diunggah"}</span>
                                      {Number.isFinite(impulseUploadProgress[cabinetImpulse.id]) && <span>{impulseUploadProgress[cabinetImpulse.id]}%</span>}
                                      <button type="button" onClick={() => removeCabinetImpulse(module.id)} className="ml-auto rounded-md border border-red-300/15 px-2 py-1 text-red-300 hover:bg-red-300/10">Hapus IR</button>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                      <label className="flex items-center gap-2 text-[10px] font-semibold text-zinc-400"><input type="checkbox" checked={cabinetImpulse.normalize !== false} onChange={(event) => updateCabinetImpulse(module.id, { normalize: event.target.checked })} /> Normalisasi peak</label>
                                      <label className="flex items-center gap-2 text-[10px] font-semibold text-zinc-400"><input type="checkbox" checked={cabinetImpulse.autoTrim !== false} onChange={(event) => updateCabinetImpulse(module.id, { autoTrim: event.target.checked })} /> Auto-trim senyap</label>
                                      <label className="flex items-center gap-2 text-[10px] font-semibold text-zinc-400"><input type="checkbox" checked={cabinetImpulse.polarityInverted === true} onChange={(event) => updateCabinetImpulse(module.id, { polarityInverted: event.target.checked })} /> Balik polaritas</label>
                                      <label className="text-[10px] font-semibold text-zinc-500"><span className="flex justify-between"><span>Trim awal</span><span>{Math.round((cabinetImpulse.trimStart || 0) * 100)}%</span></span><input className="mt-1 w-full accent-violet-300" type="range" min="0" max="0.99" step="0.01" value={cabinetImpulse.trimStart || 0} onChange={(event) => updateCabinetImpulse(module.id, { trimStart: Math.min(Number(event.target.value), (cabinetImpulse.trimEnd ?? 1) - 0.01) })} /></label>
                                      <label className="text-[10px] font-semibold text-zinc-500"><span className="flex justify-between"><span>Trim akhir</span><span>{Math.round((cabinetImpulse.trimEnd ?? 1) * 100)}%</span></span><input className="mt-1 w-full accent-violet-300" type="range" min="0.01" max="1" step="0.01" value={cabinetImpulse.trimEnd ?? 1} onChange={(event) => updateCabinetImpulse(module.id, { trimEnd: Math.max(Number(event.target.value), (cabinetImpulse.trimStart || 0) + 0.01) })} /></label>
                                      <label className="text-[10px] font-semibold text-zinc-500"><span className="flex justify-between"><span>Phase alignment</span><span>{Number(cabinetImpulse.phaseMs || 0).toFixed(2)} ms</span></span><input className="mt-1 w-full accent-violet-300" type="range" min="-2" max="2" step="0.05" value={cabinetImpulse.phaseMs || 0} onChange={(event) => updateCabinetImpulse(module.id, { phaseMs: Number(event.target.value) })} /></label>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                            </div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {isEffectProject && isPrismEqProject && (
                <div className="mt-6 rounded-2xl border border-violet-300/15 bg-violet-300/[0.035] p-4 text-xs leading-5 text-zinc-400">
                  Prism EQ memakai graph native khusus agar kelima band, frekuensi, dan Q tetap sinkron dengan panel. Editor rack generik sengaja tidak menggantikan graph ini.
                </div>
              )}
              {!isEffectProject && (
                <div className="mt-6 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.035] p-4 md:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">Generator suara</div>
                      <h3 className="mt-1 text-sm font-black text-white">Wave Generator</h3>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">Oscillator polyphonic dapat dimainkan dari keyboard/MIDI dan dicampur dengan sampler. Pitch Bend, Modulation, Attack, Release, Tone, serta efek instrumen tetap berlaku.</p>
                    </div>
                    {waveGeneratorModule ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" aria-expanded={expandedDspModuleId === waveGeneratorModule.id} onClick={() => setExpandedDspModuleId((current) => current === waveGeneratorModule.id ? null : waveGeneratorModule.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-[10px] font-bold text-cyan-100 hover:bg-cyan-300/15">Atur generator <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedDspModuleId === waveGeneratorModule.id ? "rotate-180" : ""}`} /></button>
                        <button type="button" onClick={() => deleteEngineModule(waveGeneratorModule.id)} className="rounded-lg border border-red-300/15 px-3 py-2 text-[10px] font-bold text-red-200 hover:bg-red-300/10"><Trash2 className="mr-1 inline h-3 w-3" /> Hapus</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => addEngineModule("wave_generator")} className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-[10px] font-bold text-cyan-100 hover:bg-cyan-300/15"><Plus className="mr-1 inline h-3 w-3" /> Tambahkan <span className="maker-inline-credit"><Coins aria-hidden="true" />{pricing.dsp_prices?.wave_generator ?? 20}</span></button>
                    )}
                  </div>
                  {waveGeneratorModule && (() => {
                    const option = dspRackOption("wave_generator");
                    const oscillator1Keys = new Set(["waveform", "octave", "semitone", "fine", "level", "pulse_width", "phase_reset"]);
                    const oscillator2Keys = new Set(["osc2_waveform", "osc2_octave", "osc2_detune", "osc2_level", "osc2_pulse_width"]);
                    const velocityKeys = new Set(["velocity_sensitivity", "velocity_curve", "velocity_min_level"]);
                    const oscillator1Parameters = option.parameters.filter(({ key }) => oscillator1Keys.has(key));
                    const oscillator2Parameters = option.parameters.filter(({ key }) => oscillator2Keys.has(key));
                    const velocityParameters = option.parameters.filter(({ key }) => velocityKeys.has(key));
                    const sharedParameters = option.parameters.filter(({ key }) => !oscillator1Keys.has(key) && !oscillator2Keys.has(key) && !velocityKeys.has(key) && key !== "osc2_enabled");
                    const osc2Level = Number(waveGeneratorModule.parameters?.osc2_level ?? 0);
                    const osc2Enabled = waveGeneratorModule.parameters?.osc2_enabled == null
                      ? osc2Level > 0
                      : Number(waveGeneratorModule.parameters.osc2_enabled) >= 0.5;
                    const renderParameter = (definition, disabled = false) => {
                        const parameterValue = Number(waveGeneratorModule.parameters?.[definition.key] ?? definition.defaultValue);
                        return <label key={definition.key} className={`text-[10px] font-semibold ${disabled ? "text-zinc-700" : "text-zinc-500"}`}>
                          <span className="flex justify-between gap-2"><span>{definition.label}</span><span className={disabled ? "text-zinc-600" : "text-cyan-200"}>{formatDspParameterValue(definition, parameterValue)}</span></span>
                          <input disabled={disabled} className="mt-1 w-full accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-35" type="range" min="0" max="1" step={["waveform", "osc2_waveform"].includes(definition.key) ? "0.25" : definition.key === "velocity_curve" ? "0.5" : ["phase_reset", "glide_mode", "voice_mode", "retrigger"].includes(definition.key) ? "1" : "0.01"} value={parameterValue} onChange={(event) => updateEngineModuleParameter(waveGeneratorModule.id, definition.key, event.target.value)} />
                        </label>;
                    };
                    return expandedDspModuleId === waveGeneratorModule.id ? <div className="mt-4 space-y-4 border-t border-cyan-300/10 pt-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <section className="rounded-xl border border-cyan-300/20 bg-black/20 p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div><div className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Oscillator 1</div><div className="mt-1 text-[10px] text-zinc-500">Oscillator utama · selalu aktif</div></div>
                            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-200">Aktif</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">{oscillator1Parameters.map((definition) => renderParameter(definition))}</div>
                        </section>
                        <section className={`rounded-xl border p-4 transition-colors ${osc2Enabled ? "border-cyan-300/25 bg-cyan-300/[0.04]" : "border-white/10 bg-black/15"}`}>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div><div className={osc2Enabled ? "text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200" : "text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500"}>Oscillator 2</div><div className="mt-1 text-[10px] text-zinc-600">Lapisan oscillator tambahan</div></div>
                            <button type="button" role="switch" aria-checked={osc2Enabled} onClick={() => updateEngineModuleParameter(waveGeneratorModule.id, "osc2_enabled", osc2Enabled ? 0 : 1)} className={`rounded-full border px-3 py-1.5 text-[9px] font-black uppercase tracking-wide transition-colors ${osc2Enabled ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-100" : "border-white/10 bg-white/[0.03] text-zinc-500 hover:text-zinc-300"}`}>{osc2Enabled ? "Aktif" : "Nonaktif"}</button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">{oscillator2Parameters.map((definition) => renderParameter(definition, !osc2Enabled))}</div>
                        </section>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {sharedParameters.map((definition) => renderParameter(definition))}
                        <label className="text-[10px] font-semibold text-zinc-500">
                          <span className="flex justify-between"><span>Generator mix</span><span>{Math.round(waveGeneratorModule.mix * 100)}%</span></span>
                          <input className="mt-1 w-full accent-cyan-300" type="range" min="0" max="1" step="0.01" value={waveGeneratorModule.mix} onChange={(event) => updateEngineModule(waveGeneratorModule.id, { mix: Number(event.target.value) }, `dsp:${waveGeneratorModule.id}:mix`)} />
                        </label>
                        <label className="flex items-center gap-2 self-end rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-zinc-400"><input type="checkbox" checked={waveGeneratorModule.bypassed} onChange={(event) => updateEngineModule(waveGeneratorModule.id, { bypassed: event.target.checked })} /> Bypass generator</label>
                      </div>
                      <section className="rounded-xl border border-violet-300/20 bg-violet-300/[0.035] p-4">
                        <div className="mb-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">Respons Velocity</div>
                          <div className="mt-1 text-[10px] leading-4 text-zinc-500">Atur perbedaan volume antara sentuhan lembut dan keras. Berlaku sama pada keyboard preview, MIDI controller, dan hasil VST.</div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">{velocityParameters.map((definition) => renderParameter(definition))}</div>
                      </section>
                    </div> : null;
                  })()}
                </div>
              )}
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <details className="maker-dsp-support-panel rounded-2xl border border-white/[0.08] bg-white/[0.02]">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-300/[0.08] text-violet-200"><Sliders className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-xs font-black text-zinc-200">Macro DSP</span><span className="mt-0.5 block text-[10px] text-zinc-600">{project.controls.filter((controlId) => INTERNAL_DSP_MACRO_BINDINGS[controlId]).length} kontrol aktif · tampilkan pilihan macro</span></span>
                    <ChevronDown className="maker-dsp-support-panel__chevron h-4 w-4 text-zinc-600" />
                  </summary>
                  <div className="space-y-2 border-t border-white/[0.07] p-3">
                    {CONTROL_OPTIONS.filter((control) => {
                      const binding = INTERNAL_DSP_MACRO_BINDINGS[control.id];
                      if (!binding) return false;
                      return isEffectProject
                        || ["tone", "space"].includes(control.id)
                        || dspRackModules.some((module) => module.type === binding.type);
                    }).map((control) => (
                      <ToggleRow key={control.id} title={control.label} description={control.description} checked={project.controls.includes(control.id)} onChange={() => toggleControl(control.id)} />
                    ))}
                  </div>
                </details>
                <details className="maker-dsp-support-panel rounded-2xl border border-white/[0.08] bg-white/[0.02]">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-300/[0.08] text-emerald-200"><Sliders className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-xs font-black text-zinc-200">Master</span><span className="mt-0.5 block text-[10px] text-zinc-600">Kontrol global output dan performa</span></span>
                    <ChevronDown className="maker-dsp-support-panel__chevron h-4 w-4 text-zinc-600" />
                  </summary>
                  <div className="space-y-2 border-t border-white/[0.07] p-3">
                    {CONTROL_OPTIONS.filter((control) => (
                      isEffectProject
                        ? ["bypass", "output_level"].includes(control.id)
                        : ["volume", "attack", "release", "solo", "mute", "output_level"].includes(control.id)
                    )).map((control) => (
                      <ToggleRow key={control.id} title={control.label} description={control.description} checked={project.controls.includes(control.id)} onChange={() => toggleControl(control.id)} />
                    ))}
                  </div>
                </details>
              </div>
              {!isEffectProject && Object.values(project.effects).some(Boolean) && (
                <div className="mt-6 rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">Efek kompatibilitas project lama</div>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-500">Efek lama tetap dapat dimatikan di sini. Untuk project baru, gunakan modul pada DSP Rack agar jalurnya terlihat jelas.</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {EFFECT_OPTIONS.filter((effect) => project.effects[effect.id]).map((effect) => (
                      <ToggleRow key={effect.id} title={effect.label} description={effect.detail} creditPrice={pricing.instrument_effect_prices?.[effect.id] || 0} checked onChange={() => toggleEffect(effect.id)} />
                    ))}
                  </div>
                </div>
              )}
            </section>
            )}

            {activeEditorTab === "settings" && (
            <section className="rounded-3xl border border-white/10 bg-[#0a0a0c] p-5 md:p-7">
              <SectionHeading number="05" title="Settings" description="Atur lisensi dan konfigurasi build VST Maker." />
              {!customerMode && (
                <BuildLicenseAdminPanel
                  settings={buildSettingsDraft}
                  savedSettings={buildSettings}
                  saving={savingBuildSettings}
                  onChange={setBuildSettingsDraft}
                  onSave={saveBuildSettings}
                />
              )}
            </section>
            )}
            </div>
            <div className="px-2 text-[10px] text-zinc-600">
              {storageAvailable ? savedAt ? `Project browser tersimpan pukul ${savedAt}.` : "Menyimpan project di browser…" : "Penyimpanan browser tidak tersedia; perubahan hanya bertahan selama halaman terbuka."}
            </div>
          </div>
        </div>
      </div>
      {customerMode && buildLicenseDialogOpen && (
        <CustomerBuildLicenseDialog
          mode={buildRequestMode}
          platform={buildTargetPlatform}
          settings={buildSettings}
          pricing={pricing}
          selectedActivations={project.licenseMaxActivations}
          quote={buildDialogQuote}
          balance={creditBalance}
          distributionChoice={distributionBuildChoice}
          busy={queueingBuild || savingProject}
          onChange={(value) => updateProject("licenseMaxActivations", value)}
          onDistributionChange={setDistributionBuildChoice}
          onClose={() => {
            setBuildLicenseDialogOpen(false);
            setBuildRequestMode("export");
            updateProject("licenseMaxActivations", 1);
          }}
          onConfirm={async () => {
            setBuildLicenseDialogOpen(false);
            await enqueuePlatformBuild(buildTargetPlatform, distributionBuildChoice, buildRequestMode === "correction");
            setBuildRequestMode("export");
            updateProject("licenseMaxActivations", 1);
          }}
        />
      )}
    </div>
    </div>
  );
}

function LiveCustomerActivityPanel({ activity }) {
  const items = Array.isArray(activity?.items) ? activity.items : [];
  return (
    <section className="mb-6 rounded-2xl border border-sky-300/15 bg-sky-300/[0.035] px-4 py-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-300/10 text-sky-200"><Users className="h-4 w-4" /></span>
          <div><div className="text-xs font-black uppercase tracking-[0.14em] text-sky-100">Aktivitas customer live</div><div className="mt-0.5 text-[10px] text-zinc-500">Diperbarui otomatis setiap 5 detik</div></div>
        </div>
        <div className="flex gap-2 text-[10px] font-bold">
          <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-1.5 text-emerald-200">{activity?.editing_count || 0} editing</span>
          <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.06] px-3 py-1.5 text-amber-200">{activity?.building_count || 0} build aktif</span>
        </div>
      </div>
      {items.length ? (
        <div className="mt-4 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article key={item.customer_id} className="rounded-xl border border-white/[0.07] bg-black/25 px-3 py-3">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-xs font-bold text-white">{item.name || item.email || item.customer_id}</div><div className="truncate text-[9px] text-zinc-600">{item.email || item.customer_id}</div></div><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.builds?.length ? "animate-pulse bg-amber-300" : "bg-emerald-300"}`} /></div>
              {item.editing && <div className="mt-2 rounded-lg bg-emerald-300/[0.05] px-2.5 py-2 text-[10px] text-emerald-100/75">Editing · {item.editing.project_name || "Draft baru"} · {item.editing.editor_tab}</div>}
              {(item.builds || []).map((build) => <div key={build.id} className="mt-2 rounded-lg bg-amber-300/[0.05] px-2.5 py-2 text-[10px] text-amber-100/75">Build · {build.project_name || build.project_id} · {build.status} · {Number(build.progress) || 0}%</div>)}
            </article>
          ))}
        </div>
      ) : <div className="mt-4 rounded-xl border border-white/[0.05] bg-black/20 px-4 py-3 text-xs text-zinc-600">Belum ada customer yang sedang editing atau build.</div>}
    </section>
  );
}

function BuildProgressPanel({ build, onCancel, onRetry, downloadBuilds = [], onDownload, onCollapse }) {
  const progress = Math.max(0, Math.min(100, Number(build.progress) || 0));
  const active = ACTIVE_BUILD_STATUSES.includes(build.status);
  const currentStage = buildStageIndex(build);
  const failed = build.status === "failed";
  const canceled = build.status === "canceled";
  const ready = build.status === "ready";
  const statusLabel = buildStatusLabel(build);
  const platformLabel = buildPlatformLabel(build);
  const explanation = build.status === "building"
    ? `Compiler ${platformLabel} sedang membuat plugin. Progress diperbarui bertahap selama compiler tetap aktif, lalu berlanjut ke validasi.`
    : build.status === "queued" || build.status === "retrying"
      ? `Job sudah masuk antrean dan akan mulai otomatis saat worker ${platformLabel} tersedia.`
      : build.status === "preparing"
        ? "Sample dan konfigurasi sedang diperiksa serta disiapkan untuk compiler."
        : build.status === "validating"
          ? "Kompilasi selesai. Sistem sedang memeriksa entry point dan paket VST3 sebelum file tersedia."
          : ready
            ? `VST3 ${platformLabel} sudah selesai divalidasi dan siap diunduh. Anda juga dapat memulai build baru.`
            : failed
              ? `Proses berhenti sebelum selesai. Tombol Eksport VST ${platformLabel} sudah aktif kembali atau Anda dapat mengulangi job ini.`
              : `Build ini dihentikan. Tombol Eksport VST ${platformLabel} sudah aktif kembali.`
  const tone = ready
    ? "border-emerald-300/20 bg-emerald-300/[0.045]"
    : failed || canceled
      ? "border-red-300/20 bg-red-300/[0.035]"
      : "border-sky-300/20 bg-sky-300/[0.045]";

  return (
    <section className={`maker-build-progress relative mb-6 overflow-hidden rounded-3xl border ${tone}`} aria-live="polite">
      {onCollapse && <button type="button" onClick={onCollapse} className="absolute right-4 top-4 z-10 rounded-xl border border-white/10 bg-black/25 p-2 text-zinc-500 hover:bg-white/5 hover:text-white" aria-label="Ciutkan panel progress build"><X className="h-4 w-4" /></button>}
      <div className="p-5 md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${active ? "animate-pulse bg-sky-300" : ready ? "bg-emerald-300" : "bg-red-300"}`} />
              <span className="text-xs font-black uppercase tracking-[0.18em] text-zinc-300">Build VST3 {platformLabel}</span>
              <code className="rounded-md border border-white/[0.07] bg-black/20 px-2 py-1 text-[9px] text-zinc-600">{build.id?.slice(0, 12)}</code>
            </div>
            <h2 className={`mt-3 font-[Outfit] text-2xl font-black md:text-3xl ${ready ? "text-emerald-200" : failed || canceled ? "text-red-200" : "text-white"}`}>{statusLabel}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{build.status_message || "Status build sedang diperbarui"}</p>
          </div>
          <div className="flex items-end justify-between gap-5 lg:flex-col lg:items-end">
            <div className="text-left lg:text-right">
              <div className={`font-[Outfit] text-4xl font-black tabular-nums md:text-5xl ${ready ? "text-emerald-300" : failed || canceled ? "text-red-300" : "text-sky-200"}`}>{progress}%</div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">Progress build</div>
            </div>
            {active && onCancel && <button type="button" onClick={onCancel} className="rounded-xl border border-red-300/20 px-4 py-2.5 text-xs font-bold text-red-200 hover:bg-red-300/10">Batalkan build</button>}
            {(failed || canceled) && onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl border border-sky-300/25 bg-sky-300/[0.08] px-5 py-3 text-xs font-bold text-sky-100 hover:bg-sky-300/15"><RotateCcw className="h-4 w-4" />Ulangi build</button>}
            {downloadBuilds.map((item) => (
              <button key={item.platform} type="button" onClick={() => onDownload(item.build)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/[0.1] px-5 py-3 text-xs font-bold text-emerald-100 hover:bg-emerald-300/15">
                <Download className="h-4 w-4" />Unduh {item.label} terakhir
              </button>
            ))}
          </div>
        </div>

        {build.license_key && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-200/70">Serial lisensi build · maksimal {build.license_max_activations || 2} komputer</div>
              <code className="mt-1 block break-all text-sm font-bold text-amber-100">{build.license_key}</code>
            </div>
            <button type="button" onClick={() => navigator.clipboard.writeText(build.license_key).then(() => toast.success("Serial lisensi disalin")).catch(() => toast.error("Serial tidak dapat disalin"))} className="inline-flex items-center gap-2 rounded-xl border border-amber-300/20 px-4 py-2.5 text-xs font-bold text-amber-100 hover:bg-amber-300/10"><Copy className="h-4 w-4" />Salin serial</button>
            <p className="w-full text-[10px] leading-4 text-zinc-500">Saat plugin pertama dibuka, salin serial ini lalu tekan Aktivasi dari Clipboard. Aktivasi tersimpan aman pada komputer tersebut.</p>
          </div>
        )}

        {ready && build.correction_window_expires_at && (
          <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/[0.05] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-xs text-sky-100">Kesempatan Rebuild Koreksi</strong>
              <span className="text-[10px] font-bold text-sky-300">{Number(build.correction_rebuilds_remaining ?? 0)} kesempatan tersisa · sampai {new Date(build.correction_window_expires_at).toLocaleDateString("id-ID")}</span>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-zinc-500">Perbaikan ringan mulai 15 kredit. Maksimal 3 komponen baru, 3 sample baru, dan 3 pergantian skin tetap dihitung sebagai rebuild; harga tambahannya dibayar sesuai selisih.</p>
          </div>
        )}

        <div className="mt-6">
          <div className="maker-build-progress__track" role="progressbar" aria-label={`Progress build ${platformLabel} ${progress}%`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
            <div className={`maker-build-progress__fill ${active ? "is-active" : ""} ${ready ? "is-ready" : ""} ${failed || canceled ? "is-stopped" : ""}`} style={{ width: `${Math.max(active ? 4 : 0, progress)}%` }} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
          {BUILD_STAGES.map((stage, index) => {
            const completed = ready || index < currentStage;
            const selected = index === currentStage && !ready;
            return (
              <div key={stage.id} className={`rounded-xl border px-3 py-3 transition-colors ${completed ? "border-emerald-300/15 bg-emerald-300/[0.05]" : selected ? failed || canceled ? "border-red-300/20 bg-red-300/[0.06]" : "border-sky-300/25 bg-sky-300/[0.08]" : "border-white/[0.06] bg-black/20"}`}>
                <div className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-black ${completed ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-200" : selected ? failed || canceled ? "border-red-300/30 text-red-200" : "border-sky-300/30 text-sky-200" : "border-white/10 text-zinc-700"}`}>{completed ? <Check className="h-3.5 w-3.5" /> : active && selected ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : index + 1}</span>
                  <span className={`text-[11px] font-bold ${completed ? "text-emerald-200/80" : selected ? "text-white" : "text-zinc-600"}`}>{stage.label}</span>
                </div>
                <div className="mt-2 text-[9px] text-zinc-600">{stage.detail}</div>
              </div>
            );
          })}
        </div>

        <div className={`mt-5 flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${active ? "border-sky-300/10 bg-sky-300/[0.04]" : ready ? "border-emerald-300/10 bg-emerald-300/[0.04]" : "border-red-300/10 bg-red-300/[0.04]"}`}>
          {active && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-300" />}
          {!active && <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${ready ? "bg-emerald-300" : "bg-red-300"}`} />}
          <p className="text-xs leading-5 text-zinc-400">{explanation}</p>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ number, title, description }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#fb7185]/15 bg-[#fb7185]/10 font-mono text-[10px] font-bold text-[#fb7185]">{number}</span>
      <div><h2 className="font-[Outfit] text-xl font-bold text-white">{title}</h2><p className="mt-1 text-xs text-zinc-500">{description}</p></div>
    </div>
  );
}

function FieldLabel({ children, ...props }) {
  return <span {...props} className="block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{children}</span>;
}

function ToggleRow({ title, description, creditPrice = null, checked, onChange }) {
  return (
    <button type="button" onClick={onChange} aria-pressed={checked} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${checked ? "border-[#fb7185]/20 bg-[#fb7185]/[0.06]" : "border-white/5 bg-black/20 hover:border-white/10"}`}>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-[#fb7185] bg-[#fb7185] text-black" : "border-white/15 bg-black text-transparent"}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>
      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-zinc-200">{title}</span><span className="mt-0.5 block text-[10px] text-zinc-600">{description}</span></span>
      {creditPrice !== null && <span className="maker-inline-credit"><Coins aria-hidden="true" />{creditPrice}</span>}
      <Plus className={`h-3.5 w-3.5 transition-transform ${checked ? "rotate-45 text-[#fb7185]" : "text-zinc-700"}`} />
    </button>
  );
}

const createCustomDspPreviewGraph = (context, source, destination, meterTarget, plan) => {
  const processor = createNativeDspWorkletNode(context, plan);
  attachDspMeterTarget(processor, meterTarget);
  const processorGain = context.createGain();
  source.connect(processor).connect(processorGain).connect(destination);
  return {
    processor,
    processorGain,
    source,
    destination,
    meterTarget,
    applyBypass: (bypassed) => processor.port.postMessage({ type: "bypass", bypassed }),
    topology: plan.map(({ id, type }) => `${id}:${type}`).join("|"),
  };
};

const applyCustomDspPreviewPlan = (graph, plan) => {
  const topology = plan.map(({ id, type }) => `${id}:${type}`).join("|");
  graph.processor.port.postMessage({ type: "plan", plan });
  graph.topology = topology;
  return true;
};

function EffectPreviewLab({ controls, engineModules, customImpulses = {}, accentColor, projectTemplate, sharedAnalyserRef }) {
  const graphRef = useRef(null);
  const analyserRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const values = useMemo(() => controls.reduce((result, control) => {
    result[control.parameter] = clampUnit(Number(control.value) / 100);
    if (PRISM_EQ_BANDS[control.parameter]) result[`${control.parameter}_active`] = true;
    if (Number.isFinite(Number(control.frequency))) result[`${control.parameter}_frequency`] = Number(control.frequency);
    if (Number.isFinite(Number(control.q))) result[`${control.parameter}_q`] = Number(control.q);
    return result;
  }, {}), [controls]);
  const dspPlan = useMemo(() => createDspPreviewPlan(engineModules, controls, customImpulses), [controls, customImpulses, engineModules]);
  const isPrismEq = projectTemplate === "prismeq" && !engineModules.some((module) => module.type === "prism_eq");

  const releaseGraph = () => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.audio.pause();
    graph.audio.src = "";
    URL.revokeObjectURL(graph.url);
    graph.context.close().catch(() => {});
    graphRef.current = null;
    analyserRef.current = null;
    if (sharedAnalyserRef?.current === graph.analyser) sharedAnalyserRef.current = null;
    setPlaying(false);
  };

  const applyValues = (graph, nextValues, nextPlan = dspPlan) => {
    if (!graph) return true;
    const pan = Math.max(-1, Math.min(1, (nextValues.pan ?? 0.5) * 2 - 1));
    graph.masterPanner?.pan.setTargetAtTime(pan, graph.context.currentTime, 0.01);
    if (graph.profile === "custom-rack") {
      const applied = applyCustomDspPreviewPlan(graph, nextPlan);
      if (applied) graph.applyBypass((nextValues.bypass ?? 0) >= 0.5);
      return applied;
    }
    const input = nextValues.input ?? 0.5;
    const drive = nextValues.drive ?? 0.24;
    const compress = nextValues.compress ?? 0.32;
    const tone = nextValues.tone ?? 0.5;
    const width = (nextValues.width ?? 0.5) * 2;
    const space = nextValues.space ?? 0.18;
    const mix = nextValues.mix ?? 1;
    const output = nextValues.output ?? 0.75;
    const bypass = (nextValues.bypass ?? 0) >= 0.5;
    graph.inputGain.gain.value = input <= 0 ? 0 : 10 ** (((input * 24) - 12) / 20);
    if (graph.profile === "prism-eq") {
      const boundedFrequency = (parameter) => Math.min(graph.context.sampleRate * 0.49, nextValues[`${parameter}_frequency`] ?? PRISM_EQ_BANDS[parameter].frequency);
      const boundedQ = (parameter) => Math.max(0.025, Math.min(40, nextValues[`${parameter}_q`] ?? PRISM_EQ_BANDS[parameter].q));
      graph.lowCut.frequency.value = nextValues.tone_active ? boundedFrequency("tone") : 10;
      graph.lowCut.Q.value = boundedQ("tone");
      graph.lowBody.frequency.value = boundedFrequency("drive");
      graph.lowBody.Q.value = boundedQ("drive");
      graph.lowBody.gain.value = nextValues.drive_active ? (drive - 0.5) * 24 : 0;
      graph.midFocus.frequency.value = boundedFrequency("compress");
      graph.midFocus.Q.value = boundedQ("compress");
      graph.midFocus.gain.value = nextValues.compress_active ? (compress - 0.5) * 24 : 0;
      graph.presence.frequency.value = boundedFrequency("width");
      graph.presence.Q.value = boundedQ("width");
      graph.presence.gain.value = nextValues.width_active ? ((nextValues.width ?? 0.5) - 0.5) * 24 : 0;
      graph.air.frequency.value = boundedFrequency("space");
      graph.air.Q.value = boundedQ("space");
      graph.air.gain.value = nextValues.space_active ? (space - 0.5) * 24 : 0;
      graph.dryGain.gain.value = bypass ? 0 : 1 - mix;
      graph.processedGain.gain.value = bypass ? 0 : mix;
      graph.bypassGain.gain.value = bypass ? 1 : 0;
      graph.outputGain.gain.value = output <= 0 ? 0 : 10 ** (((output * 16) - 12) / 20);
      return true;
    }
    graph.shaper.curve = drive > 0.001 ? saturationCurve(drive * 0.78) : null;
    graph.compressor.threshold.value = -6 - (compress * 24);
    graph.compressor.ratio.value = 1 + (compress * 7);
    graph.compressor.knee.value = 8 + (compress * 20);
    graph.tone.gain.value = (tone - 0.5) * 18;
    graph.ll.gain.value = (1 + width) / 2;
    graph.lr.gain.value = (1 - width) / 2;
    graph.rl.gain.value = (1 - width) / 2;
    graph.rr.gain.value = (1 + width) / 2;
    graph.spaceWet.gain.value = space * 0.34;
    graph.feedback.gain.value = 0.18 + (space * 0.48);
    graph.dryGain.gain.value = bypass ? 0 : 1 - mix;
    graph.processedGain.gain.value = bypass ? 0 : mix;
    graph.bypassGain.gain.value = bypass ? 1 : 0;
    graph.outputGain.gain.value = output <= 0 ? 0 : 10 ** (((output * 16) - 12) / 20);
    return true;
  };

  // applyValues writes into the graph owned by graphRef; it is intentionally
  // recreated each render and must not become an effect dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (applyValues(graphRef.current, values, dspPlan) === false) releaseGraph();
  // applyValues and releaseGraph intentionally close over the current render;
  // values and dspPlan are the state boundaries that should update this graph.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dspPlan, values]);
  // The graph ref owns the current Web Audio nodes; cleanup must run only when
  // this audition panel unmounts, not whenever its controls rerender.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseGraph(), []);

  const loadFile = async (file) => {
    if (!file) return;
    releaseGraph();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      toast.error("Browser ini tidak mendukung preview Web Audio");
      return;
    }
    const context = new AudioContextClass({ latencyHint: "interactive" });
    const customRack = !isPrismEq;
    if (customRack) {
      try {
        await installNativeDspWorklet(context);
      } catch (error) {
        context.close().catch(() => {});
        toast.error("Browser ini tidak mendukung preview DSP presisi tinggi");
        return;
      }
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.loop = true;
    const source = context.createMediaElementSource(audio);
    const inputGain = context.createGain();
    const lowCut = context.createBiquadFilter(); lowCut.type = "highpass";
    const lowBody = context.createBiquadFilter(); lowBody.type = "peaking"; lowBody.frequency.value = 120;
    const midFocus = context.createBiquadFilter(); midFocus.type = "peaking"; midFocus.frequency.value = 900; midFocus.Q.value = 0.85;
    const presence = context.createBiquadFilter(); presence.type = "peaking"; presence.frequency.value = 3600; presence.Q.value = 0.9;
    const air = context.createBiquadFilter(); air.type = "peaking"; air.frequency.value = 9000;
    const shaper = context.createWaveShaper();
    shaper.oversample = "4x";
    const compressor = context.createDynamicsCompressor();
    compressor.attack.value = 0.008;
    compressor.release.value = 0.12;
    const tone = context.createBiquadFilter();
    tone.type = "highshelf";
    tone.frequency.value = 2500;
    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);
    const ll = context.createGain(); const lr = context.createGain(); const rl = context.createGain(); const rr = context.createGain();
    const delay = context.createDelay(0.5); delay.delayTime.value = 0.19;
    const feedback = context.createGain(); const spaceWet = context.createGain();
    const dryGain = context.createGain(); const processedGain = context.createGain(); const bypassGain = context.createGain();
    const outputGain = context.createGain(); const masterPanner = context.createStereoPanner(); const analyser = context.createAnalyser();
    masterPanner.pan.value = Math.max(-1, Math.min(1, (values.pan ?? 0.5) * 2 - 1));
    analyser.fftSize = 1024;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -12;
    analyser.smoothingTimeConstant = 0.78;
    // The compatibility rack is represented by the same ordered DSP plan as a
    // user-authored rack, so empty standard projects audition the native laws too.
    let customGraph = null;
    if (customRack) {
      customGraph = createCustomDspPreviewGraph(context, source, masterPanner, analyser, dspPlan);
    } else {
      source.connect(bypassGain).connect(masterPanner);
      source.connect(inputGain);
      inputGain.connect(dryGain).connect(outputGain);
    }
    if (isPrismEq) {
      inputGain.connect(lowCut).connect(lowBody).connect(midFocus).connect(presence).connect(air).connect(processedGain).connect(outputGain);
    } else if (!customRack) {
      inputGain.connect(shaper).connect(compressor).connect(tone).connect(splitter);
      splitter.connect(ll, 0); splitter.connect(lr, 0); splitter.connect(rl, 1); splitter.connect(rr, 1);
      ll.connect(merger, 0, 0); rl.connect(merger, 0, 0); lr.connect(merger, 0, 1); rr.connect(merger, 0, 1);
      merger.connect(processedGain).connect(outputGain);
      merger.connect(delay); delay.connect(feedback).connect(delay); delay.connect(spaceWet).connect(processedGain);
    }
    if (!customRack) outputGain.connect(masterPanner);
    masterPanner.connect(analyser);
    if (!customRack) analyser._vstGainReductionProvider = () => (1 - bypassGain.gain.value) * Math.max(0, Math.min(1, -(Number(compressor.reduction) || 0) / 24));
    analyser.connect(context.destination);
    attachStereoMeterTap(context, analyser);
    const graph = { profile: customRack ? "custom-rack" : isPrismEq ? "prism-eq" : "standard", context, url, audio, analyser, masterPanner, inputGain, lowCut, lowBody, midFocus, presence, air, shaper, compressor, tone, ll, lr, rl, rr, feedback, spaceWet, dryGain, processedGain, bypassGain, outputGain, ...(customGraph || {}) };
    graphRef.current = graph;
    analyserRef.current = analyser;
    if (sharedAnalyserRef) sharedAnalyserRef.current = analyser;
    applyValues(graph, values, dspPlan);
    context.resume().then(() => audio.play()).then(() => setPlaying(true)).catch(() => toast.error("Preview audio tidak dapat diputar"));
  };

  const addFiles = (fileList) => {
    const selected = Array.from(fileList || []);
    const valid = selected.filter((file) => /\.wav$/i.test(file.name) && file.size <= MAX_SAMPLE_BYTES);
    if (valid.length !== selected.length) toast.error("Gunakan file WAV maksimal 512 MB per file");
    if (!valid.length) return;
    setFiles((current) => [
      ...current,
      ...valid.map((file) => ({ id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : makeId(), file, name: file.name, size: file.size })),
    ]);
  };

  const playFile = (item) => {
    if (activeFileId === item.id && graphRef.current) {
      togglePlayback();
      return;
    }
    releaseGraph();
    setActiveFileId(item.id);
    loadFile(item.file);
  };

  const removeFile = (fileId) => {
    if (activeFileId === fileId) {
      releaseGraph();
      setActiveFileId(null);
    }
    setFiles((current) => current.filter((item) => item.id !== fileId));
  };

  const togglePlayback = async () => {
    const graph = graphRef.current;
    if (!graph) return;
    if (graph.audio.paused) {
      await graph.context.resume();
      await graph.audio.play();
      setPlaying(true);
    } else {
      graph.audio.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-amber-200/10 bg-amber-100/[0.025] p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <div className="text-xs font-bold text-amber-100">Uji WAV satu per satu</div>
          <p className="mt-1 text-[10px] leading-5 text-zinc-500">Unggah beberapa WAV lokal, tekan Putar pada satu file, lalu putar knob langsung pada panel Designer di bawah. Audio melewati {isPrismEq ? "Low Cut, Low Body, Mid Focus, Presence, Air, Mix, dan Output Prism EQ" : engineModules.length ? `${engineModules.length} modul DSP Rack sesuai urutan FX & Processor` : "chain DSP kompatibilitas bawaan"}. File uji tidak disimpan ke server.</p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-amber-200/20 bg-amber-100/[0.05] px-4 py-2 text-xs font-bold text-amber-100 hover:bg-amber-100/10">
            <Upload className="h-3.5 w-3.5" /> Tambah WAV
            <input type="file" multiple accept=".wav,audio/wav" className="sr-only" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="h-20 w-20 rounded-xl border border-white/[0.07] bg-black/30 p-2" style={{ "--maker-accent": accentColor }} title="Peak output">
            <PreviewOutputMeter kind="gain_meter" analyserRef={analyserRef} accentColor={accentColor} asset={null} />
          </div>
          <div className="h-20 w-28 rounded-xl border border-white/[0.07] bg-black/30 p-2" style={{ "--maker-accent": accentColor }} title="VU output">
            <PreviewOutputMeter kind="vu_meter" analyserRef={analyserRef} accentColor={accentColor} asset={null} />
          </div>
        </div>
      </div>
      {files.length > 0 && <div className="mt-4 space-y-2">
        {files.map((item) => {
          const active = activeFileId === item.id;
          return <div key={item.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${active ? "border-cyan-300/25 bg-cyan-300/[0.05]" : "border-white/[0.06] bg-black/20"}`}>
            <FileAudio className={`h-4 w-4 shrink-0 ${active ? "text-cyan-300" : "text-zinc-600"}`} />
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{item.name}</span>
            <span className="hidden text-[9px] text-zinc-600 sm:inline">{formatBytes(item.size)}</span>
            <button type="button" onClick={() => playFile(item)} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-bold text-zinc-300 hover:bg-white/[0.06]">{active && playing ? "Jeda" : active ? "Lanjut" : "Putar"}</button>
            <button type="button" onClick={() => removeFile(item.id)} className="rounded-lg border border-red-300/10 p-2 text-zinc-600 hover:bg-red-300/10 hover:text-red-300" aria-label={`Hapus file uji ${item.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>;
        })}
      </div>}
      {!files.length && <div className="mt-4 rounded-xl border border-dashed border-white/[0.08] px-4 py-3 text-center text-[10px] text-zinc-600">Belum ada WAV uji. Anda dapat memilih beberapa file sekaligus.</div>}
    </div>
  );
}

function useMidiGrooveTransport(midiSequences, onNoteOn, onNoteOff) {
  const [selectedSequenceId, setSelectedSequenceId] = useState(midiSequences[0]?.id || "");
  const [playingSequenceId, setPlayingSequenceId] = useState("");
  const timerRef = useRef(null);
  const generationRef = useRef(0);
  const cycleRef = useRef(0);
  const playingTokensRef = useRef(new Map());
  const scheduledTokensRef = useRef(new Set());
  const sustainChannelsRef = useRef(new Set());
  const sustainedTokensRef = useRef(new Map());
  const sequencesRef = useRef(midiSequences);
  const noteOnRef = useRef(onNoteOn);
  const noteOffRef = useRef(onNoteOff);
  sequencesRef.current = midiSequences;
  noteOnRef.current = onNoteOn;
  noteOffRef.current = onNoteOff;

  const releasePlayingNotes = useCallback((playbackOptions = null) => {
    scheduledTokensRef.current.forEach((token) => noteOffRef.current(token, playbackOptions));
    scheduledTokensRef.current.clear();
    playingTokensRef.current.clear();
    sustainChannelsRef.current.clear();
    sustainedTokensRef.current.clear();
  }, []);
  const stop = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    releasePlayingNotes({ forceRelease: true });
    setPlayingSequenceId("");
  }, [releasePlayingNotes]);
  const play = useCallback((sequenceOverride = null) => {
    const sequence = sequenceOverride
      || sequencesRef.current.find((item) => item.id === selectedSequenceId)
      || sequencesRef.current[0];
    if (!sequence) return;
    stop();
    setSelectedSequenceId(sequence.id);
    setPlayingSequenceId(sequence.id);
    const generation = generationRef.current;
    const begin = async () => {
      await noteOnRef.current?.prepareGroove?.(sequence);
      if (generation !== generationRef.current) return;
      let cycleStartedAt = performance.now() + MIDI_START_DELAY_MS;
      let groupedEvents = [];
      let groupIndex = 0;
      let duration = 1;
      let cycle = 0;
      const loadCycle = () => {
        const current = sequencesRef.current.find((item) => item.id === sequence.id);
        if (!current) return false;
        const timeline = buildMidiPlaybackTimeline(current);
        groupedEvents = timeline.groups;
        duration = timeline.duration;
        groupIndex = 0;
        cycleRef.current += 1;
        cycle = cycleRef.current;
        return true;
      };
      if (!loadCycle()) return stop();
      const pump = () => {
        if (generation !== generationRef.current) return;
        const now = performance.now();
        const horizon = now + MIDI_LOOKAHEAD_MS;
        while (generation === generationRef.current) {
          while (groupIndex < groupedEvents.length && cycleStartedAt + groupedEvents[groupIndex].due <= horizon) {
            const group = groupedEvents[groupIndex];
            const scheduledAtPerformance = cycleStartedAt + group.due;
            const playbackOptions = { grooveScheduled: true, scheduledAtPerformance };
            group.events.forEach(({ event, index }) => {
              if (event.type === "control_change" && event.controller === 64) {
                if (event.value >= 64) {
                  sustainChannelsRef.current.add(event.channel);
                } else {
                  sustainChannelsRef.current.delete(event.channel);
                  const sustained = sustainedTokensRef.current.get(event.channel) || new Set();
                  sustained.forEach((token) => noteOffRef.current(token, playbackOptions));
                  sustainedTokensRef.current.delete(event.channel);
                }
                return;
              }
              const key = `${event.channel}:${event.note}`;
              if (event.type === "note_on") {
                const previous = playingTokensRef.current.get(key);
                if (previous) noteOffRef.current(previous, playbackOptions);
                const token = `midi-file-${sequence.id}-${cycle}-${index}-${event.note}`;
                playingTokensRef.current.set(key, token);
                scheduledTokensRef.current.add(token);
                noteOnRef.current(event.note, event.velocity, token, null, null, null, playbackOptions);
              } else {
                const token = playingTokensRef.current.get(key);
                if (token && sustainChannelsRef.current.has(event.channel)) {
                  const sustained = sustainedTokensRef.current.get(event.channel) || new Set();
                  sustained.add(token);
                  sustainedTokensRef.current.set(event.channel, sustained);
                } else if (token) noteOffRef.current(token, playbackOptions);
                playingTokensRef.current.delete(key);
              }
            });
            groupIndex += 1;
          }
          if (groupIndex < groupedEvents.length) break;
          const cycleEndsAt = cycleStartedAt + duration;
          const latest = sequencesRef.current.find((item) => item.id === sequence.id);
          if (latest?.loopEnabled === true) {
            if (cycleEndsAt > horizon) break;
            releasePlayingNotes({ grooveScheduled: true, scheduledAtPerformance: cycleEndsAt, forceRelease: true });
            cycleStartedAt = cycleEndsAt;
            if (!loadCycle()) return stop();
            continue;
          }
          timerRef.current = setTimeout(() => {
            if (generation !== generationRef.current) return;
            releasePlayingNotes({ forceRelease: true });
            setPlayingSequenceId("");
          }, Math.max(0, cycleEndsAt - now + 5));
          return;
        }
        timerRef.current = setTimeout(pump, MIDI_SCHEDULER_INTERVAL_MS);
      };
      pump();
    };
    begin().catch(() => {
      if (generation !== generationRef.current) return;
      setPlayingSequenceId("");
      toast.error("Audio groove gagal disiapkan untuk preview");
    });
  }, [releasePlayingNotes, selectedSequenceId, stop]);

  useEffect(() => () => {
    generationRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    releasePlayingNotes({ forceRelease: true });
  }, [releasePlayingNotes]);
  useEffect(() => {
    if (playingSequenceId && !midiSequences.some((item) => item.id === playingSequenceId)) stop();
    if (selectedSequenceId && !midiSequences.some((item) => item.id === selectedSequenceId)) setSelectedSequenceId(midiSequences[0]?.id || "");
    if (!selectedSequenceId && midiSequences[0]) setSelectedSequenceId(midiSequences[0].id);
  }, [midiSequences, playingSequenceId, selectedSequenceId, stop]);

  return { selectedSequenceId, setSelectedSequenceId, playingSequenceId, play, stop };
}

function PanelFeatureContent({ panel, controls, engineModules = [], presets, midiSequences, midiTransport, samplerGroups, onUpdateMany, onFeatureChange }) {
  const [presetName, setPresetName] = useState("");
  const { selectedSequenceId, setSelectedSequenceId, playingSequenceId, play: playMidi, stop: stopMidi } = midiTransport;
  const featureControls = controls.filter((control) => !["panel_button", "visual", "text", "image", "gain_meter", "vu_meter"].includes(control.kind));
  const importMidi = async (file) => {
    if (!file) return;
    if (!/\.(mid|midi)$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      toast.error("Gunakan file .mid/.midi maksimal 2 MB");
      return;
    }
    try {
      const sequence = { ...parseMidiFile(await file.arrayBuffer(), file.name), loopEnabled: false };
      const next = [...midiSequences.filter((item) => item.id !== sequence.id), sequence].slice(-16);
      onFeatureChange({ midiSequences: next });
      setSelectedSequenceId(sequence.id);
      toast.success(`MIDI “${sequence.name}” siap dimainkan`);
    } catch (error) {
      toast.error(error.message || "File MIDI gagal dibaca");
    }
  };
  if (panel.panelType === "preset_browser") return (
    <div className="maker-functional-panel__body">
      <div className="maker-panel-preset-toolbar">
        <input value={presetName} maxLength={48} onChange={(event) => setPresetName(event.target.value)} placeholder="Nama preset baru" />
        <button type="button" onClick={() => {
          const name = normalizePresetName(presetName);
          if (!name) return toast.error("Masukkan nama preset");
          if (hasPresetName(presets, name)) return toast.error(`Nama preset “${name}” sudah digunakan`);
          const preset = {
            id: makeId(), name, category: "user",
            control_values: Object.fromEntries(featureControls.map((control) => [control.id, Number(control.value) || 0])),
            group_values: Object.fromEntries(samplerGroups.map((group) => [group.id, { volume: group.volume, pan: group.pan, mute: group.mute, solo: group.solo }])),
            module_values: Object.fromEntries(engineModules.map((module) => [module.id, { bypassed: module.bypassed === true, mix: Math.max(0, Math.min(1, Number(module.mix ?? 1))), parameters: { ...(module.parameters || {}) } }])),
          };
          onFeatureChange({ presets: [...presets, preset].slice(-128) });
          setPresetName("");
          toast.success(`Preset “${name}” disimpan`);
        }}><Save size={14} /> Simpan kondisi</button>
      </div>
      <div className="maker-panel-preset-list">
        {presets.map((preset) => <div key={preset.id} className="maker-panel-preset-row">
          <button type="button" onClick={() => {
            onUpdateMany(Object.entries(preset.control_values || {}).map(([id, value]) => ({ id, updates: { value } })).filter(({ id }) => controls.some((control) => control.id === id)));
            const nextGroups = samplerGroups.map((group) => ({ ...group, ...(preset.group_values?.[group.id] || {}) }));
            const nextModules = normalizeDspRack(engineModules.map((module) => {
              const snapshot = preset.module_values?.[module.id];
              return snapshot ? { ...module, bypassed: snapshot.bypassed === true, mix: snapshot.mix ?? module.mix, parameters: { ...module.parameters, ...(snapshot.parameters || {}) } } : module;
            }));
            onFeatureChange({ samplerGroups: nextGroups, engineModules: nextModules });
            toast.success(`Preset “${preset.name}” dimuat`);
          }}><strong>{preset.name}</strong><span>{preset.category === "factory" ? "FACTORY" : "USER"}</span></button>
          {preset.category !== "factory" && <button type="button" aria-label={`Hapus preset ${preset.name}`} onClick={() => onFeatureChange({ presets: presets.filter((item) => item.id !== preset.id) })}><Trash2 size={14} /></button>}
        </div>)}
        {!presets.length && <div className="maker-functional-panel__empty">Belum ada preset. Atur suara lalu simpan kondisi saat ini.</div>}
      </div>
    </div>
  );
  if (panel.panelType === "mixer") return (
    <div className="maker-functional-panel__body maker-panel-mixer">
      {samplerGroups.map((group) => <div key={group.id} className="maker-panel-channel">
        <strong>{group.name}</strong>
        <label>VOL<input type="range" min="0" max="100" value={group.volume} onChange={(event) => onFeatureChange({ samplerGroups: samplerGroups.map((item) => item.id === group.id ? { ...item, volume: Number(event.target.value) } : item) })} /></label>
        <label>PAN<input type="range" min="-1" max="1" step="0.01" value={group.pan} onChange={(event) => onFeatureChange({ samplerGroups: samplerGroups.map((item) => item.id === group.id ? { ...item, pan: Number(event.target.value) } : item) })} /></label>
        <div><button type="button" className={group.mute ? "is-active" : ""} onClick={() => onFeatureChange({ samplerGroups: samplerGroups.map((item) => item.id === group.id ? { ...item, mute: !item.mute } : item) })}>M</button><button type="button" className={group.solo ? "is-active" : ""} onClick={() => onFeatureChange({ samplerGroups: samplerGroups.map((item) => item.id === group.id ? { ...item, solo: !item.solo } : item) })}>S</button></div>
      </div>)}
    </div>
  );
  return (
    <div className="maker-functional-panel__body maker-panel-midi">
      <label className="maker-panel-midi-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); importMidi(event.dataTransfer.files?.[0]); }}>
        <input type="file" accept=".mid,.midi,audio/midi" className="sr-only" onChange={(event) => { importMidi(event.target.files?.[0]); event.target.value = ""; }} />
        <Upload size={18} /> Tambahkan groove MIDI
      </label>
      <div className="maker-panel-midi-toolbar">
        <strong>GROOVE LIBRARY</strong>
        <span>{midiSequences.length} pola</span>
      </div>
      <div className="maker-panel-midi-grooves">
        {midiSequences.map((sequence) => {
          const selected = sequence.id === selectedSequenceId;
          const playing = sequence.id === playingSequenceId;
          const bars = Math.max(1, Math.ceil((Number(sequence.durationTicks) || 0) / Math.max(1, Number(sequence.ppq) || 480) / 4));
          const bpm = Math.round(Number(sequence.tempos?.[0]?.bpm) || 120);
          return <div key={sequence.id} className={`maker-panel-midi-groove ${selected ? "is-selected" : ""}`} onClick={() => setSelectedSequenceId(sequence.id)}>
            <FileAudio size={15} />
            <button type="button" className="maker-panel-midi-groove__name" onClick={() => setSelectedSequenceId(sequence.id)}><strong>{sequence.name}</strong><small>{bars} bar · {bpm} BPM</small></button>
            <span className="maker-panel-midi-groove__drag" title="Pada VST hasil build, drag baris ini ke DAW"><Download size={12} /> DRAG</span>
            <button type="button" className={`maker-panel-midi-groove__loop ${sequence.loopEnabled === true ? "is-active" : ""}`} aria-pressed={sequence.loopEnabled === true} aria-label={`${sequence.loopEnabled === true ? "Nonaktifkan" : "Aktifkan"} loop ${sequence.name}`} title="Loop" onClick={(event) => { event.stopPropagation(); onFeatureChange({ midiSequences: midiSequences.map((item) => item.id === sequence.id ? { ...item, loopEnabled: item.loopEnabled !== true } : item) }); }}><Repeat2 size={13} /></button>
            <button type="button" className="maker-panel-midi-groove__play" aria-label={playing ? `Stop ${sequence.name}` : `Play ${sequence.name}`} title={playing ? "Stop" : "Play"} onClick={(event) => { event.stopPropagation(); if (playing) stopMidi(); else playMidi(sequence); }}>{playing ? <Square size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</button>
            <button type="button" className="maker-panel-midi-groove__delete" aria-label={`Hapus ${sequence.name}`} onClick={(event) => { event.stopPropagation(); if (playing) stopMidi(); onFeatureChange({ midiSequences: midiSequences.filter((item) => item.id !== sequence.id) }); if (selected) setSelectedSequenceId(""); }}><Trash2 size={13} /></button>
          </div>;
        })}
        {!midiSequences.length && <div className="maker-functional-panel__empty">Belum ada groove. Tambahkan file .mid atau .midi.</div>}
      </div>
    </div>
  );
}

function InterfaceWorkspace({ previewActions = null, accentColor, uiColor = "#09090b", pluginName, manufacturerName, pluginVersion, pluginKind = "instrument", instrumentType, brandTagline, brandFont, brandSize = 24, brandX = 18, brandY = 13, brandAlign = "left", uiTemplate, projectTemplate, keyboardKeys, onKeyboardKeysChange, canvasWidth, canvasHeight, backgroundImageUrl, backgroundImageName, backgroundFit, backgroundOpacity, backgroundImageX = 50, backgroundImageY = 50, backgroundImageWidth = 100, backgroundImageHeight = 100, componentStyle = "css", pricing = DEFAULT_VST_PRICING, gridSnapEnabled = true, gridSize = 8, resizeAspectLocked = true, backgroundUploadEndpoint, customBackgroundEnabled = true, imageUploadEndpoint = "", imageUploadEnabled = false, onCanvasChange, canUndo = false, canRedo = false, onUndo, onRedo, midiPressedPitches, activeHitPitches = new Set(), velocity, sustainEnabled, pitchBendEnabled = true, modulationEnabled = true, pitchBendValue, modulationValue, onPitchBendChange, onModulationChange, meterAnalyserRef, controls, engineModules, presets = [], midiSequences = [], samplerGroups = [], onFeatureChange, selectedControlId, selectedControlIds = [], onNoteOn, onNoteOff, onAdd, onSelect, onUpdate, onUpdateMany, onMoveLayer, onRemove, onRemoveSelected, onDrop }) {
  const selectedControl = controls.find((control) => control.id === selectedControlId);
  const selectedEngineModule = engineModules.find((module) => module.id === selectedControl?.moduleId);
  const selectedEngineModuleOption = dspRackOption(selectedEngineModule?.type);
  const selectedControlIdSet = new Set(selectedControlIds);
  const selectedControls = controls.filter((control) => selectedControlIdSet.has(control.id));
  const backgroundTargets = selectedControls.length ? selectedControls : selectedControl ? [selectedControl] : [];
  const backgroundVisibleCount = backgroundTargets.filter((control) => control.showBackground !== false).length;
  const backgroundSelectionMixed = backgroundVisibleCount > 0 && backgroundVisibleCount < backgroundTargets.length;
  const replacementVariantsFor = (control) => {
    if (!control) return [];
    const currentVariant = COMPONENT_VARIANTS.find((variant) => variant.kind === control.kind && variant.id === control.component_variant);
    return COMPONENT_VARIANTS.filter((variant) => {
    if (variant.kind !== control.kind) return false;
    if (["pad", "hit_pad"].includes(currentVariant?.category) && variant.category !== currentVariant.category) return false;
    if (["pitch_bend", "modulation"].includes(control.parameter)) return variant.parameter === control.parameter;
    return !variant.parameter || resolveVariantParameter(variant) === control.parameter;
    });
  };
  const canvasRef = useRef(null);
  const previewViewportRef = useRef(null);
  const backgroundToggleRef = useRef(null);
  const interactionRef = useRef(null);
  const selectionPointerRef = useRef(null);
  const backgroundInteractionRef = useRef(null);
  const brandInteractionRef = useRef(null);
  const panelInteractionRef = useRef(null);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [componentImageUploading, setComponentImageUploading] = useState(false);
  const [componentCategory, setComponentCategory] = useState("knob");
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);
  const [replaceControlId, setReplaceControlId] = useState(null);
  const [backgroundTemplatePickerOpen, setBackgroundTemplatePickerOpen] = useState(false);
  const [brandFontPickerOpen, setBrandFontPickerOpen] = useState(false);
  const [openPanelId, setOpenPanelId] = useState(null);
  const midiTransport = useMidiGrooveTransport(midiSequences, onNoteOn, onNoteOff);
  const [selectedPrismBandIndex, setSelectedPrismBandIndex] = useState(1);
  const prismAnalyzers = controls.filter((control) => control.kind === "spectrum" && (control.component_variant || "realtime-spectrum") === "realtime-spectrum");
  const prismAnalyzerForContext = (control) => prismAnalyzers.find((analyzer) => analyzer.id === (control.prismOwnerId ?? control.prism_owner_id)) || prismAnalyzers[0] || null;
  const prismContextModeFor = (control) => prismAnalyzerForContext(control)?.prismControlMode ?? prismAnalyzerForContext(control)?.prism_control_mode ?? "direct";
  const activePrismModule = engineModules.find((module) => prismAnalyzers.some((analyzer) => analyzer.moduleId === module.id) && module.type === "prism_eq") || engineModules.find((module) => module.type === "prism_eq") || null;
  const enabledPrismBandIndices = PRISM_BAND_SLOTS.filter((band) => Number(activePrismModule?.parameters?.[`band_${band.index}_enabled`] ?? 0) >= 0.5).map((band) => band.index);
  const enabledPrismBandSignature = enabledPrismBandIndices.join(",");
  const selectedPrismBandEnabled = enabledPrismBandIndices.includes(selectedPrismBandIndex);
  useEffect(() => {
    if (selectedPrismBandEnabled) return;
    setSelectedPrismBandIndex(Number(enabledPrismBandSignature.split(",")[0]) || 0);
  }, [enabledPrismBandSignature, selectedPrismBandEnabled]);
  useEffect(() => {
    if (backgroundToggleRef.current) backgroundToggleRef.current.indeterminate = backgroundSelectionMixed;
  }, [backgroundSelectionMixed]);
  useEffect(() => {
    setComponentCategory("knob");
    setComponentPickerOpen(false);
  }, [pluginKind]);
  useEffect(() => {
    if (replaceControlId && replaceControlId !== selectedControlId) setReplaceControlId(null);
  }, [replaceControlId, selectedControlId]);
  useEffect(() => {
    if (openPanelId && !controls.some((control) => control.id === openPanelId && control.kind === "panel_button")) setOpenPanelId(null);
  }, [controls, openPanelId]);
  const replaceControl = controls.find((control) => control.id === replaceControlId) || null;
  const replaceControlVariants = replacementVariantsFor(replaceControl);
  // Keep the component library identical for instruments and effects. Older
  // effect templates may still use instrument-oriented controls as generic UI
  // elements, so filtering by plugin kind makes valid components disappear.
  const availableComponentCategories = COMPONENT_CATEGORIES;
  const addComponentVariants = componentCategory
    ? COMPONENT_VARIANTS.filter((variant) => variant.category === componentCategory)
    : [];
  const replaceVariantId = replaceControl?.component_variant
    || (replaceControl?.kind === "pad" ? "rubber"
      : replaceControl?.kind === "gain_meter" ? "led"
        : replaceControl?.kind === "vu_meter" ? "dark-vu" : "classic");
  const [backgroundSelected, setBackgroundSelected] = useState(false);
  const [brandSelected, setBrandSelected] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const canvasBaseWidth = Math.max(320, Number(canvasWidth) || 1024);
  const canvasBaseHeight = Math.max(320, Number(canvasHeight) || 460);
  const openPanel = controls.find((control) => control.id === openPanelId && control.kind === "panel_button") || null;
  const panelById = new Map(controls.filter((control) => control.kind === "panel_button").map((control) => [control.id, control]));
  const visibleControls = controls.filter((control) => (
    (!control.parentPanelId || control.parentPanelId === openPanelId)
    && !control.spectrumBand
  ));
  const prismContextValue = (control) => {
    if (!activePrismModule || !selectedPrismBandEnabled) return 0;
    const suffix = control.prismContext ?? control.prism_context;
    return Math.round(Math.max(0, Math.min(1, Number(activePrismModule.parameters?.[`band_${selectedPrismBandIndex}_${suffix}`] ?? 0))) * 100);
  };
  const prismContextValueText = (control) => {
    if (!selectedPrismBandEnabled) return "Tidak ada band";
    const context = control.prismContext ?? control.prism_context;
    if (context === "gain" && selectedPrismBandIndex === 1) return "Tidak tersedia";
    const normalized = prismContextValue(control) / 100;
    if (context === "frequency") return formatPrismFrequency(prismSliderToFrequency(normalized * 1000));
    if (context === "gain") return `${((normalized - 0.5) * 24).toFixed(1)} dB`;
    return `Q ${prismSliderToQ(normalized * 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  };
  const updatePrismContext = (control, value) => {
    if (!activePrismModule || !selectedPrismBandEnabled || prismContextModeFor(control) !== "contextual") return;
    const context = control.prismContext ?? control.prism_context;
    if (context === "gain" && selectedPrismBandIndex === 1) return;
    const parameter = `band_${selectedPrismBandIndex}_${context}`;
    onFeatureChange({
      engineModules: normalizeDspRack(engineModules.map((module) => module.id === activePrismModule.id
        ? { ...module, parameters: { ...module.parameters, [parameter]: Math.max(0, Math.min(1, Number(value) / 100)) } }
        : module)),
    });
  };
  const selectedSurfaceControls = selectedControl
    ? controls.filter((control) => (control.parentPanelId ?? null) === (selectedControl.parentPanelId ?? null))
    : [];
  const selectedLayerIndex = selectedSurfaceControls.findIndex((control) => control.id === selectedControlId);
  const canMoveLayerForward = moveSelectedCanvasControls(controls, selectedControlIds, "forward") !== controls;
  const canMoveLayerBackward = moveSelectedCanvasControls(controls, selectedControlIds, "backward") !== controls;
  const surfaceLayerIndex = new Map();
  const surfaceLayerCounts = new Map();
  controls.forEach((control) => {
    const surface = control.parentPanelId ?? null;
    const layer = surfaceLayerCounts.get(surface) || 0;
    surfaceLayerIndex.set(control.id, layer);
    surfaceLayerCounts.set(surface, layer + 1);
  });
  const canvasPositionFor = (control) => {
    const parent = panelById.get(control.parentPanelId);
    if (!parent) return { x: control.x, y: control.y };
    const width = parent.panelWidth ?? 88;
    const height = parent.panelHeight ?? 78;
    const headerHeight = (44 / canvasBaseHeight) * 100;
    const contentTop = (parent.panelY ?? 52) - height / 2 + headerHeight;
    const contentHeight = Math.max(0, height - headerHeight);
    return {
      x: (parent.panelX ?? 50) - width / 2 + (control.x / 100) * width,
      y: contentTop + (control.y / 100) * contentHeight,
    };
  };
  const selectedBrandFont = BRAND_FONT_OPTIONS.find((font) => font.id === brandFont) || BRAND_FONT_OPTIONS[0];
  const updateSelectedComponentBackgrounds = (showBackground) => {
    if (!backgroundTargets.length) return;
    if (backgroundTargets.length > 1) {
      onUpdateMany(backgroundTargets.map((control) => ({ id: control.id, updates: { showBackground } })));
      return;
    }
    onUpdate(backgroundTargets[0].id, { showBackground });
  };
  useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return undefined;
    const updateScale = () => setPreviewScale(Math.min(1, Math.max(0.35, (viewport.clientWidth - 4) / canvasBaseWidth)));
    updateScale();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScale) : null;
    observer?.observe(viewport);
    window.addEventListener("resize", updateScale);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [canvasBaseWidth]);
  const selectBrandFont = (fontId) => {
    const font = BRAND_FONT_OPTIONS.find((option) => option.id === fontId);
    if (!font) return;
    onCanvasChange({ brandFont: font.id });
    if (typeof document !== "undefined" && document.fonts?.load) document.fonts.load(`700 24px ${font.family}`).catch(() => {});
  };
  const uploadCanvasBackground = async (file) => {
    if (!file) return;
    if (!customBackgroundEnabled) {
      toast.error("Upload background memerlukan paket Pro");
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("Background harus berupa JPG, PNG, atau WebP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Ukuran background maksimal 10 MB");
      return;
    }
    const payload = new FormData();
    payload.append("file", file);
    payload.append("folder", "tripleside/vst-backgrounds");
    setBackgroundUploading(true);
    try {
      const { data } = await api.post(backgroundUploadEndpoint, payload, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 });
      if (!data?.url) throw new Error("URL gambar tidak tersedia");
      onCanvasChange({ backgroundImageUrl: data.url, backgroundImageName: file.name });
      toast.success("Background desain berhasil diunggah");
    } catch (error) {
      toast.error(error.userMessage || "Background gagal diunggah");
    } finally {
      setBackgroundUploading(false);
    }
  };
  const uploadCanvasImage = async (file, controlId = null) => {
    if (!file || !imageUploadEnabled) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("Gambar harus berupa JPG, PNG, atau WebP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Ukuran gambar maksimal 10 MB");
      return;
    }
    const payload = new FormData();
    payload.append("file", file);
    setComponentImageUploading(true);
    try {
      const { data } = await api.post(imageUploadEndpoint, payload, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 });
      if (!data?.url) throw new Error("URL gambar tidak tersedia");
      if (controlId) {
        onUpdate(controlId, { imageUrl: data.url, imageName: file.name });
        toast.success("Gambar komponen berhasil diganti");
      } else {
        const label = file.name.replace(/\.[^.]+$/, "").slice(0, 24) || "Gambar";
        onAdd("image", null, "css", "image", {
          label,
          parameter: "visual",
          imageUrl: data.url,
          imageName: file.name,
          imageFit: "contain",
          imageOpacity: 100,
          showBackground: false,
          ...(openPanelId ? { parentPanelId: openPanelId, x: 50, y: 50 } : {}),
        });
        toast.success("Gambar ditambahkan sebagai komponen kanvas");
      }
    } catch (error) {
      toast.error(error.userMessage || "Gambar gagal diunggah");
    } finally {
      setComponentImageUploading(false);
    }
  };
  const beginControlSelectionGesture = (event, control) => {
    if (event.button !== 0) return;
    const additive = event.ctrlKey || event.metaKey;
    const selected = selectedControlIdSet.has(control.id);
    selectionPointerRef.current = additive && selected ? {
      pointerId: event.pointerId,
      controlId: control.id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    } : null;
    if (additive && !selected) onSelect(control.id, true);
    else if (!selected) onSelect(control.id);
  };
  const updateControlSelectionGesture = (event) => {
    const gesture = selectionPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - gesture.startX) > 2 || Math.abs(event.clientY - gesture.startY) > 2) gesture.moved = true;
  };
  const endControlSelectionGesture = (event) => {
    const gesture = selectionPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    selectionPointerRef.current = null;
    if (!gesture.moved) onSelect(gesture.controlId, true);
  };
  const cancelControlSelectionGesture = (event) => {
    if (selectionPointerRef.current?.pointerId === event.pointerId) selectionPointerRef.current = null;
  };
  const beginCanvasInteraction = (event, control, mode) => {
    if (!canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const parentPanelElement = control.parentPanelId ? canvasRef.current.querySelector(`[data-vst-panel="${control.parentPanelId}"]`) : null;
    const boundsElement = parentPanelElement || canvasRef.current;
    const elementBounds = boundsElement.getBoundingClientRect();
    const panelHeaderHeight = parentPanelElement ? 44 * (elementBounds.height / Math.max(1, boundsElement.offsetHeight)) : 0;
    const bounds = parentPanelElement ? panelContentClientBounds(elementBounds, panelHeaderHeight) : elementBounds;
    const additive = event.ctrlKey || event.metaKey;
    const interactionControlIds = additive && !selectedControlIdSet.has(control.id)
      ? new Set([...selectedControlIds, control.id])
      : selectedControlIdSet;
    const interactionControls = controlsOnSameInteractionSurface(controls, [...interactionControlIds], control);
    const members = interactionControls.map((item) => ({
      id: item.id,
      kind: item.kind,
      parameter: item.parameter,
      x: item.x,
      y: item.y,
      width: item.width ?? CONTROL_DEFAULT_SIZES[item.kind]?.width ?? 112,
      height: item.height ?? CONTROL_DEFAULT_SIZES[item.kind]?.height ?? 122,
      rotation: normalizeComponentRotation(item.rotation),
    }));
    interactionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: control.x,
      y: control.y,
      width: control.width ?? CONTROL_DEFAULT_SIZES[control.kind]?.width ?? 112,
      height: control.height ?? CONTROL_DEFAULT_SIZES[control.kind]?.height ?? 122,
      members,
      freeMove: additive,
      bounds,
      canvasWidth: boundsElement.offsetWidth,
      canvasHeight: Math.max(1, boundsElement.offsetHeight - (parentPanelElement ? 44 : 0)),
      scaleX: boundsElement.offsetWidth / Math.max(1, bounds.width),
      scaleY: boundsElement.offsetHeight / Math.max(1, bounds.height),
    };
  };
  const updateCanvasInteraction = (event, control) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - interaction.startX;
    const deltaY = event.clientY - interaction.startY;
    const snapActive = gridSnapEnabled && !interaction.freeMove && !event.ctrlKey && !event.metaKey;
    if (interaction.mode === "move") {
      const horizontalLimits = interaction.members.map((member) => {
        const rotated = rotatedControlSize(member.width, member.height, member.rotation);
        const halfWidth = Math.min(50, (rotated.width / interaction.canvasWidth) * 50);
        return { minimum: halfWidth - member.x, maximum: (100 - halfWidth) - member.x };
      });
      const verticalLimits = interaction.members.map((member) => {
        const rotated = rotatedControlSize(member.width, member.height, member.rotation);
        const halfHeight = Math.min(50, (rotated.height / interaction.canvasHeight) * 50);
        return { minimum: halfHeight - member.y, maximum: (100 - halfHeight) - member.y };
      });
      const minimumDeltaX = Math.max(...horizontalLimits.map((limit) => limit.minimum));
      const maximumDeltaX = Math.min(...horizontalLimits.map((limit) => limit.maximum));
      const minimumDeltaY = Math.max(...verticalLimits.map((limit) => limit.minimum));
      const maximumDeltaY = Math.min(...verticalLimits.map((limit) => limit.maximum));
      let groupDeltaX = Math.max(minimumDeltaX, Math.min(maximumDeltaX, (deltaX / interaction.bounds.width) * 100));
      let groupDeltaY = Math.max(minimumDeltaY, Math.min(maximumDeltaY, (deltaY / interaction.bounds.height) * 100));
      if (snapActive) {
        groupDeltaX = snapControlCenter(interaction.x + groupDeltaX, interaction.canvasWidth, interaction.width, gridSize) - interaction.x;
        groupDeltaY = snapControlCenter(interaction.y + groupDeltaY, interaction.canvasHeight, interaction.height, gridSize) - interaction.y;
        groupDeltaX = Math.max(minimumDeltaX, Math.min(maximumDeltaX, groupDeltaX));
        groupDeltaY = Math.max(minimumDeltaY, Math.min(maximumDeltaY, groupDeltaY));
      }
      const updates = interaction.members.map((member) => ({
        id: member.id,
        updates: {
          x: roundLayoutPercent(member.x + groupDeltaX),
          y: roundLayoutPercent(member.y + groupDeltaY),
        },
      }));
      if (updates.length > 1) onUpdateMany(updates);
      else onUpdate(updates[0].id, updates[0].updates);
      return;
    }
    const logicalDeltaX = deltaX * interaction.scaleX;
    const logicalDeltaY = interaction.mode === "resize-width" ? 0 : deltaY * interaction.scaleY;
    const snappedDeltaX = snapActive
      ? Math.round((interaction.width + logicalDeltaX) / gridSize) * gridSize - interaction.width
      : logicalDeltaX;
    const snappedDeltaY = snapActive
      ? Math.round((interaction.height + logicalDeltaY) / gridSize) * gridSize - interaction.height
      : logicalDeltaY;
    const updates = interaction.members.map((member) => ({
      id: member.id,
      updates: resizeCanvasControlWithinBounds({
        kind: member.kind,
        preserveAspectRatio: resizeAspectLocked,
        width: member.width,
        height: member.height,
        x: member.x,
        y: member.y,
        boundsWidth: interaction.canvasWidth,
        boundsHeight: interaction.canvasHeight,
        deltaX: snappedDeltaX,
        deltaY: snappedDeltaY,
      }),
    }));
    if (updates.length > 1) onUpdateMany(updates);
    else onUpdate(updates[0].id, updates[0].updates);
  };
  const endCanvasInteraction = (event) => {
    if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
  };
  const beginPanelInteraction = (event, panel, mode) => {
    if (!canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panelInteractionRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      x: panel.panelX ?? 50,
      y: panel.panelY ?? 52,
      width: panel.panelWidth ?? 88,
      height: panel.panelHeight ?? 78,
      bounds: canvasRef.current.getBoundingClientRect(),
    };
  };
  const updatePanelInteraction = (event, panel) => {
    const interaction = panelInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = ((event.clientX - interaction.startX) / interaction.bounds.width) * 100;
    const dy = ((event.clientY - interaction.startY) / interaction.bounds.height) * 100;
    if (interaction.mode === "move") {
      onUpdate(panel.id, {
        panelX: clampPercent(interaction.x + dx, interaction.width / 2, 100 - interaction.width / 2),
        panelY: clampPercent(interaction.y + dy, interaction.height / 2, 100 - interaction.height / 2),
      });
      return;
    }
    const width = clampPercent(interaction.width + dx * 2, 35, 96);
    const height = clampPercent(interaction.height + dy * 2, 30, 92);
    onUpdate(panel.id, {
      panelWidth: width,
      panelHeight: height,
      panelX: clampPercent(interaction.x, width / 2, 100 - width / 2),
      panelY: clampPercent(interaction.y, height / 2, 100 - height / 2),
    });
  };
  const endPanelInteraction = (event) => {
    if (panelInteractionRef.current?.pointerId === event.pointerId) panelInteractionRef.current = null;
  };
  const beginBackgroundInteraction = (event, mode = "move") => {
    if (!canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setBackgroundSelected(true);
    backgroundInteractionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: clampPercent(backgroundImageX, 0, 100),
      y: clampPercent(backgroundImageY, 0, 100),
      width: clampPercent(backgroundImageWidth, 10, 200),
      height: clampPercent(backgroundImageHeight, 10, 200),
      bounds: canvasRef.current.getBoundingClientRect(),
    };
  };
  const updateBackgroundInteraction = (event) => {
    const interaction = backgroundInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const deltaX = (event.clientX - interaction.startX) / interaction.bounds.width * 100;
    const deltaY = (event.clientY - interaction.startY) / interaction.bounds.height * 100;
    if (interaction.mode === "move") {
      onCanvasChange({
        backgroundImageX: clampPercent(interaction.x + deltaX, 0, 100),
        backgroundImageY: clampPercent(interaction.y + deltaY, 0, 100),
      });
      return;
    }
    const left = interaction.x - (interaction.width / 2);
    const top = interaction.y - (interaction.height / 2);
    const width = clampPercent(interaction.width + deltaX, 10, Math.min(200, 100 - left));
    const height = clampPercent(interaction.height + deltaY, 10, Math.min(200, 100 - top));
    onCanvasChange({
      backgroundImageWidth: width,
      backgroundImageHeight: height,
      backgroundImageX: clampPercent(left + (width / 2), width / 2, 100 - (width / 2)),
      backgroundImageY: clampPercent(top + (height / 2), height / 2, 100 - (height / 2)),
    });
  };
  const endBackgroundInteraction = (event) => {
    if (backgroundInteractionRef.current?.pointerId === event.pointerId) backgroundInteractionRef.current = null;
  };
  const beginBrandInteraction = (event) => {
    if (!canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setBrandSelected(true);
    brandInteractionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: brandX,
      y: brandY,
      bounds: canvasRef.current.getBoundingClientRect(),
    };
  };
  const updateBrandInteraction = (event) => {
    const interaction = brandInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    onCanvasChange({
      brandX: clampPercent(interaction.x + ((event.clientX - interaction.startX) / interaction.bounds.width * 100), 4, 96),
      brandY: clampPercent(interaction.y + ((event.clientY - interaction.startY) / interaction.bounds.height * 100), 7, 93),
    });
  };
  const endBrandInteraction = (event) => {
    if (brandInteractionRef.current?.pointerId === event.pointerId) brandInteractionRef.current = null;
  };
  const canvasClientWidth = canvasRef.current?.clientWidth || Math.max(1, canvasWidth || 1024);
  const canvasClientHeight = canvasRef.current?.clientHeight || Math.max(1, canvasHeight || 460);
  const selectedRotatedSize = selectedControl ? rotatedControlSize(
    selectedControl.width || CONTROL_DEFAULT_SIZES[selectedControl.kind]?.width || 112,
    selectedControl.height || CONTROL_DEFAULT_SIZES[selectedControl.kind]?.height || 122,
    selectedControl.rotation,
  ) : { width: 0, height: 0 };
  const selectedHalfWidth = selectedControl ? Math.min(50, (selectedRotatedSize.width / canvasClientWidth) * 50) : 0;
  const selectedHalfHeight = selectedControl ? Math.min(50, (selectedRotatedSize.height / canvasClientHeight) * 50) : 0;

  return (
    <div className="maker-interface-workspace mt-6">
      <aside className="maker-interface-sidebar" aria-label="Pengaturan desain plugin">
      <div className="maker-interface-panel maker-interface-brand rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Label & merek VST</div>
        <div className="maker-interface-brand-fields mt-4 grid gap-3 md:grid-cols-3">
          <label><FieldLabel>Nama plugin</FieldLabel><input value={pluginName} maxLength={48} onChange={(event) => onCanvasChange({ name: event.target.value })} className="maker-input mt-2" placeholder="Aurum Concert" /></label>
          <label><FieldLabel>Merek / developer</FieldLabel><input value={manufacturerName} maxLength={64} onChange={(event) => onCanvasChange({ manufacturerName: event.target.value })} className="maker-input mt-2" placeholder="Nama studio Anda" /></label>
          <label><FieldLabel>Tagline</FieldLabel><input value={brandTagline} maxLength={80} onChange={(event) => onCanvasChange({ brandTagline: event.target.value })} className="maker-input mt-2" placeholder="Signature Instrument" /></label>
        </div>
        <div className="maker-interface-brand-meta mt-3 grid gap-3 md:grid-cols-2">
          <label><FieldLabel>Versi plugin</FieldLabel><input value={pluginVersion} maxLength={20} onChange={(event) => onCanvasChange({ pluginVersion: event.target.value })} className="maker-input mt-2" placeholder="1.0.0" inputMode="numeric" /></label>
          <label><FieldLabel>{pluginKind === "effect" ? "Jenis plugin" : "Jenis instrumen"}</FieldLabel><select value={instrumentType} disabled={pluginKind === "effect"} onChange={(event) => onCanvasChange({ instrumentType: event.target.value })} className="maker-input mt-2">{["Audio Effect", "Sampler", "Synth", "Drum Pad", "Keys", "Piano", "Pluck", "Bass", "Strings", "Pads", "Percussion"].map((type) => <option key={type}>{type}</option>)}</select></label>
        </div>
        <div className="relative mt-4 max-w-sm" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setBrandFontPickerOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setBrandFontPickerOpen(false); }}>
          <FieldLabel>Jenis font brand</FieldLabel>
          <button type="button" aria-haspopup="listbox" aria-expanded={brandFontPickerOpen} onClick={() => setBrandFontPickerOpen((open) => !open)} className="maker-input mt-2 flex w-full items-center justify-between gap-3 text-left" style={{ fontFamily: selectedBrandFont.family }}>
            <span className="min-w-0"><span className="block truncate text-sm text-white">{selectedBrandFont.name}</span><span className="block truncate text-[9px] text-zinc-500">{selectedBrandFont.mood}</span></span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition ${brandFontPickerOpen ? "rotate-180" : ""}`} />
          </button>
          {brandFontPickerOpen && (
            <div role="listbox" aria-label="Jenis font brand" className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-[#111014] p-1.5 shadow-2xl shadow-black/60">
              {BRAND_FONT_OPTIONS.map((font) => (
                <button key={font.id} type="button" role="option" aria-selected={brandFont === font.id} onClick={() => { selectBrandFont(font.id); setBrandFontPickerOpen(false); }} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition ${brandFont === font.id ? "bg-white/[0.08] text-white" : "text-zinc-300 hover:bg-white/[0.05] hover:text-white"}`} style={{ fontFamily: font.family }}>
                  <span className="min-w-0"><span className="block truncate text-sm">{font.name}</span><span className="mt-0.5 block truncate text-[9px] text-zinc-500">{font.mood}</span></span>
                  {brandFont === font.id && <Check className="h-4 w-4 shrink-0" style={{ color: accentColor }} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="maker-interface-brand-layout mt-4 grid gap-4 rounded-xl border border-white/[0.06] bg-black/20 p-4 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="flex items-center justify-between gap-3"><FieldLabel>Ukuran nama plugin</FieldLabel><span className="font-mono text-[10px] text-zinc-400">{Math.round(brandSize)} px</span></div>
            <input type="range" min="12" max="64" value={brandSize} onChange={(event) => onCanvasChange({ brandSize: Number(event.target.value) })} className="maker-range mt-3 w-full" />
            <div className="mt-3 flex flex-wrap gap-2">{BRAND_POSITION_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => onCanvasChange({ brandX: preset.x, brandY: preset.y, brandAlign: preset.align })} className="rounded-lg border border-white/10 px-3 py-2 text-[9px] font-semibold text-zinc-400 hover:border-white/25 hover:text-white">{preset.label}</button>)}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label><FieldLabel>Posisi X</FieldLabel><input type="number" min="4" max="96" value={Math.round(brandX)} onChange={(event) => onCanvasChange({ brandX: clampPercent(event.target.value, 4, 96) })} className="maker-input mt-2" /></label>
            <label><FieldLabel>Posisi Y</FieldLabel><input type="number" min="7" max="93" value={Math.round(brandY)} onChange={(event) => onCanvasChange({ brandY: clampPercent(event.target.value, 7, 93) })} className="maker-input mt-2" /></label>
            <label><FieldLabel>Rata teks</FieldLabel><select value={brandAlign} onChange={(event) => onCanvasChange({ brandAlign: event.target.value })} className="maker-input mt-2"><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option></select></label>
          </div>
        </div>
        <p className="mt-3 text-[9px] leading-4 text-zinc-600">Semua pilihan memakai SIL Open Font License: boleh digunakan secara komersial dan label tetap berupa teks yang dapat ditulis ulang.</p>
      </div>
      <div className="maker-interface-panel maker-interface-canvas-settings rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Ukuran & background kanvas</div><div className="mt-1 text-[9px] text-zinc-600">Rentang 0–1024 px · nilai 0 mengikuti ruang workspace</div></div>
          <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[9px] text-zinc-500">{canvasWidth || "AUTO"} × {canvasHeight || "AUTO"}</span>
        </div>
        <div className="maker-interface-canvas-fields mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label><FieldLabel>Lebar kanvas (px)</FieldLabel><input type="number" min="0" max="1024" value={canvasWidth} onChange={(event) => onCanvasChange({ canvasWidth: Math.max(0, Math.min(1024, Number(event.target.value) || 0)) })} className="maker-input mt-2" /></label>
          <label><FieldLabel>Tinggi kanvas (px)</FieldLabel><input type="number" min="0" max="1024" value={canvasHeight} onChange={(event) => onCanvasChange({ canvasHeight: Math.max(0, Math.min(1024, Number(event.target.value) || 0)) })} className="maker-input mt-2" /></label>
          <label><FieldLabel>Penempatan gambar</FieldLabel><select value={backgroundFit} onChange={(event) => onCanvasChange({ backgroundFit: event.target.value })} className="maker-input mt-2"><option value="cover">Cover</option><option value="contain">Contain</option><option value="stretch">Stretch</option></select></label>
          <label><FieldLabel>Opacity · {backgroundOpacity}%</FieldLabel><input type="range" min="0" max="100" value={backgroundOpacity} onChange={(event) => onCanvasChange({ backgroundOpacity: Number(event.target.value) })} className="maker-range mt-5 w-full" /></label>
        </div>
      </div>
      </aside>
      <div className="maker-interface-main">
      <div className="maker-interface-stage">
        <div className="maker-interface-preview maker-interface-preview-stack">
          <div className="maker-interface-preview-toolbar rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] text-zinc-500">
            <div className="maker-preview-toolbar-main">
              <div className="inline-flex overflow-hidden rounded-lg border border-white/10">
                <button type="button" onClick={onUndo} disabled={!canUndo} className="inline-flex h-8 items-center gap-1.5 px-2.5 font-semibold text-zinc-300 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30" aria-label="Urungkan perubahan Designer" title="Undo (Ctrl/Cmd + Z)"><Undo2 className="h-3.5 w-3.5" /> Undo</button>
                <button type="button" onClick={onRedo} disabled={!canRedo} className="inline-flex h-8 items-center gap-1.5 border-l border-white/10 px-2.5 font-semibold text-zinc-300 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30" aria-label="Ulangi perubahan Designer" title="Redo (Ctrl/Cmd + Shift + Z)"><Redo2 className="h-3.5 w-3.5" /> Redo</button>
              </div>
              <span className="text-[9px] text-zinc-600">Ctrl/Cmd + D untuk duplikat pilihan</span>
              {backgroundImageUrl && <><span className="ml-auto text-zinc-300">Background {Math.round(backgroundImageWidth)}% × {Math.round(backgroundImageHeight)}%</span><span>· tarik gambar untuk memindahkan</span><span>· tarik sudut kanan bawah untuk resize</span><button type="button" onClick={() => onCanvasChange({ backgroundImageX: 50, backgroundImageY: 50, backgroundImageWidth: 100, backgroundImageHeight: 100 })} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[9px] font-semibold text-zinc-300 hover:bg-white/5">Reset ukuran</button></>}
              {previewActions && <div className="maker-preview-project-actions">{previewActions}</div>}
            </div>
            <div className="maker-preview-toolbar-snap-row">
              <div className="maker-grid-snap-compact" role="group" aria-label="Pengaturan Grid Snap">
                <button
                  type="button"
                  aria-pressed={gridSnapEnabled}
                  aria-label={gridSnapEnabled ? "Nonaktifkan Grid Snap" : "Aktifkan Grid Snap"}
                  title={gridSnapEnabled ? "Grid Snap aktif · klik untuk menonaktifkan" : "Grid Snap nonaktif · klik untuk mengaktifkan"}
                  onClick={() => onCanvasChange({ gridSnapEnabled: !gridSnapEnabled })}
                  className={`maker-grid-snap-toggle ${gridSnapEnabled ? "is-active" : ""}`}
                >
                  <span className="maker-cubase-snap-icon" aria-hidden="true">
                    <Magnet />
                    <span className="maker-cubase-snap-grid"><i /><i /><i /><i /></span>
                  </span>
                </button>
                {GRID_SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    type="button"
                    disabled={!gridSnapEnabled}
                    aria-pressed={gridSnapEnabled && gridSize === size}
                    aria-label={`Grid ${size} piksel`}
                    title={`Ukuran grid ${size} px`}
                    onClick={() => onCanvasChange({ gridSize: size })}
                    className={`maker-grid-size-compact ${gridSnapEnabled && gridSize === size ? "is-selected" : ""}`}
                  >{size}</button>
                ))}
              </div>
              <button
                type="button"
                aria-pressed={resizeAspectLocked}
                aria-label={resizeAspectLocked ? "Gunakan resize bebas" : "Kunci rasio resize"}
                title={resizeAspectLocked ? "Resize konstan · rasio komponen dikunci" : "Resize bebas · lebar dan tinggi terpisah"}
                onClick={() => onCanvasChange({ resizeAspectLocked: !resizeAspectLocked })}
                className={`maker-resize-mode-toggle ${resizeAspectLocked ? "is-locked" : "is-free"}`}
              >
                {resizeAspectLocked ? <Lock aria-hidden="true" /> : <Unlock aria-hidden="true" />}
              </button>
            </div>
          </div>
        <div ref={previewViewportRef} className="maker-plugin-canvas-viewport min-w-0">
          <div className="maker-plugin-canvas-scaler" style={{ width: `${canvasBaseWidth * previewScale}px`, height: `${canvasBaseHeight * previewScale}px` }}>
          <div
            ref={canvasRef}
            className={`maker-plugin-canvas maker-plugin-canvas--${uiTemplate} maker-plugin-canvas--project-${projectTemplate} ${gridSnapEnabled ? "is-grid-snap" : "is-grid-free"} ${projectTemplate === "neonpopdrums" ? "maker-plugin-canvas--neon-pop-drums" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) onSelect(null);
            }}
            style={{ "--maker-accent": accentColor, "--maker-ui-color": uiColor, "--maker-canvas-bg": uiColor, "--maker-canvas-header": `color-mix(in srgb, ${uiColor} 88%, black)`, "--maker-control-bg": `color-mix(in srgb, ${uiColor} 76%, #18181f)`, "--maker-control-border": `color-mix(in srgb, ${uiColor} 82%, white)`, "--maker-grid-line": `color-mix(in srgb, ${uiColor} 94%, white)`, "--maker-brand-font": BRAND_FONT_OPTIONS.find((font) => font.id === brandFont)?.family || "Outfit, sans-serif", "--maker-grid-size": `${gridSize}px`, width: `${canvasBaseWidth}px`, height: `${canvasBaseHeight}px`, minHeight: `${canvasBaseHeight}px`, transform: `scale(${previewScale})` }}
            aria-label="Panel plugin. Seret komponen untuk memasang atau memindahkannya."
          >
            {backgroundImageUrl && <div
              className={`maker-plugin-canvas__background ${backgroundSelected ? "is-selected" : ""}`}
              onClick={(event) => { event.stopPropagation(); setBackgroundSelected(true); }}
              onPointerDown={(event) => beginBackgroundInteraction(event, "move")}
              onPointerMove={updateBackgroundInteraction}
              onPointerUp={endBackgroundInteraction}
              onPointerCancel={endBackgroundInteraction}
              style={{ left: `${backgroundImageX}%`, top: `${backgroundImageY}%`, width: `${backgroundImageWidth}%`, height: `${backgroundImageHeight}%`, backgroundImage: `url(${JSON.stringify(backgroundImageUrl)})`, backgroundSize: backgroundFit === "stretch" ? "100% 100%" : backgroundFit, opacity: backgroundOpacity / 100 }}
              aria-label="Background desain, tarik untuk memindahkan"
            >
              {backgroundSelected && (
                <button
                  type="button"
                  className="maker-canvas-control__replace maker-plugin-canvas__background-replace"
                  title="Pilih template background"
                  aria-label="Ganti background"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setBackgroundTemplatePickerOpen(true);
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="maker-plugin-canvas__background-resize"
                aria-label="Ubah ukuran background desain"
                title="Tarik untuk mengubah ukuran background"
                onPointerDown={(event) => beginBackgroundInteraction(event, "resize")}
                onPointerMove={updateBackgroundInteraction}
                onPointerUp={endBackgroundInteraction}
                onPointerCancel={endBackgroundInteraction}
              />
            </div>}
            <div className="maker-plugin-canvas__header">
              <span className="maker-plugin-canvas__brand">DESIGN PREVIEW</span>
              <span className="maker-plugin-canvas__hint">Ctrl/Cmd + klik: pilih/lepas · tahan + seret: pindah bersama tanpa grid</span>
            </div>
            <div
              className={`maker-plugin-canvas__brand-object ${brandSelected ? "is-selected" : ""}`}
              style={{ left: `${brandX}%`, top: `${brandY}%`, fontSize: `${brandSize}px`, textAlign: brandAlign, fontFamily: selectedBrandFont.family }}
              onClick={(event) => { event.stopPropagation(); setBrandSelected(true); }}
              onPointerDown={beginBrandInteraction}
              onPointerMove={updateBrandInteraction}
              onPointerUp={endBrandInteraction}
              onPointerCancel={endBrandInteraction}
              title="Seret untuk memindahkan merek"
            >
              <strong>{pluginName || "UNTITLED INSTRUMENT"}</strong>
              <span>{manufacturerName || "YOUR BRAND"}</span>
              {brandTagline && <small>{brandTagline}</small>}
            </div>
            {openPanel && (
              <section
                className="maker-functional-panel"
                data-vst-panel={openPanel.id}
                style={{
                  left: `${(openPanel.panelX ?? 50) - (openPanel.panelWidth ?? 88) / 2}%`,
                  top: `${(openPanel.panelY ?? 52) - (openPanel.panelHeight ?? 78) / 2}%`,
                  width: `${openPanel.panelWidth ?? 88}%`,
                  height: `${openPanel.panelHeight ?? 78}%`,
                  "--maker-accent": accentColor,
                }}
              >
                <header
                  onPointerDown={(event) => beginPanelInteraction(event, openPanel, "move")}
                  onPointerMove={(event) => updatePanelInteraction(event, openPanel)}
                  onPointerUp={endPanelInteraction}
                  onPointerCancel={endPanelInteraction}
                >
                  <span>{openPanel.label}</span>
                  <small>{openPanel.panelType === "preset_browser" ? "PRESET BROWSER" : openPanel.panelType === "mixer" ? "MIXER" : "GROOVE BROWSER"}</small>
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setOpenPanelId(null); onSelect(openPanel.id); }} aria-label="Tutup panel"><X size={15} /></button>
                </header>
                <PanelFeatureContent
                  panel={openPanel}
                  controls={controls}
                  engineModules={engineModules}
                  presets={presets}
                  midiSequences={midiSequences}
                  midiTransport={midiTransport}
                  samplerGroups={samplerGroups}
                  onUpdateMany={onUpdateMany}
                  onFeatureChange={onFeatureChange}
                />
                <button
                  type="button"
                  className="maker-functional-panel__resize"
                  aria-label="Ubah ukuran panel"
                  onPointerDown={(event) => beginPanelInteraction(event, openPanel, "resize")}
                  onPointerMove={(event) => updatePanelInteraction(event, openPanel)}
                  onPointerUp={endPanelInteraction}
                  onPointerCancel={endPanelInteraction}
                />
              </section>
            )}
            {visibleControls.map((control) => {
              const canvasPosition = canvasPositionFor(control);
              return (
              <article
                key={control.id}
                data-vst-control={control.id}
                className={`maker-canvas-control maker-canvas-control--${control.kind} maker-label-position--${normalizeLabelPosition(control.labelPosition ?? control.label_position)} ${control.parentPanelId ? "is-panel-child" : ""} ${["hit-effect", "diffuse-hit", "smooth-diffuse-hit"].includes(control.component_variant) ? "maker-canvas-control--hit-pad" : ""} ${projectTemplate === "neonpopdrums" && control.kind === "pad" && !["hit-effect", "diffuse-hit", "smooth-diffuse-hit"].includes(control.component_variant) ? "maker-canvas-control--drum-hotspot" : ""} ${selectedControlIdSet.has(control.id) ? "is-selected" : ""} ${selectedControlId === control.id ? "is-primary-selected" : ""} ${control.showBackground === false ? "is-background-hidden" : ""} ${PRISM_CONTEXT_PARAMETERS.has(control.parameter) && prismContextModeFor(control) !== "contextual" ? "is-prism-context-hidden" : ""} ${PRISM_CONTEXT_PARAMETERS.has(control.parameter) && !selectedPrismBandEnabled ? "is-prism-context-disabled" : ""}`}
                style={{ left: `${canvasPosition.x}%`, top: `${canvasPosition.y}%`, width: `${control.width ?? CONTROL_DEFAULT_SIZES[control.kind]?.width ?? 112}px`, height: `${control.height ?? CONTROL_DEFAULT_SIZES[control.kind]?.height ?? 122}px`, zIndex: (control.parentPanelId ? 300 : 10) + (surfaceLayerIndex.get(control.id) || 0), "--maker-accent": accentColor, "--maker-label-gap": normalizeLabelGap(control.labelGap ?? control.label_gap), "--maker-component-opacity": Math.max(0, Math.min(100, Number(control.opacity ?? 100))) / 100, "--maker-component-rotation": `${normalizeComponentRotation(control.rotation)}deg` }}
                aria-selected={selectedControlIdSet.has(control.id)}
                onPointerDownCapture={(event) => beginControlSelectionGesture(event, control)}
                onPointerMoveCapture={updateControlSelectionGesture}
                onPointerUpCapture={endControlSelectionGesture}
                onPointerCancelCapture={cancelControlSelectionGesture}
              >
                <span className="maker-canvas-control__frame" aria-hidden="true" />
                <div
                  className="maker-canvas-control__handle"
                  onPointerDown={(event) => beginCanvasInteraction(event, control, "move")}
                  onPointerMove={(event) => updateCanvasInteraction(event, control)}
                  onPointerUp={endCanvasInteraction}
                  onPointerCancel={endCanvasInteraction}
                >
                  <span>{control.label ?? INTERFACE_CONTROL_OPTIONS.find((option) => option.id === control.kind)?.label}</span>
                  <span className="maker-canvas-control__drag-mark" aria-hidden="true">⠿</span>
                </div>
                {!PRISM_CONTEXT_PARAMETERS.has(control.parameter) && <button
                  type="button"
                  className="maker-canvas-control__delete"
                  aria-label={shouldRemoveSelectedCanvasControls(control.id, selectedControlIds)
                    ? `Hapus ${selectedControlIds.length} komponen terpilih`
                    : `Hapus ${control.label || INTERFACE_CONTROL_OPTIONS.find((option) => option.id === control.kind)?.label || "komponen"}`}
                  title={shouldRemoveSelectedCanvasControls(control.id, selectedControlIds) ? `Hapus ${selectedControlIds.length} komponen terpilih` : "Hapus komponen"}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (shouldRemoveSelectedCanvasControls(control.id, selectedControlIds)) onRemoveSelected();
                    else onRemove(control.id);
                  }}
                ><X aria-hidden="true" /></button>}
                {selectedControlId === control.id && replacementVariantsFor(control).length > 1 && (
                  <button
                    type="button"
                    className="maker-canvas-control__replace"
                    aria-label={`Ganti komponen ${control.label}`}
                    title="Ganti komponen"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelect(control.id);
                      setReplaceControlId(control.id);
                    }}
                  ><RotateCcw aria-hidden="true" /></button>
                )}
                {control.kind === "panel_button" ? (
                  <button type="button" className={`maker-panel-launcher maker-panel-launcher--${control.panelType} ${openPanelId === control.id ? "is-open" : ""}`} onClick={() => { setOpenPanelId((current) => current === control.id ? null : control.id); onSelect(control.id); }}>
                    <span>{control.panelType === "preset_browser" ? "PRESETS" : control.panelType === "mixer" ? "MIXER" : "MIDI"}</span>
                    <small>{openPanelId === control.id ? "CLOSE" : "OPEN"}</small>
                  </button>
                ) : control.kind === "button" || control.kind === "solo" || control.kind === "mute" ? (
                  <FilmstripButton
                    value={control.value}
                    label={control.label}
                    offLabel={control.off_label}
                    onLabel={control.on_label}
                    inverted={control.parameter === "bypass"}
                    kind={control.kind}
                    variant={control.component_variant || "classic"}
                    asset={filmstripAssetFor(control, componentStyle, "button")}
                    onChange={(value) => onUpdate(control.id, { value })}
                  />
                ) : control.kind === "knob" ? (
                  <RotaryKnob
                    value={PRISM_CONTEXT_PARAMETERS.has(control.parameter) ? prismContextValue(control) : control.value}
                    valueText={PRISM_CONTEXT_PARAMETERS.has(control.parameter) ? prismContextValueText(control) : undefined}
                    disabled={PRISM_CONTEXT_PARAMETERS.has(control.parameter) && (!selectedPrismBandEnabled || ((control.prismContext ?? control.prism_context) === "gain" && selectedPrismBandIndex === 1))}
                    neutralValue={neutralControlValue(control, projectTemplate)} label={control.label}
                    variant={control.component_variant || "classic"} asset={filmstripAssetFor(control, componentStyle, "knob")}
                    onChange={(value) => {
                      if (PRISM_CONTEXT_PARAMETERS.has(control.parameter)) updatePrismContext(control, value);
                      else onUpdate(control.id, {
                        value,
                        ...(projectTemplate === "prismeq" && control.parameter === "tone" ? { frequency: prismSliderToFrequency(value * 10) } : {}),
                      });
                    }}
                  />
                ) : control.kind === "fader" && ["pitch_bend", "modulation"].includes(control.parameter) ? (
                  <KeyboardPerformanceWheel
                    value={control.parameter === "pitch_bend" ? (pitchBendEnabled ? (pitchBendValue ?? control.value) : 50) : (modulationEnabled ? (modulationValue ?? control.value) : 0)}
                    label={control.label}
                    spring={control.parameter === "pitch_bend"}
                    led={['pitch-bend-led', 'modulation-led'].includes(control.component_variant)}
                    color={control.controlColor ?? control.control_color ?? accentColor}
                    disabled={control.parameter === "pitch_bend" ? !pitchBendEnabled : !modulationEnabled}
                    onChange={control.parameter === "pitch_bend" ? (onPitchBendChange || ((value) => onUpdate(control.id, { value }))) : (onModulationChange || ((value) => onUpdate(control.id, { value })))}
                  />
                ) : control.kind === "fader" ? (
                  <FilmstripFader
                    value={control.value}
                    neutralValue={neutralControlValue(control, projectTemplate)}
                    valueText={faderValueText(control)}
                    showUnityMarker={["input", "output"].includes(String(control.parameter || "").toLowerCase())}
                    label={control.label}
                    variant={control.component_variant || "classic"}
                    asset={filmstripAssetFor(control, componentStyle, "fader")}
                    onChange={(value) => onUpdate(control.id, { value })}
                  />
                ) : control.kind === "pad" ? (
                  <SamplerPad
                    controlId={control.id}
                    label={control.label}
                    notePitch={control.notePitch ?? 60}
                    velocity={velocity}
                    accentColor={accentColor}
                    padColor={control.padColor ?? control.pad_color}
                    padActiveColor={control.padActiveColor ?? control.pad_active_color}
                    variant={control.component_variant || "rubber"}
                    externalPressed={activeHitPitches.has(control.notePitch ?? 60) || midiPressedPitches.has(control.notePitch ?? 60)}
                    onNoteOn={onNoteOn}
                    onNoteOff={onNoteOff}
                  />
                ) : control.kind === "keyboard" ? (
                  <SamplerKeyboard
                    compact
                    fitWidth
                    externalPressedPitches={midiPressedPitches}
                    keyboardPitches={Array.from({ length: control.keyCount ?? keyboardKeys }, (_, index) => 36 + index)}
                    tokenNamespace={`plugin-${control.id}`}
                    accentColor={accentColor}
                    variant={control.component_variant || "classic"}
                    velocity={velocity}
                    sustainEnabled={sustainEnabled}
                    onNoteOn={onNoteOn}
                    onNoteOff={onNoteOff}
                  />
                ) : control.kind === "gain_meter" || control.kind === "vu_meter" ? (
                  <PreviewOutputMeter captureLevel={control.captureLevel} kind={control.kind} meterSource={control.parameter} moduleId={control.moduleId} meterMode={control.meterMode ?? control.meter_mode ?? (control.kind === "gain_meter" ? "stereo" : "mono")} variant={control.component_variant || (control.kind === "vu_meter" ? "dark-vu" : "led")} analyserRef={meterAnalyserRef} accentColor={accentColor} asset={filmstripAssetFor(control, componentStyle, "meter")} />
                ) : control.kind === "image" ? (
                  <img
                    src={control.imageUrl ?? control.image_url}
                    alt={control.label || control.imageName || control.image_name || "Gambar"}
                    draggable="false"
                    className="maker-canvas-image-component"
                    style={{ objectFit: (control.imageFit ?? control.image_fit) === "stretch" ? "fill" : (control.imageFit ?? control.image_fit) || "contain", opacity: (Math.max(0, Math.min(100, Number(control.imageOpacity ?? control.image_opacity ?? 100))) / 100) * (Math.max(0, Math.min(100, Number(control.opacity ?? 100))) / 100) }}
                  />
                ) : control.kind === "spectrum" ? (
                  control.component_variant === "stereo-vectorscope" ? (
                    <StereoVectorscopeDisplay analyserRef={meterAnalyserRef} accentColor={control.visualColor ?? control.visual_color ?? accentColor} showCorrelationMeter={control.showCorrelationMeter !== false && control.show_correlation_meter !== false} />
                  ) : (
                    <PrismSpectrumDisplay
                      analyserRef={meterAnalyserRef}
                      prismModule={engineModules.find((module) => module.id === control.moduleId && module.type === "prism_eq") || engineModules.find((module) => module.type === "prism_eq")}
                      selectedBandIndex={selectedPrismBandIndex}
                      accentColor={control.visualColor ?? control.visual_color ?? accentColor}
                      interactive={control.component_variant !== "pure-spectrum"}
                      onBandSelect={setSelectedPrismBandIndex}
                      onBandDelete={(bandIndex, remainingIndices) => {
                        const nearest = remainingIndices.reduce((best, index) => best === null || Math.abs(index - bandIndex) < Math.abs(best - bandIndex) ? index : best, null);
                        setSelectedPrismBandIndex(nearest || 0);
                      }}
                      onParameterChange={(parameter, value) => {
                        const prismModule = engineModules.find((module) => module.id === control.moduleId && module.type === "prism_eq") || engineModules.find((module) => module.type === "prism_eq");
                        if (!prismModule) return;
                        const parameterUpdates = typeof parameter === "object" ? parameter : { [parameter]: value };
                        onFeatureChange({ engineModules: normalizeDspRack(engineModules.map((module) => module.id === prismModule.id
                          ? { ...module, parameters: { ...module.parameters, ...Object.fromEntries(Object.entries(parameterUpdates).map(([key, nextValue]) => [key, Math.max(0, Math.min(1, Number(nextValue) || 0))])) } }
                          : module)) });
                      }}
                      style={{ inset: 0 }}
                    />
                  )
                ) : control.kind === "visual" ? (
                  <ScaleRing variant={control.component_variant || "scale-classic"} color={control.visualColor ?? control.visual_color ?? "#E8E0CF"} />
                ) : control.kind === "text" ? (
                  <div className="maker-canvas-text-component" style={{ color: control.textColor ?? control.text_color ?? "#F4F4F5", fontFamily: BRAND_FONT_OPTIONS.find((font) => font.id === (control.textFont ?? control.text_font))?.family || BRAND_FONT_OPTIONS[2].family }}>{control.label || "Text"}</div>
                ) : null}
                {control.kind === "keyboard" && (
                  <button
                    type="button"
                    className="maker-canvas-control__resize-width"
                    aria-label={`Ubah lebar ${control.label}`}
                    title="Tarik ke kiri atau kanan untuk mengubah lebar"
                    onPointerDown={(event) => beginCanvasInteraction(event, control, "resize-width")}
                    onPointerMove={(event) => updateCanvasInteraction(event, control)}
                    onPointerUp={endCanvasInteraction}
                    onPointerCancel={endCanvasInteraction}
                  />
                )}
                <button
                  type="button"
                  className="maker-canvas-control__resize"
                  aria-label={`Ubah ukuran ${control.label}`}
                  title="Tarik untuk mengubah ukuran"
                  onPointerDown={(event) => beginCanvasInteraction(event, control, "resize")}
                  onPointerMove={(event) => updateCanvasInteraction(event, control)}
                  onPointerUp={endCanvasInteraction}
                  onPointerCancel={endCanvasInteraction}
                />
              </article>
            );})}
            {!controls.length && (
              <div className="maker-plugin-canvas__empty">
                <Sliders className="h-6 w-6" />
                <span>Panel masih kosong</span>
                <span className="text-[10px] text-zinc-600">Gunakan tombol Tambah komponen di bawah preview</span>
              </div>
            )}
            {componentPickerOpen && (
              <div className="maker-component-replace-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setComponentPickerOpen(false); }}>
                <section className="maker-component-replace-dialog maker-component-add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-component-dialog-title">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div id="add-component-dialog-title" className="text-sm font-bold text-white">Tambah komponen</div>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-500">Pilih kategori, lalu pilih bentuk komponen yang ingin ditambahkan ke panel.</p>
                    </div>
                    <button type="button" onClick={() => setComponentPickerOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Tutup pilihan komponen"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="maker-component-add-categories mt-4" role="tablist" aria-label="Kategori komponen">
                    {availableComponentCategories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        role="tab"
                        aria-selected={componentCategory === category.id}
                        onClick={() => setComponentCategory(category.id)}
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                  <div className="maker-component-replacer mt-4" style={{ "--maker-accent": accentColor }}>
                    {addComponentVariants.map((variant) => (
                      <button
                        key={componentVariantKey(variant)}
                        type="button"
                        className="maker-gallery-card"
                        disabled={ordinaryInterfaceControlCount(controls) >= MAX_INTERFACE_CONTROLS}
                        aria-label={`Tambah ${variant.label}`}
                        onClick={() => {
                          const panelChildren = openPanelId ? controls.filter((control) => control.parentPanelId === openPanelId) : [];
                          const childIndex = panelChildren.length;
                          onAdd(variant.kind, null, variant.style, variant.id, variant.kind !== "panel_button" && openPanelId ? {
                            parentPanelId: openPanelId,
                            x: 18 + (childIndex % 4) * 22,
                            y: 34 + (Math.floor(childIndex / 4) % 3) * 24,
                          } : {});
                          setComponentPickerOpen(false);
                          setComponentCategory("knob");
                        }}
                      >
                        <CreditCoinBadge value={componentCreditPrice(variant.kind, variant.id, pricing)} />
                        <ComponentThumbnail variant={variant} />
                        <span className="maker-gallery-card__title">{variant.label}</span>
                        <span className="maker-gallery-card__detail"><span>{variant.detail}</span><Plus aria-hidden="true" size={13} /></span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-4 text-[9px] text-zinc-600">{ordinaryInterfaceControlCount(controls)}/{MAX_INTERFACE_CONTROLS} komponen digunakan · kontrol kontekstual Prism tidak dihitung</p>
                </section>
              </div>
            )}
            {backgroundTemplatePickerOpen && (
              <div className="maker-component-replace-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setBackgroundTemplatePickerOpen(false); }}>
                <section className="maker-component-replace-dialog maker-background-template-dialog" role="dialog" aria-modal="true" aria-labelledby="background-template-picker-title">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div id="background-template-picker-title" className="text-sm font-bold text-white">Pilih template background</div>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-500">Ganti gambar tanpa mengubah posisi, ukuran, opacity, atau komponen pada panel.</p>
                    </div>
                    <button type="button" onClick={() => setBackgroundTemplatePickerOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Tutup pilihan background"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="maker-background-template-grid mt-4">
                    {BACKGROUND_TEMPLATE_OPTIONS.map((template) => {
                      const selected = backgroundImageUrl === template.backgroundUrl;
                      return (
                        <button
                          key={template.id}
                          type="button"
                          className={`maker-background-template-card ${selected ? "is-selected" : ""}`}
                          aria-pressed={selected}
                          onClick={() => {
                            onCanvasChange({ backgroundImageUrl: template.backgroundUrl, backgroundImageName: template.backgroundName || `${template.name} Background` });
                            setBackgroundTemplatePickerOpen(false);
                            setBackgroundSelected(true);
                          }}
                        >
                          <span className="maker-background-template-card__preview" style={{ backgroundImage: `url(${template.backgroundUrl})` }} />
                          <span className="maker-background-template-card__info"><span>{template.backgroundName || template.name}</span>{selected ? <Check aria-label="Sedang digunakan" size={14} /> : <small>Pilih</small>}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
            {replaceControl && replaceControlVariants.length > 1 && (
              <div className="maker-component-replace-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setReplaceControlId(null); }}>
                <section className="maker-component-replace-dialog" role="dialog" aria-modal="true" aria-labelledby={`replace-component-label-${replaceControl.id}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div id={`replace-component-label-${replaceControl.id}`} className="text-sm font-bold text-white">Ganti komponen · {replaceControl.label}</div>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-500">Pilih tampilan baru. Fungsi, posisi, ukuran, dan nilainya tidak berubah.</p>
                    </div>
                    <button type="button" onClick={() => setReplaceControlId(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Tutup pilihan komponen"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="maker-component-replacer mt-4">
                    {replaceControlVariants.map((variant) => {
                      const selected = replaceVariantId === variant.id;
                      return (
                        <button
                          key={componentVariantKey(variant)}
                          type="button"
                          className="maker-gallery-card"
                          aria-pressed={selected}
                          onClick={() => {
                            const prismModule = variant.kind === "spectrum" && variant.id === "realtime-spectrum"
                              ? engineModules.find((module) => module.type === "prism_eq")
                              : null;
                            const prismModuleId = prismModule?.id || (variant.kind === "spectrum" && variant.id === "realtime-spectrum" ? makeId() : null);
                            if (prismModuleId && !prismModule) onFeatureChange({ engineModules: appendDspRackModule(engineModules, "prism_eq", prismModuleId) });
                            onUpdate(replaceControl.id, {
                              component_style: variant.style,
                              component_variant: variant.id,
                              ...(prismModuleId ? { moduleId: prismModuleId, parameter: "output_level" } : {}),
                              ...(["pitch-bend-led", "modulation-led"].includes(variant.id) && !isHexColor(replaceControl.controlColor ?? replaceControl.control_color) ? { controlColor: accentColor } : {}),
                              ...(variant.showBackground !== undefined ? { showBackground: variant.showBackground } : {}),
                            });
                            setReplaceControlId(null);
                          }}
                        >
                          <CreditCoinBadge value={componentCreditPrice(variant.kind, variant.id, pricing)} />
                          <ComponentThumbnail variant={variant} />
                          <span className="maker-gallery-card__title">{variant.label}</span>
                          <span className="maker-gallery-card__detail"><span>{variant.detail}</span>{selected ? <Check aria-label="Sedang digunakan" size={13} /> : <span>Pilih</span>}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={ordinaryInterfaceControlCount(controls) >= MAX_INTERFACE_CONTROLS}
            onClick={() => {
              setComponentCategory("knob");
              setComponentPickerOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-[#e11d48] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#be123c] disabled:cursor-not-allowed disabled:opacity-40"
            aria-haspopup="dialog"
          >
            <Plus className="h-3.5 w-3.5" /> Tambah komponen
          </button>
          {imageUploadEnabled && <label className={`inline-flex items-center gap-2 rounded-xl border border-sky-300/20 bg-sky-300/[0.07] px-4 py-2.5 text-xs font-bold text-sky-200 hover:bg-sky-300/10 ${componentImageUploading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={componentImageUploading} onChange={(event) => { uploadCanvasImage(event.target.files?.[0]); event.target.value = ""; }} />
            {componentImageUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {componentImageUploading ? "Mengunggah gambar…" : <>Upload gambar · +{componentCreditPrice("image", "default", pricing)} kredit</>}
          </label>}
          {customBackgroundEnabled ? <label className={`inline-flex items-center gap-2 rounded-xl bg-[#e11d48] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#be123c] ${backgroundUploading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={backgroundUploading} onChange={(event) => { uploadCanvasBackground(event.target.files?.[0]); event.target.value = ""; }} />
            {backgroundUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {backgroundUploading ? "Mengunggah…" : <>{backgroundImageUrl ? "Ganti background" : "Upload background"} · {isCustomVstBackground(backgroundImageUrl) ? "harga tetap " : "+"}{pricing.custom_background_credits} kredit</>}
          </label> : <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-zinc-500">
            <Upload className="h-3.5 w-3.5" /> Upload background tersedia mulai paket Pro
          </span>}
          {backgroundImageUrl && <button type="button" onClick={() => onCanvasChange({ backgroundImageUrl: "", backgroundImageName: "" })} className="rounded-xl border border-red-400/15 px-4 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-400/10">Hapus background</button>}
          <span className="min-w-0 truncate text-[10px] text-zinc-600">{backgroundImageName || "JPG, PNG, atau WebP · maks. 10 MB"}</span>
        </div>
        </div>
      </div>

      <div className="maker-interface-right-panel">
      {selectedControl ? (
        <div className="maker-interface-inspector grid gap-3 rounded-2xl border border-[#fb7185]/15 bg-[#111014] p-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#fb7185]">Pengaturan komponen terpilih</div>
            <div className="mt-1 text-xs font-semibold text-white">{selectedControl.label}{selectedControlIds.length > 1 ? ` · ${selectedControlIds.length} komponen dipilih` : ""}</div>
            <p className="mt-1 text-[9px] leading-4 text-zinc-600">Atur fungsi, posisi, dan ukuran komponen yang dipilih pada preview.</p>
          </div>
          <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <FieldLabel>Urutan lapisan</FieldLabel>
                <p className="mt-1 text-[9px] text-zinc-500">Lapisan {selectedLayerIndex + 1} dari {selectedSurfaceControls.length} · urutan ini ikut dipakai pada hasil VST.</p>
              </div>
              <div className="flex items-center gap-2" role="group" aria-label="Atur urutan lapisan komponen">
                <button type="button" onClick={() => onMoveLayer?.("backward")} disabled={!canMoveLayerBackward} className="inline-flex items-center gap-1.5 rounded-full border border-[#fb7185]/40 bg-[#e11d48] px-3.5 py-2 text-[10px] font-bold text-white shadow-[0_8px_20px_rgba(225,29,72,0.2)] transition hover:bg-[#be123c] hover:shadow-[0_10px_24px_rgba(225,29,72,0.3)] disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none" title="Pindahkan ke lapisan paling belakang">
                  <ArrowDown className="h-3.5 w-3.5" /> Ke belakang
                </button>
                <button type="button" onClick={() => onMoveLayer?.("forward")} disabled={!canMoveLayerForward} className="inline-flex items-center gap-1.5 rounded-full border border-[#fb7185]/40 bg-[#e11d48] px-3.5 py-2 text-[10px] font-bold text-white shadow-[0_8px_20px_rgba(225,29,72,0.2)] transition hover:bg-[#be123c] hover:shadow-[0_10px_24px_rgba(225,29,72,0.3)] disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none" title="Pindahkan ke lapisan paling depan">
                  <ArrowUp className="h-3.5 w-3.5" /> Ke depan
                </button>
              </div>
            </div>
          </div>
          <label>
            <FieldLabel>{selectedControl.kind === "text" ? "Isi text" : "Label komponen"}</FieldLabel>
            <input className="maker-input mt-2" value={selectedControl.label} maxLength={selectedControl.kind === "text" ? 80 : 24} onChange={(event) => onUpdate(selectedControl.id, { label: event.target.value })} />
          </label>
          {selectedControl.kind === "text" && <label>
            <FieldLabel>Font text</FieldLabel>
            <select className="maker-input mt-2" value={selectedControl.textFont ?? selectedControl.text_font ?? "space-grotesk"} onChange={(event) => onUpdate(selectedControl.id, { textFont: event.target.value })}>
              {BRAND_FONT_OPTIONS.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
            </select>
          </label>}
          {selectedControl.kind === "text" && <label>
            <FieldLabel>Warna text</FieldLabel>
            <span className="mt-2 flex items-center gap-2">
              <input type="color" className="maker-color-input" value={isHexColor(selectedControl.textColor ?? selectedControl.text_color) ? (selectedControl.textColor ?? selectedControl.text_color) : "#F4F4F5"} onChange={(event) => onUpdate(selectedControl.id, { textColor: event.target.value })} />
              <span className="font-mono text-[10px] uppercase text-zinc-400">{isHexColor(selectedControl.textColor ?? selectedControl.text_color) ? (selectedControl.textColor ?? selectedControl.text_color) : "#F4F4F5"}</span>
            </span>
          </label>}
          {selectedControl.kind !== "text" && <label>
            <FieldLabel>Posisi label</FieldLabel>
            <select className="maker-input mt-2" value={normalizeLabelPosition(selectedControl.labelPosition ?? selectedControl.label_position)} onChange={(event) => onUpdate(selectedControl.id, { labelPosition: event.target.value })}>
              {LABEL_POSITION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>}
          {selectedControl.kind !== "text" && <label>
            <FieldLabel>Jarak label ke komponen · {normalizeLabelGap(selectedControl.labelGap ?? selectedControl.label_gap)} px</FieldLabel>
            <input
              className="maker-range mt-4 w-full"
              type="range"
              min="0"
              max="24"
              step="1"
              value={normalizeLabelGap(selectedControl.labelGap ?? selectedControl.label_gap)}
              onChange={(event) => onUpdate(selectedControl.id, { labelGap: Number(event.target.value) })}
              title="Atur jarak vertikal label; tidak menggeser label ke kiri atau kanan"
            />
          </label>}
          {selectedControl.kind === "button" && (
            <>
              <label>
                <FieldLabel>Teks saat mati (OFF)</FieldLabel>
                <input className="maker-input mt-2" value={selectedControl.off_label ?? selectedControl.label} maxLength={24} onChange={(event) => onUpdate(selectedControl.id, { off_label: event.target.value })} />
              </label>
              <label>
                <FieldLabel>Teks saat menyala (ON)</FieldLabel>
                <input className="maker-input mt-2" value={selectedControl.on_label ?? "ON"} maxLength={24} onChange={(event) => onUpdate(selectedControl.id, { on_label: event.target.value })} />
              </label>
            </>
          )}
          {selectedControl.kind === "panel_button" ? (
            <>
              <label>
                <FieldLabel>Fungsi panel</FieldLabel>
                <select className="maker-input mt-2" value={selectedControl.panelType || "preset_browser"} onChange={(event) => onUpdate(selectedControl.id, { panelType: event.target.value })}>
                  <option value="preset_browser">Preset Browser</option>
                  <option value="mixer">Mixer</option>
                  <option value="midi_map">MIDI Groove Browser</option>
                </select>
              </label>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                <FieldLabel>Isi panel</FieldLabel>
                <span className="mt-1 block text-[10px] text-zinc-400">Buka panel lalu gunakan Tambah komponen. Komponen baru otomatis masuk ke panel ini.</span>
              </div>
              <label><FieldLabel>Lebar panel · {Math.round(selectedControl.panelWidth ?? 88)}%</FieldLabel><input className="maker-range mt-4 w-full" type="range" min="35" max="96" value={selectedControl.panelWidth ?? 88} onChange={(event) => onUpdate(selectedControl.id, { panelWidth: Number(event.target.value) })} /></label>
              <label><FieldLabel>Tinggi panel · {Math.round(selectedControl.panelHeight ?? 78)}%</FieldLabel><input className="maker-range mt-4 w-full" type="range" min="30" max="92" value={selectedControl.panelHeight ?? 78} onChange={(event) => onUpdate(selectedControl.id, { panelHeight: Number(event.target.value) })} /></label>
            </>
          ) : selectedControl.kind === "pad" ? (
            <>
              <label>
                <FieldLabel>Nada pad</FieldLabel>
                <select className="maker-input mt-2" value={selectedControl.notePitch ?? 60} onChange={(event) => onUpdate(selectedControl.id, { notePitch: Number(event.target.value) })}>
                  {SAMPLER_PITCHES.map((pitch) => <option key={pitch} value={pitch}>{midiNoteName(pitch)}</option>)}
                </select>
              </label>
              <label>
                <FieldLabel>Warna permukaan pad</FieldLabel>
                <span className="mt-2 flex items-center gap-2">
                  <input type="color" className="maker-color-input" value={isHexColor(selectedControl.padColor) ? selectedControl.padColor : defaultPadSurfaceColor(selectedControl.component_variant)} onChange={(event) => onUpdate(selectedControl.id, { padColor: event.target.value })} />
                  <span className="font-mono text-[10px] uppercase text-zinc-400">{isHexColor(selectedControl.padColor) ? selectedControl.padColor : defaultPadSurfaceColor(selectedControl.component_variant)}</span>
                </span>
              </label>
              <label>
                <FieldLabel>Warna nyala lampu</FieldLabel>
                <span className="mt-2 flex items-center gap-2">
                  <input type="color" className="maker-color-input" value={isHexColor(selectedControl.padActiveColor) ? selectedControl.padActiveColor : defaultPadActiveColor(selectedControl.component_variant, selectedControl.notePitch ?? 60, accentColor)} onChange={(event) => onUpdate(selectedControl.id, { padActiveColor: event.target.value })} />
                  <span className="font-mono text-[10px] uppercase text-zinc-400">{isHexColor(selectedControl.padActiveColor) ? selectedControl.padActiveColor : defaultPadActiveColor(selectedControl.component_variant, selectedControl.notePitch ?? 60, accentColor)}</span>
                </span>
              </label>
            </>
          ) : selectedControl.kind === "keyboard" ? (
            <label>
              <FieldLabel>Jumlah piano keys</FieldLabel>
              <select className="maker-input mt-2" value={selectedControl.keyCount ?? keyboardKeys} onChange={(event) => {
                const keyCount = Number(event.target.value);
                onUpdate(selectedControl.id, { keyCount, label: `${keyCount} Keys` });
                onKeyboardKeysChange(keyCount);
              }}>
                {KEYBOARD_SIZE_OPTIONS.map((count) => <option key={count} value={count}>{count} tuts</option>)}
              </select>
            </label>
          ) : ["pitch_bend", "modulation"].includes(selectedControl.parameter) ? (
            <>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                <FieldLabel>Fungsi native</FieldLabel>
                <span className="mt-1 block text-[10px] text-zinc-400">{selectedControl.parameter === "pitch_bend" ? "Pitch Bend MIDI · rentang ±2 semitone · kembali otomatis ke tengah" : "Modulation Wheel MIDI CC1 · vibrato hingga ±0.5 semitone"}</span>
              </div>
              {["pitch-bend-led", "modulation-led"].includes(selectedControl.component_variant) && <label>
                <FieldLabel>Warna LED & slider</FieldLabel>
                <span className="mt-2 flex items-center gap-2">
                  <input type="color" className="maker-color-input" value={isHexColor(selectedControl.controlColor ?? selectedControl.control_color) ? (selectedControl.controlColor ?? selectedControl.control_color) : accentColor} onChange={(event) => onUpdate(selectedControl.id, { controlColor: event.target.value })} />
                  <span className="font-mono text-[10px] uppercase text-zinc-400">{isHexColor(selectedControl.controlColor ?? selectedControl.control_color) ? (selectedControl.controlColor ?? selectedControl.control_color) : accentColor}</span>
                </span>
              </label>}
            </>
          ) : selectedControl.kind === "image" ? (
            <>
              {imageUploadEnabled && <label className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-sky-300/20 bg-sky-300/[0.07] px-3 py-2.5 text-xs font-bold text-sky-200 hover:bg-sky-300/10 ${componentImageUploading ? "pointer-events-none opacity-50" : ""}`}>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={componentImageUploading} onChange={(event) => { uploadCanvasImage(event.target.files?.[0], selectedControl.id); event.target.value = ""; }} />
                {componentImageUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Ganti gambar · harga tetap {componentCreditPrice("image", "default", pricing)} kredit
              </label>}
              <label>
                <FieldLabel>Penempatan gambar</FieldLabel>
                <select className="maker-input mt-2" value={selectedControl.imageFit ?? selectedControl.image_fit ?? "contain"} onChange={(event) => onUpdate(selectedControl.id, { imageFit: event.target.value })}>
                  <option value="contain">Contain</option>
                  <option value="cover">Cover</option>
                  <option value="stretch">Stretch</option>
                </select>
              </label>
              <label className="md:col-span-2">
                <div className="flex items-center justify-between gap-3"><FieldLabel>Opacity gambar</FieldLabel><span className="font-mono text-[10px] text-zinc-400">{Math.round(selectedControl.imageOpacity ?? selectedControl.image_opacity ?? 100)}%</span></div>
                <input type="range" min="0" max="100" value={selectedControl.imageOpacity ?? selectedControl.image_opacity ?? 100} onChange={(event) => onUpdate(selectedControl.id, { imageOpacity: Number(event.target.value) })} className="maker-range mt-2" />
              </label>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 md:col-span-2">
                <FieldLabel>File gambar</FieldLabel>
                <span className="mt-1 block truncate text-[10px] text-zinc-400">{selectedControl.imageName ?? selectedControl.image_name ?? "Gambar upload"}</span>
              </div>
            </>
          ) : selectedControl.kind === "spectrum" ? (
            <>
              <label>
                <FieldLabel>Warna analyzer</FieldLabel>
                <span className="mt-2 flex items-center gap-2">
                  <input type="color" className="maker-color-input" value={isHexColor(selectedControl.visualColor ?? selectedControl.visual_color) ? (selectedControl.visualColor ?? selectedControl.visual_color) : accentColor} onChange={(event) => onUpdate(selectedControl.id, { visualColor: event.target.value })} />
                  <span className="font-mono text-[10px] uppercase text-zinc-400">{selectedControl.visualColor ?? selectedControl.visual_color ?? accentColor}</span>
                </span>
              </label>
              {selectedControl.component_variant === "stereo-vectorscope" && (
                <label>
                  <FieldLabel>Correlation meter</FieldLabel>
                  <select className="maker-input mt-2" value={selectedControl.showCorrelationMeter !== false && selectedControl.show_correlation_meter !== false ? "visible" : "hidden"} onChange={(event) => onUpdate(selectedControl.id, { show_correlation_meter: event.target.value === "visible" })}>
                    <option value="visible">Tampilkan</option>
                    <option value="hidden">Sembunyikan</option>
                  </select>
                </label>
              )}
              {(selectedControl.component_variant || "realtime-spectrum") === "realtime-spectrum" && activePrismModule && (
                <label>
                  <FieldLabel>Kontrol Prism</FieldLabel>
                  <select className="maker-input mt-2" value={selectedControl.prismControlMode ?? selectedControl.prism_control_mode ?? "direct"} onChange={(event) => {
                    const mode = event.target.value === "contextual" ? "contextual" : "direct";
                    const nextControls = withRequiredSpectrum("prismeq", controls.map((control) => control.id === selectedControl.id
                      ? { ...control, prismControlMode: mode }
                      : control));
                    onFeatureChange({
                      interfaceControls: nextControls.map((control) => PRISM_CONTEXT_PARAMETERS.has(control.parameter)
                        ? { ...control, moduleId: activePrismModule.id, prismOwnerId: selectedControl.id }
                        : control),
                    });
                  }}>
                    <option value="contextual">Contextual · 3 knob bersama</option>
                    <option value="direct">Direct · node analyzer saja</option>
                  </select>
                </label>
              )}
              <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-2.5">
                <FieldLabel>Fungsi native</FieldLabel>
                <span className="mt-1 block text-[10px] text-zinc-400">{selectedControl.component_variant === "stereo-vectorscope"
                  ? "Stereo vectorscope real-time · phase correlation −1 sampai +1 · aktif pada preview browser dan hasil VST3 native"
                  : selectedControl.component_variant === "pure-spectrum"
                    ? "FFT output real-time murni tanpa node atau kontrol EQ · aktif pada preview browser dan hasil VST3 native"
                    : "FFT output real-time · aktif pada preview browser dan hasil VST3 native · band EQ yang ditambahkan dari analyzer sudah termasuk dan tidak menambah biaya komponen"}</span>
              </div>
            </>
          ) : selectedControl.kind === "visual" ? (
            <>
              <label>
                <FieldLabel>Warna scale ring</FieldLabel>
                <span className="mt-2 flex items-center gap-2">
                  <input type="color" className="maker-color-input" value={isHexColor(selectedControl.visualColor ?? selectedControl.visual_color) ? (selectedControl.visualColor ?? selectedControl.visual_color) : "#E8E0CF"} onChange={(event) => onUpdate(selectedControl.id, { visualColor: event.target.value })} />
                  <span className="font-mono text-[10px] uppercase text-zinc-400">{isHexColor(selectedControl.visualColor ?? selectedControl.visual_color) ? (selectedControl.visualColor ?? selectedControl.visual_color) : "#E8E0CF"}</span>
                </span>
              </label>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                <FieldLabel>Fungsi native</FieldLabel>
                <span className="mt-1 block text-[10px] text-zinc-400">Visual statis · tidak mengubah parameter audio</span>
              </div>
            </>
          ) : ["gain_meter", "vu_meter"].includes(selectedControl.kind) ? (
            <>
              <label>
                <FieldLabel>Sumber meter</FieldLabel>
                <select className="maker-input mt-2" value={selectedControl.parameter === "gain_reduction" ? "gain_reduction" : "output_level"} onChange={(event) => {
                  const parameter = event.target.value;
                  const firstCompressor = engineModules.find((module) => module.type === "linked_compressor");
                  onUpdate(selectedControl.id, { parameter, moduleId: parameter === "gain_reduction" ? (selectedControl.moduleId || firstCompressor?.id || null) : null });
                }}>
                  <option value="output_level">Output level</option>
                  <option value="gain_reduction">Gain Reduction compressor</option>
                </select>
              </label>
              {selectedControl.parameter === "gain_reduction" && (
                <label>
                  <FieldLabel>Compressor target</FieldLabel>
                  <select className="maker-input mt-2" value={selectedControl.moduleId || ""} onChange={(event) => onUpdate(selectedControl.id, { moduleId: event.target.value || null })}>
                    <option value="">Compressor pertama di rack</option>
                    {engineModules.filter((module) => module.type === "linked_compressor").map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
                  </select>
                </label>
              )}
              <label>
                <FieldLabel>Mode meter</FieldLabel>
                <select className="maker-input mt-2" value={selectedControl.meterMode ?? selectedControl.meter_mode ?? (selectedControl.kind === "gain_meter" ? "stereo" : "mono")} onChange={(event) => onUpdate(selectedControl.id, { meterMode: event.target.value })}>
                  <option value="mono">Mono · level gabungan</option>
                  <option value="stereo">Stereo · kanal L / R</option>
                </select>
              </label>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                <FieldLabel>Fungsi native</FieldLabel>
                <span className="mt-1 block text-[10px] text-zinc-400">{selectedControl.parameter === "gain_reduction" ? "Reduksi gain aktual dari compressor yang dipilih" : selectedControl.kind === "gain_meter" ? "Peak output aktual" : "RMS / VU output aktual"}</span>
              </div>
            </>
          ) : ["solo", "mute"].includes(selectedControl.kind) ? (
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <FieldLabel>Fungsi native</FieldLabel>
              <span className="mt-1 block text-[10px] text-zinc-400">{selectedControl.kind === "solo" ? "Solo-safe output" : "Mute output"}</span>
            </div>
          ) : (
            <>
              <label>
                <FieldLabel>Target modul</FieldLabel>
                <select className="maker-input mt-2" value={selectedControl.moduleId || ""} onChange={(event) => {
                  const moduleId = event.target.value || null;
                  const moduleOption = dspRackOption(engineModules.find((module) => module.id === moduleId)?.type);
                  const previousModule = engineModules.find((module) => module.id === selectedControl.moduleId);
                  const inferredMacro = Object.entries(INTERNAL_DSP_MACRO_BINDINGS).find(([, binding]) => (
                    binding.type === previousModule?.type && binding.parameter === selectedControl.parameter
                  ))?.[0];
                  const currentAutomaticParameter = CONTROL_OPTIONS.some((option) => option.id === selectedControl.parameter)
                    ? selectedControl.parameter
                    : null;
                  const firstAvailableMacro = Object.entries(INTERNAL_DSP_MACRO_BINDINGS).find(([, binding]) => (
                    engineModules.some((module) => module.type === binding.type)
                  ))?.[0];
                  onUpdate(selectedControl.id, {
                    moduleId,
                    ...(moduleId && moduleOption
                      ? { parameter: moduleOption.parameter }
                      : { parameter: inferredMacro || currentAutomaticParameter || firstAvailableMacro || (pluginKind === "effect" ? "bypass" : "volume") }),
                  });
                }}>
                  <option value="">Macro DSP otomatis</option>
                  {engineModules.map((module) => <option key={module.id} value={module.id}>{module.name} · {module.type}</option>)}
                </select>
              </label>
              {selectedControl.moduleId ? (
                <label>
                  <FieldLabel>Parameter modul</FieldLabel>
                  <select className="maker-input mt-2" value={selectedControl.parameter} onChange={(event) => onUpdate(selectedControl.id, { parameter: event.target.value })}>
                    {(selectedEngineModuleOption?.parameters || []).map((parameter) => <option key={parameter.key} value={parameter.key}>{parameter.label}</option>)}
                    <option value="module_mix">Module mix</option>
                    <option value="bypass">Bypass modul</option>
                  </select>
                </label>
              ) : (
                <label>
                  <FieldLabel>Master / Macro DSP</FieldLabel>
                  <select className="maker-input mt-2" value={selectedControl.parameter} onChange={(event) => onUpdate(selectedControl.id, { parameter: event.target.value })}>
                    {pluginKind !== "effect" && <option value="group_0_pan">Pan Sampler</option>}
                    {CONTROL_OPTIONS.filter((option) => {
                      const binding = INTERNAL_DSP_MACRO_BINDINGS[option.id];
                      return !binding || engineModules.some((module) => module.type === binding.type);
                    }).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <span className="mt-1 block text-[9px] text-zinc-500">Macro DSP mengontrol modul pertama yang cocok di rack; parameter Master tetap langsung ke output instrumen.</span>
                </label>
              )}
            </>
          )}
          <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3">
            <span>
              <FieldLabel>{backgroundTargets.length > 1 ? `Background ${backgroundTargets.length} komponen` : selectedControl.kind === "knob" ? "Background knob" : "Background komponen"}</FieldLabel>
              <span className="mt-1 block text-[9px] text-zinc-600">{backgroundSelectionMixed ? "Sebagian background aktif · uncheck untuk mematikan semua" : backgroundTargets.length > 1 ? "Terapkan bersama ke semua komponen terpilih" : "Hilangkan kotak pembungkus"}</span>
            </span>
            <input
              ref={backgroundToggleRef}
              type="checkbox"
              checked={backgroundVisibleCount === backgroundTargets.length}
              onChange={(event) => updateSelectedComponentBackgrounds(backgroundSelectionMixed ? false : event.target.checked)}
              className="h-4 w-4 accent-rose-500"
            />
          </label>
          {selectedControl.kind === "keyboard" && (
            <>
              <label>
                <FieldLabel>Lebar keyboard (px)</FieldLabel>
                <input className="maker-input mt-2" type="number" min="240" max="1600" value={selectedControl.width ?? CONTROL_DEFAULT_SIZES.keyboard.width} onChange={(event) => onUpdate(selectedControl.id, { width: Math.max(240, Math.min(1600, Number(event.target.value) || 240)) })} />
              </label>
              <label>
                <FieldLabel>Tinggi keyboard (px)</FieldLabel>
                <input className="maker-input mt-2" type="number" min="112" max="360" value={selectedControl.height ?? CONTROL_DEFAULT_SIZES.keyboard.height} onChange={(event) => onUpdate(selectedControl.id, { height: Math.max(112, Math.min(360, Number(event.target.value) || 112)) })} />
              </label>
            </>
          )}
          <label className="md:col-span-2">
            <div className="flex items-center justify-between gap-3"><FieldLabel>Opacity komponen</FieldLabel><span className="font-mono text-[10px] text-zinc-400">{Math.round(selectedControl.opacity ?? 100)}%</span></div>
            <input className="maker-range mt-2 w-full" type="range" min="0" max="100" value={selectedControl.opacity ?? 100} onChange={(event) => onUpdate(selectedControl.id, { opacity: Number(event.target.value) })} />
          </label>
          <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Rotasi komponen</FieldLabel>
              <span className="font-mono text-[10px] text-zinc-400">{normalizeComponentRotation(selectedControl.rotation)}°</span>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_82px] gap-2">
              <input aria-label="Rotasi komponen" className="maker-range w-full" type="range" min="-180" max="180" step="1" value={normalizeComponentRotation(selectedControl.rotation)} onChange={(event) => onUpdate(selectedControl.id, { rotation: normalizeComponentRotation(event.target.value) })} />
              <input aria-label="Derajat rotasi komponen" className="maker-input h-9 px-2 text-center font-mono text-xs" type="number" min="-180" max="180" step="1" value={normalizeComponentRotation(selectedControl.rotation)} onChange={(event) => onUpdate(selectedControl.id, { rotation: normalizeComponentRotation(event.target.value) })} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] font-bold text-zinc-300 hover:bg-white/[0.06]" onClick={() => onUpdate(selectedControl.id, { rotation: -90 })}>−90°</button>
              <button type="button" className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] font-bold text-zinc-300 hover:bg-white/[0.06]" onClick={() => onUpdate(selectedControl.id, { rotation: 0 })}>Reset 0°</button>
              <button type="button" className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] font-bold text-zinc-300 hover:bg-white/[0.06]" onClick={() => onUpdate(selectedControl.id, { rotation: 90 })}>+90°</button>
            </div>
          </div>
          <label>
            <FieldLabel>Posisi X · {selectedControl.x}%</FieldLabel>
            <input className="maker-range mt-4 w-full" type="range" min={selectedHalfWidth} max={100 - selectedHalfWidth} value={selectedControl.x} onChange={(event) => onUpdate(selectedControl.id, { x: Number(event.target.value) })} />
          </label>
          <label>
            <FieldLabel>Posisi Y · {selectedControl.y}%</FieldLabel>
            <input className="maker-range mt-4 w-full" type="range" min={selectedHalfHeight} max={100 - selectedHalfHeight} value={selectedControl.y} onChange={(event) => onUpdate(selectedControl.id, { y: Number(event.target.value) })} />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => selectedControlIds.length ? onRemoveSelected() : onRemove(selectedControl.id)} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-400/15 text-xs font-semibold text-red-300 hover:bg-red-400/10">
              <Trash2 className="h-3.5 w-3.5" /> {selectedControlIds.length > 1 ? `Hapus ${selectedControlIds.length} kontrol sekaligus` : "Hapus kontrol"}
            </button>
          </div>
        </div>
      ) : (
        <p className="maker-interface-inspector rounded-xl border border-white/5 bg-[#111014] px-4 py-3 text-[10px] text-zinc-600">Pilih kontrol di preview untuk mengubahnya. Tahan Ctrl (atau Cmd di Mac) lalu klik untuk memilih beberapa kontrol.</p>
      )}
      <div className="maker-interface-ui-colors grid grid-cols-2 gap-3 rounded-2xl border border-white/[0.07] bg-[#111014] p-4">
        <label>
          <FieldLabel>Warna aksen UI</FieldLabel>
          <span className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-2.5 py-2">
            <input type="color" value={accentColor} onChange={(event) => onCanvasChange({ accentColor: event.target.value })} className="h-8 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent" aria-label="Warna aksen plugin" />
            <span className="min-w-0 truncate font-mono text-[10px] text-zinc-400">{accentColor.toUpperCase()}</span>
          </span>
        </label>
        <label>
          <FieldLabel>Warna dasar UI</FieldLabel>
          <span className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-2.5 py-2">
            <input type="color" value={uiColor} onChange={(event) => onCanvasChange({ uiColor: event.target.value })} className="h-8 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent" aria-label="Warna dasar UI plugin" />
            <span className="min-w-0 truncate font-mono text-[10px] text-zinc-400">{uiColor.toUpperCase()}</span>
          </span>
        </label>
      </div>
      </div>
      </div>
    </div>
  );
}

const ORBIT_ENCODER_LED_COUNT = 18;

function OrbitEncoderLights({ value }) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  const lastLitIndex = Math.round((normalized / 100) * (ORBIT_ENCODER_LED_COUNT - 1));
  return (
    <span className="maker-orbit-encoder__lights" aria-hidden="true">
      {Array.from({ length: ORBIT_ENCODER_LED_COUNT }, (_, index) => {
        const angle = (-135 + ((270 * index) / (ORBIT_ENCODER_LED_COUNT - 1))) * (Math.PI / 180);
        return <i key={index} className={index <= lastLitIndex ? "is-lit" : ""} style={{ left: `${50 + (Math.sin(angle) * 38)}%`, top: `${50 - (Math.cos(angle) * 38)}%` }} />;
      })}
    </span>
  );
}

const PAN_LED_COUNT = 21;

function PanLedRing({ value, type = "dots" }) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  const activeIndex = Math.round((normalized / 100) * (PAN_LED_COUNT - 1));
  const centerIndex = Math.floor(PAN_LED_COUNT / 2);
  const activeStart = Math.min(centerIndex, activeIndex);
  const activeEnd = Math.max(centerIndex, activeIndex);
  if (type === "ring") {
    const currentAngle = normalized * 2.7;
    const activeLow = Math.min(132.5, currentAngle);
    const activeHigh = Math.max(137.5, currentAngle);
    const fill = `conic-gradient(from -135deg, #202329 0deg ${activeLow}deg, var(--maker-accent, #67e8f9) ${activeLow}deg ${activeHigh}deg, #202329 ${activeHigh}deg 270deg, transparent 270deg 360deg)`;
    return <span className="maker-pan-led-ring maker-pan-led-ring--solid" aria-hidden="true" style={{ "--pan-ring-fill": fill }} />;
  }
  return (
    <span className="maker-pan-led-ring" aria-hidden="true">
      {Array.from({ length: PAN_LED_COUNT }, (_, index) => {
        const angle = (-135 + ((270 * index) / (PAN_LED_COUNT - 1))) * (Math.PI / 180);
        const lit = index >= activeStart && index <= activeEnd;
        return <i key={index} className={lit ? "is-lit" : ""} style={{ left: `${50 + (Math.sin(angle) * 47)}%`, top: `${50 - (Math.cos(angle) * 47)}%` }} />;
      })}
    </span>
  );
}

const SCALE_RING_SETTINGS = {
  "scale-classic": { count: 11, majorEvery: 5 },
  "scale-fine": { count: 21, majorEvery: 5 },
  "scale-dots": { count: 15, majorEvery: 7, dots: true },
  "scale-console": { count: 11, majorEvery: 5, centerLabel: "5" },
  "scale-arc": { count: 9, majorEvery: 4, arc: true },
};

function ScaleRing({ variant = "scale-classic", color = "#E8E0CF" }) {
  const settings = SCALE_RING_SETTINGS[variant] || SCALE_RING_SETTINGS["scale-classic"];
  const marks = Array.from({ length: settings.count }, (_, index) => {
    const degrees = -135 + ((270 * index) / (settings.count - 1));
    const radians = degrees * (Math.PI / 180);
    const major = index === 0 || index === settings.count - 1 || index % settings.majorEvery === 0;
    const outer = settings.dots ? 64 : 67;
    const inner = settings.dots ? outer : (major ? 55 : 60);
    const point = (radius) => ({ x: 80 + (Math.sin(radians) * radius), y: 80 - (Math.cos(radians) * radius) });
    const start = point(inner);
    const end = point(outer);
    return settings.dots
      ? <circle key={index} cx={end.x} cy={end.y} r={major ? 2.5 : 1.7} className={major ? "is-major" : ""} />
      : <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y} className={major ? "is-major" : ""} />;
  });
  return (
    <span className={`maker-scale-ring maker-scale-ring--${variant}`} style={{ "--scale-ring-color": isHexColor(color) ? color : "#E8E0CF" }} aria-hidden="true">
      <svg viewBox="0 0 160 160" focusable="false">
        {settings.arc && <path className="maker-scale-ring__arc" d="M 36.16 123.84 A 62 62 0 1 1 123.84 123.84" />}
        <g className="maker-scale-ring__marks">{marks}</g>
        <text x="14" y="151" textAnchor="start">MIN</text>
        {settings.centerLabel && <text x="80" y="151" textAnchor="middle">{settings.centerLabel}</text>}
        <text x="146" y="151" textAnchor="end">MAX</text>
      </svg>
    </span>
  );
}

function CreditCoinBadge({ value, prefix = "" }) {
  return (
    <span className="maker-credit-badge" aria-label={`${prefix ? `${prefix} ` : ""}${value} kredit`}>
      {prefix && <span>{prefix}</span>}
      <Coins aria-hidden="true" />
      <strong>{Number(value || 0).toLocaleString("id-ID")}</strong>
    </span>
  );
}

const CREDIT_COMPONENT_KIND_LABELS = {
  knob: "Knob",
  button: "Button",
  solo: "Button Solo",
  mute: "Button Mute",
  fader: "Fader",
  gain_meter: "Gain Meter",
  vu_meter: "VU Meter",
  pad: "Pad",
  keyboard: "Keyboard",
  visual: "Visual",
  text: "Text",
  panel_button: "Panel Button",
  image: "Gambar upload",
};

const creditItemLabel = (value = "") => String(value)
  .replaceAll("_", " ")
  .replaceAll("-", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

function CreditEstimateRow({ label, detail, credits, included = false, nested = false }) {
  return (
    <div className={`maker-credit-popup__row ${nested ? "is-nested" : ""}`}>
      <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
      <b className={included ? "is-included" : ""}>{included ? "Termasuk" : formatCredits(credits)}</b>
    </div>
  );
}

function CreditEstimatePopup({ quote, balance, insufficient }) {
  const remaining = Number(balance || 0) - Number(quote.totalCredits || 0);
  const dspLabel = (line) => line.name || dspRackOption(line.type)?.name || creditItemLabel(line.type);
  return (
    <div className="maker-credit-estimate">
      <span className={`maker-credit-estimate__total ${insufficient ? "is-insufficient" : ""}`}>
        Estimasi {formatCredits(quote.totalCredits)}
      </span>
      <details className="maker-credit-popup">
        <summary>Lihat rincian</summary>
        <div className="maker-credit-popup__panel">
          <div className="maker-credit-popup__heading">
            <span><Coins aria-hidden="true" /><strong>Rincian estimasi kredit</strong></span>
            <small>Berubah otomatis mengikuti isi project.</small>
          </div>
          <div className="maker-credit-popup__body">
            <CreditEstimateRow
              label="Biaya build dasar"
              detail={quote.templateBundleActive ? "Sudah termasuk dalam harga template" : quote.includedDspCount ? `Termasuk Input, Output, dan ${quote.includedDspCount} DSP pertama` : "Fondasi build native Steinberg VST3"}
              credits={quote.baseCredits}
              included={quote.templateBundleActive}
            />
            <CreditEstimateRow
              label="Template"
              detail={quote.templateId ? creditItemLabel(quote.templateId) : "Template dasar"}
              credits={quote.templateCredits}
              included={!quote.templateCredits}
            />
            <CreditEstimateRow
              label={`Komponen (${quote.componentCount})`}
              detail={quote.templateBundleActive ? `${quote.templateIncludedComponentCount} bawaan template termasuk · sisanya penambahan/penggantian` : "Total komponen pada Designer"}
              credits={quote.componentCredits}
              included={!quote.componentCredits}
            />
            {quote.componentLines.map((line) => (
              <CreditEstimateRow
                key={`${line.kind}:${line.variant}:${line.unitCredits}`}
                label={`${CREDIT_COMPONENT_KIND_LABELS[line.kind] || creditItemLabel(line.kind)} · ${creditItemLabel(line.variant)} (${line.quantity})`}
                detail={`${formatCredits(line.unitCredits)} per komponen`}
                credits={line.credits}
                nested
              />
            ))}
            <CreditEstimateRow
              label={`DSP & Processor (${quote.dspLines.length})`}
              detail={quote.templateBundleActive ? `${quote.includedDspCount} bawaan template termasuk · DSP baru berbayar` : quote.includedDspCount ? `${quote.includedDspCount} DSP pertama termasuk untuk Plugin FX` : "Processor yang digunakan project"}
              credits={quote.dspCredits}
              included={!quote.dspCredits}
            />
            {quote.dspLines.map((line, index) => (
              <CreditEstimateRow
                key={`${line.type}:${index}`}
                label={dspLabel(line)}
                detail={line.legacyEffect ? "Efek instrumen kompatibilitas" : creditItemLabel(line.type)}
                credits={line.credits}
                included={line.included}
                nested
              />
            ))}
            <CreditEstimateRow
              label={`Sample (${quote.sampleCount})`}
              detail={quote.templateBundleActive ? `${quote.templateIncludedSampleCount} bawaan template termasuk · ${quote.extraSampleCount} baru/pengganti × ${formatCredits(quote.extraSampleCredits)}` : quote.includedSamples ? `${Math.min(quote.sampleCount, quote.includedSamples)} termasuk · ${quote.extraSampleCount} berbayar × ${formatCredits(quote.extraSampleCredits)}` : "Tidak dikenakan pada Plugin FX"}
              credits={quote.sampleCredits}
              included={!quote.sampleCredits}
            />
            <CreditEstimateRow
              label="Background custom"
              detail={quote.backgroundIncludedByTemplate ? "Background bawaan sudah termasuk harga template" : quote.hasCustomBackground ? "Background upload baru digunakan" : "Background bawaan atau tanpa background"}
              credits={quote.backgroundCredits}
              included={!quote.backgroundCredits}
            />
            <CreditEstimateRow
              label={quote.licenseMaxActivations ? `Lisensi · ${quote.licenseMaxActivations} komputer` : "Tanpa serial number"}
              detail={quote.licenseMaxActivations ? "Kapasitas aktivasi per serial" : "Tidak memakai aktivasi perangkat"}
              credits={quote.licenseCredits}
              included={!quote.licenseCredits}
            />
          </div>
          <div className="maker-credit-popup__footer">
            <div><span>Total estimasi</span><strong>{formatCredits(quote.totalCredits)}</strong></div>
            <div><span>Saldo saat ini</span><strong>{formatCredits(balance)}</strong></div>
            <div className={remaining < 0 ? "is-negative" : ""}><span>Sisa setelah build</span><strong>{formatCredits(remaining)}</strong></div>
          </div>
          <p className="maker-credit-popup__note">Harga final tetap dihitung ulang oleh server saat Export. Rebuild Koreksi, bila memenuhi syarat, ditampilkan pada langkah konfirmasi.</p>
        </div>
      </details>
    </div>
  );
}

function FreeCreditAdminPanel({ email, credits, note, busy, onEmailChange, onCreditsChange, onNoteChange, onGrantCredits }) {
  return (
    <section className="maker-grants-admin mt-6">
      <div className="maker-grants-admin__heading">
        <div><span>Hadiah kredit</span><small>Email harus sudah terdaftar sebagai customer.</small></div>
        <Coins aria-hidden="true" />
      </div>
      <div className="maker-grants-admin__form">
        <label><span>Email customer</span><input type="email" value={email} placeholder="customer@email.com" onChange={(event) => onEmailChange(event.target.value)} /></label>
        <label><span>Jumlah kredit gratis</span><input type="number" min="1" max="1000000" value={credits} onChange={(event) => onCreditsChange(event.target.value)} /></label>
        <label><span>Catatan audit (opsional)</span><input type="text" maxLength="240" value={note} placeholder="Contoh: bonus komunitas" onChange={(event) => onNoteChange(event.target.value)} /></label>
        <div className="maker-grants-admin__buttons">
          <button type="button" disabled={!email.trim() || Number(credits) < 1 || !!busy} onClick={onGrantCredits}>{busy === "credits" ? <Loader2 className="animate-spin" /> : <Coins />}Berikan kredit gratis</button>
        </div>
      </div>
    </section>
  );
}

function PricingAdminPanel({ pricing, templates, variants, dspOptions, saving, onScalarChange, onPriceChange, onSave }) {
  const basicProjectPrices = [
    { id: "basicvst", name: "VST Basic" },
    { id: "basicfx", name: "Plugin Basic" },
  ];
  const additionalTemplates = templates.filter((template) => !basicProjectPrices.some((basic) => basic.id === template.id));
  const componentRows = [];
  const seenComponents = new Set();
  variants.forEach((variant) => {
    const priceKind = ["button", "solo", "mute"].includes(variant.kind) ? "button" : ["gain_meter", "vu_meter"].includes(variant.kind) ? "meter" : variant.kind;
    const key = `${priceKind}:${variant.id}`;
    if (seenComponents.has(key)) return;
    seenComponents.add(key);
    componentRows.push({ ...variant, priceKind });
  });
  componentRows.push({ id: "default", label: "Gambar upload", category: "Visual", kind: "image", priceKind: "image" });
  return (
    <details className="maker-pricing-admin mt-6">
      <summary><span><Coins aria-hidden="true" /> Kelola harga kredit</span><small>Backend resmi · perubahan berlaku untuk build baru</small></summary>
      <div className="maker-pricing-admin__body">
        <div className="maker-pricing-admin__section">
          <h3>Harga dasar</h3>
          <div className="maker-pricing-admin__grid maker-pricing-admin__grid--base">
            {[
              ["base_build_credits", "Build dasar"],
              ["extra_sample_credits", "Sampel tambahan"],
              ["included_instrument_samples", "Sampel termasuk"],
              ["included_effect_dsp", "DSP termasuk (Plugin FX)"],
              ["custom_background_credits", "Background custom"],
            ].map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="100000" value={pricing[key]} onChange={(event) => onScalarChange(key, event.target.value)} /></label>)}
          </div>
        </div>
        <div className="maker-pricing-admin__section">
          <h3>Harga pilihan Project baru</h3>
          <p>Harga ini tampil pada popup Project baru. Nama dibuat khusus agar tidak tertukar dengan template bergambar di galeri.</p>
          <div className="maker-pricing-admin__grid">
            {basicProjectPrices.map((template) => <label key={template.id}><span>{template.name}</span><input type="number" min="0" max="100000" value={pricing.template_credits?.[template.id] || 0} onChange={(event) => onPriceChange("template_credits", template.id, event.target.value)} /></label>)}
          </div>
        </div>
        <div className="maker-pricing-admin__section">
          <h3>Harga template tambahan</h3>
          <p>Jika nilainya di atas 0, angka ini menjadi harga bundel template dan sudah mencakup build dasar serta isi bawaan template. Badge galeri memakai kalkulasi yang sama dengan rincian sebelum build.</p>
          <div className="maker-pricing-admin__grid">
            {additionalTemplates.map((template) => <label key={template.id}><span>{template.name}</span><input type="number" min="0" max="100000" value={pricing.template_credits?.[template.id] || 0} onChange={(event) => onPriceChange("template_credits", template.id, event.target.value)} /></label>)}
          </div>
        </div>
        <div className="maker-pricing-admin__section">
          <h3>Harga komponen</h3>
          <div className="maker-pricing-admin__grid">
            {componentRows.map((variant) => <label key={`${variant.priceKind}:${variant.id}`}><span>{variant.label}<small>{variant.category}</small></span><input type="number" min="0" max="100000" value={pricing.component_prices?.[variant.priceKind]?.[variant.id] ?? componentCreditPrice(variant.kind, variant.id, pricing)} onChange={(event) => onPriceChange("component_prices", variant.priceKind, event.target.value, variant.id)} /></label>)}
          </div>
        </div>
        <div className="maker-pricing-admin__section">
          <h3>Harga DSP</h3>
          <div className="maker-pricing-admin__grid">
            {dspOptions.map((option) => <label key={option.type}><span>{option.name}</span><input type="number" min="0" max="100000" value={pricing.dsp_prices?.[option.type] ?? 15} onChange={(event) => onPriceChange("dsp_prices", option.type, event.target.value)} /></label>)}
          </div>
        </div>
        <div className="maker-pricing-admin__section">
          <h3>Efek instrumen</h3>
          <div className="maker-pricing-admin__grid maker-pricing-admin__grid--base">
            {Object.entries(pricing.instrument_effect_prices || {}).map(([effect, credits]) => <label key={effect}><span>{effect}</span><input type="number" min="0" max="100000" value={credits} onChange={(event) => onPriceChange("instrument_effect_prices", effect, event.target.value)} /></label>)}
          </div>
        </div>
        <div className="maker-pricing-admin__section">
          <h3>Harga lisensi per kapasitas perangkat</h3>
          <p>Nilai ini ditambahkan ke harga project ketika proteksi lisensi build customer aktif.</p>
          <div className="maker-pricing-admin__grid maker-pricing-admin__grid--base">
            {[1, 2, 3].map((count) => <label key={count}><span>{count} komputer</span><input type="number" min="0" max="100000" value={pricing.license_activation_credits?.[count] || 0} onChange={(event) => onPriceChange("license_activation_credits", String(count), event.target.value)} /></label>)}
          </div>
        </div>
        <div className="maker-pricing-admin__section">
          <h3>Lisensi distribusi</h3>
          <p>Harga per serial untuk VST yang dijual kembali. Diskon diterapkan ketika customer membeli paket kuota.</p>
          <div className="maker-pricing-admin__grid maker-pricing-admin__grid--base">
            {[1, 2, 3].map((count) => <label key={count}><span>Serial · {count} komputer</span><input type="number" min="0" max="100000" value={pricing.distribution_license_credits?.[count] || 0} onChange={(event) => onPriceChange("distribution_license_credits", String(count), event.target.value)} /></label>)}
            {[10, 50, 100, 1000].map((quantity) => <label key={quantity}><span>Diskon paket {quantity}</span><input type="number" min="0" max="100" value={pricing.distribution_pack_discounts?.[quantity] || 0} onChange={(event) => onPriceChange("distribution_pack_discounts", String(quantity), event.target.value)} /></label>)}
          </div>
        </div>
        <div className="maker-pricing-admin__footer">
          <span>Harga 0 diperbolehkan untuk item yang ingin digratiskan.</span>
          <button type="button" onClick={onSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Menyimpan…" : "Simpan semua harga"}</button>
        </div>
      </div>
    </details>
  );
}

function BuildLicenseAdminPanel({ settings, savedSettings, saving, onChange, onSave }) {
  const dirty = settings.customer_license_enabled !== savedSettings.customer_license_enabled
    || settings.show_no_serial_option !== savedSettings.show_no_serial_option
    || Number(settings.license_max_activations) !== Number(savedSettings.license_max_activations);
  return (
    <section className="maker-pricing-admin mb-6">
      <div className="maker-pricing-admin__body">
        <div className="maker-pricing-admin__section">
          <h3>Lisensi build customer</h3>
          <p>Pengaturan ini berlaku untuk build customer baru. Build dan serial yang sudah dibuat tidak diubah.</p>
          <div className="maker-pricing-admin__grid maker-pricing-admin__grid--base">
            <label>
              <span>Proteksi lisensi</span>
              <select
                value={settings.customer_license_enabled === false ? "off" : "on"}
                onChange={(event) => onChange((current) => ({ ...current, customer_license_enabled: event.target.value === "on" }))}
              >
                <option value="on">Aktif · serial wajib</option>
                <option value="off">Nonaktif · tanpa serial</option>
              </select>
            </label>
            <label>
              <span>Opsi tanpa serial number</span>
              <select
                value={settings.show_no_serial_option === false ? "hidden" : "visible"}
                disabled={settings.customer_license_enabled === false}
                onChange={(event) => onChange((current) => ({ ...current, show_no_serial_option: event.target.value === "visible" }))}
              >
                <option value="visible">Tampil di langkah terakhir</option>
                <option value="hidden">Sembunyikan dari customer</option>
              </select>
            </label>
            <label>
              <span>Maksimal pilihan komputer</span>
              <select
                value={settings.license_max_activations}
                disabled={settings.customer_license_enabled === false}
                onChange={(event) => onChange((current) => ({ ...current, license_max_activations: Number(event.target.value) }))}
              >
                {[1, 2, 3].map((count) => <option key={count} value={count}>{count} komputer</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="maker-pricing-admin__footer">
          <span>{settings.customer_license_enabled === false ? "Build customer baru tidak akan meminta aktivasi." : settings.show_no_serial_option === false ? `Customer wajib memilih lisensi 1–${settings.license_max_activations} komputer.` : `Customer dapat memilih tanpa serial atau lisensi 1–${settings.license_max_activations} komputer.`}</span>
          <button type="button" onClick={onSave} disabled={saving || !dirty}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Menyimpan…" : "Simpan pengaturan lisensi"}</button>
        </div>
      </div>
    </section>
  );
}

function CustomerBuildLicenseDialog({ mode = "export", platform = "windows", settings, pricing, selectedActivations, quote, balance, distributionChoice, busy, onChange, onDistributionChange, onClose, onConfirm }) {
  const enabled = settings.customer_license_enabled !== false;
  const showNoSerialOption = settings.show_no_serial_option !== false;
  const maximum = Math.max(1, Math.min(3, Number(settings.license_max_activations) || 2));
  const selected = showNoSerialOption && Number(selectedActivations) === 0 ? 0 : Math.max(1, Math.min(maximum, Number(selectedActivations) || 1));
  const distributionEnabled = enabled && selected > 0 && distributionChoice?.enabled === true;
  const distributionQuantity = [10, 50, 100, 1000].includes(Number(distributionChoice?.quantity)) ? Number(distributionChoice.quantity) : 10;
  const distributionActivations = Math.max(1, Math.min(3, Number(distributionChoice?.maxActivations) || 1));
  const distributionUnitCredits = Number(pricing.distribution_license_credits?.[distributionActivations] || 0);
  const distributionDiscount = Number(pricing.distribution_pack_discounts?.[distributionQuantity] || 0);
  const distributionSubtotal = distributionQuantity * distributionUnitCredits;
  const distributionDiscountCredits = distributionEnabled
    ? Math.max(0, distributionSubtotal - Math.ceil(distributionSubtotal * (100 - distributionDiscount) / 100))
    : 0;
  const distributionCredits = distributionEnabled
    ? distributionSubtotal - distributionDiscountCredits
    : 0;
  const correction = quote.correctionRebuild || null;
  const correctionEligible = correction?.eligible === true;
  const existingBuildAvailable = correction?.mode === "download_existing";
  const grandTotal = Number(quote.totalCredits) + distributionCredits;
  const insufficient = Number(balance) < grandTotal;
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/75 px-4 py-8 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-amber-300/20 bg-[#0a0a0d] p-5 shadow-2xl md:p-7" role="dialog" aria-modal="true" aria-labelledby="build-license-dialog-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">{mode === "correction" ? "Konfirmasi build ulang" : "Langkah terakhir sebelum build"}</div>
            <h2 id="build-license-dialog-title" className="mt-2 font-[Outfit] text-2xl font-black text-white">{mode === "correction" ? `Rebuild Koreksi VST3 ${platform === "macos" ? "macOS" : "Windows"}` : `Lisensi VST3 ${platform === "macos" ? "macOS" : "Windows"}`}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-full border border-white/10 p-2 text-zinc-500 hover:text-white disabled:opacity-40" aria-label="Tutup pilihan lisensi"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5">
          {enabled ? (
            <>
              <p className="text-sm leading-6 text-zinc-400">{showNoSerialOption ? "Pilih build tanpa serial number untuk distribusi bebas, atau gunakan serial number unik dan aktivasi perangkat untuk melindungi plugin." : "Pilih jumlah komputer untuk serial number unik dan aktivasi perangkat yang melindungi plugin."} Setelah aktivasi pertama, plugin berlisensi tetap dapat digunakan offline tanpa batas waktu.</p>
              <div className="maker-license-options" role="radiogroup" aria-label="Jumlah komputer untuk lisensi build">
                {[...(showNoSerialOption ? [0] : []), ...Array.from({ length: maximum }, (_, index) => index + 1)].map((count) => {
                  const credits = Number(pricing.license_activation_credits?.[count] || 0);
                  return (
                    <button key={count} type="button" role="radio" aria-checked={selected === count} className={selected === count ? "is-active" : ""} onClick={() => {
                      onChange(count);
                      if (count === 0) onDistributionChange((current) => ({ ...current, enabled: false }));
                    }}>
                      <strong>{count === 0 ? "Tanpa serial number" : `${count} komputer`}</strong>
                      <span>{count === 0 ? "Tanpa aktivasi" : credits ? `+${formatCredits(credits)}` : "Termasuk"}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-5 text-zinc-500">{selected === 0 ? "Build tidak meminta serial number dan dapat dibuka tanpa aktivasi perangkat." : "Serial diterbitkan saat build masuk antrean dan baru dapat diaktivasi setelah build berhasil."}</p>

              {correction && (
                <div className={`mt-5 rounded-2xl border p-4 ${correctionEligible ? "border-emerald-300/25 bg-emerald-300/[0.06]" : existingBuildAvailable ? "border-sky-300/25 bg-sky-300/[0.06]" : "border-amber-300/15 bg-amber-300/[0.04]"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <strong className={`text-sm ${correctionEligible ? "text-emerald-200" : existingBuildAvailable ? "text-sky-200" : "text-amber-100"}`}>{correctionEligible ? "Rebuild Koreksi tersedia" : existingBuildAvailable ? "Build yang sama sudah tersedia" : "Dihitung sebagai build baru"}</strong>
                      <p className="mt-1 text-xs leading-5 text-zinc-400">{correctionEligible ? `${Number(correction.changed_properties || 0) + Number(correction.added_components || 0) + Number(correction.added_samples || 0)} perubahan ringan terdeteksi. Kesempatan tersisa setelah build: ${Number(correction.remaining_after_build || 0)}.` : existingBuildAvailable ? "Tidak ada perubahan project. Sistem menggunakan hasil build sebelumnya tanpa biaya build baru." : (correction.reasons || ["Project belum memenuhi ketentuan Rebuild Koreksi."]).join(" · ")}</p>
                    </div>
                    {correctionEligible && <div className="text-right"><div className="text-lg font-black text-emerald-300">{formatCredits(correction.charged_credits)}</div><div className="text-[10px] text-zinc-500 line-through">{formatCredits(correction.full_price_credits)}</div></div>}
                  </div>
                  {correctionEligible && (correction.changes || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">{correction.changes.map((change) => <span key={change.section} className="rounded-full border border-emerald-300/15 bg-black/20 px-2.5 py-1 text-[10px] text-emerald-100/80">{change.label} · {change.count}</span>)}</div>
                  )}
                  {correctionEligible && Number(correction.added_item_credits || 0) > 0 && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs"><span className="text-zinc-500">Biaya koreksi 15 kredit + item baru/selisih skin</span><strong className="text-emerald-200">+{formatCredits(correction.added_item_credits)}</strong></div>}
                  {correctionEligible && <div className="mt-3 text-xs font-bold text-emerald-300">Hemat {formatCredits(correction.savings_credits)} · berlaku sampai {new Date(correction.expires_at).toLocaleDateString("id-ID")}</div>}
                  <details className="mt-3 border-t border-white/[0.07] pt-3 text-xs text-zinc-500">
                    <summary className="cursor-pointer font-bold text-zinc-300">Ketentuan Rebuild Koreksi</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 leading-5">
                      <li>Biaya dasar 15 kredit, berlaku 7 hari, maksimal 2 kali.</li>
                      <li>Maksimal 3 komponen dan 3 sample baru tetap termasuk rebuild; harga item baru tetap dibayar.</li>
                      <li>Maksimal 3 komponen boleh berganti skin; hanya selisih harga yang lebih mahal yang ditambahkan dan skin lebih murah tidak mendapat refund.</li>
                      <li>Posisi, ukuran, warna, teks, mapping, dan parameter DSP yang sudah ada dapat diperbaiki.</li>
                      <li>Sample/komponen lama tidak boleh dihapus atau berganti jenis; IR, jenis DSP, identitas produk, dan kapasitas lisensi harus tetap sama.</li>
                      <li>Serial number dan Product ID build sebelumnya digunakan kembali.</li>
                      <li>Build gagal dapat diulang melalui tombol Ulangi build setelah kredit dikembalikan.</li>
                    </ul>
                  </details>
                </div>
              )}

              <div className={`mt-5 rounded-2xl border p-4 transition-colors ${distributionEnabled ? "border-emerald-300/25 bg-emerald-300/[0.05]" : "border-white/[0.08] bg-black/20"}`}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={distributionEnabled}
                    onChange={(event) => {
                      if (event.target.checked && selected === 0) onChange(1);
                      onDistributionChange((current) => ({ ...current, enabled: event.target.checked }));
                    }}
                    className="mt-1 h-4 w-4 accent-emerald-400"
                  />
                  <span>
                    <strong className="flex items-center gap-2 text-sm text-white"><PackagePlus className="h-4 w-4 text-emerald-300" />Lisensi Distribusi</strong>
                    <span className="mt-1 block text-xs leading-5 text-zinc-400">Pilih ini jika VST akan dijual massal. Anda memperoleh kuota serial number unik untuk setiap pembeli, diskon paket, pengiriman lisensi lewat Dashboard atau API, serta kontrol reset perangkat, kirim ulang, revoke, dan arsip lisensi.</span>
                  </span>
                </label>
                {distributionEnabled && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-zinc-500">Jumlah serial
                      <select value={distributionQuantity} onChange={(event) => onDistributionChange((current) => ({ ...current, quantity: Number(event.target.value) }))} className="maker-input mt-1.5">
                        {[10, 50, 100, 1000].map((quantity) => <option key={quantity} value={quantity}>{quantity} serial · diskon {Number(pricing.distribution_pack_discounts?.[quantity] || 0)}%</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-zinc-500">Kapasitas setiap serial
                      <select value={distributionActivations} onChange={(event) => onDistributionChange((current) => ({ ...current, maxActivations: Number(event.target.value) }))} className="maker-input mt-1.5">
                        {[1, 2, 3].map((count) => <option key={count} value={count}>{count} komputer/serial</option>)}
                      </select>
                    </label>
                    <div className="sm:col-span-2 space-y-2 rounded-xl border border-emerald-300/10 bg-black/25 px-3 py-3 text-xs">
                      <div className="flex items-center justify-between gap-3"><span className="text-zinc-500">Harga setiap serial</span><strong className="text-zinc-200">{formatCredits(distributionUnitCredits)}</strong></div>
                      <div className="flex items-center justify-between gap-3"><span className="text-zinc-500">{distributionQuantity} serial × {formatCredits(distributionUnitCredits)}</span><strong className="text-zinc-200">{formatCredits(distributionSubtotal)}</strong></div>
                      <div className="flex items-center justify-between gap-3"><span className="text-zinc-500">Diskon paket {distributionDiscount}%</span><strong className="text-amber-300">−{formatCredits(distributionDiscountCredits)}</strong></div>
                      <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-2"><span className="font-bold text-zinc-300">Total paket distribusi</span><strong className="text-emerald-300">+{formatCredits(distributionCredits)}</strong></div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm leading-6 text-zinc-400">Build tidak memerlukan serial number atau aktivasi perangkat.</p>
          )}
        </div>
        <div className="mt-6 rounded-2xl border border-white/[0.07] bg-black/25 p-4">
          <div className="flex items-center justify-between gap-4"><span className="text-xs text-zinc-500">Total build</span><strong className="text-lg text-white">{formatCredits(grandTotal)}</strong></div>
          {enabled && <div className="mt-2 flex items-center justify-between gap-4 text-xs"><span className="text-zinc-600">{quote.licenseMaxActivations ? `Lisensi ${quote.licenseMaxActivations} komputer` : "Tanpa serial number"}</span><span className="font-bold text-amber-300">{quote.licenseMaxActivations ? (quote.licenseCredits ? `+${formatCredits(quote.licenseCredits)}` : "Termasuk") : "Tanpa aktivasi"}</span></div>}
          {distributionEnabled && <div className="mt-2 flex items-center justify-between gap-4 text-xs"><span className="text-zinc-600">Lisensi distribusi · {distributionQuantity} serial</span><span className="font-bold text-emerald-300">+{formatCredits(distributionCredits)}</span></div>}
          <div className="mt-2 flex items-center justify-between gap-4 text-xs"><span className="text-zinc-600">Saldo tersisa setelah build</span><span className={insufficient ? "font-bold text-red-300" : "font-bold text-emerald-300"}>{formatCredits(Number(balance) - grandTotal)}</span></div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-white/10 px-5 py-3 text-xs font-bold text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40">Kembali</button>
          <button type="button" onClick={onConfirm} disabled={busy || insufficient} className="inline-flex items-center gap-2 rounded-xl bg-[#e11d48] px-5 py-3 text-xs font-black text-white hover:bg-[#be123c] disabled:cursor-not-allowed disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : existingBuildAvailable ? <Download className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}{insufficient ? "Kredit tidak cukup" : busy ? "Mengantrekan…" : existingBuildAvailable ? "Gunakan build tersedia" : correctionEligible ? `Rebuild ${formatCredits(correction.charged_credits)}` : "Lanjutkan build"}</button>
        </div>
      </section>
    </div>
  );
}

function ComponentThumbnail({ variant }) {
  const { kind, style: appearance, id } = variant;
  const assetKind = ["button", "solo", "mute"].includes(kind) ? "button" : ["gain_meter", "vu_meter"].includes(kind) ? "meter" : kind;
  const galleryKnobAssets = {
    "modern-spectrum": VST_KNOB_ASSETS.modernSpectrum,
    "studio-scallop": VST_KNOB_ASSETS.studioScallop,
    "black-precision": VST_KNOB_ASSETS.blackPrecision,
    "pan-ring-black-precision": VST_KNOB_ASSETS.blackPrecision,
    "pan-black-precision": VST_KNOB_ASSETS.blackPrecision,
    "crimson-wing": VST_KNOB_ASSETS.crimsonWing,
    "black-crimson-wing": VST_KNOB_ASSETS.blackCrimsonWing,
    "regent-white-wing": VST_KNOB_ASSETS.regentWhiteWing,
    "pan-ring-black-crimson-wing": VST_KNOB_ASSETS.blackCrimsonWing,
    "pan-black-crimson-wing": VST_KNOB_ASSETS.blackCrimsonWing,
    "graphite-ridge": VST_KNOB_ASSETS.graphiteRidge,
  };
  const asset = appearance === "filmstrip" ? (kind === "knob" ? galleryKnobAssets[id] || (id === "pultec" ? DEFAULT_VST_FILMSTRIP_SKIN.pultecKnob : DEFAULT_VST_FILMSTRIP_SKIN.knob) : DEFAULT_VST_FILMSTRIP_SKIN[assetKind]) : null;
  let preview;
  if (asset) {
    const sprite = <span className={`maker-gallery-sprite maker-gallery-sprite--${assetKind}`} style={filmstripFrameStyle(asset, assetKind === "button" ? 0 : Math.round((asset.frames - 1) * (isPanKnobVariant(id) ? 0.5 : 0.65)))} />;
    preview = isPanLedKnobVariant(id) ? <span className={`maker-gallery-pan-led-shell maker-knob--${id}`}><PanLedRing value={50} type={panLedStyleForVariant(id)} />{sprite}</span> : sprite;
  } else if (kind === "knob") {
    const visualVariant = PAN_LED_KNOB_BASES[id] || id;
    preview = <span className={`maker-rotary-knob maker-knob--${id} ${visualVariant !== id ? `maker-knob--${visualVariant}` : ""}`} style={{ "--knob-angle": isPanKnobVariant(id) ? "0deg" : "40deg", "--knob-progress": "175.5deg" }}>{id === "chicken-head" && <span className="maker-chicken-head-knob__scale"><span>MIN</span><span>MAX</span></span>}{id === "ivory-lever" && <span className="maker-ivory-lever__scale"><span>MIN</span><span>MAX</span></span>}{id === "orbit-encoder" && <OrbitEncoderLights value={65} />}{isPanLedKnobVariant(id) && <PanLedRing value={50} type={panLedStyleForVariant(id)} />}<span className="maker-rotary-knob__indicator" /><span className="maker-rotary-knob__value">{isPanKnobVariant(id) ? "C" : "65"}</span></span>;
  } else if (["button", "solo", "mute"].includes(kind)) {
    preview = (
      <span className={`maker-gallery-button-stage maker-gallery-button-stage--${id} maker-canvas-control--${kind}`}>
        <span className={`maker-panel-button maker-button--${id} maker-css-control maker-panel-button--${kind}`}>
          {kind === "solo" ? "S" : kind === "mute" ? "M" : <>{id === "mechanical-toggle" && <img className="maker-mechanical-toggle-image" src="/images/vst-buttons/mechanical-toggle-off-v4.png" alt="" aria-hidden="true" draggable="false" />}<span className="maker-panel-button__state-label">{id === "toggle" ? "" : "OFF"}</span></>}
        </span>
      </span>
    );
  } else if (kind === "panel_button") {
    const panelLabel = variant.panelType === "preset_browser" ? "PRESETS" : variant.panelType === "mixer" ? "MIXER" : "MIDI";
    preview = <span className="maker-gallery-panel-launcher-stage"><span className={`maker-panel-launcher maker-panel-launcher--${variant.panelType}`}><span>{panelLabel}</span><small>OPEN</small></span></span>;
  } else if (kind === "fader" && ["pitch-bend", "pitch-bend-led", "modulation", "modulation-led"].includes(id)) {
    preview = <KeyboardPerformanceWheel value={id.startsWith("pitch-bend") ? 50 : 68} label={variant.label} spring={id.startsWith("pitch-bend")} led={id.endsWith("-led")} color="#55d9ee" onChange={() => {}} />;
  } else if (kind === "fader") {
    preview = <span className={`maker-panel-fader maker-css-control maker-fader--${id}`} style={{ "--maker-fader-value": "65%" }}><span className="maker-css-fader__track" /><span className="maker-css-fader__fill" /><span className="maker-css-fader__thumb" /></span>;
  } else if (kind === "gain_meter") {
    preview = <span className={`maker-gain-meter maker-meter--${id}`} style={{ "--maker-level": "65%" }}><div><i /></div><span>−6.0 dB</span></span>;
  } else if (kind === "vu_meter") {
    preview = <span className={`maker-vu-meter maker-meter--${id}`}><span className="maker-vu-meter__scale">−20 · −10 · 0 · +3</span><i style={{ transform: "translateX(-50%) rotate(14deg)" }} /><b>VU</b></span>;
  } else if (kind === "keyboard") {
    const pitches = Array.from({ length: 12 }, (_, index) => 36 + index);
    const whitePitches = pitches.filter((pitch) => !isBlackKey(pitch));
    const blackPitches = pitches.filter(isBlackKey);
    preview = (
      <span className={`maker-gallery-keyboard maker-keyboard--${id}`}>
        <span className="maker-sampler-keyboard__white" style={{ "--maker-white-count": whitePitches.length }}>
          {whitePitches.map((pitch, index) => <i key={pitch} className={`maker-sampler-key maker-sampler-key--white ${index === whitePitches.length - 1 ? "is-last" : ""}`} style={{ gridColumn: index + 1 }} />)}
          {blackPitches.map((pitch) => {
            const whitePosition = whitePitches.filter((whitePitch) => whitePitch < pitch).length;
            return <i key={pitch} className="maker-sampler-key maker-sampler-key--black" style={{ left: `calc((${whitePosition} * (100% / ${whitePitches.length})) - ((100% / ${whitePitches.length}) * 0.3))` }} />;
          })}
        </span>
      </span>
    );
  } else if (kind === "spectrum") {
    preview = id === "stereo-vectorscope"
      ? <span className="maker-gallery-vectorscope"><i /><i /><b /><em /></span>
      : <span className={`maker-gallery-spectrum ${id === "pure-spectrum" ? "is-pure" : ""}`}><i /><i /><i /><i /><i /><b /></span>;
  } else if (kind === "visual") {
    preview = <ScaleRing variant={id} color={variant.color} />;
  } else if (kind === "text") {
    preview = <span className="maker-gallery-text-component">YOUR TEXT</span>;
  } else {
    const isPerformancePad = ["performance", "performance-dark"].includes(id);
    preview = <span className={`maker-panel-pad maker-pad--${id} ${isPerformancePad ? "maker-pad--performance" : ""}`} style={{ "--maker-pad-idle": defaultPadSurfaceColor(id), "--maker-pad-color": "#55d9ee", "--maker-accent": "#55d9ee" }}>
      {isPerformancePad && <span className="maker-panel-pad__face" aria-hidden="true"><i /><i /><i /><i /></span>}
      <span className={isPerformancePad ? "maker-panel-pad__content" : ""}><span className="maker-panel-pad__label">PAD</span><span className="maker-panel-pad__note">C3</span></span>
    </span>;
  }
  return <span className="maker-gallery-preview" aria-hidden="true">{preview}</span>;
}

function RotaryKnob({ value, valueText, neutralValue = 50, label, onChange, onInteract, disabled = false, variant = "classic", asset = DEFAULT_VST_FILMSTRIP_SKIN.knob }) {
  const dragRef = useRef(null);
  const isPanKnob = isPanKnobVariant(variant);
  const visualVariant = PAN_LED_KNOB_BASES[variant] || variant;
  const setFromKey = (event) => {
    const increments = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (!(event.key in increments)) return;
    event.preventDefault();
    onChange(Math.max(0, Math.min(100, value + increments[event.key])));
  };

  return (
    <button
      type="button"
      disabled={disabled}
      role="slider"
      aria-label={`${label} nilai`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={valueText || (isPanKnob ? (value === 50 ? "Center" : value < 50 ? `Left ${100 - value * 2}%` : `Right ${(value - 50) * 2}%`) : `${value}%`)}
      className={`maker-rotary-knob maker-knob--${variant} ${visualVariant !== variant ? `maker-knob--${visualVariant}` : ""} ${asset ? `maker-filmstrip-control ${asset.staticFace ? "maker-static-knob-asset" : ""}` : "maker-css-control"}`}
      style={asset ? { ...filmstripFrameStyle(asset, (value / 100) * (asset.frames - 1)), "--knob-angle": `${-135 + (value * 2.7)}deg` } : { "--knob-angle": `${-135 + (value * 2.7)}deg`, "--knob-progress": `${value * 2.7}deg` }}
      onPointerDown={(event) => {
        event.preventDefault();
        onInteract?.();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value };
      }}
      onPointerMove={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
        const delta = Math.round((dragRef.current.startY - event.clientY) / 2);
        onChange(Math.max(0, Math.min(100, dragRef.current.startValue + delta)));
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onInteract?.();
        onChange(neutralValue);
      }}
      title={`Double-click untuk kembali ke nilai netral (${neutralValue})`}
      onFocus={() => onInteract?.()}
      onKeyDown={(event) => { onInteract?.(); setFromKey(event); }}
    >
      {asset ? <>{isPanLedKnobVariant(variant) && <PanLedRing value={value} type={panLedStyleForVariant(variant)} />}{asset.staticFace && <span className="maker-static-knob-asset__indicator" />}<span className="maker-control-value-readout">{valueText || (isPanKnob ? value === 50 ? "C" : value < 50 ? `L${100 - value * 2}` : `R${(value - 50) * 2}` : value)}</span></> : <>{variant === "chicken-head" && <span className="maker-chicken-head-knob__scale" aria-hidden="true"><span>MIN</span><span>MAX</span></span>}{variant === "ivory-lever" && <span className="maker-ivory-lever__scale" aria-hidden="true"><span>MIN</span><span>MAX</span></span>}{variant === "orbit-encoder" && <OrbitEncoderLights value={value} />}{isPanLedKnobVariant(variant) && <PanLedRing value={value} type={panLedStyleForVariant(variant)} />}<span className="maker-rotary-knob__indicator" /><span className="maker-rotary-knob__value">{valueText || (isPanKnob ? value === 50 ? "C" : value < 50 ? `L${100 - value * 2}` : `R${(value - 50) * 2}` : value)}</span></>}
    </button>
  );
}

function FilmstripButton({ value, label, offLabel, onLabel, inverted = false, kind = "button", variant = "classic", onChange, asset = DEFAULT_VST_FILMSTRIP_SKIN.button }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const active = inverted ? Number(value) < 50 : Number(value) > 0;
  const stateLabel = active ? (onLabel ?? "ON") : (offLabel ?? label ?? "");
  const frame = pressed ? (active ? 3 : 2) : hovered ? (active ? 5 : 4) : active ? 1 : 0;
  return (
    <button
      type="button"
      aria-label={label || "Button"}
      aria-pressed={active}
      className={`maker-panel-button maker-button--${variant} ${asset ? "maker-filmstrip-control" : `maker-css-control maker-panel-button--${kind} ${active ? "is-on" : ""}`}`}
      style={asset ? filmstripFrameStyle(asset, frame) : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => { setHovered(false); setPressed(false); }}
      onPointerDown={(event) => { event.stopPropagation(); setPressed(true); }}
      onPointerUp={() => setPressed(false)}
      onClick={(event) => {
        event.stopPropagation();
        onChange(inverted ? (active ? 100 : 0) : (active ? 0 : 100));
      }}
    >{kind === "solo" ? (asset ? null : "S") : kind === "mute" ? (asset ? null : "M") : <>{variant === "mechanical-toggle" && <img className="maker-mechanical-toggle-image" src={`/images/vst-buttons/mechanical-toggle-${active ? "on" : "off"}-v4.png`} alt="" aria-hidden="true" draggable="false" />}<span className="maker-panel-button__state-label">{stateLabel}</span></>}</button>
  );
}

function KeyboardPerformanceWheel({ value, label, spring = false, led = false, color = "#fb7185", disabled = false, onChange }) {
  const dragRef = useRef(null);
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  const updateFromPointer = (event) => {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextValue = Math.round((1 - ((event.clientY - bounds.top) / Math.max(1, bounds.height))) * 100);
    onChange(Math.max(0, Math.min(100, nextValue)));
  };
  const release = () => {
    dragRef.current = null;
    if (spring && !disabled) onChange(50);
  };
  const displayValue = spring
    ? normalized === 50 ? "0 st" : `${normalized > 50 ? "+" : ""}${(((normalized - 50) / 50) * 2).toFixed(1)} st`
    : `${Math.round(normalized)}%`;
  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`${label} nilai`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
      aria-valuetext={displayValue}
      className={`maker-keyboard-wheel ${spring ? "maker-keyboard-wheel--pitch" : "maker-keyboard-wheel--modulation"} ${led ? "maker-keyboard-wheel--led" : ""} ${disabled ? "is-disabled" : ""}`}
      style={{ "--maker-wheel-value": `${normalized}%`, "--maker-wheel-color": isHexColor(color) ? color : "#fb7185" }}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = event.pointerId;
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragRef.current !== event.pointerId) return;
        updateFromPointer(event);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onBlur={() => { if (spring && !disabled) onChange(50); }}
      onKeyDown={(event) => {
        if (disabled) return;
        const increments = { ArrowUp: 2, ArrowRight: 2, ArrowDown: -2, ArrowLeft: -2, PageUp: 10, PageDown: -10 };
        if (!(event.key in increments)) return;
        event.preventDefault();
        onChange(Math.max(0, Math.min(100, normalized + increments[event.key])));
      }}
      onKeyUp={(event) => {
        if (spring && ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "PageUp", "PageDown"].includes(event.key)) onChange(50);
      }}
    >
      {led ? <>
        <span className="maker-keyboard-wheel__led-track" aria-hidden="true">
          <i style={{ height: `${normalized}%` }} />
        </span>
        <span className="maker-keyboard-wheel__plain-slider" aria-hidden="true" />
      </> : <>
        <span className="maker-keyboard-wheel__slot" aria-hidden="true" />
        <span className="maker-keyboard-wheel__wheel" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span className="maker-keyboard-wheel__value" aria-hidden="true">{displayValue}</span>
      </>}
    </div>
  );
}

function FilmstripFader({ value, neutralValue = 50, valueText = `${value}%`, showUnityMarker = false, label, onChange, variant = "classic", asset = DEFAULT_VST_FILMSTRIP_SKIN.fader }) {
  const dragRef = useRef(null);
  const setFromKey = (event) => {
    const increments = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (!(event.key in increments)) return;
    event.preventDefault();
    onChange(Math.max(0, Math.min(100, value + increments[event.key])));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${label} nilai`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={`maker-panel-fader maker-fader--${variant} ${asset ? "maker-filmstrip-control" : "maker-css-control"}`}
      style={asset ? { ...filmstripFrameStyle(asset, (value / 100) * (asset.frames - 1)), "--maker-neutral-position": `${neutralValue}%` } : { "--maker-fader-value": `${value}%`, "--maker-neutral-position": `${neutralValue}%` }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value };
      }}
      onPointerMove={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
        const delta = Math.round((dragRef.current.startY - event.clientY) / 2);
        onChange(Math.max(0, Math.min(100, dragRef.current.startValue + delta)));
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onChange(neutralValue);
        toast.success(`${label || "Fader"} dikembalikan ke ${showUnityMarker ? "0 dB" : `nilai netral ${neutralValue}`}`);
      }}
      title={`${valueText} · Double-click untuk kembali ke ${showUnityMarker ? "0 dB" : `nilai netral ${neutralValue}`}`}
      onKeyDown={setFromKey}
    >
      {!asset && <><span className="maker-css-fader__track" /><span className="maker-css-fader__fill" /><span className="maker-css-fader__thumb" /></>}
      {showUnityMarker && <span className="maker-fader-unity-marker" aria-hidden="true"><i />0</span>}
      <span className="maker-fader-value-readout" aria-hidden="true">{valueText}</span>
    </div>
  );
}

function attachStereoMeterTap(context, analyser) {
  if (!context || !analyser || analyser._vstMeterChannels) return analyser?._vstMeterChannels || null;
  const splitter = context.createChannelSplitter(2);
  const channels = [context.createAnalyser(), context.createAnalyser()];
  const silent = context.createGain();
  silent.gain.value = 0;
  channels.forEach((channel, index) => {
    channel.fftSize = analyser.fftSize;
    channel.smoothingTimeConstant = analyser.smoothingTimeConstant;
    splitter.connect(channel, index);
    channel.connect(silent);
  });
  analyser.connect(splitter);
  silent.connect(context.destination);
  analyser._vstMeterChannels = channels;
  analyser._vstMeterSplitter = splitter;
  analyser._vstMeterSilent = silent;
  return channels;
}

function attachDspMeterTarget(processor, target) {
  if (!processor?.port || !target) return;
  target._vstDspMeterProcessor = processor;
  target._vstGainReduction = 0;
  target._vstGainReductionById = {};
  processor.port.onmessage = ({ data }) => {
    if (target._vstDspMeterProcessor !== processor || data?.type !== "meter") return;
    target._vstGainReduction = Math.max(0, Math.min(1, Number(data.gainReduction) || 0));
    target._vstGainReductionById = data.gainReductionById || {};
  };
}

function whenDspProcessorReady(processor, callback) {
  if (!processor?.port || typeof callback !== "function") return;
  const handleMessage = ({ data }) => {
    if (data?.type !== "ready") return;
    processor.port.removeEventListener?.("message", handleMessage);
    callback();
  };
  processor.port.addEventListener?.("message", handleMessage);
  processor.port.start?.();
}

function PreviewOutputMeter({ kind, meterSource = "output_level", moduleId = null, meterMode = "mono", variant = "led", analyserRef, analyserProvider, accentColor, captureLevel, asset = DEFAULT_VST_FILMSTRIP_SKIN.meter }) {
  const [level, setLevel] = useState({ peak: [0, 0], rms: [0, 0], reduction: 0 });
  useEffect(() => {
    let frame = 0;
    let channelData = [null, null];
    const measure = (analyser, index) => {
      if (!channelData[index] || channelData[index].length !== analyser.fftSize) channelData[index] = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(channelData[index]);
      let peak = 0;
      let energy = 0;
      for (let sample = 0; sample < channelData[index].length; sample += 1) {
        const value = channelData[index][sample];
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
      }
      return { peak, rms: Math.sqrt(energy / Math.max(1, channelData[index].length)) };
    };
    const update = () => {
      const analyser = analyserProvider?.() || analyserRef?.current;
      if (analyser) {
        const rawReduction = moduleId && Object.prototype.hasOwnProperty.call(analyser._vstGainReductionById || {}, moduleId)
          ? analyser._vstGainReductionById[moduleId]
          : analyser._vstGainReductionProvider?.() ?? analyser._vstGainReduction ?? 0;
        const sources = analyser._vstMeterChannels || [analyser, analyser];
        const measured = [measure(sources[0], 0), measure(sources[1] || sources[0], 1)];
        setLevel((current) => ({
          peak: measured.map((item, index) => Math.max(item.peak, current.peak[index] * 0.82)),
          rms: measured.map((item, index) => Math.max(item.rms, current.rms[index] * 0.9)),
          reduction: Math.max(Number(rawReduction) || 0, current.reduction * 0.88),
        }));
      } else {
        setLevel((current) => ({ peak: current.peak.map((value) => value * 0.82), rms: current.rms.map((value) => value * 0.9), reduction: current.reduction * 0.88 }));
      }
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [analyserRef, analyserProvider, moduleId]);
  const isGainReduction = meterSource === "gain_reduction";
  const scale = kind === "vu_meter" ? 2.8 : 1.5;
  const rawLevels = captureLevel === undefined ? (isGainReduction ? [level.reduction, level.reduction] : kind === "vu_meter" ? level.rms : level.peak) : [captureLevel, captureLevel];
  const channels = rawLevels.map((value) => Math.max(0, Math.min(1, Number(value || 0) * (captureLevel === undefined && !isGainReduction ? scale : 1))));
  const displayed = meterMode === "stereo" ? channels : [Math.max(...channels)];
  if (asset) {
    return <div className={`maker-filmstrip-meter-group is-${meterMode}`} role="meter" aria-label={isGainReduction ? "Gain reduction" : kind === "vu_meter" ? "VU level" : "Output level"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(...displayed) * 100)}>{displayed.map((value, index) => <div key={index} className="maker-filmstrip-meter maker-filmstrip-control" data-channel={meterMode === "stereo" ? (index ? "R" : "L") : undefined} style={filmstripFrameStyle(asset, value * (asset.frames - 1))} />)}</div>;
  }
  if (kind === "vu_meter") {
    return <div className={`maker-vu-meter-group is-${meterMode}`}>{displayed.map((value, index) => <div key={index} className={`maker-vu-meter maker-meter--${variant}`} style={{ "--maker-accent": accentColor }}><span className="maker-vu-meter__scale">{isGainReduction ? <>0&nbsp;&nbsp;3&nbsp;&nbsp;6&nbsp;&nbsp;12&nbsp;&nbsp;24</> : <>−20&nbsp;&nbsp;−10&nbsp;&nbsp;−3&nbsp;&nbsp;0&nbsp;&nbsp;+3</>}</span><i style={{ transform: `translateX(-50%) rotate(${-48 + value * 96}deg)` }} /><b>{isGainReduction ? "GR" : meterMode === "stereo" ? (index ? "R" : "L") : "VU"}</b></div>)}</div>;
  }
  const maximum = Math.max(...displayed);
  return <div className={`maker-gain-meter maker-meter--${variant} is-${meterMode}`} style={{ "--maker-accent": accentColor }}><div className="maker-gain-meter__channels">{displayed.map((value, index) => <i key={index} data-channel={meterMode === "stereo" ? (index ? "R" : "L") : undefined} style={{ "--maker-level": `${value * 100}%` }} />)}</div><span>{isGainReduction ? `${(maximum * 24).toFixed(1)} dB GR` : maximum > 0.001 ? `${Math.max(-60, 20 * Math.log10(maximum)).toFixed(1)} dB` : "−∞ dB"}</span></div>;
}

function PrismSpectrumDisplay({ analyserRef, prismModule, onParameterChange, onBandSelect, onBandDelete, selectedBandIndex = 1, accentColor, interactive = true, style }) {
  const canvasRef = useRef(null);
  const shellRef = useRef(null);
  const dragRef = useRef(null);
  const bandControls = useMemo(() => {
    if (!interactive || !prismModule) return [];
    const parameters = prismModule.parameters || {};
    return PRISM_BAND_SLOTS.map((defaults) => ({
      ...defaults,
      enabled: Number(parameters[`band_${defaults.index}_enabled`] ?? 0) >= 0.5,
      frequency: prismSliderToFrequency(Number(parameters[`band_${defaults.index}_frequency`] ?? prismFrequencyToSlider(defaults.frequency) / 1000) * 1000),
      gain: defaults.index === 1 ? 0.5 : Number(parameters[`band_${defaults.index}_gain`] ?? 0.5),
      q: prismSliderToQ(Number(parameters[`band_${defaults.index}_q`] ?? prismQToSlider(defaults.q) / 1000) * 1000),
    })).filter((band) => band.enabled);
  }, [interactive, prismModule]);
  const selectedBandControl = bandControls.find((band) => band.index === selectedBandIndex) || null;

  useEffect(() => {
    let frame = 0;
    let lastDrawAt = 0;
    let frequencyData = null;
    let smoothed = [];
    const frequencies = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000];
    const frequencyX = (frequency, width) => Math.log(frequency / 10) / Math.log(3000) * width;

    const draw = (timestamp = 0) => {
      frame = window.requestAnimationFrame(draw);
      if (timestamp - lastDrawAt < 40) return;
      lastDrawAt = timestamp;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const ratio = Math.min(1.25, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      context.lineWidth = 1;
      context.strokeStyle = "rgba(148, 210, 255, 0.12)";
      frequencies.forEach((frequency) => {
        const x = frequencyX(frequency, width);
        context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
      });
      for (let index = 1; index < 5; index += 1) {
        const y = (height / 5) * index;
        context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
      }

      const analyser = analyserRef?.current;
      const points = Math.max(72, Math.min(128, Math.round(width / 6)));
      if (smoothed.length !== points) smoothed = Array(points).fill(0);
      if (analyser) {
        if (!frequencyData || frequencyData.length !== analyser.frequencyBinCount) frequencyData = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(frequencyData);
        const nyquist = analyser.context.sampleRate / 2;
        for (let index = 0; index < points; index += 1) {
          const frequency = 10 * (3000 ** (index / Math.max(1, points - 1)));
          const bin = Math.min(frequencyData.length - 1, Math.max(0, Math.round((frequency / nyquist) * frequencyData.length)));
          const db = Number.isFinite(frequencyData[bin]) ? frequencyData[bin] : -100;
          const normalized = Math.max(0, Math.min(1, (db + 100) / 88));
          smoothed[index] = Math.max(normalized, smoothed[index] * 0.91);
        }
      } else {
        for (let index = 0; index < smoothed.length; index += 1) smoothed[index] *= 0.86;
      }

      // Smooth neighbouring FFT bins so the spectral silhouette is fluid
      // without slowing its response to real audio changes.
      const shapedSpectrum = smoothed.map((_, index) => {
        let total = 0; let weightTotal = 0;
        for (let offset = -4; offset <= 4; offset += 1) {
          const sampleIndex = Math.max(0, Math.min(smoothed.length - 1, index + offset));
          const weight = 5 - Math.abs(offset);
          total += smoothed[sampleIndex] * weight;
          weightTotal += weight;
        }
        return total / weightTotal;
      });

      context.beginPath();
      context.moveTo(0, height);
      shapedSpectrum.forEach((value, index) => {
        const x = index / Math.max(1, points - 1) * width;
        const y = height - (value * height * 0.9);
        context.lineTo(x, y);
      });
      context.lineTo(width, height);
      context.closePath();
      const analyzerColor = isHexColor(accentColor) ? accentColor : "#22D3EE";
      const spectrumFill = context.createLinearGradient(0, 0, 0, height);
      spectrumFill.addColorStop(0, hexColorWithAlpha(analyzerColor, 0.5));
      spectrumFill.addColorStop(0.55, hexColorWithAlpha(analyzerColor, 0.2));
      spectrumFill.addColorStop(1, hexColorWithAlpha(analyzerColor, 0.03));
      context.fillStyle = spectrumFill;
      context.fill();
      context.strokeStyle = hexColorWithAlpha(analyzerColor, 0.78);
      context.lineWidth = 1.3;
      context.stroke();

      if (interactive) {
      const bandSpread = (q) => Math.max(0.06, Math.min(3.5, 0.85 / Math.sqrt(q)));
      const curvePoints = Math.max(240, Math.min(480, Math.round(width / 2)));
      context.beginPath();
      for (let index = 0; index < curvePoints; index += 1) {
        const frequency = 10 * (3000 ** (index / Math.max(1, curvePoints - 1)));
        const gaussian = (center, spread) => Math.exp(-0.5 * ((Math.log(frequency / center) / spread) ** 2));
        const response = bandControls.reduce((sum, band) => {
          if (band.index === 1) {
            const ratio = frequency / Math.max(10, band.frequency);
            const magnitude = (ratio ** 2) / Math.sqrt((((1 - (ratio ** 2)) ** 2) + ((ratio / band.q) ** 2)));
            return sum + Math.max(-72, Math.min(36, 20 * Math.log10(Math.max(0.000001, magnitude))));
          }
          return sum + ((band.gain - 0.5) * 24) * gaussian(band.frequency, bandSpread(band.q));
        }, 0);
        const x = index / Math.max(1, curvePoints - 1) * width;
        const y = Math.max(3, Math.min(height - 3, (height * 0.5) - ((response / 36) * height)));
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.save();
      context.shadowBlur = 13;
      context.shadowColor = accentColor || "#22d3ee";
      context.strokeStyle = accentColor || "#22d3ee";
      context.lineWidth = 2.2;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
      context.restore();
      }

      context.fillStyle = "rgba(186, 230, 253, 0.56)";
      context.font = `${Math.max(7, Math.min(10, width / 115))}px ui-monospace, monospace`;
      context.textAlign = "center";
      [[10, "10"], [100, "100"], [1000, "1k"], [10000, "10k"], [30000, "30k"]].forEach(([frequency, label]) => {
        context.fillText(label, frequencyX(frequency, width), height - 5);
      });

    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [accentColor, analyserRef, bandControls, interactive]);

  const updateBandFromPointer = (event, band) => {
    const bounds = shellRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds?.height) return;
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(1 / 6, Math.min(5 / 6, (event.clientY - bounds.top) / bounds.height));
    onParameterChange?.({
      [`band_${band.index}_frequency`]: x,
      ...(band.index !== 1 ? { [`band_${band.index}_gain`]: Math.max(0, Math.min(1, 0.5 + ((0.5 - y) * 1.5))) } : {}),
    });
  };

  return (
    <div
      ref={shellRef}
      className="maker-prism-spectrum"
      style={{ ...style, "--spectrum-color": isHexColor(accentColor) ? accentColor : "#22D3EE" }}
      aria-label={interactive ? "Prism interactive real-time frequency spectrum" : "Pure real-time frequency spectrum"}
      title={interactive ? "Klik ganda untuk menambah band · pilih titik lalu hapus dari panel" : "FFT output real-time tanpa kontrol EQ"}
      onDoubleClick={(event) => {
        if (!interactive) return;
        event.preventDefault(); event.stopPropagation();
        const bounds = shellRef.current?.getBoundingClientRect();
        if (!bounds?.width || !bounds?.height) return;
        const missing = PRISM_BAND_SLOTS.filter((band) => !bandControls.some((active) => active.index === band.index));
        if (!missing.length) { toast.error("Maksimal lima band DSP Prism"); return; }
        const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        const y = Math.max(1 / 6, Math.min(5 / 6, (event.clientY - bounds.top) / bounds.height));
        const frequency = 10 * (3000 ** x);
        const band = missing.reduce((best, candidate) => Math.abs(Math.log(candidate.frequency / frequency)) < Math.abs(Math.log(best.frequency / frequency)) ? candidate : best, missing[0]);
        onParameterChange?.({
          [`band_${band.index}_enabled`]: 1,
          [`band_${band.index}_frequency`]: x,
          [`band_${band.index}_q`]: prismQToSlider(band.q) / 1000,
          ...(band.index !== 1 ? { [`band_${band.index}_gain`]: Math.max(0, Math.min(1, 0.5 + ((0.5 - y) * 1.5))) } : {}),
        });
        onBandSelect?.(band.index);
      }}
    >
      <canvas ref={canvasRef} className="maker-prism-spectrum__canvas" />
      {interactive && <div className="maker-prism-spectrum__nodes" aria-label="EQ bands">
        {bandControls.map((band) => {
          const gain = band.index === 1 ? 0 : (band.gain - 0.5) * 24;
          const selected = selectedBandControl?.index === band.index;
          return (
            <button
              key={band.index}
              type="button"
              className={`maker-prism-spectrum__node ${selected ? "is-selected" : ""}`}
              style={{ left: `${prismFrequencyToSlider(band.frequency) / 10}%`, top: `${50 - ((gain / 36) * 100)}%`, "--band-index": band.index - 1 }}
              aria-label={`${band.label}, ${formatPrismFrequency(band.frequency)}, Q ${band.q}`}
              title="Seret kiri/kanan untuk Frequency · atas/bawah untuk Gain · scroll untuk Q"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragRef.current = { pointerId: event.pointerId, bandIndex: band.index };
                onBandSelect?.(band.index);
                updateBandFromPointer(event, band);
              }}
              onPointerMove={(event) => {
                if (dragRef.current?.pointerId === event.pointerId && dragRef.current.bandIndex === band.index) updateBandFromPointer(event, band);
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
              }}
              onPointerCancel={() => { dragRef.current = null; }}
              onClick={(event) => { event.stopPropagation(); onBandSelect?.(band.index); }}
              onWheel={(event) => {
                event.preventDefault(); event.stopPropagation();
                onBandSelect?.(band.index);
                const nextSlider = Math.max(0, Math.min(1000, prismQToSlider(band.q) - (Math.sign(event.deltaY) * 24)));
                onParameterChange?.(`band_${band.index}_q`, nextSlider / 1000);
              }}
            ><span>{band.index}</span></button>
          );
        })}
      </div>}
      {interactive && selectedBandControl && (
        <div className="maker-prism-spectrum__band-panel" onPointerDown={(event) => event.stopPropagation()}>
          <strong>{selectedBandControl.label}</strong>
          <output>{formatPrismFrequency(selectedBandControl.frequency)} · Q {Number(selectedBandControl.q).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}</output>
          <button type="button" className="maker-prism-spectrum__delete-band" onClick={(event) => {
            event.stopPropagation();
            onBandDelete?.(selectedBandControl.index, bandControls.filter((band) => band.index !== selectedBandControl.index).map((band) => band.index));
            onParameterChange?.(`band_${selectedBandControl.index}_enabled`, 0);
          }}>HAPUS</button>
        </div>
      )}
    </div>
  );
}

function StereoVectorscopeDisplay({ analyserRef, accentColor, showCorrelationMeter = true }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    let frame = 0;
    let leftData = null;
    let rightData = null;
    let smoothedCorrelation = 0;
    const draw = () => {
      frame = window.requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const ratio = Math.min(1.25, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const color = isHexColor(accentColor) ? accentColor : "#F59E0B";
      const meterHeight = showCorrelationMeter ? Math.max(25, Math.min(36, height * 0.13)) : 0;
      const scopeHeight = height - meterHeight;
      const centerX = width / 2;
      const centerY = scopeHeight / 2;
      const radius = Math.max(8, Math.min(width, scopeHeight) * 0.43);

      context.strokeStyle = hexColorWithAlpha(color, 0.16);
      context.lineWidth = 1;
      context.beginPath(); context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.stroke();
      context.beginPath(); context.moveTo(centerX - radius, centerY); context.lineTo(centerX + radius, centerY); context.moveTo(centerX, centerY - radius); context.lineTo(centerX, centerY + radius); context.stroke();
      context.save(); context.translate(centerX, centerY); context.rotate(Math.PI / 4);
      context.beginPath(); context.moveTo(-radius, 0); context.lineTo(radius, 0); context.moveTo(0, -radius); context.lineTo(0, radius); context.stroke(); context.restore();

      const analyser = analyserRef?.current;
      const channels = analyser?._vstMeterChannels || (analyser ? [analyser, analyser] : []);
      let correlation = smoothedCorrelation * 0.96;
      if (channels[0]) {
        const size = Math.min(1024, channels[0].fftSize || 512);
        if (!leftData || leftData.length !== size) { leftData = new Float32Array(size); rightData = new Float32Array(size); }
        channels[0].getFloatTimeDomainData(leftData);
        (channels[1] || channels[0]).getFloatTimeDomainData(rightData);
        let cross = 0; let leftEnergy = 0; let rightEnergy = 0;
        context.beginPath();
        for (let index = 0; index < size; index += 2) {
          const left = leftData[index] || 0;
          const right = rightData[index] || 0;
          cross += left * right; leftEnergy += left * left; rightEnergy += right * right;
          const x = centerX + ((right - left) * radius * 0.72);
          const y = centerY - ((left + right) * radius * 0.72);
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        const denominator = Math.sqrt(leftEnergy * rightEnergy);
        correlation = denominator > 1e-8 ? Math.max(-1, Math.min(1, cross / denominator)) : 0;
        context.save();
        context.strokeStyle = hexColorWithAlpha(color, 0.78);
        context.shadowColor = color; context.shadowBlur = 8; context.lineWidth = 1.15;
        context.stroke(); context.restore();
      }
      smoothedCorrelation += (correlation - smoothedCorrelation) * 0.18;
      if (showCorrelationMeter) {
        const barLeft = width * 0.1; const barRight = width * 0.9; const barY = scopeHeight + meterHeight * 0.43;
        context.strokeStyle = hexColorWithAlpha(color, 0.25);
        context.beginPath(); context.moveTo(barLeft, barY); context.lineTo(barRight, barY); context.stroke();
        const zeroX = (barLeft + barRight) / 2;
        const valueX = zeroX + smoothedCorrelation * ((barRight - barLeft) / 2);
        context.fillStyle = hexColorWithAlpha(color, 0.24);
        context.fillRect(Math.min(zeroX, valueX), barY - 4, Math.abs(valueX - zeroX), 8);
        context.fillStyle = color; context.beginPath(); context.arc(valueX, barY, 5, 0, Math.PI * 2); context.fill();
        context.fillStyle = hexColorWithAlpha(color, 0.75); context.font = "8px ui-monospace, monospace"; context.textAlign = "center";
        context.fillText("−1", barLeft, barY + 14); context.fillText("0", zeroX, barY + 14); context.fillText("+1", barRight, barY + 14);
      }
      context.textAlign = "left"; context.fillText("L", 7, centerY); context.textAlign = "right"; context.fillText("R", width - 7, centerY);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [accentColor, analyserRef, showCorrelationMeter]);
  return <div className="maker-prism-spectrum maker-stereo-vectorscope" style={{ inset: 0, "--spectrum-color": isHexColor(accentColor) ? accentColor : "#F59E0B" }} aria-label="Stereo vectorscope and phase correlation meter"><canvas ref={canvasRef} className="maker-prism-spectrum__canvas" /></div>;
}

function SamplerPad({ controlId, label, notePitch, velocity, accentColor, padColor, padActiveColor, variant = "rubber", externalPressed = false, onNoteOn, onNoteOff }) {
  const activeRef = useRef(false);
  const tokenRef = useRef(null);
  const [pressed, setPressed] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const flashTimerRef = useRef(null);
  const hitPad = ["hit-effect", "diffuse-hit", "smooth-diffuse-hit"].includes(variant);
  const triggerFlash = useCallback(() => {
    if (!hitPad) return;
    window.clearTimeout(flashTimerRef.current);
    setFlashActive(true);
    flashTimerRef.current = window.setTimeout(() => setFlashActive(false), 115);
  }, [hitPad]);
  useEffect(() => () => window.clearTimeout(flashTimerRef.current), []);
  useEffect(() => { if (externalPressed) triggerFlash(); }, [externalPressed, triggerFlash]);
  const begin = (event) => {
    if (activeRef.current || (event.type === "keydown" && event.repeat)) return;
    event.preventDefault();
    if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId);
    activeRef.current = true;
    tokenRef.current = `pad-${controlId}-${makeId()}`;
    setPressed(true);
    triggerFlash();
    onNoteOn(notePitch, velocity, tokenRef.current);
  };
  const end = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setPressed(false);
    onNoteOff(tokenRef.current);
    tokenRef.current = null;
  };
  const visualRenderHoldsFrame = typeof document !== "undefined" && document.body.classList.contains("vst-visual-render");
  const hitActive = hitPad ? (visualRenderHoldsFrame ? externalPressed : flashActive) : pressed || externalPressed;
  const performancePad = ["performance", "performance-dark"].includes(variant);
  const performanceDark = variant === "performance-dark";
  const resolvedPadColor = isHexColor(padColor) ? padColor : defaultPadSurfaceColor(variant);
  const resolvedActiveColor = isHexColor(padActiveColor) ? padActiveColor : defaultPadActiveColor(variant, notePitch, accentColor);

  return (
    <button
      type="button"
      className={`maker-panel-pad maker-pad--${variant} ${performancePad ? "maker-pad--performance" : ""} ${performanceDark ? "maker-pad--performance-dark" : ""} ${hitActive ? "is-pressed" : ""}`}
      style={{ "--maker-accent": resolvedActiveColor, "--maker-pad-color": resolvedActiveColor, "--maker-pad-idle": resolvedPadColor }}
      aria-label={`Mainkan pad ${label} pada ${midiNoteName(notePitch)}`}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") begin(event); }}
      onKeyUp={(event) => { if (event.key === "Enter" || event.key === " ") end(); }}
      onBlur={end}
    >
      <span className="maker-panel-pad__led" aria-hidden="true" />
      <span className="maker-panel-pad__face" aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="maker-panel-pad__content">
        <span className="maker-panel-pad__note">{midiNoteName(notePitch)}</span>
        <span className="maker-panel-pad__label">{label}</span>
        <span className="maker-panel-pad__meter" aria-hidden="true"><i style={{ width: `${Math.max(12, velocity / 1.27)}%` }} /></span>
      </span>
    </button>
  );
}

function SampleWaveformEditor({ sample, mapping, accentColor, playback, onChange }) {
  const [waveform, setWaveform] = useState({ peaks: [], duration: 0, loading: false, error: "" });
  const [playheadPosition, setPlayheadPosition] = useState(null);
  const rawAuditionRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!sample?.file) {
      setWaveform({ peaks: [], duration: 0, loading: false, error: "" });
      return undefined;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setWaveform({ peaks: [], duration: 0, loading: false, error: "Preview waveform tidak didukung browser ini." });
      return undefined;
    }
    setWaveform({ peaks: [], duration: 0, loading: true, error: "" });
    const context = new AudioContextClass();
    sample.file.arrayBuffer()
      .then((buffer) => context.decodeAudioData(buffer))
      .then((audioBuffer) => {
        if (cancelled) return;
        const channel = audioBuffer.getChannelData(0);
        const barCount = 160;
        const blockSize = Math.max(1, Math.floor(channel.length / barCount));
        const peaks = Array.from({ length: barCount }, (_, index) => {
          const start = index * blockSize;
          const end = Math.min(channel.length, start + blockSize);
          let peak = 0;
          for (let cursor = start; cursor < end; cursor += 1) peak = Math.max(peak, Math.abs(channel[cursor]));
          return peak;
        });
        const maximum = Math.max(...peaks, 0.001);
        setWaveform({ peaks: peaks.map((peak) => peak / maximum), duration: audioBuffer.duration, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setWaveform({ peaks: [], duration: 0, loading: false, error: "Waveform gagal dibaca. File tetap dapat dipakai untuk mapping." });
      })
      .finally(() => context.close().catch(() => {}));
    return () => { cancelled = true; context.close().catch(() => {}); };
  }, [sample]);

  useEffect(() => {
    const audio = playback?.mappingId === mapping.id && playback?.sampleId === sample?.id ? playback.audio : null;
    if (!audio) {
      setPlayheadPosition(null);
      return undefined;
    }
    let frame = null;
    const update = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setPlayheadPosition(Math.max(0, Math.min(1, audio.currentTime / audio.duration)));
      }
      if (!audio.paused && !audio.ended) frame = window.requestAnimationFrame(update);
      else setPlayheadPosition(null);
    };
    update();
    return () => { if (frame) window.cancelAnimationFrame(frame); };
  }, [mapping.id, playback, sample?.id]);

  const sampleStart = mapping.sampleStart ?? 0;
  const sampleEnd = mapping.sampleEnd ?? 1;
  const loopStart = mapping.loopStart ?? sampleStart;
  const loopEnd = mapping.loopEnd ?? sampleEnd;
  const updateStart = (value) => {
    const nextStart = Math.min(Number(value), sampleEnd - 0.001);
    const nextLoopStart = Math.max(nextStart, loopStart);
    onChange({ sampleStart: nextStart, loopStart: nextLoopStart, loopEnd: Math.max(nextLoopStart + 0.001, loopEnd) });
  };
  const updateEnd = (value) => {
    const nextEnd = Math.max(Number(value), sampleStart + 0.001);
    const nextLoopEnd = Math.min(nextEnd, loopEnd);
    onChange({ sampleEnd: nextEnd, loopEnd: nextLoopEnd, loopStart: Math.min(loopStart, nextLoopEnd - 0.001) });
  };
  const beginAudition = (event) => {
    event.preventDefault();
    if (!sample?.file || rawAuditionRef.current) return;
    if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId);
    const url = URL.createObjectURL(sample.file);
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = 1;
    audio.playbackRate = 1;
    rawAuditionRef.current = { audio, url };
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (rawAuditionRef.current?.audio === audio) rawAuditionRef.current = null;
    };
    audio.play().catch(() => {
      URL.revokeObjectURL(url);
      if (rawAuditionRef.current?.audio === audio) rawAuditionRef.current = null;
    });
  };
  const endAudition = () => {
    const audition = rawAuditionRef.current;
    if (!audition) return;
    audition.audio.pause();
    audition.audio.currentTime = 0;
    URL.revokeObjectURL(audition.url);
    rawAuditionRef.current = null;
  };

  useEffect(() => () => {
    if (!rawAuditionRef.current) return;
    rawAuditionRef.current.audio.pause();
    URL.revokeObjectURL(rawAuditionRef.current.url);
    rawAuditionRef.current = null;
  }, []);

  return (
    <section className="rounded-2xl border border-white/5 bg-black/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Sample editor</div>
          <div className="mt-1 text-xs text-zinc-500">{sample?.name || "Sample tidak ditemukan"}{waveform.duration ? ` · ${waveform.duration.toFixed(2)} detik` : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          {!sample?.file && <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2.5 py-1 text-[9px] text-amber-200">{sample?.previewUrl ? "Memuat audio tersimpan…" : "Simpan atau pilih ulang file"}</span>}
          <button
            type="button"
            disabled={!sample?.file}
            onPointerDown={beginAudition}
            onPointerUp={endAudition}
            onPointerCancel={endAudition}
            onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !event.repeat) beginAudition(event); }}
            onKeyUp={(event) => { if (event.key === "Enter" || event.key === " ") endAudition(); }}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-semibold text-zinc-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Dengar WAV asli · tanpa mapping/FX
          </button>
        </div>
      </div>

      <div className="relative mt-4 flex h-28 items-center overflow-hidden rounded-xl border border-white/5 bg-[#08080b] px-2" aria-label="Waveform dan batas playback sample">
        {waveform.loading && <div className="absolute inset-0 grid place-items-center text-[10px] text-zinc-500">Membaca waveform…</div>}
        {waveform.error && <div className="absolute inset-0 grid place-items-center px-4 text-center text-[10px] text-zinc-500">{waveform.error}</div>}
        {!waveform.loading && !waveform.error && waveform.peaks.length > 0 && (
          <div className="flex h-full w-full items-center gap-px">
            {waveform.peaks.map((peak, index) => <span key={index} className="min-w-0 flex-1 rounded-full" style={{ height: `${Math.max(3, peak * 82)}%`, backgroundColor: accentColor, opacity: 0.3 + peak * 0.65 }} />)}
          </div>
        )}
        {!sample?.file && !waveform.loading && !waveform.error && <div className="absolute inset-0 grid place-items-center text-[10px] text-zinc-600">Waveform tersedia setelah file audio tersambung</div>}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/70" style={{ width: `${sampleStart * 100}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/70" style={{ width: `${(1 - sampleEnd) * 100}%` }} />
        <div className="pointer-events-none absolute inset-y-0 w-px" style={{ left: `${sampleStart * 100}%`, backgroundColor: accentColor }} />
        <div className="pointer-events-none absolute inset-y-0 w-px" style={{ left: `${sampleEnd * 100}%`, backgroundColor: accentColor }} />
        {mapping.loopEnabled && <div className="pointer-events-none absolute inset-y-2 border-x border-emerald-300/80 bg-emerald-300/[0.06]" style={{ left: `${loopStart * 100}%`, width: `${(loopEnd - loopStart) * 100}%` }} />}
        {playheadPosition !== null && (
          <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" style={{ left: `${playheadPosition * 100}%` }}>
            <span className="absolute -left-1 top-0 h-2 w-2 rotate-45 bg-white" />
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label><FieldLabel>Sample start · {(sampleStart * 100).toFixed(1)}%</FieldLabel><input type="range" min="0" max="0.999" step="0.001" value={sampleStart} onChange={(event) => updateStart(event.target.value)} {...mappingRangeResetProps(() => updateStart(0))} className="maker-range mt-3 w-full" /></label>
        <label><FieldLabel>Sample end · {(sampleEnd * 100).toFixed(1)}%</FieldLabel><input type="range" min="0.001" max="1" step="0.001" value={sampleEnd} onChange={(event) => updateEnd(event.target.value)} {...mappingRangeResetProps(() => updateEnd(1))} className="maker-range mt-3 w-full" /></label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-white/5 px-3 py-2"><span><FieldLabel>Audio Loop</FieldLabel><span className="mt-1 block text-[9px] text-zinc-600">Ulangi bagian audio selama note ditahan</span></span><input type="checkbox" checked={!!mapping.loopEnabled} onChange={(event) => onChange({ loopEnabled: event.target.checked, loopStart: sampleStart, loopEnd: sampleEnd })} className="h-4 w-4 accent-emerald-400" /></label>
        <div className={!mapping.loopEnabled ? "pointer-events-none opacity-35" : ""}>
          <FieldLabel>Loop region · {(loopStart * 100).toFixed(1)}–{(loopEnd * 100).toFixed(1)}%</FieldLabel>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input type="number" min={sampleStart} max={loopEnd - 0.001} step="0.001" value={loopStart} onChange={(event) => onChange({ loopStart: Math.max(sampleStart, Math.min(loopEnd - 0.001, Number(event.target.value))) })} className="maker-input" aria-label="Loop start" />
            <input type="number" min={loopStart + 0.001} max={sampleEnd} step="0.001" value={loopEnd} onChange={(event) => onChange({ loopEnd: Math.min(sampleEnd, Math.max(loopStart + 0.001, Number(event.target.value))) })} className="maker-input" aria-label="Loop end" />
          </div>
        </div>
        <label><FieldLabel>Fade in · {mapping.fadeInMs || 0} ms</FieldLabel><input type="range" min="0" max="10000" step="10" value={mapping.fadeInMs || 0} onChange={(event) => onChange({ fadeInMs: Number(event.target.value) })} {...mappingRangeResetProps(() => onChange({ fadeInMs: 0 }))} className="maker-range mt-3 w-full" /></label>
        <label><FieldLabel>Fade out · {mapping.fadeOutMs || 0} ms</FieldLabel><input type="range" min="0" max="10000" step="10" value={mapping.fadeOutMs || 0} onChange={(event) => onChange({ fadeOutMs: Number(event.target.value) })} {...mappingRangeResetProps(() => onChange({ fadeOutMs: 0 }))} className="maker-range mt-3 w-full" /></label>
        <label>
          <FieldLabel>Tune semitone</FieldLabel>
          <input
            type="number"
            min="-24"
            max="24"
            step="1"
            className="maker-input mt-2"
            value={mapping.tuneSemitones || 0}
            onChange={(event) => onChange({ tuneSemitones: Math.max(-24, Math.min(24, Number(event.target.value) || 0)) })}
          />
        </label>
        <label><FieldLabel>Tune cent · {mapping.tuneCents || 0}</FieldLabel><input type="range" min="-1200" max="1200" step="1" value={mapping.tuneCents || 0} onChange={(event) => onChange({ tuneCents: Number(event.target.value) })} {...mappingRangeResetProps(() => onChange({ tuneCents: 0 }))} className="maker-range mt-3 w-full" /></label>
        <label><FieldLabel>Gain · {Number(mapping.gainDb || 0).toFixed(1)} dB</FieldLabel><input type="range" min="-24" max="12" step="0.1" value={mapping.gainDb || 0} onChange={(event) => onChange({ gainDb: Number(event.target.value) })} {...mappingRangeResetProps(() => onChange({ gainDb: 0 }))} className="maker-range mt-3 w-full" /></label>
        <label><FieldLabel>Pan · {Number(mapping.pan || 0).toFixed(2)}</FieldLabel><input type="range" min="-1" max="1" step="0.01" value={mapping.pan || 0} onChange={(event) => onChange({ pan: Number(event.target.value) })} {...mappingRangeResetProps(() => onChange({ pan: 0 }))} className="maker-range mt-3 w-full" /></label>
      </div>
    </section>
  );
}

function SamplerMappingEditor({ accentColor, samples, pricing = DEFAULT_VST_PRICING, includedSampleIds = null, mappings, samplerGroups = [], rootNote, velocityLayers = 1, projectTempo = 120, velocity, sustainEnabled, onSustainToggle, pitchBendEnabled, onPitchBendToggle, modulationEnabled, onModulationToggle, onVelocityChange, audioStatus, externalPressedPitches = new Set(), waveformPlayback, onEnsureSampleFile, onNoteOn, onNoteOff, onDropSampleFiles, onDeleteSamples, onMappingsChange, onVelocityLayersChange, onProjectTempoChange, onSamplerGroupChange, onSamplerGroupRename, onAddSamplerGroup, onRemoveSamplerGroup, projectActions = null }) {
  const [selectedMappingId, setSelectedMappingId] = useState(null);
  const [selectedMappingIds, setSelectedMappingIds] = useState(() => new Set());
  const [selectedSamplerId, setSelectedSamplerId] = useState(null);
  const [auditionedPitch, setAuditionedPitch] = useState(null);
  const [dropPitch, setDropPitch] = useState(null);
  const [zoneDragPreview, setZoneDragPreview] = useState(null);
  const [zoneSelectionBox, setZoneSelectionBox] = useState(null);
  const [detectingTempo, setDetectingTempo] = useState(false);
  const [tempoSuggestions, setTempoSuggestions] = useState(() => new Map());
  const zoneMapCanvasRef = useRef(null);
  const zoneDragRef = useRef(null);
  const zoneResizeRef = useRef(null);
  const zoneSelectionRef = useRef(null);
  const mappingHistoryPastRef = useRef([]);
  const mappingHistoryFutureRef = useRef([]);
  const latestMappingsRef = useRef(mappings);
  const detectedTempoCacheRef = useRef(new Map());
  const [mappingHistoryVersion, setMappingHistoryVersion] = useState(0);
  const selectedSampler = samplerGroups.find((group) => group.id === selectedSamplerId) || samplerGroups[0] || null;
  const selectedSamplerName = selectedSampler?.name || DEFAULT_SAMPLER_NAME;
  const samplerMappings = useMemo(() => mappings.filter((mapping) => normalizeSamplerName(mapping.groupName) === selectedSamplerName), [mappings, selectedSamplerName]);
  const articulations = useMemo(() => Array.from(new Set(samplerMappings.map((mapping) => mapping.articulation || "Sustain"))), [samplerMappings]);
  const [previewArticulation, setPreviewArticulation] = useState(articulations[0] || "Sustain");
  const activePreviewArticulation = articulations.includes(previewArticulation) ? previewArticulation : articulations[0] || "Sustain";
  const micPositions = useMemo(() => Array.from(new Set(
    samplerMappings
      .filter((mapping) => (mapping.articulation || "Sustain") === activePreviewArticulation)
      .map((mapping) => mapping.micPosition || "Main"),
  )), [samplerMappings, activePreviewArticulation]);
  const [previewMicPosition, setPreviewMicPosition] = useState(micPositions[0] || "Main");
  const activePreviewMicPosition = micPositions.includes(previewMicPosition) ? previewMicPosition : micPositions[0] || "Main";
  const selectedMapping = samplerMappings.find((mapping) => mapping.id === selectedMappingId) || samplerMappings[0];
  const selectedSample = samples.find((sample) => sample.id === selectedMapping?.sampleId);
  const groupOptions = Array.from(new Set(samplerGroups.map((group) => group.name)));
  const configuredVelocityLayers = Math.max(1, Math.min(4, Math.round(Number(velocityLayers) || 1)));

  useEffect(() => {
    if (!selectedSample?.file && selectedSample?.previewUrl) onEnsureSampleFile?.(selectedSample);
    // The selected sample identity/availability drives private preview hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSample?.id, selectedSample?.file, selectedSample?.previewUrl]);

  useEffect(() => {
    if (!samplerGroups.some((group) => group.id === selectedSamplerId)) setSelectedSamplerId(samplerGroups[0]?.id || null);
  }, [samplerGroups, selectedSamplerId]);

  useEffect(() => {
    if (!samplerMappings.some((mapping) => mapping.id === selectedMappingId)) setSelectedMappingId(samplerMappings[0]?.id || null);
    setSelectedMappingIds((current) => {
      const available = new Set(samplerMappings.map((mapping) => mapping.id));
      const next = new Set([...current].filter((id) => available.has(id)));
      if (!next.size && samplerMappings[0]) next.add(samplerMappings[0].id);
      return next;
    });
  }, [samplerMappings, selectedMappingId]);

  const selectOnlyMapping = (mappingId) => {
    setSelectedMappingId(mappingId || null);
    setSelectedMappingIds(new Set(mappingId ? [mappingId] : []));
  };

  const selectSampler = (sampler) => {
    setSelectedSamplerId(sampler.id);
    const firstMapping = mappings.find((mapping) => normalizeSamplerName(mapping.groupName) === sampler.name);
    selectOnlyMapping(firstMapping?.id || null);
  };

  useEffect(() => {
    if (!articulations.includes(previewArticulation)) setPreviewArticulation(articulations[0] || "Sustain");
  }, [articulations, previewArticulation]);

  useEffect(() => {
    if (!micPositions.includes(previewMicPosition)) setPreviewMicPosition(micPositions[0] || "Main");
  }, [micPositions, previewMicPosition]);

  useEffect(() => {
    if (latestMappingsRef.current === mappings) return;
    latestMappingsRef.current = mappings;
    mappingHistoryPastRef.current = [];
    mappingHistoryFutureRef.current = [];
    setMappingHistoryVersion((version) => version + 1);
  }, [mappings]);

  const commitMappings = (nextMappings) => {
    mappingHistoryPastRef.current = [...mappingHistoryPastRef.current.slice(-49), latestMappingsRef.current];
    mappingHistoryFutureRef.current = [];
    latestMappingsRef.current = nextMappings;
    setMappingHistoryVersion((version) => version + 1);
    onMappingsChange(nextMappings);
  };

  const undoMappings = () => {
    const previous = mappingHistoryPastRef.current.at(-1);
    if (!previous) return;
    mappingHistoryPastRef.current = mappingHistoryPastRef.current.slice(0, -1);
    mappingHistoryFutureRef.current = [latestMappingsRef.current, ...mappingHistoryFutureRef.current].slice(0, 50);
    latestMappingsRef.current = previous;
    setMappingHistoryVersion((version) => version + 1);
    onMappingsChange(previous);
  };

  const redoMappings = () => {
    const next = mappingHistoryFutureRef.current[0];
    if (!next) return;
    mappingHistoryFutureRef.current = mappingHistoryFutureRef.current.slice(1);
    mappingHistoryPastRef.current = [...mappingHistoryPastRef.current.slice(-49), latestMappingsRef.current];
    latestMappingsRef.current = next;
    setMappingHistoryVersion((version) => version + 1);
    onMappingsChange(next);
  };

  const updateMapping = (mappingId, updates) => {
    commitMappings(latestMappingsRef.current.map((mapping) => mapping.id === mappingId ? { ...mapping, ...updates } : mapping));
  };

  const updateSelectedMappings = (updates) => {
    const targetIds = selectedMappingIds.size
      ? selectedMappingIds
      : new Set(selectedMapping ? [selectedMapping.id] : []);
    if (!targetIds.size) return;
    commitMappings(latestMappingsRef.current.map((mapping) => targetIds.has(mapping.id) ? { ...mapping, ...updates } : mapping));
  };

  const assignSelectedVelocityLayers = () => {
    const targetIds = selectedMappingIds.size
      ? new Set(selectedMappingIds)
      : new Set(selectedMapping ? [selectedMapping.id] : []);
    if (targetIds.size < 2 || targetIds.size > 4) {
      toast.error("Pilih 2 sampai 4 zona sample untuk disusun sebagai velocity layer");
      return;
    }
    const nextMappings = stackMappingsAsVelocityLayers(mappings, targetIds, selectedMapping?.id);
    commitMappings(nextMappings);
    onVelocityLayersChange?.(targetIds.size);
    toast.success(`${targetIds.size} sample ditumpuk pada root ${midiNoteName(selectedMapping.rootPitch)} sebagai velocity layer 1–${targetIds.size}.`);
  };

  const assignMappingVelocityLayer = (layer) => {
    if (!selectedMapping) return;
    updateMapping(selectedMapping.id, velocityLayerRange(layer, configuredVelocityLayers));
  };

  const clearTempoSuggestionsFor = (targetIds) => {
    setTempoSuggestions((current) => {
      const next = new Map(current);
      targetIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const changeSelectedPlaybackMode = (playbackMode) => {
    const targetIds = selectedMappingIds.size
      ? new Set(selectedMappingIds)
      : new Set(selectedMapping ? [selectedMapping.id] : []);
    clearTempoSuggestionsFor(targetIds);
    updateSelectedMappings({ playbackMode });
  };

  const detectSelectedMappingsTempo = async () => {
    const targetIds = selectedMappingIds.size
      ? new Set(selectedMappingIds)
      : new Set(selectedMapping ? [selectedMapping.id] : []);
    if (!targetIds.size || detectingTempo) return;
    clearTempoSuggestionsFor(targetIds);
    setDetectingTempo(true);
    try {
      const detectedByMappingId = new Map();
      const targets = mappings.filter((mapping) => targetIds.has(mapping.id));
      await Promise.all(targets.map(async (mapping) => {
        const sample = samples.find((item) => item.id === mapping.sampleId);
        if (!sample) return;
        let bpm = detectedTempoCacheRef.current.get(sample.id);
        if (!bpm) {
          bpm = await detectSampleBpm(sample);
          if (bpm) detectedTempoCacheRef.current.set(sample.id, bpm);
        }
        if (bpm) detectedByMappingId.set(mapping.id, bpm);
      }));
      setTempoSuggestions((current) => {
        const next = new Map(current);
        detectedByMappingId.forEach((bpm, mappingId) => next.set(mappingId, bpm));
        return next;
      });
      if (detectedByMappingId.size) toast.success(`BPM terdeteksi untuk ${detectedByMappingId.size} zona. Konfirmasi hasil sebelum Tempo Sync diterapkan.`);
      else toast.warning("Tempo tidak dapat dideteksi dengan yakin. Masukkan BPM asli secara manual.");
    } catch (error) {
      toast.error(error.userMessage || "Deteksi BPM WAV gagal. BPM tetap dapat diisi manual.");
    } finally {
      setDetectingTempo(false);
    }
  };

  const applyDetectedTempoSuggestions = () => {
    const targetIds = selectedMappingIds.size
      ? new Set(selectedMappingIds)
      : new Set(selectedMapping ? [selectedMapping.id] : []);
    const nextMappings = latestMappingsRef.current.map((mapping) => {
      const suggestion = targetIds.has(mapping.id) ? tempoSuggestions.get(mapping.id) : null;
      return suggestion ? { ...mapping, sourceBpm: suggestion, sourceBpmConfirmed: true } : mapping;
    });
    if (!nextMappings.some((mapping, index) => mapping !== latestMappingsRef.current[index])) return;
    commitMappings(nextMappings);
    setTempoSuggestions((current) => {
      const next = new Map(current);
      targetIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const confirmSelectedSourceBpm = (multiplier = 1) => {
    const targetIds = selectedMappingIds.size
      ? selectedMappingIds
      : new Set(selectedMapping ? [selectedMapping.id] : []);
    if (!targetIds.size) return;
    commitMappings(latestMappingsRef.current.map((mapping) => targetIds.has(mapping.id) ? {
      ...mapping,
      sourceBpm: scaleSourceBpm(mapping.sourceBpm, multiplier),
      sourceBpmConfirmed: true,
    } : mapping));
  };

  const deleteSelectedMappings = async () => {
    const mappingIds = selectedMappingIds.size
      ? selectedMappingIds
      : new Set(selectedMapping ? [selectedMapping.id] : []);
    const sampleIds = [...new Set(mappings.filter((mapping) => mappingIds.has(mapping.id)).map((mapping) => mapping.sampleId))];
    if (!sampleIds.length) return;
    if (!window.confirm(`Hapus ${mappingIds.size} zona terpilih beserta ${sampleIds.length} audio sample dari project dan penyimpanan server? Semua zona lain yang memakai audio tersebut juga akan dihapus.`)) return;
    await onDeleteSamples?.(sampleIds);
    selectOnlyMapping(null);
  };

  const autoMapSequential = () => {
    if (!samples.length) {
      toast.error("Tambahkan sample terlebih dahulu sebelum auto-map");
      return;
    }
    if (samplerMappings.length) {
      const collapsedMappings = collapseMappingsToRoot(samplerMappings);
      const mappedSampleIds = new Set(samplerMappings.map((mapping) => mapping.sampleId));
      const unmappedSamples = samples.filter((sample) => !mappedSampleIds.has(sample.id));
      const nextPitch = collapsedMappings.length
        ? Math.min(127, Math.max(...collapsedMappings.map((mapping) => mapping.rootPitch)) + 1)
        : noteNameToMidi(rootNote);
      const addedMappings = createOneKeyMappings(unmappedSamples, nextPitch, selectedSamplerName);
      const collapsedById = new Map(collapsedMappings.map((mapping) => [mapping.id, mapping]));
      const nextMappings = [
        ...mappings.map((mapping) => collapsedById.get(mapping.id) || mapping),
        ...addedMappings,
      ].slice(0, 128);
      commitMappings(nextMappings);
      toast.success(`Manual map dipulihkan pada root asli setiap zona. ${addedMappings.length ? `${addedMappings.length} sample baru ikut dipetakan.` : "Posisi nada awal tidak berubah."}`);
      return;
    }
    const nextMappings = createOneKeyMappings(samples, noteNameToMidi(rootNote), selectedSamplerName);
    commitMappings([...mappings.filter((mapping) => normalizeSamplerName(mapping.groupName) !== selectedSamplerName), ...nextMappings]);
    selectOnlyMapping(nextMappings[0]?.id || null);
    toast.success(`${nextMappings.length} sample dipetakan satu per tuts dari ${midiNoteName(nextMappings[0].rootPitch)} sampai ${midiNoteName(nextMappings.at(-1).rootPitch)}`);
  };

  const autoMapChromatic = () => {
    if (!selectedMapping) {
      toast.error("Pilih zona sample yang akan dibentangkan");
      return;
    }
    const rootPitch = selectedMapping.rootPitch;
    const { lowPitch, highPitch } = fullChromaticPitchRange(rootPitch);
    updateSelectedMappings({ lowPitch, highPitch });
    const sample = samples.find((item) => item.id === selectedMapping.sampleId);
    toast.success(`${selectedMappingIds.size > 1 ? `${selectedMappingIds.size} velocity layer` : sample?.name || "Sample"} dibentangkan chromatic ke bawah dan atas (${midiNoteName(lowPitch)}–${midiNoteName(highPitch)}) dari posisi root ${midiNoteName(rootPitch)}`);
  };

  const selectZoneForPitch = (pitch, noteVelocity) => {
    const matches = samplerMappings
      .filter((mapping) => pitch >= mapping.lowPitch && pitch <= mapping.highPitch && noteVelocity >= mapping.velocityLow && noteVelocity <= mapping.velocityHigh)
      .sort((left, right) => {
        const leftRange = left.highPitch - left.lowPitch;
        const rightRange = right.highPitch - right.lowPitch;
        return leftRange - rightRange || Math.abs(pitch - left.rootPitch) - Math.abs(pitch - right.rootPitch);
      });
    if (matches[0]) selectOnlyMapping(matches[0].id);
    setAuditionedPitch(pitch);
  };

  useEffect(() => {
    if (!externalPressedPitches.size) return;
    const pitch = Array.from(externalPressedPitches).at(-1);
    selectZoneForPitch(pitch, velocity);
    // Selection follows incoming MIDI notes; mapping edits are handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPressedPitches, velocity]);

  const pitchAtClientX = (clientX, element = zoneMapCanvasRef.current) => {
    if (!element) return 0;
    const bounds = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, clientX - bounds.left));
    return SAMPLER_PITCHES.reduce((nearest, pitch) => (
      Math.abs(samplerPitchCenter(pitch) - x) < Math.abs(samplerPitchCenter(nearest) - x) ? pitch : nearest
    ), 0);
  };

  const pitchAtDropPosition = (event) => pitchAtClientX(event.clientX, event.currentTarget);

  const zoneCanvasPoint = (event) => {
    const canvas = zoneMapCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.clientWidth, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(canvas.clientHeight, event.clientY - bounds.top)),
    };
  };

  const beginZoneSelection = (event) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = zoneCanvasPoint(event);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const baseSelection = additive ? new Set(selectedMappingIds) : new Set();
    zoneSelectionRef.current = {
      pointerId: event.pointerId,
      start,
      baseSelection,
      selectedIds: baseSelection,
      moved: false,
    };
    if (!additive) {
      setSelectedMappingIds(new Set());
    }
    setZoneSelectionBox({ left: start.x, top: start.y, width: 0, height: 0 });
  };

  const moveZoneSelection = (event) => {
    const selection = zoneSelectionRef.current;
    if (!selection || selection.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = zoneCanvasPoint(event);
    const left = Math.min(selection.start.x, point.x);
    const right = Math.max(selection.start.x, point.x);
    const top = Math.min(selection.start.y, point.y);
    const bottom = Math.max(selection.start.y, point.y);
    selection.moved = selection.moved || Math.abs(point.x - selection.start.x) > 3 || Math.abs(point.y - selection.start.y) > 3;
    const next = new Set(selection.baseSelection);
    const canvasHeight = zoneMapCanvasRef.current?.clientHeight || 190;
    if (selection.moved) {
      samplerMappings.forEach((mapping) => {
        const horizontal = samplerPitchBounds(mapping.lowPitch, mapping.highPitch);
        const zoneLeft = horizontal.left;
        const zoneRight = horizontal.left + horizontal.width;
        const zoneTop = ((127 - mapping.velocityHigh) / 127) * canvasHeight;
        const zoneBottom = zoneTop + (((mapping.velocityHigh - mapping.velocityLow + 1) / 127) * canvasHeight);
        if (zoneRight >= left && zoneLeft <= right && zoneBottom >= top && zoneTop <= bottom) next.add(mapping.id);
      });
    }
    selection.selectedIds = next;
    setSelectedMappingIds(next);
    const primary = [...samplerMappings].reverse().find((mapping) => next.has(mapping.id));
    if (primary) setSelectedMappingId(primary.id);
    setZoneSelectionBox({ left, top, width: right - left, height: bottom - top });
  };

  const endZoneSelection = (event) => {
    const selection = zoneSelectionRef.current;
    if (!selection || selection.pointerId !== event.pointerId) return;
    event.preventDefault();
    zoneSelectionRef.current = null;
    setZoneSelectionBox(null);
  };

  const beginZoneDrag = (event, mapping) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    let dragIds;
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      const next = new Set(selectedMappingIds);
      if (next.has(mapping.id)) next.delete(mapping.id);
      else next.add(mapping.id);
      setSelectedMappingIds(next);
      if (!next.has(mapping.id)) {
        const remainingPrimary = [...samplerMappings].reverse().find((item) => next.has(item.id));
        if (remainingPrimary) setSelectedMappingId(remainingPrimary.id);
        return;
      }
      setSelectedMappingId(mapping.id);
      dragIds = next;
    } else {
      dragIds = selectedMappingIds.has(mapping.id) ? new Set(selectedMappingIds) : new Set([mapping.id]);
      if (!selectedMappingIds.has(mapping.id)) selectOnlyMapping(mapping.id);
      else setSelectedMappingId(mapping.id);
    }
    const startPitch = pitchAtClientX(event.clientX);
    const originals = mappings.filter((item) => dragIds.has(item.id)).map((item) => ({
      mappingId: item.id,
      lowPitch: item.lowPitch,
      highPitch: item.highPitch,
      rootPitch: item.rootPitch,
    }));
    const previews = Object.fromEntries(originals.map((item) => [item.mappingId, item]));
    zoneDragRef.current = {
      pointerId: event.pointerId,
      startPitch,
      originals,
      minimumLow: Math.min(...originals.map((item) => item.lowPitch)),
      maximumHigh: Math.max(...originals.map((item) => item.highPitch)),
      previews,
    };
    setZoneDragPreview(previews);
  };

  const moveZoneDrag = (event) => {
    const drag = zoneDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const requestedDelta = pitchAtClientX(event.clientX) - drag.startPitch;
    const delta = Math.max(-drag.minimumLow, Math.min(127 - drag.maximumHigh, requestedDelta));
    const previews = Object.fromEntries(drag.originals.map((item) => [item.mappingId, {
      mappingId: item.mappingId,
      lowPitch: item.lowPitch + delta,
      highPitch: item.highPitch + delta,
      rootPitch: item.rootPitch + delta,
    }]));
    drag.previews = previews;
    drag.delta = delta;
    setZoneDragPreview(previews);
  };

  const endZoneDrag = (event) => {
    const drag = zoneDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    zoneDragRef.current = null;
    setZoneDragPreview(null);
    if (!drag.delta) return;
    commitMappings(latestMappingsRef.current.map((mapping) => drag.previews[mapping.id] ? {
      ...mapping,
      lowPitch: drag.previews[mapping.id].lowPitch,
      highPitch: drag.previews[mapping.id].highPitch,
      rootPitch: drag.previews[mapping.id].rootPitch,
    } : mapping));
  };

  const beginZoneResize = (event, mapping, edge) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const resizeIds = selectedMappingIds.has(mapping.id)
      ? new Set(selectedMappingIds)
      : new Set([mapping.id]);
    if (!selectedMappingIds.has(mapping.id)) selectOnlyMapping(mapping.id);
    else setSelectedMappingId(mapping.id);
    const originals = mappings.filter((item) => resizeIds.has(item.id)).map((item) => ({
      mappingId: item.id,
      lowPitch: item.lowPitch,
      highPitch: item.highPitch,
      rootPitch: item.rootPitch,
    }));
    const previews = Object.fromEntries(originals.map((item) => [item.mappingId, item]));
    zoneResizeRef.current = {
      pointerId: event.pointerId,
      edge,
      startPitch: pitchAtClientX(event.clientX),
      originals,
      previews,
    };
    setZoneDragPreview(previews);
  };

  const moveZoneResize = (event) => {
    const resize = zoneResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const requestedDelta = pitchAtClientX(event.clientX) - resize.startPitch;
    let delta;
    if (resize.edge === "left") {
      const minimum = -Math.min(...resize.originals.map((item) => item.lowPitch));
      const maximum = Math.min(...resize.originals.map((item) => item.rootPitch - item.lowPitch));
      delta = Math.max(minimum, Math.min(maximum, requestedDelta));
    } else {
      const minimum = Math.max(...resize.originals.map((item) => item.rootPitch - item.highPitch));
      const maximum = 127 - Math.max(...resize.originals.map((item) => item.highPitch));
      delta = Math.max(minimum, Math.min(maximum, requestedDelta));
    }
    const previews = Object.fromEntries(resize.originals.map((item) => [item.mappingId, {
      ...item,
      ...(resize.edge === "left" ? { lowPitch: item.lowPitch + delta } : { highPitch: item.highPitch + delta }),
    }]));
    resize.previews = previews;
    resize.delta = delta;
    setZoneDragPreview(previews);
  };

  const endZoneResize = (event) => {
    const resize = zoneResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    zoneResizeRef.current = null;
    setZoneDragPreview(null);
    if (!resize.delta) return;
    commitMappings(latestMappingsRef.current.map((mapping) => resize.previews[mapping.id] ? {
      ...mapping,
      lowPitch: resize.previews[mapping.id].lowPitch,
      highPitch: resize.previews[mapping.id].highPitch,
    } : mapping));
  };

  const handleMapDragOver = (event) => {
    const types = Array.from(event.dataTransfer?.types || []);
    if (!types.includes("Files") && !types.includes("application/x-vst-sample-id")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropPitch(pitchAtDropPosition(event));
  };

  const handleMapDrop = (event) => {
    event.preventDefault();
    const pitch = pitchAtDropPosition(event);
    const sampleId = event.dataTransfer.getData("application/x-vst-sample-id");
    setDropPitch(null);
    if (sampleId) {
      const sample = samples.find((item) => item.id === sampleId);
      if (!sample) return;
      if (mappings.length >= 128) {
        toast.error("Maksimal 128 zona sample mapping per project");
        return;
      }
      const mapping = { ...createSampleMapping(sampleId, pitch), groupName: selectedSamplerName };
      commitMappings([...latestMappingsRef.current, mapping]);
      selectOnlyMapping(mapping.id);
      toast.success(`${sample.name} dipetakan ke ${midiNoteName(pitch)}`);
      return;
    }
    if (event.dataTransfer.files?.length) onDropSampleFiles?.(event.dataTransfer.files, pitch, selectedSamplerName);
  };

  const handleMappingKeyDown = (event) => {
    const isFormField = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']");
    if (isFormField) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelectedMappingIds(new Set(samplerMappings.map((mapping) => mapping.id)));
      if (samplerMappings[0]) setSelectedMappingId(samplerMappings[0].id);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelectedMappings();
    }
  };

  const mappingView = (
    <div className="maker-zone-map" style={{ width: `${SAMPLER_WHITE_PITCHES.length * SAMPLER_KEY_WIDTH}px`, "--maker-accent": accentColor }}>
      <div className="maker-zone-map__heading">
        <span>Velocity 127</span>
        <strong>{selectedSample?.name || (samples.length ? "Pilih zona" : "Tarik sample ke atas tuts")}</strong>
        <span>{auditionedPitch === null ? "Drop menentukan root key" : `Tuts ${midiNoteName(auditionedPitch)} dipilih`}</span>
      </div>
      <div
        className={`maker-zone-map__canvas ${dropPitch !== null ? "is-drop-active" : ""}`}
        ref={zoneMapCanvasRef}
        tabIndex={0}
        aria-label="Peta zona. Seret area kosong untuk memilih beberapa zona."
        data-vst-drop-target="true"
        onPointerDown={beginZoneSelection}
        onPointerMove={moveZoneSelection}
        onPointerUp={endZoneSelection}
        onPointerCancel={endZoneSelection}
        onDragOver={handleMapDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDropPitch(null);
        }}
        onDrop={handleMapDrop}
      >
        {SAMPLER_PITCHES.map((pitch) => (
          <span
            key={pitch}
            className={`maker-zone-map__keyline ${isBlackKey(pitch) ? "is-black" : ""} ${pitch % 12 === 0 ? "is-octave" : ""}`}
            style={{ left: `${samplerPitchCenter(pitch)}px` }}
          >{pitch % 12 === 0 ? midiNoteName(pitch) : ""}</span>
        ))}
        {samplerMappings.map((mapping, index) => {
          const sample = samples.find((item) => item.id === mapping.sampleId);
          const displayedMapping = zoneDragPreview?.[mapping.id]
            ? { ...mapping, ...zoneDragPreview[mapping.id] }
            : mapping;
          const bounds = samplerPitchBounds(displayedMapping.lowPitch, displayedMapping.highPitch);
          const top = ((127 - mapping.velocityHigh) / 127) * 100;
          const height = ((mapping.velocityHigh - mapping.velocityLow + 1) / 127) * 100;
          return (
            <button
              type="button"
              key={mapping.id}
              onPointerDown={(event) => beginZoneDrag(event, mapping)}
              onPointerMove={moveZoneDrag}
              onPointerUp={endZoneDrag}
              onPointerCancel={endZoneDrag}
              className={`maker-zone-map__zone ${selectedMappingIds.has(mapping.id) ? "is-selected" : ""} ${zoneDragPreview?.[mapping.id] ? "is-dragging" : ""}`}
              style={{ left: `${bounds.left}px`, width: `${bounds.width}px`, top: `${top}%`, height: `${height}%`, "--zone-color": samplerZoneColor(mapping, index) }}
              title={`${sample?.name || "Missing sample"} · velocity ${mapping.velocityLow}–${mapping.velocityHigh} · seret badan untuk pindah; setelah dipilih, seret strip tepi untuk membentangkan · ${midiNoteName(displayedMapping.lowPitch)}–${midiNoteName(displayedMapping.highPitch)}`}
            >
              <span
                className="maker-zone-map__resize is-left"
                onPointerDown={(event) => beginZoneResize(event, mapping, "left")}
                onPointerMove={moveZoneResize}
                onPointerUp={endZoneResize}
                onPointerCancel={endZoneResize}
                aria-hidden="true"
              />
              <span>{sample?.name || "Missing"}</span>
              <small>{midiNoteName(displayedMapping.rootPitch)}</small>
              <span
                className="maker-zone-map__resize is-right"
                onPointerDown={(event) => beginZoneResize(event, mapping, "right")}
                onPointerMove={moveZoneResize}
                onPointerUp={endZoneResize}
                onPointerCancel={endZoneResize}
                aria-hidden="true"
              />
            </button>
          );
        })}
        {zoneSelectionBox && (
          <span
            className="maker-zone-map__selection-box"
            style={{ left: `${zoneSelectionBox.left}px`, top: `${zoneSelectionBox.top}px`, width: `${zoneSelectionBox.width}px`, height: `${zoneSelectionBox.height}px` }}
            aria-hidden="true"
          />
        )}
        {auditionedPitch !== null && <span className="maker-zone-map__played" style={{ left: `${samplerPitchCenter(auditionedPitch)}px` }} />}
        {dropPitch !== null && <span className="maker-zone-map__drop" style={{ left: `${samplerPitchCenter(dropPitch)}px` }}><b>{midiNoteName(dropPitch)}</b></span>}
      </div>
      <div className="maker-zone-map__footer"><span>Velocity 1</span><span>Badan zona: pindah · Strip tepi zona terpilih: bentangkan · Ctrl/Cmd + klik: tambah pilihan</span><span>Key range →</span></div>
    </div>
  );

  const rootOptions = SAMPLER_PITCHES.filter((pitch) => pitch >= selectedMapping?.lowPitch && pitch <= selectedMapping?.highPitch);
  const lowOptions = SAMPLER_PITCHES.filter((pitch) => pitch <= selectedMapping?.rootPitch);
  const highOptions = SAMPLER_PITCHES.filter((pitch) => pitch >= selectedMapping?.rootPitch);
  const selectedChokeTargets = normalizeChokeTargetPitches(selectedMapping?.chokeTargetPitches);
  const availableChokeTargets = SAMPLER_PITCHES.filter((pitch) => (
    pitch !== selectedMapping?.rootPitch && !selectedChokeTargets.includes(pitch)
  ));

  return (
    <div className="maker-mapping-workspace mt-6" onKeyDown={handleMappingKeyDown}>
      <div className="maker-mapping-toolbar flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] text-zinc-500"><span className="font-semibold text-zinc-300">{selectedSamplerName}</span> · {samplerMappings.length} zona sampler · {selectedMappingIds.size} dipilih · {mappings.length} zona total · MIDI 0–127</div>
        <div className="mt-1 text-[10px] text-emerald-200/70">{includedSampleIds ? `Harga sampel: bawaan template termasuk · tambahan/pengganti +${pricing.extra_sample_credits} kredit/file` : `Harga sampel: ${pricing.included_instrument_samples} pertama termasuk · berikutnya +${pricing.extra_sample_credits} kredit/file`}</div>
        <div className="flex flex-wrap items-center gap-2">
          {!!articulations.length && <label className="flex items-center gap-2 text-[9px] text-zinc-500"><span>Preview</span><select className="maker-input h-9 py-1 text-[10px]" value={activePreviewArticulation} onChange={(event) => setPreviewArticulation(event.target.value)}>{articulations.map((item) => <option key={item}>{item}</option>)}</select></label>}
          {!!micPositions.length && <label className="flex items-center gap-2 text-[9px] text-zinc-500"><span>Mic</span><select className="maker-input h-9 py-1 text-[10px]" value={activePreviewMicPosition} onChange={(event) => setPreviewMicPosition(event.target.value)}>{micPositions.map((item) => <option key={item}>{item}</option>)}</select></label>}
        </div>
      </div>

      <aside className="maker-mapping-sidebar">
      <section className="maker-mapping-mixer rounded-2xl border border-white/[0.08] bg-black/20 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Mixer Sampler</div><div className="mt-1 text-[9px] text-zinc-600">Setiap sampler memiliki volume, pan, solo, dan mute terpisah.</div></div>
          <button type="button" onClick={() => { const sampler = onAddSamplerGroup?.(); if (sampler) selectSampler(sampler); }} className="rounded-lg border border-sky-300/20 px-3 py-2 text-[10px] font-bold text-sky-200 hover:bg-sky-300/10">+ Tambah sampler</button>
        </div>
        <div className="maker-mapping-mixer-grid grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {samplerGroups.map((group) => {
            const isSelected = selectedSampler?.id === group.id;
            const zoneCount = mappings.filter((mapping) => normalizeSamplerName(mapping.groupName) === group.name).length;
            return (
            <div key={group.id} onClick={() => selectSampler(group)} className={`relative cursor-pointer rounded-xl border p-3 transition-colors ${isSelected ? "border-sky-300/55 bg-sky-300/[0.07] ring-1 ring-sky-300/20" : "border-white/[0.07] bg-[#0b0b0e] hover:border-white/20"}`}>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  const nextSamplerId = onRemoveSamplerGroup?.(group.id);
                  if (isSelected && nextSamplerId) {
                    const nextSampler = samplerGroups.find((item) => item.id === nextSamplerId);
                    if (nextSampler) selectSampler(nextSampler);
                  }
                }}
                disabled={samplerGroups.length <= 1}
                className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-full text-zinc-600 hover:bg-red-400/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-25"
                aria-label={`Hapus sampler ${group.name}`}
                title={samplerGroups.length <= 1 ? "Minimal satu sampler harus tersedia" : `Hapus sampler ${group.name}`}
              ><X className="h-3.5 w-3.5" /></button>
              <div className="min-w-0">
                <input defaultValue={group.name} onFocus={() => selectSampler(group)} onBlur={(event) => onSamplerGroupRename(group.id, event.target.value)} className="w-full border-0 bg-transparent p-0 pr-7 text-xs font-bold text-zinc-200 outline-none" aria-label={`Nama sampler ${group.name}`} />
                <div className="mt-1 text-[8px] font-medium uppercase tracking-[0.12em] text-zinc-600">{zoneCount} zona{isSelected ? " · aktif" : ""}</div>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" onClick={() => onSamplerGroupChange(group.id, { solo: !group.solo })} className={`h-8 w-9 rounded-md border text-[10px] font-black ${group.solo ? "border-yellow-300/60 bg-yellow-300/15 text-yellow-200" : "border-white/10 text-zinc-600"}`}>S</button>
                  <button type="button" onClick={() => onSamplerGroupChange(group.id, { mute: !group.mute })} className={`h-8 w-9 rounded-md border text-[10px] font-black ${group.mute ? "border-rose-300/60 bg-rose-300/15 text-rose-200" : "border-white/10 text-zinc-600"}`}>M</button>
                </div>
                <label className="mt-2 block text-[8px] uppercase text-zinc-600">Volume {Math.round(group.volume)}<input type="range" min="0" max="100" value={group.volume} onChange={(event) => onSamplerGroupChange(group.id, { volume: Number(event.target.value) })} {...mappingRangeResetProps(() => onSamplerGroupChange(group.id, { volume: 100 }))} className="maker-range mt-1 w-full" /></label>
                <label className="mt-2 block text-[8px] uppercase text-zinc-600">Pan {Number(group.pan).toFixed(2)}<input type="range" min="-1" max="1" step="0.01" value={group.pan} onChange={(event) => onSamplerGroupChange(group.id, { pan: Number(event.target.value) })} {...mappingRangeResetProps(() => onSamplerGroupChange(group.id, { pan: 0 }))} className="maker-range mt-1 w-full" /></label>
              </div>
            </div>
          );})}
        </div>
      </section>

      {selectedMapping ? (
        <div className="maker-mapping-zone-settings grid gap-3 rounded-2xl border border-white/5 bg-[#111014] p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="col-span-full flex items-center justify-between gap-3">
            <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Pengaturan zona aktif</div><div className="mt-1 truncate text-[9px] text-zinc-600">{selectedSample?.name || "Sample"} · {selectedSamplerName}</div></div>
            <span className="rounded-full border border-white/10 px-2 py-1 text-[8px] text-zinc-500">{midiNoteName(selectedMapping.rootPitch)}</span>
          </div>
          <label className="sm:col-span-2 lg:col-span-1">
            <FieldLabel>File sample</FieldLabel>
            <select className="maker-input mt-2" value={selectedMapping.sampleId} onChange={(event) => updateMapping(selectedMapping.id, { sampleId: event.target.value })}>
              {samples.map((sample, index) => <option key={sample.id} value={sample.id}>{sample.name}{sample.file || sample.previewUrl ? " · ready" : " · belum tersimpan"} · {(includedSampleIds ? includedSampleIds.has(String(sample.id)) : index < Number(pricing.included_instrument_samples)) ? "termasuk" : `+${pricing.extra_sample_credits} kredit`}</option>)}
            </select>
          </label>
          <label>
            <FieldLabel>Mode mapping{selectedMappingIds.size > 1 ? ` · ${selectedMappingIds.size} zona` : ""}</FieldLabel>
            <select className="maker-input mt-2" value={selectedMapping.playbackMode === "tempo_sync" ? "tempo_sync" : "sampler"} onChange={(event) => changeSelectedPlaybackMode(event.target.value === "tempo_sync" ? "tempo_sync" : "sampler")} disabled={detectingTempo}>
              <option value="sampler">Kecepatan asli</option>
              <option value="tempo_sync">{detectingTempo ? "Mendeteksi tempo…" : "Ikuti tempo DAW · pitch tetap"}</option>
            </select>
          </label>
          {selectedMapping.playbackMode === "tempo_sync" && (
            <label>
              <FieldLabel>Tempo sumber</FieldLabel>
              <div className="mt-2 flex gap-2">
                <input type="number" min="20" max="300" step="0.1" className="maker-input min-w-0 flex-1" value={selectedMapping.sourceBpm ?? ""} onChange={(event) => updateSelectedMappings({ sourceBpm: event.target.value === "" ? "" : Number(event.target.value), sourceBpmConfirmed: false })} onBlur={(event) => updateSelectedMappings({ sourceBpm: Math.max(20, Math.min(300, Number(event.target.value) || 120)), sourceBpmConfirmed: false })} aria-label="Tempo sumber BPM" />
                <button type="button" onClick={detectSelectedMappingsTempo} disabled={detectingTempo} className="shrink-0 rounded-xl border border-emerald-300/20 px-3 text-[9px] font-semibold text-emerald-200 hover:bg-emerald-300/10 disabled:opacity-40">{detectingTempo ? "Mendeteksi…" : "Deteksi BPM"}</button>
              </div>
              {tempoSuggestions.has(selectedMapping.id) && <button type="button" onClick={applyDetectedTempoSuggestions} className="mt-2 w-full rounded-lg border border-sky-300/25 bg-sky-300/[0.07] px-2 py-1.5 text-[9px] font-semibold text-sky-100 hover:bg-sky-300/15">Gunakan hasil deteksi {tempoSuggestions.get(selectedMapping.id)} BPM{selectedMappingIds.size > 1 ? " untuk zona terpilih" : ""}</button>}
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <button type="button" onClick={() => confirmSelectedSourceBpm(0.5)} className="rounded-lg border border-white/10 px-2 py-1.5 text-[9px] text-zinc-400 hover:bg-white/5">½× tempo</button>
                <button type="button" onClick={() => confirmSelectedSourceBpm(1)} className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.07] px-2 py-1.5 text-[9px] font-semibold text-emerald-100 hover:bg-emerald-300/12">Konfirmasi</button>
                <button type="button" onClick={() => confirmSelectedSourceBpm(2)} className="rounded-lg border border-white/10 px-2 py-1.5 text-[9px] text-zinc-400 hover:bg-white/5">2× tempo</button>
              </div>
              <span className={`mt-1 block text-[9px] ${selectedMapping.sourceBpmConfirmed ? "text-emerald-200/65" : "text-amber-200/70"}`}>{selectedMapping.sourceBpmConfirmed ? `Siap · preview ${Number(projectTempo || 120).toFixed(0)} BPM; hasil export mengikuti tempo DAW.` : "Konfirmasi tempo sumber agar sync aktif di preview dan hasil export."}</span>
            </label>
          )}
          <label>
            <FieldLabel>Root note · {midiNoteName(selectedMapping.rootPitch)}</FieldLabel>
            <select className="maker-input mt-2" value={selectedMapping.rootPitch} onChange={(event) => updateMapping(selectedMapping.id, { rootPitch: Number(event.target.value) })}>
              {rootOptions.map((pitch) => <option key={pitch} value={pitch}>{midiNoteName(pitch)}</option>)}
            </select>
          </label>
          <label>
            <FieldLabel>Key range{selectedMappingIds.size > 1 ? ` · ${selectedMappingIds.size} layer bersama` : ""}</FieldLabel>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select className="maker-input" value={selectedMapping.lowPitch} onChange={(event) => updateSelectedMappings({ lowPitch: Number(event.target.value) })} aria-label="Key range bawah">
                {lowOptions.map((pitch) => <option key={pitch} value={pitch}>{midiNoteName(pitch)}</option>)}
              </select>
              <select className="maker-input" value={selectedMapping.highPitch} onChange={(event) => updateSelectedMappings({ highPitch: Number(event.target.value) })} aria-label="Key range atas">
                {highOptions.map((pitch) => <option key={pitch} value={pitch}>{midiNoteName(pitch)}</option>)}
              </select>
            </div>
          </label>
          <div>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>Velocity layer cepat</FieldLabel>
              <select
                className="maker-input h-8 w-auto py-1 text-[9px]"
                value={configuredVelocityLayers}
                onChange={(event) => onVelocityLayersChange?.(Number(event.target.value))}
                aria-label="Jumlah velocity layer"
              >
                {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} layer</option>)}
              </select>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {Array.from({ length: configuredVelocityLayers }, (_, index) => {
                const layer = index + 1;
                const range = velocityLayerRange(layer, configuredVelocityLayers);
                const active = selectedMapping.velocityLow === range.velocityLow && selectedMapping.velocityHigh === range.velocityHigh;
                return <button key={layer} type="button" onClick={() => assignMappingVelocityLayer(layer)} className={`rounded-lg border px-1.5 py-2 text-[9px] font-bold ${active ? "border-[#fb7185]/60 bg-[#e11d48] text-white" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07]"}`} title={`Layer ${layer}: velocity ${range.velocityLow}–${range.velocityHigh}`}>L{layer}</button>;
              })}
            </div>
            <span className="mt-1 block text-[9px] text-zinc-600">Pilih layer untuk zona aktif; rentang manual tetap dapat diubah di bawah.</span>
          </div>
          <div>
            <FieldLabel>Choke target · {selectedChokeTargets.length ? `${selectedChokeTargets.length} note` : "Mati"}</FieldLabel>
            <select
              className="maker-input mt-2"
              value=""
              disabled={selectedChokeTargets.length >= 16}
              onChange={(event) => {
                if (event.target.value === "") return;
                const targetPitch = Number(event.target.value);
                updateSelectedMappings({ chokeTargetPitches: [...selectedChokeTargets, targetPitch] });
              }}
              aria-label="Tambah note choke target"
            >
              <option value="">{selectedChokeTargets.length >= 16 ? "Maksimal 16 note" : "Tambah note…"}</option>
              {availableChokeTargets.map((pitch) => <option key={pitch} value={pitch}>{midiNoteName(pitch)}</option>)}
            </select>
            {!!selectedChokeTargets.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedChokeTargets.map((pitch) => (
                  <button
                    key={pitch}
                    type="button"
                    onClick={() => updateSelectedMappings({ chokeTargetPitches: selectedChokeTargets.filter((item) => item !== pitch) })}
                    className="maker-choke-target-chip"
                    aria-label={`Hapus choke target ${midiNoteName(pitch)}`}
                  >
                    {midiNoteName(pitch)} <X className="h-2.5 w-2.5" />
                  </button>
                ))}
              </div>
            )}
            <span className="mt-1 block text-[9px] text-zinc-600">Saat zona dimainkan, semua suara aktif pada note target langsung berhenti.{selectedMappingIds.size > 1 ? " Berlaku untuk semua zona terpilih." : ""}</span>
          </div>
          {selectedMapping.loopEnabled && (
            <label>
              <FieldLabel>Loop crossfade · {Math.round(Number(selectedMapping.loopCrossfadeMs) || 0)} ms</FieldLabel>
              <input type="range" min="0" max="100" step="1" value={selectedMapping.loopCrossfadeMs ?? 8} onChange={(event) => updateSelectedMappings({ loopCrossfadeMs: Number(event.target.value) })} {...mappingRangeResetProps(() => updateSelectedMappings({ loopCrossfadeMs: 8 }))} className="maker-range mt-3 w-full" />
            </label>
          )}
          <label>
            <FieldLabel>Pilih sampler</FieldLabel>
            <select className="maker-input mt-2" value={normalizeSamplerName(selectedMapping.groupName)} onChange={(event) => {
              const samplerName = event.target.value;
              const sampler = samplerGroups.find((item) => item.name === samplerName);
              if (sampler) setSelectedSamplerId(sampler.id);
              updateMapping(selectedMapping.id, { groupName: samplerName });
            }} aria-label="Pilih sampler untuk zona ini">
              {!groupOptions.includes(normalizeSamplerName(selectedMapping.groupName)) && <option value={normalizeSamplerName(selectedMapping.groupName)}>{normalizeSamplerName(selectedMapping.groupName)}</option>}
              {groupOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <FieldLabel>Articulation</FieldLabel>
            <select className="maker-input mt-2" value={selectedMapping.articulation || "Sustain"} onChange={(event) => updateMapping(selectedMapping.id, { articulation: event.target.value })}>
              {!ARTICULATION_OPTIONS.includes(selectedMapping.articulation || "Sustain") && <option value={selectedMapping.articulation}>{selectedMapping.articulation}</option>}
              {ARTICULATION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <FieldLabel>Mic position</FieldLabel>
            <select className="maker-input mt-2" value={selectedMapping.micPosition || "Main"} onChange={(event) => updateMapping(selectedMapping.id, { micPosition: event.target.value })}>
              {!MIC_POSITION_OPTIONS.includes(selectedMapping.micPosition || "Main") && <option value={selectedMapping.micPosition}>{selectedMapping.micPosition}</option>}
              {MIC_POSITION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <FieldLabel>Round robin</FieldLabel>
            <input type="number" min="1" max="32" className="maker-input mt-2" value={selectedMapping.roundRobin || 1} onChange={(event) => updateMapping(selectedMapping.id, { roundRobin: Math.max(1, Math.min(32, Number(event.target.value) || 1)) })} />
          </label>
          <label>
            <FieldLabel>Velocity bawah · {selectedMapping.velocityLow}</FieldLabel>
            <input type="range" min="1" max={selectedMapping.velocityHigh} value={selectedMapping.velocityLow} onChange={(event) => updateMapping(selectedMapping.id, { velocityLow: Number(event.target.value) })} {...mappingRangeResetProps(() => updateMapping(selectedMapping.id, { velocityLow: 1 }))} className="maker-range mt-4 w-full" />
          </label>
          <label>
            <FieldLabel>Velocity atas · {selectedMapping.velocityHigh}</FieldLabel>
            <input type="range" min={selectedMapping.velocityLow} max="127" value={selectedMapping.velocityHigh} onChange={(event) => updateMapping(selectedMapping.id, { velocityHigh: Number(event.target.value) })} {...mappingRangeResetProps(() => updateMapping(selectedMapping.id, { velocityHigh: 127 }))} className="maker-range mt-4 w-full" />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={deleteSelectedMappings} className="h-11 w-full rounded-xl border border-red-400/15 text-xs font-semibold text-red-300 hover:bg-red-400/10">Hapus zona & audio</button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[#111014] px-4 py-5 text-center text-[10px] text-zinc-600">Pilih atau buat zona untuk menampilkan pengaturannya.</div>
      )}
      </aside>

      <main className="maker-mapping-main">

      {!!samples.length && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-violet-300/20 bg-violet-300/[0.06] px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-violet-100">Cara membuat mapping</div>
            <div className="mt-1 text-[10px] text-violet-100/60">
              {selectedMappingIds.size >= 2 && selectedMappingIds.size <= 4
                ? `${selectedMappingIds.size} zona dipilih. Susun sebagai velocity layer, lalu seret tepi zona untuk membentangkannya bersama.`
                : samples.length === 1
                  ? "Manual map menempatkan sample pada satu tuts; chromatic membentangkannya ke seluruh keyboard MIDI."
                  : "Pilih 2–4 zona sample dari lembut ke keras, susun sebagai velocity layer, lalu bentangkan key range-nya."}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={autoMapSequential} className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.06] px-3 py-2 text-[10px] font-bold text-emerald-100 hover:bg-emerald-300/10">Buat manual map</button>
            <button type="button" onClick={assignSelectedVelocityLayers} disabled={selectedMappingIds.size < 2 || selectedMappingIds.size > 4} title="Zona pertama menjadi layer paling lembut; zona berikutnya semakin keras" className="rounded-lg border border-[#fb7185]/35 bg-[#e11d48] px-3 py-2 text-[10px] font-bold text-white hover:bg-[#be123c] disabled:cursor-not-allowed disabled:opacity-35">Susun {selectedMappingIds.size >= 2 && selectedMappingIds.size <= 4 ? selectedMappingIds.size : "2–4"} velocity layer</button>
            <button type="button" onClick={autoMapChromatic} disabled={!selectedMapping} title={selectedMapping ? `Bentangkan zona dari root ${midiNoteName(selectedMapping.rootPitch)} ke seluruh keyboard MIDI` : "Pilih zona sample terlebih dahulu"} className="rounded-lg border border-violet-200/25 bg-violet-200/10 px-3 py-2 text-[10px] font-bold text-violet-100 hover:bg-violet-200/15 disabled:cursor-not-allowed disabled:opacity-35">Buat chromatic auto-map</button>
          </div>
        </div>
      )}

      <SamplerKeyboard
        accentColor={accentColor}
        velocity={velocity}
        sustainEnabled={sustainEnabled}
        onSustainToggle={onSustainToggle}
        pitchBendEnabled={pitchBendEnabled}
        onPitchBendToggle={onPitchBendToggle}
        modulationEnabled={modulationEnabled}
        onModulationToggle={onModulationToggle}
        onVelocityChange={onVelocityChange}
        audioStatus={audioStatus}
        externalPressedPitches={externalPressedPitches}
        mappingView={mappingView}
        mappingToolbar={(
          <div className="maker-mapping-zone-toolbar">
            <div className="maker-mapping-zone-toolbar__left">
              <div className="flex items-center overflow-hidden rounded-lg border border-white/10" key={mappingHistoryVersion}>
                <button type="button" onClick={undoMappings} disabled={!mappingHistoryPastRef.current.length} className="grid h-9 w-9 place-items-center text-zinc-400 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-25" aria-label="Urungkan edit mapping" title="Undo mapping"><Undo2 className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={redoMappings} disabled={!mappingHistoryFutureRef.current.length} className="grid h-9 w-9 place-items-center border-l border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-25" aria-label="Ulangi edit mapping" title="Redo mapping"><Redo2 className="h-3.5 w-3.5" /></button>
              </div>
              <label className="flex items-center gap-2 text-[9px] text-zinc-500" title="Hanya untuk preview browser dan fallback bila host tidak mengirim tempo. VST di DAW mengikuti tempo host."><span>Tempo preview</span><input type="number" min="20" max="300" step="1" value={projectTempo ?? ""} onChange={(event) => onProjectTempoChange?.(event.target.value === "" ? "" : Number(event.target.value))} onBlur={(event) => onProjectTempoChange?.(Math.max(20, Math.min(300, Number(event.target.value) || 120)))} className="maker-input h-9 w-20 py-1 text-[10px]" aria-label="Tempo preview BPM" /><span>BPM</span></label>
            </div>
            {projectActions && <div className="maker-mapping-project-actions">{projectActions}</div>}
          </div>
        )}
        onNoteOn={(pitch, noteVelocity, token) => {
          selectZoneForPitch(pitch, noteVelocity);
          onNoteOn(pitch, noteVelocity, token, activePreviewArticulation, activePreviewMicPosition, selectedSamplerName);
        }}
        onNoteOff={(token) => onNoteOff(token)}
      />

      {selectedMapping && (
        <SampleWaveformEditor
          sample={selectedSample}
          mapping={selectedMapping}
          accentColor={accentColor}
          playback={waveformPlayback}
          onChange={(updates) => updateMapping(selectedMapping.id, updates)}
        />
      )}

      {!selectedMapping && selectedSampler && (
        <div className="rounded-2xl border border-dashed border-sky-300/20 bg-sky-300/[0.04] px-5 py-6 text-center">
          <div className="text-sm font-semibold text-zinc-200">Sampler “{selectedSamplerName}” belum memiliki zona</div>
          <div className="mt-1 text-[10px] text-zinc-500">Tarik file ke atas tuts atau gunakan “Buat manual map”.</div>
        </div>
      )}

      </main>
    </div>
  );
}

function SamplerKeyboard({ accentColor, velocity, sustainEnabled, onSustainToggle, pitchBendEnabled = false, onPitchBendToggle, modulationEnabled = false, onModulationToggle, onVelocityChange, audioStatus, onNoteOn, onNoteOff, keyboardPitches = SAMPLER_PITCHES, compact = false, fitWidth = false, variant = "classic", externalPressedPitches = new Set(), tokenNamespace = "sampler", mappingView = null, mappingToolbar = null, scrollTargetPitch = null }) {
  const [pressedPitches, setPressedPitches] = useState(() => new Set());
  const activeTokensRef = useRef(new Set());
  const gestureTokensRef = useRef(new Map());
  const noteSequenceRef = useRef(0);
  const scrollRef = useRef(null);
  const noteOffRef = useRef(onNoteOff);
  noteOffRef.current = onNoteOff;
  useEffect(() => () => {
    activeTokensRef.current.forEach((token) => noteOffRef.current(token));
    activeTokensRef.current.clear();
  }, []);
  useEffect(() => {
    if (!Number.isInteger(scrollTargetPitch) || !scrollRef.current || fitWidth) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const viewport = scrollRef.current;
      if (!viewport) return;
      const targetX = samplerPitchCenter(Math.max(SAMPLER_MIN_PITCH, Math.min(SAMPLER_MAX_PITCH, scrollTargetPitch)));
      viewport.scrollTo({ left: Math.max(0, targetX - (viewport.clientWidth / 2)), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitWidth, scrollTargetPitch]);
  const whitePitches = keyboardPitches.filter((pitch) => !isBlackKey(pitch));
  const blackPitches = keyboardPitches.filter(isBlackKey);
  const keyWidth = compact ? 18 : 30;
  const beginNote = (pitch, event, tokenPrefix) => {
    event.preventDefault();
    if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId);
    const gestureKey = `${tokenPrefix}-${pitch}-${event.pointerId ?? "keyboard"}`;
    const previousToken = gestureTokensRef.current.get(gestureKey);
    if (previousToken) onNoteOff(previousToken);
    const token = `${tokenNamespace}-${gestureKey}-${++noteSequenceRef.current}`;
    gestureTokensRef.current.set(gestureKey, token);
    activeTokensRef.current.add(token);
    setPressedPitches((current) => new Set(current).add(pitch));
    onNoteOn(pitch, velocity, token);
  };
  const endNote = (pitch, event, tokenPrefix) => {
    const gestureKey = `${tokenPrefix}-${pitch}-${event.pointerId ?? "keyboard"}`;
    const token = gestureTokensRef.current.get(gestureKey);
    gestureTokensRef.current.delete(gestureKey);
    if (!token) return;
    activeTokensRef.current.delete(token);
    setPressedPitches((current) => {
      const next = new Set(current);
      next.delete(pitch);
      return next;
    });
    onNoteOff(token);
  };
  const keyProps = (pitch) => ({
    onPointerDown: (event) => beginNote(pitch, event, "pointer"),
    onPointerUp: (event) => endNote(pitch, event, "pointer"),
    onPointerCancel: (event) => endNote(pitch, event, "pointer"),
    onKeyDown: (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) beginNote(pitch, event, "keyboard");
    },
    onKeyUp: (event) => {
      if (event.key === "Enter" || event.key === " ") endNote(pitch, event, "keyboard");
    },
  });

  return (
    <div className={`maker-sampler-keyboard-panel maker-keyboard--${variant} ${compact ? "maker-sampler-keyboard-panel--compact" : ""}`} style={{ "--maker-accent": accentColor }}>
      {mappingToolbar}
      {!compact && (
        <div className="mb-3 flex flex-wrap items-end gap-4">
          <div className="min-w-40 flex-1">
            <FieldLabel>Velocity test · {velocity}</FieldLabel>
            <input type="range" min="1" max="127" value={velocity} onChange={(event) => onVelocityChange(Number(event.target.value))} {...mappingRangeResetProps(() => onVelocityChange(100))} className="maker-range mt-4 w-full" />
          </div>
          <button
            type="button"
            onClick={onSustainToggle}
            aria-pressed={sustainEnabled}
            className={`maker-sustain-toggle ${sustainEnabled ? "is-enabled" : ""}`}
          >
            <span className="maker-sustain-toggle__indicator" />
            Sustain {sustainEnabled ? "On" : "Off"}
          </button>
          <button
            type="button"
            onClick={onPitchBendToggle}
            aria-pressed={pitchBendEnabled}
            title="Aktifkan atau nonaktifkan Pitch Bend"
            className={`maker-sustain-toggle ${pitchBendEnabled ? "is-enabled" : ""}`}
          >
            <span className="maker-sustain-toggle__indicator" />
            Pitch Bend {pitchBendEnabled ? "On" : "Off"}
          </button>
          <button
            type="button"
            onClick={onModulationToggle}
            aria-pressed={modulationEnabled}
            title="Aktifkan atau nonaktifkan Modulasi"
            className={`maker-sustain-toggle ${modulationEnabled ? "is-enabled" : ""}`}
          >
            <span className="maker-sustain-toggle__indicator" />
            Modulasi {modulationEnabled ? "On" : "Off"}
          </button>
          <div className="text-[9px] text-zinc-600">MIDI 0–127 · pedal menahan nada yang dilepas</div>
        </div>
      )}
      <div ref={scrollRef} className="maker-sampler-keyboard-scroll">
        {mappingView}
        <div
          className={`maker-sampler-keyboard ${compact ? "maker-sampler-keyboard--compact" : ""} ${fitWidth ? "maker-sampler-keyboard--fit" : ""}`}
          style={fitWidth ? { "--maker-fit-min-width": `${whitePitches.length * 20}px` } : undefined}
        >
          <div
            className="maker-sampler-keyboard__white"
            style={{
              "--maker-accent": accentColor,
              "--maker-white-count": whitePitches.length,
              "--maker-key-width": fitWidth ? "minmax(20px, 1fr)" : `${keyWidth}px`,
              "--maker-key-height": fitWidth ? "100%" : compact ? "78px" : "126px",
              "--maker-black-width": fitWidth ? `calc((100% / ${whitePitches.length}) * 0.62)` : compact ? "11px" : "18px",
              "--maker-black-height": fitWidth ? "62%" : compact ? "48px" : "78px",
            }}
          >
            {whitePitches.map((pitch, index) => (
              <button
                type="button"
                key={pitch}
                {...keyProps(pitch)}
                data-vst-pitch={pitch}
                className={`maker-sampler-key maker-sampler-key--white ${(pressedPitches.has(pitch) || externalPressedPitches.has(pitch)) ? "is-pressed" : ""} ${index === whitePitches.length - 1 ? "is-last" : ""}`}
                style={{ gridColumn: index + 1 }}
                aria-label={`Mainkan ${midiNoteName(pitch)}`}
                title={midiNoteName(pitch)}
              >
                {pitch % 12 === 0 && <span>{midiNoteName(pitch)}</span>}
              </button>
            ))}
            {blackPitches.map((pitch) => {
              const whitePosition = whitePitches.filter((whitePitch) => whitePitch < pitch).length;
              return (
                <button
                  type="button"
                  key={pitch}
                  {...keyProps(pitch)}
                  data-vst-pitch={pitch}
                  className={`maker-sampler-key maker-sampler-key--black ${(pressedPitches.has(pitch) || externalPressedPitches.has(pitch)) ? "is-pressed" : ""}`}
                  style={{ left: fitWidth ? `calc((${whitePosition} * (100% / ${whitePitches.length})) - ((100% / ${whitePitches.length}) * 0.3))` : `${whitePosition * keyWidth - (keyWidth * 0.3)}px` }}
                  aria-label={`Mainkan ${midiNoteName(pitch)}`}
                  title={midiNoteName(pitch)}
                />
              );
            })}
          </div>
        </div>
      </div>
      {!compact && <p className="mt-3 min-h-5 text-[10px] text-zinc-500" aria-live="polite">{audioStatus}</p>}
    </div>
  );
}

function PianoRoll({ accentColor, notes, onChange }) {
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [newNoteLength, setNewNoteLength] = useState(2);
  const [newNoteVelocity, setNewNoteVelocity] = useState(100);
  const selectedNote = notes.find((note) => note.id === selectedNoteId);

  useEffect(() => {
    if (selectedNoteId && !selectedNote) setSelectedNoteId(null);
  }, [selectedNote, selectedNoteId]);

  const addOrSelectNote = (pitch, step) => {
    const existing = notes.find((note) => note.pitch === pitch && step >= note.step && step < note.step + note.length);
    if (existing) {
      setSelectedNoteId(existing.id);
      setNewNoteLength(existing.length);
      setNewNoteVelocity(existing.velocity);
      return;
    }
    if (notes.length >= 128) {
      toast.error("Piano roll dibatasi hingga 128 nada per project");
      return;
    }
    const note = {
      id: makeId(),
      pitch,
      step,
      length: Math.min(newNoteLength, PIANO_STEPS - step),
      velocity: newNoteVelocity,
    };
    onChange([...notes, note]);
    setSelectedNoteId(note.id);
  };

  const updateSelectedNote = (updates) => {
    if (!selectedNote) return;
    onChange(notes.map((note) => note.id === selectedNote.id ? { ...note, ...updates } : note));
  };

  const setLength = (value) => {
    const length = Number(value);
    setNewNoteLength(length);
    if (selectedNote) updateSelectedNote({ length: Math.min(length, PIANO_STEPS - selectedNote.step) });
  };

  const setVelocity = (value) => {
    const velocity = Number(value);
    setNewNoteVelocity(velocity);
    if (selectedNote) updateSelectedNote({ velocity });
  };

  const removeSelectedNote = () => {
    onChange(notes.filter((note) => note.id !== selectedNoteId));
    setSelectedNoteId(null);
  };

  return (
    <div className="mt-6" style={{ "--maker-accent": accentColor }}>
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-2xl border border-white/5 bg-black/20 p-4">
        <label className="min-w-36">
          <FieldLabel>Panjang nada</FieldLabel>
          <select className="maker-input mt-2" value={selectedNote?.length ?? newNoteLength} onChange={(event) => setLength(event.target.value)}>
            {[1, 2, 4, 8, 16].map((length) => <option key={length} value={length}>{length} step</option>)}
          </select>
        </label>
        <label className="min-w-40 flex-1">
          <FieldLabel>Velocity · {selectedNote?.velocity ?? newNoteVelocity}</FieldLabel>
          <input className="maker-range mt-4 w-full" type="range" min="1" max="127" value={selectedNote?.velocity ?? newNoteVelocity} onChange={(event) => setVelocity(event.target.value)} />
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-zinc-500">{notes.length} nada · 2 bar</span>
          {selectedNote && <button type="button" onClick={removeSelectedNote} className="rounded-lg border border-red-400/15 px-3 py-2 text-[10px] font-semibold text-red-300 hover:bg-red-400/10">Hapus nada</button>}
          {!!notes.length && <button type="button" onClick={() => { onChange([]); setSelectedNoteId(null); }} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-zinc-400 hover:bg-white/5">Kosongkan</button>}
        </div>
      </div>

      <div className="maker-piano-roll-scroll">
        <div className="maker-piano-timeline">
          <span className="maker-piano-key-label">Nada</span>
          <div className="maker-piano-timeline__grid">
            {Array.from({ length: 8 }, (_, beat) => (
              <span key={beat} style={{ gridColumn: `${beat * 4 + 1} / span 4` }}>
                {beat % 4 === 0 ? `Bar ${Math.floor(beat / 4) + 1}` : `Beat ${beat % 4 + 1}`}
              </span>
            ))}
          </div>
        </div>
        {PIANO_PITCHES.map((pitch) => (
          <div className="maker-piano-row" key={pitch}>
            <div className={`maker-piano-key-label ${isBlackKey(pitch) ? "is-black" : ""}`}>{midiNoteName(pitch)}</div>
            <div className="maker-piano-row__grid">
              {Array.from({ length: PIANO_STEPS }, (_, step) => (
                <button
                  key={step}
                  type="button"
                  className={`maker-piano-cell ${step === 0 || step === 16 ? "is-bar-start" : step % 4 === 0 ? "is-beat-start" : ""}`}
                  onClick={() => addOrSelectNote(pitch, step)}
                  aria-label={`Tambah nada ${midiNoteName(pitch)} di step ${step + 1}`}
                />
              ))}
              {notes.filter((note) => note.pitch === pitch).map((note) => (
                <button
                  type="button"
                  key={note.id}
                  className={`maker-piano-note ${selectedNoteId === note.id ? "is-selected" : ""}`}
                  style={{ left: `${(note.step / PIANO_STEPS) * 100}%`, width: `${(note.length / PIANO_STEPS) * 100}%` }}
                  onClick={() => {
                    setSelectedNoteId(note.id);
                    setNewNoteLength(note.length);
                    setNewNoteVelocity(note.velocity);
                  }}
                  title={`${midiNoteName(note.pitch)} · velocity ${note.velocity} · ${note.length} step`}
                >
                  {midiNoteName(note.pitch)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-5 text-zinc-600">Klik grid untuk menambah nada. Piano roll ini menyimpan susunan MIDI rancangan; audio playback belum tersambung.</p>
    </div>
  );
}
