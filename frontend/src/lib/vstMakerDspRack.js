const clampUnit = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

const migrateLegendGainStaging = (type, parameters) => {
  const migrated = { ...parameters };
  const matches = (key, value) => Math.abs(Number(migrated[key]) - value) < 0.000001;
  if (type === "legend_compressor" && matches("model", 0) && matches("amount", 0.42)
    && matches("attack", 0.38) && matches("release", 0.46) && matches("makeup", 0.12)) migrated.makeup = 0;
  if (type === "legend_eq" && matches("model", 0) && matches("low", 0.54) && matches("mid", 0.5)
    && matches("high", 0.54) && matches("air", 0.54)) Object.assign(migrated, { low: 0.5, high: 0.5, air: 0.5 });
  if (type === "legend_tape" && matches("model", 1 / 3) && matches("drive", 0.34) && matches("speed", 0.5)
    && matches("age", 0.16) && matches("wow_flutter", 0.12) && matches("output", 0.5)) migrated.output = 0.46;
  return migrated;
};

export const DSP_RACK_MODULE_OPTIONS = [
  { type: "legend_preamp", name: "Legend Preamp", family: "legend_hardware", stage: 1, parameter: "drive", defaultValue: 0.38, parameters: [
    { key: "model", label: "Circuit character", defaultValue: 0, format: "legend_preamp_model", options: [
      { label: "British Class-A", value: 0 }, { label: "American Discrete", value: 1 / 3 }, { label: "Tube Broadcast", value: 2 / 3 }, { label: "Modern Transformer", value: 1 },
    ] },
    { key: "drive", label: "Input drive", defaultValue: 0.38, format: "legend_drive" },
    { key: "color", label: "Transformer color", defaultValue: 0.52, format: "percentage" },
    { key: "high_pass", label: "Low cut", defaultValue: 0.18, format: "legend_high_pass" },
    { key: "output", label: "Output", defaultValue: 0.5, format: "bipolar_db" },
  ] },
  { type: "legend_compressor", name: "Legend Compressor", family: "legend_hardware", stage: 2, parameter: "amount", defaultValue: 0.42, parameters: [
    { key: "model", label: "Compressor topology", defaultValue: 0, format: "legend_compressor_model", options: [
      { label: "FET Punch", value: 0 }, { label: "Optical Smooth", value: 1 / 3 }, { label: "VCA Bus", value: 2 / 3 }, { label: "Vari-Mu Glue", value: 1 },
    ] },
    { key: "amount", label: "Compression", defaultValue: 0.42, format: "percentage" },
    { key: "attack", label: "Attack", defaultValue: 0.38, format: "attack_ms" },
    { key: "release", label: "Release", defaultValue: 0.46, format: "release_ms" },
    { key: "makeup", label: "Makeup", defaultValue: 0, format: "makeup_db" },
  ] },
  { type: "legend_eq", name: "Legend Equalizer", family: "legend_hardware", stage: 3, parameter: "mid", defaultValue: 0.5, parameters: [
    { key: "model", label: "EQ architecture", defaultValue: 0, format: "legend_eq_model", options: [
      { label: "Passive Tube", value: 0 }, { label: "British Console", value: 1 / 3 }, { label: "American Proportional-Q", value: 2 / 3 }, { label: "Modern Clean", value: 1 },
    ] },
    { key: "low", label: "Low", defaultValue: 0.5, format: "bipolar_db" },
    { key: "mid", label: "Mid", defaultValue: 0.5, format: "bipolar_db" },
    { key: "high", label: "High", defaultValue: 0.5, format: "bipolar_db" },
    { key: "air", label: "Air", defaultValue: 0.5, format: "bipolar_db" },
  ] },
  { type: "legend_tape", name: "Legend Tape Machine", family: "legend_hardware", stage: 4, parameter: "drive", defaultValue: 0.34, parameters: [
    { key: "model", label: "Tape formulation", defaultValue: 1 / 3, format: "legend_tape_model", options: [
      { label: "Warm Ferric", value: 0 }, { label: "Studio 456", value: 1 / 3 }, { label: "High-Output GP9", value: 2 / 3 }, { label: "Mastering Clean", value: 1 },
    ] },
    { key: "drive", label: "Record level", defaultValue: 0.34, format: "legend_drive" },
    { key: "speed", label: "Tape speed", defaultValue: 0.5, format: "legend_tape_speed", options: [
      { label: "7.5 ips", value: 0 }, { label: "15 ips", value: 0.5 }, { label: "30 ips", value: 1 },
    ] },
    { key: "age", label: "Tape age", defaultValue: 0.16, format: "percentage" },
    { key: "wow_flutter", label: "Wow & flutter", defaultValue: 0.12, format: "percentage" },
    { key: "output", label: "Output", defaultValue: 0.46, format: "bipolar_db" },
  ] },
  { type: "tuning", name: "Tuning & Fine Tune", parameter: "tuning", defaultValue: 0.5, instrumentOnly: true, parameters: [
    { key: "tuning", label: "Tuning", defaultValue: 0.5, format: "tuning_semitone" },
    { key: "fine_tune", label: "Fine Tune", defaultValue: 0.5, format: "tuning_cents" },
  ] },
  { type: "wave_generator", name: "Wave Generator", parameter: "waveform", defaultValue: 0, instrumentOnly: true, parameters: [
    { key: "waveform", label: "OSC 1 waveform", defaultValue: 0, format: "osc_waveform" },
    { key: "octave", label: "Octave", defaultValue: 0.5, format: "osc_octave" },
    { key: "semitone", label: "Semitone", defaultValue: 0.5, format: "osc_semitone" },
    { key: "fine", label: "Fine tune", defaultValue: 0.5, format: "osc_fine" },
    { key: "level", label: "OSC 1 level", defaultValue: 0.65 },
    { key: "pulse_width", label: "Pulse width", defaultValue: 0.5, format: "osc_pulse_width" },
    { key: "phase_reset", label: "Reset phase", defaultValue: 1, format: "on_off" },
    { key: "voice_mode", label: "Voice mode", defaultValue: 1, format: "voice_mode" },
    { key: "retrigger", label: "Retrigger envelope", defaultValue: 1, format: "on_off" },
    { key: "attack", label: "Amp attack", defaultValue: 0, format: "synth_attack" },
    { key: "decay", label: "Amp decay", defaultValue: 0.2, format: "synth_decay" },
    { key: "sustain", label: "Amp sustain", defaultValue: 1 },
    { key: "release", label: "Amp release", defaultValue: 0.18, format: "synth_release" },
    { key: "velocity_sensitivity", label: "Sensitivitas velocity", defaultValue: 1, format: "percentage" },
    { key: "velocity_curve", label: "Kurva velocity", defaultValue: 1, format: "velocity_curve" },
    { key: "velocity_min_level", label: "Level minimum", defaultValue: 0, format: "percentage" },
    { key: "filter_cutoff", label: "Filter cutoff", defaultValue: 1, format: "synth_cutoff" },
    { key: "filter_resonance", label: "Filter resonance", defaultValue: 0, format: "synth_resonance" },
    { key: "filter_env_amount", label: "Filter envelope", defaultValue: 0.5, format: "synth_bipolar" },
    { key: "filter_key_tracking", label: "Filter key tracking", defaultValue: 0, format: "percentage" },
    { key: "osc2_enabled", label: "OSC 2 aktif", defaultValue: 0, format: "on_off" },
    { key: "osc2_waveform", label: "OSC 2 waveform", defaultValue: 0, format: "osc_waveform" },
    { key: "osc2_octave", label: "OSC 2 octave", defaultValue: 0.5, format: "osc_octave" },
    { key: "osc2_detune", label: "OSC 2 detune", defaultValue: 0.5, format: "osc_fine" },
    { key: "osc2_level", label: "OSC 2 level", defaultValue: 0.5 },
    { key: "osc2_pulse_width", label: "OSC 2 pulse width", defaultValue: 0.5, format: "osc_pulse_width" },
    { key: "sub_level", label: "Sub oscillator", defaultValue: 0 },
    { key: "noise_level", label: "Noise level", defaultValue: 0 },
    { key: "noise_color", label: "Noise color", defaultValue: 0.5, format: "noise_color" },
    { key: "unison_voices", label: "Unison voices", defaultValue: 0, format: "unison_voices" },
    { key: "unison_detune", label: "Unison detune", defaultValue: 0.12, format: "unison_detune" },
    { key: "stereo_spread", label: "Stereo spread", defaultValue: 0, format: "percentage" },
    { key: "glide", label: "Glide", defaultValue: 0, format: "glide_time" },
    { key: "glide_mode", label: "Glide mode", defaultValue: 0, format: "glide_mode" },
    { key: "vibrato_rate", label: "Vibrato rate", defaultValue: 0.45, format: "vibrato_rate" },
    { key: "vibrato_depth", label: "Vibrato depth", defaultValue: 0, format: "vibrato_cents" },
    { key: "vibrato_delay", label: "Vibrato delay", defaultValue: 0, format: "vibrato_delay" },
  ] },
  { type: "input_trim", name: "Input Trim", parameter: "input", defaultValue: 0.5, parameters: [{ key: "input", label: "Input", defaultValue: 0.5, format: "input_db" }] },
  { type: "soft_clip", name: "Soft Clip", parameter: "drive", defaultValue: 0.24, parameters: [
    { key: "drive", label: "Drive", defaultValue: 0.24 }, { key: "character", label: "Character", defaultValue: 0.5 }, { key: "output", label: "Output", defaultValue: 0.5, format: "bipolar_db" },
  ] },
  { type: "linked_compressor", name: "Linked Compressor", parameter: "compress", defaultValue: 0.35, parameters: [
    { key: "compress", label: "Amount", defaultValue: 0.35 }, { key: "threshold", label: "Threshold", defaultValue: 0.7, format: "threshold_db" }, { key: "ratio", label: "Ratio", defaultValue: 0.13, format: "ratio" },
    { key: "attack", label: "Attack", defaultValue: 0.63, format: "attack_ms" }, { key: "release", label: "Release", defaultValue: 0.46, format: "release_ms" }, { key: "makeup", label: "Makeup", defaultValue: 0, format: "makeup_db" },
  ] },
  { type: "de_esser", name: "De-Esser", parameter: "amount", defaultValue: 0.55, parameters: [
    { key: "amount", label: "Amount", defaultValue: 0.55, format: "percentage" },
    { key: "frequency", label: "Frequency", defaultValue: 0.5, format: "deesser_frequency" },
    { key: "threshold", label: "Threshold", defaultValue: 0.58, format: "threshold_db" },
    { key: "range", label: "Range", defaultValue: 0.5, format: "deesser_range" },
    { key: "attack", label: "Attack", defaultValue: 0.35, format: "deesser_attack_ms" },
    { key: "release", label: "Release", defaultValue: 0.45, format: "deesser_release_ms" },
  ] },
  { type: "prism_eq", name: "Prism Spectrum EQ", parameter: "band_3_gain", defaultValue: 0.5, parameters: [
    { key: "band_1_enabled", label: "Band 1 · Low Cut", defaultValue: 0, format: "on_off", step: 1 },
    { key: "band_1_frequency", label: "Band 1 · Frequency", defaultValue: 0.201, format: "prism_frequency" },
    { key: "band_1_gain", label: "Band 1 · Gain", defaultValue: 0.5, format: "bipolar_db" },
    { key: "band_1_q", label: "Band 1 · Q", defaultValue: 0.453, format: "prism_q" },
    { key: "band_2_enabled", label: "Band 2 · Low Body", defaultValue: 0, format: "on_off", step: 1 },
    { key: "band_2_frequency", label: "Band 2 · Frequency", defaultValue: 0.31, format: "prism_frequency" },
    { key: "band_2_gain", label: "Band 2 · Gain", defaultValue: 0.42, format: "bipolar_db" },
    { key: "band_2_q", label: "Band 2 · Q", defaultValue: 0.452, format: "prism_q" },
    { key: "band_3_enabled", label: "Band 3 · Mid Focus", defaultValue: 0, format: "on_off", step: 1 },
    { key: "band_3_frequency", label: "Band 3 · Frequency", defaultValue: 0.562, format: "prism_frequency" },
    { key: "band_3_gain", label: "Band 3 · Gain", defaultValue: 0.48, format: "bipolar_db" },
    { key: "band_3_q", label: "Band 3 · Q", defaultValue: 0.478, format: "prism_q" },
    { key: "band_4_enabled", label: "Band 4 · Presence", defaultValue: 0, format: "on_off", step: 1 },
    { key: "band_4_frequency", label: "Band 4 · Frequency", defaultValue: 0.735, format: "prism_frequency" },
    { key: "band_4_gain", label: "Band 4 · Gain", defaultValue: 0.54, format: "bipolar_db" },
    { key: "band_4_q", label: "Band 4 · Q", defaultValue: 0.486, format: "prism_q" },
    { key: "band_5_enabled", label: "Band 5 · Air", defaultValue: 0, format: "on_off", step: 1 },
    { key: "band_5_frequency", label: "Band 5 · Frequency", defaultValue: 0.859, format: "prism_frequency" },
    { key: "band_5_gain", label: "Band 5 · Gain", defaultValue: 0.32, format: "bipolar_db" },
    { key: "band_5_q", label: "Band 5 · Q", defaultValue: 0.452, format: "prism_q" },
  ] },
  { type: "parametric_eq", name: "Parametric EQ", parameter: "mid_gain", defaultValue: 0.5, parameters: [
    { key: "mode", label: "Processing", defaultValue: 0, format: "eq_mode", step: 0.5 },
    { key: "low_cut_enabled", label: "Low cut", defaultValue: 0, format: "on_off", step: 1 },
    { key: "low_cut_frequency", label: "Low cut frequency", defaultValue: 0.28, format: "eq_low_cut_frequency" },
    { key: "low_cut_q", label: "Low cut Q", defaultValue: 0.12, format: "eq_cut_q" },
    { key: "low_gain", label: "Low bell gain", defaultValue: 0.5, format: "bipolar_db" },
    { key: "low_frequency", label: "Low bell frequency", defaultValue: 0.32, format: "eq_low_frequency" },
    { key: "low_q", label: "Low bell Q", defaultValue: 0.18, format: "eq_bell_q" },
    { key: "mid_gain", label: "Mid bell gain", defaultValue: 0.5, format: "bipolar_db" },
    { key: "mid_frequency", label: "Mid bell frequency", defaultValue: 0.45, format: "eq_mid_frequency" },
    { key: "mid_q", label: "Mid bell Q", defaultValue: 0.28, format: "eq_bell_q" },
    { key: "high_gain", label: "High bell gain", defaultValue: 0.5, format: "bipolar_db" },
    { key: "high_frequency", label: "High bell frequency", defaultValue: 0.55, format: "eq_high_frequency" },
    { key: "high_q", label: "High bell Q", defaultValue: 0.18, format: "eq_bell_q" },
    { key: "high_cut_enabled", label: "High cut", defaultValue: 0, format: "on_off", step: 1 },
    { key: "high_cut_frequency", label: "High cut frequency", defaultValue: 0.78, format: "eq_high_cut_frequency" },
    { key: "high_cut_q", label: "High cut Q", defaultValue: 0.12, format: "eq_cut_q" },
    { key: "output", label: "Output", defaultValue: 0.5, format: "bipolar_db" },
  ] },
  { type: "multiband_compressor", name: "Multiband Compressor", parameter: "amount", defaultValue: 0.65, parameters: [
    { key: "amount", label: "Amount", defaultValue: 0.65, format: "percentage" },
    { key: "low_crossover", label: "Low crossover", defaultValue: 0.48, format: "mb_low_crossover" },
    { key: "high_crossover", label: "High crossover", defaultValue: 0.42, format: "mb_high_crossover" },
    { key: "low_threshold", label: "Low threshold", defaultValue: 0.58, format: "threshold_db" },
    { key: "low_ratio", label: "Low ratio", defaultValue: 0.2, format: "ratio" },
    { key: "low_attack", label: "Low attack", defaultValue: 0.62, format: "attack_ms" },
    { key: "low_release", label: "Low release", defaultValue: 0.5, format: "release_ms" },
    { key: "low_makeup", label: "Low makeup", defaultValue: 0, format: "mb_makeup_db" },
    { key: "mid_threshold", label: "Mid threshold", defaultValue: 0.54, format: "threshold_db" },
    { key: "mid_ratio", label: "Mid ratio", defaultValue: 0.26, format: "ratio" },
    { key: "mid_attack", label: "Mid attack", defaultValue: 0.5, format: "attack_ms" },
    { key: "mid_release", label: "Mid release", defaultValue: 0.45, format: "release_ms" },
    { key: "mid_makeup", label: "Mid makeup", defaultValue: 0, format: "mb_makeup_db" },
    { key: "high_threshold", label: "High threshold", defaultValue: 0.5, format: "threshold_db" },
    { key: "high_ratio", label: "High ratio", defaultValue: 0.3, format: "ratio" },
    { key: "high_attack", label: "High attack", defaultValue: 0.38, format: "attack_ms" },
    { key: "high_release", label: "High release", defaultValue: 0.4, format: "release_ms" },
    { key: "high_makeup", label: "High makeup", defaultValue: 0, format: "mb_makeup_db" },
  ] },
  { type: "tone_shaper", name: "Tone Shaper", parameter: "tone", defaultValue: 0.5, parameters: [
    { key: "tone", label: "Tone", defaultValue: 0.5 }, { key: "low", label: "Low", defaultValue: 0.5, format: "bipolar_db" }, { key: "mid", label: "Mid", defaultValue: 0.5, format: "bipolar_db" }, { key: "high", label: "High", defaultValue: 0.5, format: "bipolar_db" },
  ] },
  { type: "stereo_width", name: "Stereo Width", parameter: "width", defaultValue: 0.5, parameters: [
    { key: "width", label: "Width", defaultValue: 0.5, format: "width" }, { key: "mono_bass", label: "Mono bass", defaultValue: 0, format: "mono_bass" },
  ] },
  { type: "noise_gate", name: "Amp Noise Gate", parameter: "threshold", defaultValue: 0.42, parameters: [
    { key: "threshold", label: "Threshold", defaultValue: 0.42, format: "gate_threshold_db" }, { key: "release", label: "Release", defaultValue: 0.5, format: "gate_release_ms" },
  ] },
  { type: "amp_overdrive", name: "Amp Overdrive", parameter: "drive", defaultValue: 0.35, parameters: [
    { key: "drive", label: "Drive", defaultValue: 0.35 }, { key: "tone", label: "Tone", defaultValue: 0.5 }, { key: "level", label: "Level", defaultValue: 0.5, format: "bipolar_db" },
  ] },
  { type: "amp_model", name: "Original Amp Model", parameter: "gain", defaultValue: 0.45, parameters: [
    { key: "gain", label: "Gain", defaultValue: 0.45 }, { key: "bass", label: "Bass", defaultValue: 0.5, format: "bipolar_db" },
    { key: "mid", label: "Mid", defaultValue: 0.5, format: "bipolar_db" }, { key: "treble", label: "Treble", defaultValue: 0.5, format: "bipolar_db" },
    { key: "presence", label: "Presence", defaultValue: 0.35 }, { key: "master", label: "Master", defaultValue: 0.75, format: "amp_master_db" },
  ] },
  { type: "dual_high_gain", name: "Dual High-Gain Amp", parameter: "gain", defaultValue: 0.72, parameters: [
    { key: "mode", label: "Voicing", defaultValue: 0, format: "amp_mode" }, { key: "gain", label: "Gain", defaultValue: 0.72 },
    { key: "tight", label: "Tight", defaultValue: 0.65 }, { key: "bass", label: "Bass", defaultValue: 0.5, format: "bipolar_db" },
    { key: "mid", label: "Mid", defaultValue: 0.5, format: "bipolar_db" }, { key: "treble", label: "Treble", defaultValue: 0.5, format: "bipolar_db" },
    { key: "presence", label: "Presence", defaultValue: 0.5 }, { key: "depth", label: "Depth", defaultValue: 0.5 },
    { key: "sag", label: "Sag", defaultValue: 0.25 }, { key: "master", label: "Master", defaultValue: 0.65, format: "amp_master_db" },
  ] },
  { type: "silk_bloom", name: "Silk Bloom Boutique Amp", parameter: "gain", defaultValue: 0.46, parameters: [
    { key: "mode", label: "Channel", defaultValue: 0.5, format: "silk_mode" }, { key: "pickup", label: "Pickup", defaultValue: 0.5, format: "pickup_mode" },
    { key: "gain", label: "Gain", defaultValue: 0.46 }, { key: "touch", label: "Touch", defaultValue: 0.72 },
    { key: "bass", label: "Bass", defaultValue: 0.48, format: "bipolar_db" }, { key: "mid", label: "Mid", defaultValue: 0.58, format: "bipolar_db" },
    { key: "treble", label: "Treble", defaultValue: 0.54, format: "bipolar_db" }, { key: "presence", label: "Presence", defaultValue: 0.38 },
    { key: "sag", label: "Bloom", defaultValue: 0.42 }, { key: "master", label: "Master", defaultValue: 0.7, format: "amp_master_db" },
  ] },
  { type: "cabinet_ir", name: "Built-in Cabinet", parameter: "cabinet", defaultValue: 0.5, parameters: [
    { key: "cabinet", label: "Cabinet voicing", defaultValue: 0.5 }, { key: "mic_position", label: "Mic position", defaultValue: 0.58 },
    { key: "mic_blend", label: "Dynamic / Ribbon", defaultValue: 0.22, format: "mic_blend" }, { key: "distance", label: "Mic distance", defaultValue: 0.08, format: "mic_distance" },
    { key: "low_cut", label: "Low cut", defaultValue: 0.18, format: "cab_low_cut" }, { key: "high_cut", label: "High cut", defaultValue: 0.48, format: "cab_high_cut" },
    { key: "resonance", label: "Resonance", defaultValue: 0.5 }, { key: "level", label: "Level", defaultValue: 0.5, format: "bipolar_db" },
  ] },
  { type: "cross_delay", name: "Cross Delay", parameter: "space", defaultValue: 0.22, parameters: [
    { key: "space", label: "Amount", defaultValue: 0.22 }, { key: "time", label: "Time", defaultValue: 0.576, format: "delay_ms" }, { key: "feedback", label: "Feedback", defaultValue: 0.3, format: "feedback" },
    { key: "crossfeed", label: "Crossfeed", defaultValue: 1 }, { key: "filter", label: "Filter", defaultValue: 1 },
  ] },
  { type: "chorus", name: "Studio Chorus", parameter: "mix", defaultValue: 0.35, parameters: [
    { key: "mix", label: "Mix", defaultValue: 0.35 }, { key: "rate", label: "Rate", defaultValue: 0.38, format: "mod_rate" },
    { key: "depth", label: "Depth", defaultValue: 0.58 }, { key: "delay", label: "Delay", defaultValue: 0.48, format: "chorus_delay" },
    { key: "feedback", label: "Feedback", defaultValue: 0.35, format: "mod_feedback" }, { key: "stereo", label: "Stereo", defaultValue: 0.75 },
  ] },
  { type: "flanger", name: "Through-Zero Flanger", parameter: "mix", defaultValue: 0.42, parameters: [
    { key: "mix", label: "Mix", defaultValue: 0.42 }, { key: "rate", label: "Rate", defaultValue: 0.32, format: "mod_rate" },
    { key: "depth", label: "Depth", defaultValue: 0.62 }, { key: "manual", label: "Manual", defaultValue: 0.38, format: "flanger_delay" },
    { key: "feedback", label: "Feedback", defaultValue: 0.68, format: "bipolar_feedback" }, { key: "stereo", label: "Stereo", defaultValue: 0.6 },
  ] },
  { type: "tremolo", name: "Stereo Tremolo", parameter: "mix", defaultValue: 1, parameters: [
    { key: "mix", label: "Mix", defaultValue: 1 }, { key: "rate", label: "Rate", defaultValue: 0.48, format: "tremolo_rate" },
    { key: "depth", label: "Depth", defaultValue: 0.7 }, { key: "shape", label: "Shape", defaultValue: 0.35, format: "lfo_shape" },
    { key: "stereo", label: "Stereo phase", defaultValue: 0.5 },
  ] },
  { type: "vibrato", name: "True Vibrato", parameter: "mix", defaultValue: 1, parameters: [
    { key: "mix", label: "Mix", defaultValue: 1 }, { key: "rate", label: "Rate", defaultValue: 0.45, format: "mod_rate" },
    { key: "depth", label: "Depth", defaultValue: 0.45, format: "vibrato_depth" }, { key: "stereo", label: "Stereo", defaultValue: 0.4 },
  ] },
  { type: "digital_delay", name: "Early Digital Delay", parameter: "mix", defaultValue: 0.28, parameters: [
    { key: "mix", label: "Mix", defaultValue: 0.28 }, { key: "time", label: "Time", defaultValue: 0.62, format: "digital_delay_ms" },
    { key: "feedback", label: "Feedback", defaultValue: 0.38, format: "delay_feedback" }, { key: "tone", label: "Tone", defaultValue: 0.58 },
    { key: "character", label: "Early digital", defaultValue: 0.72 }, { key: "stereo", label: "Stereo", defaultValue: 0.35 },
  ] },
  { type: "reverb", name: "True Reverb", parameter: "mix", defaultValue: 0.25, parameters: [
    { key: "mix", label: "Mix", defaultValue: 0.25 }, { key: "mode", label: "Reverb type", defaultValue: 1, format: "reverb_mode", step: 1 / 3 },
    { key: "size", label: "Size", defaultValue: 0.58 },
    { key: "decay", label: "Decay", defaultValue: 0.52, format: "reverb_decay" }, { key: "damping", label: "Damping", defaultValue: 0.55 },
    { key: "pre_delay", label: "Pre-delay", defaultValue: 0.18, format: "predelay_ms" }, { key: "modulation", label: "Modulation", defaultValue: 0.22 },
  ] },
  { type: "shimmer", name: "Chord Bloom", parameter: "mix", defaultValue: 0.3, parameters: [
    { key: "mix", label: "Mix", defaultValue: 0.3 },
    { key: "size", label: "Size", defaultValue: 0.68 },
    { key: "decay", label: "Decay", defaultValue: 0.68, format: "reverb_decay" }, { key: "damping", label: "Damping", defaultValue: 0.48 },
    { key: "pre_delay", label: "Pre-delay", defaultValue: 0.22, format: "predelay_ms" }, { key: "shimmer", label: "Bloom intensity", defaultValue: 0.5 },
    { key: "rise", label: "Bloom rise", defaultValue: 0.5, format: "bloom_rise" }, { key: "tone", label: "Bloom tone", defaultValue: 0.42, format: "bloom_tone" },
  ] },
  { type: "dry_wet", name: "Dry / Wet", parameter: "mix", defaultValue: 1, parameters: [{ key: "mix", label: "Mix", defaultValue: 1 }] },
  { type: "output_trim", name: "Output Trim", parameter: "output", defaultValue: 0.5, parameters: [{ key: "output", label: "Output", defaultValue: 0.5, format: "output_db" }] },
];

export const AMP_SIMULATOR_RACK_PRESET = [
  { type: "input_trim", parameters: { input: 0.5 } },
  { type: "noise_gate", parameters: { threshold: 0.4, release: 0.5 } },
  { type: "amp_overdrive", parameters: { drive: 0.6, tone: 0.55, level: 0.5 } },
  { type: "amp_model", parameters: { gain: 0.55, bass: 0.6, mid: 0.45, treble: 0.65, presence: 0.4, master: 0.75 } },
  { type: "cabinet_ir", parameters: { cabinet: 0.5, mic_position: 0.55, resonance: 0.5, level: 0.5 } },
  { type: "output_trim", parameters: { output: 0.75 } },
];

export const HIGH_GAIN_AMP_RACK_PRESET = [
  { type: "input_trim", parameters: { input: 0.56 } },
  { type: "noise_gate", parameters: { threshold: 0.62, release: 0.2 } },
  { type: "dual_high_gain", parameters: { mode: 0, gain: 0.82, tight: 0.72, bass: 0.58, mid: 0.36, treble: 0.64, presence: 0.62, depth: 0.68, sag: 0.2, master: 0.62 } },
  { type: "cabinet_ir", parameters: { cabinet: 0.88, mic_position: 0.62, resonance: 0.64, level: 0.53 } },
  { type: "output_trim", parameters: { output: 0.66 } },
];

export const SILK_BLOOM_RACK_PRESET = [
  { type: "input_trim", parameters: { input: 0.5 } },
  { type: "silk_bloom", parameters: { mode: 0.5, pickup: 0.5, gain: 0.46, touch: 0.72, bass: 0.48, mid: 0.58, treble: 0.54, presence: 0.38, sag: 0.42, master: 0.7 } },
  { type: "cabinet_ir", parameters: { cabinet: 0.18, mic_position: 0.46, mic_blend: 0.48, distance: 0.18, low_cut: 0.14, high_cut: 0.58, resonance: 0.42, level: 0.5 } },
  { type: "chorus", parameters: { mix: 0.1, rate: 0.31, depth: 0.3, delay: 0.46, feedback: 0.12, stereo: 0.72 } },
  { type: "digital_delay", parameters: { mix: 0.18, time: 0.5, feedback: 0.27, tone: 0.48, character: 0.35, stereo: 0.32 } },
  { type: "reverb", parameters: { mix: 0.16, size: 0.48, decay: 0.38, damping: 0.58, pre_delay: 0.16, modulation: 0.12 } },
  { type: "output_trim", parameters: { output: 0.7 } },
];

export const LEGEND_HARDWARE_MODULE_TYPES = ["legend_preamp", "legend_compressor", "legend_eq", "legend_tape"];

export const LEGEND_HARDWARE_RACK_PRESET = [
  { type: "legend_preamp", parameters: { model: 0, drive: 0.38, color: 0.52, high_pass: 0.18, output: 0.5 } },
  { type: "legend_compressor", parameters: { model: 0, amount: 0.42, attack: 0.38, release: 0.46, makeup: 0 } },
  { type: "legend_eq", parameters: { model: 0, low: 0.5, mid: 0.5, high: 0.5, air: 0.5 } },
  { type: "legend_tape", parameters: { model: 1 / 3, drive: 0.34, speed: 0.5, age: 0.16, wow_flutter: 0.12, output: 0.46 } },
];

export const formatDspParameterValue = (definition, rawValue) => {
  const value = clampUnit(rawValue, definition?.defaultValue ?? 0);
  const signedDb = (value - 0.5) * 24;
  if (Array.isArray(definition?.options) && definition.options.length) {
    return definition.options.reduce((closest, option) => (
      Math.abs(option.value - value) < Math.abs(closest.value - value) ? option : closest
    ), definition.options[0]).label;
  }
  switch (definition?.format) {
    case "legend_drive": return `${(value * 24).toFixed(1)} dB drive`;
    case "legend_high_pass": return value <= 0.001 ? "Off" : `${Math.round(20 + value * 180)} Hz`;
    case "input_db": return value === 0 ? "−∞ dB" : `${value * 24 - 12 >= 0 ? "+" : ""}${(value * 24 - 12).toFixed(1)} dB`;
    case "output_db": return value === 0 ? "−∞ dB" : `${value * 16 - 12 >= 0 ? "+" : ""}${(value * 16 - 12).toFixed(1)} dB`;
    case "bipolar_db": return `${signedDb >= 0 ? "+" : ""}${signedDb.toFixed(1)} dB`;
    case "threshold_db": return `${(-48 + value * 48).toFixed(1)} dB`;
    case "ratio": return `${(1 + value * 19).toFixed(1)}:1`;
    case "attack_ms": return `${(0.1 * (1000 ** value)).toFixed(value < 0.34 ? 1 : 0)} ms`;
    case "release_ms": return `${Math.round(20 * (50 ** value))} ms`;
    case "makeup_db": return `+${(value * 24).toFixed(1)} dB`;
    case "deesser_frequency": return `${(3 * (4 ** value)).toFixed(value < 0.65 ? 1 : 0)} kHz`;
    case "prism_frequency": {
      const frequency = 10 * (3000 ** value);
      return frequency >= 1000 ? `${(frequency / 1000).toFixed(frequency >= 10000 ? 1 : 2)} kHz` : `${Math.round(frequency)} Hz`;
    }
    case "prism_q": return (0.025 * (1600 ** value)).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    case "deesser_range": return `${(value * 18).toFixed(1)} dB`;
    case "deesser_attack_ms": return `${(0.1 * (200 ** value)).toFixed(value < 0.45 ? 1 : 0)} ms`;
    case "deesser_release_ms": return `${Math.round(20 * (15 ** value))} ms`;
    case "eq_mode": return value < 0.25 ? "Stereo" : value < 0.75 ? "Mid" : "Side";
    case "eq_low_cut_frequency": return `${Math.round(20 * (50 ** value))} Hz`;
    case "eq_low_frequency": return `${Math.round(40 * (20 ** value))} Hz`;
    case "eq_mid_frequency": return `${Math.round(200 * (40 ** value))} Hz`;
    case "eq_high_frequency": return `${(2 * (9 ** value)).toFixed(1)} kHz`;
    case "eq_high_cut_frequency": return `${(4 * (5 ** value)).toFixed(1)} kHz`;
    case "eq_cut_q": return `${(0.5 + value * 1.5).toFixed(2)} Q`;
    case "eq_bell_q": return `${(0.3 + value * 7.7).toFixed(2)} Q`;
    case "mb_low_crossover": return `${Math.round(80 * (7.5 ** value))} Hz`;
    case "mb_high_crossover": return `${(1.2 * (6.6666667 ** value)).toFixed(1)} kHz`;
    case "mb_makeup_db": return `+${(value * 18).toFixed(1)} dB`;
    case "width": return `${Math.round(value * 200)}%`;
    case "mono_bass": return value === 0 ? "Off" : `${Math.round(40 * (10 ** value))} Hz`;
    case "delay_ms": return `${Math.round(20 * (50 ** value))} ms`;
    case "feedback": return `${Math.round(5 + value * 80)}%`;
    case "mod_rate": return `${(0.05 * (100 ** value)).toFixed(value < 0.65 ? 2 : 1)} Hz`;
    case "tremolo_rate": return `${(0.2 * (60 ** value)).toFixed(value < 0.5 ? 2 : 1)} Hz`;
    case "chorus_delay": return `${(8 + value * 20).toFixed(1)} ms`;
    case "flanger_delay": return `${(0.25 + value * 7.75).toFixed(2)} ms`;
    case "vibrato_depth": return `${(value * 6).toFixed(1)} ms`;
    case "mod_feedback": return `${Math.round(value * 55)}%`;
    case "bipolar_feedback": return `${Math.round((value - 0.5) * 150)}%`;
    case "digital_delay_ms": return `${Math.round(10 * (80 ** value))} ms`;
    case "delay_feedback": return `${Math.round(value * 92)}%`;
    case "reverb_decay": return `${(0.35 + value * 9.65).toFixed(1)} s`;
    case "reverb_mode": return ["Room", "Spring", "Plate", "Hall"][Math.min(3, Math.round(value * 3))];
    case "predelay_ms": return `${Math.round(value * 120)} ms`;
    case "bloom_rise": return `${Math.round(180 + value * 270)} ms`;
    case "bloom_tone": return `${(3.2 + value * 2.3).toFixed(1)} kHz`;
    case "lfo_shape": return value < 0.33 ? "Sine" : value < 0.67 ? "Triangle" : "Square";
    case "gate_threshold_db": return `${(-80 + value * 60).toFixed(1)} dB`;
    case "gate_release_ms": return `${Math.round(5 * (100 ** value))} ms`;
    case "amp_master_db": return `${-18 + value * 24 >= 0 ? "+" : ""}${(-18 + value * 24).toFixed(1)} dB`;
    case "amp_mode": return value >= 0.5 ? "Cascading" : "Rectified";
    case "silk_mode": return value < 1 / 3 ? "Crystal" : value < 2 / 3 ? "Edge" : "Singing";
    case "pickup_mode": return value < 1 / 3 ? "Single" : value < 2 / 3 ? "Neutral" : "Humbucker";
    case "mic_blend": return `${Math.round((1 - value) * 100)}% Dynamic · ${Math.round(value * 100)}% Ribbon`;
    case "mic_distance": return `${(1 + value * 19).toFixed(1)} cm`;
    case "cab_low_cut": return `${Math.round(45 * (3.1 ** value))} Hz`;
    case "cab_high_cut": return `${(4.2 * (2 ** (value * 1.25))).toFixed(1)} kHz`;
    case "osc_waveform": return ["Sine", "Triangle", "Saw", "Square", "Noise"][Math.min(4, Math.round(value * 4))];
    case "osc_octave": return `${Math.round(value * 4) - 2 >= 0 ? "+" : ""}${Math.round(value * 4) - 2} oct`;
    case "osc_semitone": return `${Math.round(value * 24) - 12 >= 0 ? "+" : ""}${Math.round(value * 24) - 12} st`;
    case "osc_fine": return `${Math.round(value * 200) - 100 >= 0 ? "+" : ""}${Math.round(value * 200) - 100} ct`;
    case "tuning_semitone": return `${Math.round(value * 48) - 24 >= 0 ? "+" : ""}${Math.round(value * 48) - 24} st`;
    case "tuning_cents": return `${Math.round(value * 200) - 100 >= 0 ? "+" : ""}${Math.round(value * 200) - 100} ct`;
    case "osc_pulse_width": return `${Math.round(5 + value * 90)}%`;
    case "synth_attack": return `${Math.round(5000 * (value ** 2.5))} ms`;
    case "synth_decay": return `${Math.round(10 + 4990 * (value ** 2.2))} ms`;
    case "synth_release": return `${Math.round(10 + 9990 * (value ** 2.2))} ms`;
    case "synth_cutoff": return `${Math.round(20 * (1000 ** value))} Hz`;
    case "synth_resonance": return `${(0.5 + value * 19.5).toFixed(1)} Q`;
    case "synth_bipolar": return `${Math.round((value - 0.5) * 96)} st`;
    case "percentage": return `${Math.round(value * 100)}%`;
    case "noise_color": return value < 1 / 3 ? "Brown" : value < 2 / 3 ? "Pink" : "White";
    case "unison_voices": return `${1 + Math.round(value * 7)} voices`;
    case "unison_detune": return `${Math.round(value * 50)} cent`;
    case "glide_time": return value <= 0 ? "Off" : `${Math.round(2000 * (value ** 2))} ms`;
    case "glide_mode": return value >= 0.5 ? "Legato" : "Always";
    case "voice_mode": return value >= 0.5 ? "Mono" : "Poly";
    case "velocity_curve": return value < 0.25 ? "Soft" : value < 0.75 ? "Linear" : "Hard";
    case "vibrato_rate": return `${(0.1 + value * 11.9).toFixed(1)} Hz`;
    case "vibrato_cents": return `${Math.round(value * 100)} cent`;
    case "vibrato_delay": return `${Math.round(value * 2000)} ms`;
    case "on_off": return value >= 0.5 ? "On" : "Off";
    default: return `${Math.round(value * 100)}%`;
  }
};

export const dspRackOption = (type) => DSP_RACK_MODULE_OPTIONS.find((option) => option.type === String(type || "").replaceAll("-", "_"));

export const isLegendHardwareModule = (moduleOrType) => {
  const type = typeof moduleOrType === "string" ? moduleOrType : moduleOrType?.type;
  return dspRackOption(type)?.family === "legend_hardware";
};

export const INTERNAL_DSP_MACRO_BINDINGS = {
  input: { type: "input_trim", parameter: "input" },
  drive: { type: "soft_clip", parameter: "drive" },
  compress: { type: "linked_compressor", parameter: "compress" },
  tone: { type: "tone_shaper", parameter: "tone" },
  width: { type: "stereo_width", parameter: "width" },
  space: { type: "cross_delay", parameter: "space" },
  mix: { type: "dry_wet", parameter: "mix" },
  output: { type: "output_trim", parameter: "output" },
};

export const internalDspMacroTarget = (modules, parameter) => {
  const binding = INTERNAL_DSP_MACRO_BINDINGS[parameter];
  if (!binding) return null;
  return normalizeDspRack(modules).find((module) => module.type === binding.type && !module.samplerGroupId) || null;
};

export const dspBindingValue = (module, parameter) => {
  if (!module) return null;
  if (parameter === "bypass") return module.bypassed ? 1 : 0;
  if (parameter === "module_mix") return clampUnit(module.mix, 1);
  const definition = dspRackOption(module.type)?.parameters?.find((item) => item.key === parameter);
  if (!definition) return null;
  return clampUnit(module.parameters?.[parameter], definition.defaultValue);
};

export const controlsShareDspBinding = (left, right) => (
  Boolean(left?.parameter)
  && left.parameter === right?.parameter
  && (left.moduleId || null) === (right?.moduleId || null)
);

export const syncControlsFromDspBinding = (controls, moduleId, parameter, value, modules = []) => {
  const controlValue = clampUnit(value) * 100;
  const module = normalizeDspRack(modules).find((item) => item.id === moduleId);
  const macroParameters = Object.entries(INTERNAL_DSP_MACRO_BINDINGS)
    .filter(([, binding]) => binding.type === module?.type && binding.parameter === parameter)
    .map(([macroParameter]) => macroParameter);
  const isFirstMacroTarget = macroParameters.some((macroParameter) => internalDspMacroTarget(modules, macroParameter)?.id === moduleId);
  return (Array.isArray(controls) ? controls : []).map((control) => (
    (control.moduleId === moduleId && control.parameter === parameter)
      || (!control.moduleId && isFirstMacroTarget && macroParameters.includes(control.parameter))
      ? { ...control, value: controlValue }
      : control
  ));
};

export const syncDspRackFromControl = (modules, control) => {
  if (!control?.parameter) return normalizeDspRack(modules);
  const value = clampUnit(Number(control.value) / 100);
  const normalizedModules = normalizeDspRack(modules);
  const macroTarget = !control.moduleId ? internalDspMacroTarget(normalizedModules, control.parameter) : null;
  return normalizedModules.map((module) => {
    if (module.id !== (control.moduleId || macroTarget?.id)) return module;
    const parameter = control.moduleId
      ? control.parameter
      : INTERNAL_DSP_MACRO_BINDINGS[control.parameter]?.parameter;
    if (parameter === "bypass") return { ...module, bypassed: value >= 0.5 };
    if (parameter === "module_mix") return { ...module, mix: value };
    const supportsParameter = dspRackOption(module.type)?.parameters?.some((item) => item.key === parameter);
    if (!supportsParameter) return module;
    return { ...module, parameters: { ...module.parameters, [parameter]: value } };
  });
};

export const normalizeDspRack = (modules = []) => (Array.isArray(modules) ? modules : [])
  .map((rawModule, index) => {
    const type = String(rawModule?.type || "").replaceAll("-", "_");
    const option = dspRackOption(type) || (type === "prism_eq"
      ? { type, name: "Prism EQ", parameter: "normalized", defaultValue: 0.5 }
      : null);
    if (!option) return null;
    const storedParameters = rawModule?.parameters && typeof rawModule.parameters === "object"
      ? migrateLegendGainStaging(type, rawModule.parameters)
      : {};
    // Voice controls were introduced after the Wave Generator shipped. Migrate
    // older browser projects to the same defaults displayed by the editor so
    // "Mono" never looks selected while the preview is actually polyphonic.
    const compatibleParameters = Object.fromEntries(Object.entries(storedParameters).filter(([key]) => (
      !(type === "wave_generator" && key === "note_priority") && !(type === "shimmer" && key === "mode")
    )));
    const rawParameters = type === "wave_generator"
      ? { voice_mode: 1, retrigger: 1, ...compatibleParameters }
      : compatibleParameters;
    const storedName = String(rawModule?.name || option.name);
    return {
      id: String(rawModule?.id || `module-${index + 1}`),
      type,
      name: ((type === "reverb" && storedName === "Algorithmic Reverb") || (type === "shimmer" && storedName === "Shimmer Reverb") ? option.name : storedName).slice(0, 80),
      parentId: rawModule?.parentId || rawModule?.parent_id || null,
      samplerGroupId: rawModule?.samplerGroupId || rawModule?.sampler_group_id || null,
      order: index,
      bypassed: rawModule?.bypassed === true,
      mix: clampUnit(rawModule?.mix, 1),
      parameters: {
        ...rawParameters,
        ...Object.fromEntries((option.parameters || [{ key: option.parameter, defaultValue: option.defaultValue }])
          .filter(({ key }) => Object.hasOwn(rawParameters, key))
          .map(({ key, defaultValue }) => [key, clampUnit(rawParameters[key], defaultValue)])),
      },
    };
  })
  .filter(Boolean);

export const createDspRackModule = (type, id) => {
  const option = dspRackOption(type);
  if (!option) return null;
  return {
    id,
    type: option.type,
    name: option.name,
    parentId: null,
    order: 0,
    bypassed: false,
    mix: 1,
    parameters: ["wave_generator", "prism_eq"].includes(option.type) || option.family === "legend_hardware"
      ? Object.fromEntries(option.parameters.map(({ key, defaultValue }) => [key, defaultValue]))
      : { [option.parameter]: option.defaultValue },
  };
};

export const appendDspRackModule = (modules, type, id) => {
  const module = createDspRackModule(type, id);
  return module ? normalizeDspRack([...normalizeDspRack(modules), module]) : normalizeDspRack(modules);
};

export const createAmpSimulatorRack = (createId) => normalizeDspRack(
  AMP_SIMULATOR_RACK_PRESET.map((preset, index) => {
    const option = dspRackOption(preset.type);
    return {
      id: typeof createId === "function" ? createId(preset.type, index) : `amp-${index + 1}`,
      type: preset.type,
      name: option?.name || preset.type,
      parentId: null,
      order: index,
      bypassed: false,
      mix: 1,
      parameters: { ...preset.parameters },
    };
  }),
);

export const createLegendHardwareRack = (createId) => normalizeDspRack(
  LEGEND_HARDWARE_RACK_PRESET.map((preset, index) => ({
    id: typeof createId === "function" ? createId(preset.type, index) : `legend-${index + 1}`,
    type: preset.type,
    name: dspRackOption(preset.type)?.name || preset.type,
    parentId: null,
    order: index,
    bypassed: false,
    mix: 1,
    parameters: { ...preset.parameters },
  })),
);

export const createAmpSimulatorTemplateState = (createId) => {
  const nextId = typeof createId === "function"
    ? createId
    : (_, index) => `amp-template-${index + 1}`;
  let controlIndex = AMP_SIMULATOR_RACK_PRESET.length;
  const engineModules = createAmpSimulatorRack((type, index) => nextId(type, index));
  const moduleByType = Object.fromEntries(engineModules.map((module) => [module.type, module]));
  const knob = (label, moduleType, parameter, x, y) => {
    const module = moduleByType[moduleType];
    return {
      id: nextId("control", controlIndex++), kind: "knob", label, parameter, moduleId: module.id, x, y,
      value: Math.round((module.parameters[parameter] ?? 0.5) * 100), notePitch: 60,
      width: 60, height: 64, component_style: "css", component_variant: "black-dome", showBackground: false,
    };
  };
  const firstRow = [
    ["Input", "input_trim", "input"],
    ["Gate", "noise_gate", "threshold"],
    ["Release", "noise_gate", "release"],
    ["OD Drive", "amp_overdrive", "drive"],
    ["OD Tone", "amp_overdrive", "tone"],
    ["OD Level", "amp_overdrive", "level"],
    ["Amp Gain", "amp_model", "gain"],
    ["Master", "amp_model", "master"],
    ["Output", "output_trim", "output"],
  ];
  const secondRow = [
    ["Bass", "amp_model", "bass"],
    ["Mid", "amp_model", "mid"],
    ["Treble", "amp_model", "treble"],
    ["Presence", "amp_model", "presence"],
    ["Cabinet", "cabinet_ir", "cabinet"],
    ["Mic", "cabinet_ir", "mic_position"],
    ["Resonance", "cabinet_ir", "resonance"],
    ["Cab Level", "cabinet_ir", "level"],
  ];
  const firstRowX = [7, 18, 29, 40, 51, 62, 73, 84, 95];
  const secondRowX = [18, 29, 40, 51, 62, 73, 84, 95];
  return {
    engineModules,
    interfaceControls: [
      ...firstRow.map((definition, index) => knob(...definition, firstRowX[index], 16)),
      {
        id: nextId("control", controlIndex++), kind: "button", label: "Bypass", off_label: "OFF", on_label: "ON",
        parameter: "bypass", moduleId: null, x: 7, y: 27, value: 0, notePitch: 60,
        width: 58, height: 62, component_style: "css", component_variant: "square-led-label", showBackground: false,
      },
      ...secondRow.map((definition, index) => knob(...definition, secondRowX[index], 27)),
    ],
  };
};

export const createHighGainAmpTemplateState = (createId) => {
  const nextId = typeof createId === "function" ? createId : (_, index) => `high-gain-template-${index + 1}`;
  const engineModules = normalizeDspRack(HIGH_GAIN_AMP_RACK_PRESET.map((preset, index) => ({
    id: nextId(preset.type, index), type: preset.type,
    name: preset.type === "dual_high_gain" ? "Obsidian Dual High-Gain" : preset.type === "cabinet_ir" ? "Modern 4×12 Cabinet" : dspRackOption(preset.type)?.name,
    parentId: null, order: index, bypassed: false, mix: 1, parameters: { ...preset.parameters },
  })));
  const moduleByType = Object.fromEntries(engineModules.map((module) => [module.type, module]));
  let controlIndex = engineModules.length;
  const control = (kind, label, moduleType, parameter, x, y, extra = {}) => {
    const module = moduleByType[moduleType];
    return {
      id: nextId("control", controlIndex++), kind, label, parameter, moduleId: module?.id || null, x, y,
      value: Math.round((module?.parameters?.[parameter] ?? 0) * 100), notePitch: 60,
      width: kind === "button" ? 58 : 54, height: kind === "button" ? 62 : 60,
      component_style: "css", component_variant: kind === "button" ? "square-led-label" : "luminous", showBackground: false,
      ...extra,
    };
  };
  const firstRow = [
    ["Input", "input_trim", "input"], ["Tight Gate", "noise_gate", "threshold"], ["Gate Rel", "noise_gate", "release"],
    ["Voicing", "dual_high_gain", "mode", "button"], ["High Gain", "dual_high_gain", "gain"], ["Tight", "dual_high_gain", "tight"],
    ["Low", "dual_high_gain", "bass"], ["Mid", "dual_high_gain", "mid"], ["High", "dual_high_gain", "treble"], ["Master", "dual_high_gain", "master"],
  ];
  const secondRow = [
    ["Presence", "dual_high_gain", "presence"], ["Depth", "dual_high_gain", "depth"], ["Sag", "dual_high_gain", "sag"],
    ["Cab Type", "cabinet_ir", "cabinet"], ["Mic Edge", "cabinet_ir", "mic_position"], ["Thump", "cabinet_ir", "resonance"],
    ["Cab Level", "cabinet_ir", "level"], ["Output", "output_trim", "output"],
  ];
  const interfaceControls = [
    ...firstRow.map(([label, type, parameter, kind = "knob"], index) => control(kind, label, type, parameter, 5 + index * 10, 16,
      kind === "button" ? { off_label: "RECT", on_label: "CASC" } : {})),
    {
      id: nextId("control", controlIndex++), kind: "button", label: "Bypass", off_label: "OFF", on_label: "ON",
      parameter: "bypass", moduleId: null, x: 5, y: 27, value: 0, notePitch: 60, width: 58, height: 62,
      component_style: "css", component_variant: "square-led-label", showBackground: false,
    },
    ...secondRow.map(([label, type, parameter], index) => control("knob", label, type, parameter, 18 + index * 11, 27)),
  ];
  return { engineModules, interfaceControls };
};

export const isLegacyHighGainAmpRack = (modules = []) => normalizeDspRack(modules)
  .map((module) => module.type)
  .join("|") === "input_trim|noise_gate|amp_overdrive|amp_model|cabinet_ir|output_trim";

export const moveDspRackModule = (modules, moduleId, direction) => {
  const normalized = normalizeDspRack(modules);
  const sourceIndex = normalized.findIndex((module) => module.id === moduleId);
  const targetIndex = sourceIndex + Number(direction);
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= normalized.length) return normalized;
  [normalized[sourceIndex], normalized[targetIndex]] = [normalized[targetIndex], normalized[sourceIndex]];
  return normalizeDspRack(normalized);
};

export const removeDspRackModule = (modules, controls, moduleId) => ({
  modules: normalizeDspRack(modules).filter((module) => module.id !== moduleId).map((module, order) => ({ ...module, order })),
  controls: (Array.isArray(controls) ? controls : []).map((control) => (
    control.moduleId === moduleId ? { ...control, moduleId: null } : control
  )),
});

export const serializeDspRack = (modules = []) => normalizeDspRack(modules).map((module) => ({
  id: module.id,
  type: module.type,
  name: module.name,
  parent_id: module.parentId || null,
  sampler_group_id: module.samplerGroupId || null,
  order: module.order,
  bypassed: module.bypassed,
  mix: module.mix,
  parameters: module.parameters,
}));
