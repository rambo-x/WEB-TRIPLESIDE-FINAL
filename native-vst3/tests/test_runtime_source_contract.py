from pathlib import Path


SOURCE_DIR = Path(__file__).parents[1] / "Source"


def test_hidden_master_mute_and_solo_cannot_be_restored():
    source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert 'mute=hasControlParameter("mute")&&v>=.5f' in source
    assert 'solo=hasControlParameter("solo")&&v>=.5f' in source
    assert 'v[5]=mute?1.f:0.f;v[6]=solo?1.f:0.f' in source


def test_native_view_uses_real_midi_activity_and_boolean_pad_state():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "drawPad(const D2D1_RECT_F&,bool," in header
    assert "instrument.isNoteActive(c.notePitch)" in source
    assert "instrument.isNoteActive(n)" in source
    assert 'equals(currentControlVariant,"hit-effect")' in source
    assert 'equals(currentControlVariant,"diffuse-hit")' in source
    assert 'equals(currentControlVariant,"smooth-diffuse-hit")' in source
    assert "if(hitPad&&!active)return" in source
    assert "CreateRadialGradientBrush" in source
    assert "const auto index=static_cast<size_t>(pitch);" in source
    assert "const auto generation=instrument.noteTriggerCount(pitch);" in source
    assert "const auto now=GetTickCount64();" in source
    assert "index=static_cast<size_t>(pitch),generation=" not in source
    assert "c.opacity<.999f" in source
    assert 'equals(c.kind,"text")' in source


def test_native_view_rotates_procedural_controls_and_hit_testing():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac_source = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    assert "controlPoint(size_t,float,float) const" in header
    assert "D2D1::Matrix3x2F::Rotation(c.rotation,center)" in source
    assert "project::kControls[i].rotation" in source
    assert "controlLocalPoint" in mac_source
    assert "rotateByDegrees:control.rotation" in mac_source


def test_windows_groove_transport_loops_smoothly_and_survives_panel_close():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    instrument_header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    instrument_source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "SetTimer(hwnd,2,10,nullptr)" not in source
    assert "processGrooveSample()" in instrument_header
    assert "processGrooveSample();renderFrame" in instrument_source
    assert "grooveCommand.exchange" in instrument_source
    assert "grooveTick+=" in instrument_source
    assert "playingMidiSequence" in header
    assert "midiSequenceLoopEnabled" in header
    assert "toggleMidiSequenceLoop" in source
    assert "project::kMidiSequences[static_cast<size_t>(index)].loopEnabled" in source
    assert "instrument.setGrooveLoop" in source
    assert "drawGroovePanel(r)" in source
    assert "groovePanelMouseDown(r,x,y)" in source
    assert "GROOVE LIBRARY" in source
    assert "grooveScrollOffset" in header
    assert "IDC_HAND" in source
    assert "thumbHeight" in source
    assert "GetOpenFileNameW" not in source
    assert "DragAcceptFiles" not in source
    assert "hiddenMidiSequences.insert(source)" not in source
    assert "playingMidiSequence==source" in source
    close_panel = source.split("void NativeView::closePanel()", 1)[1].split("}", 1)[0]
    assert "stopMidiSequence" not in close_panel


def test_generated_pattern_buttons_arm_transposed_live_trigger():
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    instrument_header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    instrument_source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "setLivePatternSequence" in instrument_header
    assert "routeLivePatternNote" in instrument_source
    assert "pitch-pattern.triggerRootPitch" in instrument_source
    assert "event.note+audioGrooveTranspose" in instrument_source
    assert "audioGrooveLiveTrigger&&sequence.liveHold" in instrument_source
    assert "instrument.livePatternSequenceIndex()==c.midiSequenceIndex" in source
    assert "instrument.setLivePatternSequence(instrument.livePatternSequenceIndex()==c.midiSequenceIndex?-1:c.midiSequenceIndex)" in source
    visual_control = source.split("void NativeView::drawVisualControl(size_t index)", 1)[1].split("void NativeView::drawVisualCanvas()", 1)[0]
    assert "if(c.midiSequenceIndex>=0)value=instrument.livePatternSequenceIndex()==c.midiSequenceIndex?1.f:0.f;" in visual_control
    assert 'else if(c.midiSequenceIndex<0&&equals(c.kind,"pad"))' in visual_control


def test_embedded_resource_loader_supports_rc_quoted_names():
    source = (SOURCE_DIR / "EmbeddedResource.cpp").read_text(encoding="utf-8")

    assert "quotedName[0] = L'\"'" in source
    assert "quotedName[length + 1] = L'\"'" in source
    assert "FindResourceW(module, quotedName.data()" in source


def test_native_runtime_maps_sustain_and_matches_preview_keyboard_origin():
    instrument_header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    instrument_source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")
    view_source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "public Steinberg::Vst::IMidiMapping" in instrument_header
    assert "controller==kCtrlSustainOnOff" in instrument_source
    assert "if(!sustain)v.releasing=true" in instrument_source
    assert "project::kDefaultSustain||on" in instrument_source
    assert "sustain=project::kDefaultSustain" in instrument_source
    assert "new StringListParameter" in instrument_source
    assert 'appendString(STR16("Off"))' in instrument_source
    assert 'appendString(STR16("On"))' in instrument_source
    assert "defaultNormalizedValue=sustainDefault" in instrument_source
    assert "if(voice.active&&!voice.held)voice.releasing=true" in instrument_source
    assert "return std::clamp(36,0,127-count+1)" in view_source
    assert 'L"C%d",n/12-1' in view_source
    assert "drawKeyboard(keyboardContentRect(r),c.keyCount,i)" in view_source
    assert "project::kKeyColors" in view_source
    assert "rgb(keyColor(n,0xf4f4f5))" in view_source
    assert "rgb(keyColor(n,0x09090b))" in view_source
    assert "cy=(r.top+r.bottom)/2+16" in view_source


def test_native_keyboard_atlas_uses_idle_and_next_pressed_frame_on_both_platforms():
    windows_source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac_source = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")
    capture_source = (SOURCE_DIR.parent / "tools" / "render_visual_assets.py").read_text(encoding="utf-8")

    assert "for active in (False, True):" in capture_source
    assert "frame=key_index*2" in capture_source
    assert "source_width=key_images[-1].width" in capture_source
    assert "key.sourceWidth" in windows_source
    assert "key.frame+(active?1:0)" in windows_source
    assert "const NSInteger frame = key.frame + (active ? 1 : 0);" in mac_source
    assert "key.sourceWidth" in mac_source
    assert "const NSInteger row = frame / columns;" in mac_source
    assert "const NSInteger column = frame % columns;" in mac_source


def test_instrument_bypass_buttons_register_toggle_and_bypass_only_the_dsp_chain():
    instrument_source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")
    mac_source = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    assert 'if(hasControlParameter("bypass"))parameters.addParameter' in instrument_source
    assert "const float dryL=sl,dryR=sr" in instrument_source
    assert "sl+=(dryL-sl)*bypassMix" in instrument_source
    assert "version>6" in instrument_source
    assert "b.writeInt32u(6)" in instrument_source
    assert "project::kVisualKeys.rbegin()" in mac_source


def test_native_runtime_maps_pitch_bend_and_modulation_with_expression_dsp():
    instrument_header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    instrument_source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")
    view_source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "kPitchBendId=117" in instrument_header
    assert "kModulationId=118" in instrument_header
    assert "controller==kPitchBend" in instrument_source
    assert "controller==kCtrlModWheel" in instrument_source
    assert "project::kPitchBendEnabled" in instrument_source
    assert "project::kModulationEnabled" in instrument_source
    assert "(smoothedPitchBend-.5f)*4.f" in instrument_source
    assert "smoothedPitchBend+=bendAlpha*(pitchBend-smoothedPitchBend)" in instrument_source
    assert "-1./(.003*hostSampleRate)" in instrument_source
    assert "std::sin(modulationPhase)*modulation*.5f" in instrument_source
    assert "v.position+=v.increment*expressionRate" in instrument_source
    assert 'equals(project::kControls[activeControl].parameter,"pitch_bend")' in view_source
    assert "setParameter(kPitchBendId,.5f)" in view_source
    assert 'equals(currentControlVariant,"pitch-bend-led")' in view_source
    assert 'equals(currentControlVariant,"modulation-led")' in view_source
    assert "currentControlColor" in view_source
    assert "const auto track=D2D1::RoundedRect" in view_source
    assert "const int count=18" not in view_source


def test_native_runtime_applies_and_persists_master_pan():
    instrument_header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    instrument_source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "kPanId=119" in instrument_header
    assert "applyMasterPan(float&, float&)" in instrument_header
    assert "masterPan.next()*2.f-1.f" in instrument_source
    assert "applyMasterPan(sl,sr)" in instrument_source
    assert "version>6" in instrument_source
    assert "writeInt32u(6)" in instrument_source
    assert "b.writeFloat(pan)" in instrument_source


def test_native_gain_reduction_meter_reads_compressor_dsp():
    instrument_header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    view_source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    dsp_header = (SOURCE_DIR / "DspModules.h").read_text(encoding="utf-8")
    dsp_source = (SOURCE_DIR / "DspModules.cpp").read_text(encoding="utf-8")

    assert "float gainReduction(int moduleIndex = -1)" in instrument_header
    assert 'equals(c.parameter,"gain_reduction")' in view_source
    assert "effectiveGainReduction" in dsp_header
    assert "float EffectRack::gainReduction" in dsp_source


def test_shared_preview_meters_keep_browser_visuals_and_independent_stereo_levels():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "drawVisualSpriteRegion" in header
    assert 'if(equals(c.kind,"spectrum"))drawControl(i);else drawVisualControl(i)' in source
    assert 'equals(c.meterMode,"stereo")&&s.mlw>0' in source
    assert "instrument.outputPeak(0)*scale" in source
    assert "instrument.outputPeak(1)*scale" in source
    assert "elapsed/16.6667f" in source


def test_preview_brand_uses_the_native_behind_controls_layering():
    css = (Path(__file__).parents[2] / "frontend/src/pages/VstMakerPreview.css").read_text(encoding="utf-8")
    brand_rule = css.rsplit(".maker-plugin-canvas__brand-object {", 1)[1].split("}", 1)[0]

    assert "z-index: 1;" in brand_rule


def test_native_runtime_renders_polyphonic_wave_generator():
    header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "struct OscVoice" in header
    assert "std::array<OscVoice, project::kPolyphony> oscillatorVoices" in header
    assert "configureWaveGenerator()" in source
    assert 'std::strcmp(module.type,"wave_generator")' in source
    assert "shape==3" in source
    assert "wavePulseWidth" in source
    assert "polyBlep" in source
    assert "waveGlide" in source
    assert "glideSamplesRemaining" in header
    assert "setWavePitchTarget" in source
    assert "seconds*hostSampleRate" in source
    assert "(v.targetPitch-v.currentPitch)/static_cast<double>(v.glideSamplesRemaining)" in source
    assert "std::exp(-1/(glideSeconds*hostSampleRate))" not in source
    assert "waveVibratoDepth" in source
    assert "waveFilterCutoff" in source
    assert "waveUnisonVoices" in source
    assert 'std::strcmp(parameter,"osc2_enabled")' in source
    assert 'p("osc2_enabled",waveOsc2Level>0?1.f:0.f)' in source
    assert "waveOsc2Enabled=false" in header
    assert 'p("voice_mode",0)' in source
    assert "waveRetrigger" in source
    assert "waveVelocityGain(velocity,waveVelocitySensitivity,waveVelocityCurve,waveVelocityMinLevel)" in source
    assert "waveNotePriority" not in source


def test_native_runtime_applies_global_tuning_to_sampler_and_wave_generator():
    header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "configureGlobalTuning()" in header
    assert 'std::strcmp(module.type,"tuning")' in source
    assert 'projectModuleParameter(tuningModule,"tuning",.5f)' in source
    assert 'projectModuleParameter(tuningModule,"fine_tune",.5f)' in source
    assert "expressionSemitones=bendSemitones+vibratoSemitones+globalTuning" in source
    assert 'std::strcmp(parameter,"fine_tune")' in source


def test_native_css_controls_and_branding_follow_preview_tokens():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert 'family=L"Georgia"' in source
    assert "upper(wide(TS_PRODUCT_NAME))" in source
    assert "SetCharacterSpacing" in source
    assert "brandMetaFormat" in header
    assert "brandTagFormat" in header
    assert "IDWriteInMemoryFontFileLoader" in header
    assert "CreateInMemoryFontFileReference" in source
    assert "static_cast<DWRITE_FONT_WEIGHT>(650)" in source
    assert "target->SetTransform(designTransform())" in source
    assert "designPoint(x,y)" in source
    assert "GetClientRect(hwnd,&client)" in source
    assert "D2D1::RectF(0,0" in source
    assert "rgb(0x414149)" in source
    assert "rgb(0x24242a)" in source
    assert "rgb(0x101013)" in source
    assert 'L"−20   −10   −3   0   +3"' in source
    assert "rgb(0xf5be5a,.28f)" in source
    assert 'DrawTextW(L"VU",2' in source


def test_native_knobs_and_faders_support_preview_neutral_reset_and_mouse_wheel():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac_source = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    assert "wc.style=CS_DBLCLKS" in source
    assert "case WM_LBUTTONDBLCLK" in source
    assert "case WM_MOUSEWHEEL" in source
    assert "mouseDoubleClick(float,float)" in header
    assert "mouseWheel(float,float,int)" in header
    assert "neutralControlValue(int) const" in header
    assert 'equals(parameter,"volume")||equals(parameter,"mix")' in source
    assert 'equals(parameter,"output")' in source
    assert 'equals(parameter,"attack")||equals(parameter,"release")' in source
    assert 'equals(c.kind,"knob")||equals(c.kind,"fader")' in source
    assert 'equals(control.kind, "knob") || equals(control.kind, "fader")' in mac_source
    assert "neutralControlValue(control)" in mac_source
    assert "value:1.f" in mac_source
    assert "value:.5f" in mac_source
    assert "current+steps*.01f" in source


def test_windows_double_click_retriggers_pad_and_keyboard_note_down():
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "case WM_LBUTTONDBLCLK:ReleaseCapture();mouseUp();mouseDoubleClick" in source
    assert "if(equals(c.kind,\"knob\")||equals(c.kind,\"fader\")){" in source
    assert "SetCapture(hwnd);mouseDown(x,y);" in source


def test_native_component_labels_apply_saved_position_presets():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert 'currentLabelPosition="top-left"' in header
    assert "currentLabelGap=12" in header
    assert "currentLabelPosition=c.labelPosition" in source
    assert "currentLabelGap=c.labelGap" in source
    assert "D2D1_RECT_F NativeView::labelRect" in source
    assert 'startsWith(currentLabelPosition,"bottom-")' in source
    assert 'containsIgnoreCase(currentLabelPosition,"right")' in source
    assert 'std::clamp(width*.06f,4.f,8.f)' in source
    assert 'DWRITE_TEXT_ALIGNMENT_TRAILING' in source
    assert 'currentLabelControlRect.left+inset' in source
    assert 'currentLabelControlRect.right-inset' in source
    assert 'column=width/3.f' not in source
    assert "currentLabelControlRect.bottom-height-verticalShift" in source
    assert "frameBottom=r.bottom" in source
    assert "labelRect(D2D1::RectF(r.left,r.top" in source
    assert "labelRect(D2D1::RectF(r.left,r.top,r.right,r.top+20))" in source


def test_native_panel_runtime_uses_separate_panel_manifest_contract():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac_source = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    assert "hitPanelChild(float,float) const" in header
    assert "project::kPanelControls[i].parentPanelIndex==openPanelIndex" in source
    assert "project::kPanelControls[static_cast<size_t>(openPanelIndex)].panelType" in source
    assert "activeControl=hitPanelChild(x,y)" in source
    assert "project::kControls[i].parentPanelIndex" not in source
    assert "project::kControls[static_cast<size_t>(openPanelIndex)].panelType" not in source
    assert "panelRuntimeBounds[openPanelIndex]" in source
    assert "hitPanelChild(x,y)" in source
    assert "drawVisualControl(i);else drawControl(i)" in source
    assert "panelChildRect" in mac_source
    assert "panelControlAt" in mac_source
    assert "drawPanelControl" in mac_source


def test_visual_capture_rasterizes_panel_children_from_the_shared_preview():
    renderer = (SOURCE_DIR.parent.parent / "frontend" / "src" / "pages" / "VstVisualRender.jsx").read_text(encoding="utf-8")
    workspace = (SOURCE_DIR.parent.parent / "frontend" / "src" / "pages" / "VstMakerPreview.jsx").read_text(encoding="utf-8")
    capture = (SOURCE_DIR.parent / "tools" / "render_visual_assets.py").read_text(encoding="utf-8")

    assert "visualOpenPanelId={frame.panelId ?? null}" in renderer
    assert "if (visualOpenPanelId !== undefined)" in workspace
    assert "panelId=parent_panel_id or None" in capture
    assert "visual_panel_reference_" in capture
    assert "visual_panel_backdrop_" in capture
    assert ".maker-canvas-control.is-panel-child" in capture
    assert "Using native panel visual" not in capture
    assert "visual_panel_child.png" not in capture

    assert "midiSequenceId: c.midi_sequence_id" in renderer
    assert "generatorConfig: sequence.generator_config" in renderer
    assert "livePatternConfig={livePatternConfig}" in renderer

    verifier = (SOURCE_DIR.parent / "tools" / "verify_visual_assets.py").read_text(encoding="utf-8")
    assert "if control.get('parent_panel_id')" in verifier
    assert "def verify_panels(spec_path)" in verifier
    assert "Panel {panel_index} visual composition differs" in verifier


def test_native_user_presets_are_persistent_overwritable_and_deletable():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "loadUserPresets()" in source
    assert "persistUserPresets()" in source
    assert 'L"TripleSide Studio"/L"VST3 Presets"' in source
    assert "MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH" in source
    assert 'L"\\u25A3  Simpan kondisi"' in source
    assert "presetNameInput" in header
    assert "deleteUserPreset(userRow)" in source
    assert "void overwriteUserPreset(int)" in header
    assert "void deleteUserPreset(int)" in header
    assert "presetScrollOffset" in header
    assert "selectedPresetRow" in header
    assert "hoveredPresetRow" in header
    assert "thumbHeight" in source
    assert "absolute==selectedPresetRow" in source
    assert "absolute==hoveredPresetRow" in source
    assert 'L"OVR"' not in source


def test_windows_mixer_matches_preview_channel_cards():
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac_source = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")
    cmake = (SOURCE_DIR.parent / "CMakeLists.txt").read_text(encoding="utf-8")

    assert 'x+=122' in source
    assert 'L"VOL"' in source
    assert 'L"PAN"' in source
    assert 'slider(top+35,top+53,L"VOL",volume)' in source
    assert 'slider(top+80,top+98,L"PAN",pan)' in source
    assert 'top+126,bx+42.5f,top+148' in source
    assert 'std::min(top+159.f,r.bottom-16)' in source
    assert "panelNameFormat" in source
    assert "DWRITE_WORD_WRAPPING_NO_WRAP" in source
    assert "CreateEllipsisTrimmingSign" in source
    assert "D2D1_DRAW_TEXT_OPTIONS_CLIP" in source
    assert "panelLabelFormat" in source
    assert "panelButtonFormat" in source
    assert 'CreateTextFormat(L"Manrope",brandCollection' in source
    assert "target->FillEllipse" in source
    assert 'equals(panel.panelType,"mixer")' in source
    assert 'groupParameterId(group,slot)' in source
    assert 'L"SAMPLER MIXER"' not in source
    assert 'std::min<CGFloat>(159, NSMaxY(panelRect) - top - 16)' in mac_source
    assert 'NSMakeRect(x + 11, top + 35, 90, 11)' in mac_source
    assert 'NSMakeRect(x + 11, top + 80, 90, 11)' in mac_source
    assert 'top + 126, 42.5, 22' in mac_source
    assert 'CTFontManagerRegisterFontsForURL' in mac_source
    assert '"-framework CoreText"' in cmake
    assert 'Assets/fonts/Manrope-wght.ttf' in cmake


def test_windows_wheel_supports_knobs_faders_mixer_and_preset_scroll():
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert '!equals(c.kind,"knob")&&!equals(c.kind,"fader")' in source
    assert 'equals(panel.panelType,"preset_browser")' in source
    assert 'presetScrollOffset=std::clamp' in source
    assert 'setParameter(id,static_cast<float>(instrument.getParamNormalized(id))+(delta>0?.02f:-.02f))' in source


def test_native_panel_midi_player_honors_tempo_events():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    instrument = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "struct RuntimeMidiTempo" in header
    assert "sequence.tempos.push_back" in source
    assert "60000000.0/micros" in source
    assert "project::kMidiTempos" in source
    assert "grooveTempoCursor" in instrument
    assert "tempo.tick>grooveTick" in instrument
    assert "sequence.ppq)*grooveBpm/(60.*" in instrument


def test_native_panel_exports_embedded_midi_as_a_daw_file_drag():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "exportMidiSequence(int) const" in header
    assert 'text("MThd")' in source
    assert 'text("MTrk")' in source
    assert "project::kMidiTempos" in source
    assert "project::kMidiEvents" in source
    assert "CF_HDROP" in source
    assert "DoDragDrop" in source
    assert "DROPEFFECT_COPY" in source


def test_native_midi_panel_is_a_groove_browser_without_cc_map_copy():
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert 'L"GROOVE BROWSER"' in source
    assert 'Tambahkan groove MIDI' not in source
    assert 'L"\\u21E9 DRAG"' not in source
    assert 'countText' not in source
    assert 'midiDragCandidate=source' in source
    assert 'playing?L"\\u25A0":L"\\u25B6"' in source
    assert 'midiPlaying?L"STOP":L"PLAY"' not in source
    assert "MIDI PLAYER & MAP" not in source


def test_all_panel_headers_use_only_the_panel_type_at_top_left():
    preview = (SOURCE_DIR.parent.parent / "frontend" / "src" / "pages" / "VstMakerPreview.jsx").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac_source = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    assert '<span>{openPanel.label}</span>' not in preview
    assert 'openPanel.panelType === "preset_browser" ? "PRESET BROWSER"' in preview
    assert 'auto title=wide(panel.label)' not in source
    assert 'D2D1::RectF(r.left+16,r.top+14,r.right-48,r.top+31)' in source
    assert "NSString* title" not in mac_source
    assert "NSMakeRect(NSMinX(panelRect) + 16, NSMinY(panelRect) + 15" in mac_source


def test_native_mixer_volume_and_pan_track_horizontal_mouse_drag():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac_source = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    assert "mixerDragGroup=-1, mixerDragSlot=-1" in header
    assert "mixerDragGroup=group;mixerDragSlot=0" in source
    assert "mixerDragGroup=group;mixerDragSlot=1" in source
    assert "std::clamp((x-trackLeft)/90.f,0.f,1.f)" in source
    assert "mixerDragGroup=-1;mixerDragSlot=-1" in source
    assert "_mixerDragGroup = group; _mixerDragSlot = 0" in mac_source
    assert "_mixerDragGroup = group; _mixerDragSlot = 1" in mac_source
    assert "std::clamp((point.x - trackLeft) / 90., 0., 1.)" in mac_source
    assert "_mixerDragGroup = -1;" in mac_source
    assert "_mixerDragSlot = -1;" in mac_source


def test_native_canvas_uses_saved_ui_color():
    source = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "bottom=rgb(project::kUiRgb)" in source


def test_native_tempo_sync_uses_host_context_and_independent_time_stretch():
    header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "public Steinberg::Vst::SingleComponentEffect" in header
    assert "getProcessContextRequirements()" in header
    assert "ProcessContext::kTempoValid" in source
    assert "IProcessContextRequirements::kNeedTempo" in source
    assert "project::kFallbackTempoBpm" in header
    assert "signalsmith::stretch::SignalsmithStretch<float>" in source
    assert "smoothedTempoBpm/static_cast<double>(zone.sourceBpm)" in source
    assert "setTransposeSemitones" in source
    assert "zone.loopCrossfadeMs" in source


def test_looping_and_tempo_sync_retrigger_choke_only_the_same_pitch():
    header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "retriggerRelease=false" in header
    assert "v.active&&v.pitch==pitch" in source
    assert "project::kZones[v.zoneIndex].loopEnabled||project::kZones[v.zoneIndex].tempoSync" in source
    assert "v.retriggerRelease=true" in source
    assert ".008f*static_cast<float>(hostSampleRate)" in source


def test_mapping_choke_targets_override_sustain_with_fast_release():
    source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "std::array<bool,128> chokePitches" in source
    assert "z.chokeTargetCount" in source
    assert "z.chokeTargetPitches" in source
    assert "target!=pitch" in source
    assert "chokePitches[static_cast<size_t>(v.pitch)]" in source
    assert "v.retriggerRelease=true" in source


def test_effect_runtime_applies_sample_offset_automation_and_reports_tails():
    header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    source = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "applyAutomationAt(i)" in source
    assert "if(offset>sampleOffset)break" in source
    assert "applyParameterValue(cursor.queue->getParameterId()" in source
    assert "effectBypassMix.setTarget" in source
    assert "effectBypassMix.next()" in source
    assert "getTailSamples()" in header
    assert "hostSampleRate*120.0" in source


def test_customer_build_runtime_requires_machine_bound_activation():
    instrument = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")
    view = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    runtime = (SOURCE_DIR / "LicenseRuntime.cpp").read_text(encoding="utf-8")

    assert "LicenseRuntime::initialize()" in instrument
    assert "!LicenseRuntime::isLicensed()" in instrument
    assert "std::fill(l,l+data.numSamples,0)" in instrument
    assert "Masukkan serial lisensi" in view
    assert 'auto eyebrow=L"AKTIVASI PRODUK"' in view
    assert "TRIPLESIDE STUDIO · AKTIVASI PRODUK" not in view
    assert "LicenseRuntime::activateSerial(licenseInput)" in view
    assert "Ctrl+V" in view
    assert "NativeView::onKeyDown(char16 key,int16 keyCode,int16 modifiers)" in view
    assert "keyCode==KEY_BACK" in view
    assert "modifiers&(kCommandKey|kControlKey)" in view
    assert "DLGC_WANTALLKEYS|DLGC_WANTCHARS" in view
    assert "GetTickCount64()-licenseForwardedAt<100" in view
    assert "CryptProtectData" in runtime
    assert "CryptUnprotectData" in runtime
    assert "WinHttpSendRequest" in runtime
    assert "startOnlineRefresh" in runtime
    assert "now - verifiedAt <=" not in runtime


def test_macos_runtime_uses_keychain_machine_binding_and_activation_overlay():
    runtime = (SOURCE_DIR / "LicenseRuntime.cpp").read_text(encoding="utf-8")
    header = (SOURCE_DIR / "LicenseRuntime.h").read_text(encoding="utf-8")
    view = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")
    cmake = (SOURCE_DIR.parent / "CMakeLists.txt").read_text(encoding="utf-8")

    assert "IOPlatformUUID" in runtime
    assert "SecItemAdd" in runtime
    assert "SecItemCopyMatching" in runtime
    assert 'os_name\\\":\\\"macOS' in runtime
    assert "startOnlineRefreshMac" in runtime
    assert 'defined(_WIN32) || defined(__APPLE__)' in header
    assert "AKTIFKAN DARI CLIPBOARD" in view
    assert "NSPasteboard.generalPasteboard" in view
    assert "LicenseRuntime::activateSerial(value)" in view
    assert 'set_source_files_properties(Source/LicenseRuntime.cpp PROPERTIES LANGUAGE OBJCXX)' in cmake
    assert '"-framework Security"' in cmake


def test_factory_presets_restore_hidden_dsp_and_native_text_style():
    instrument_header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    instrument = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")
    view = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "applyModulePresetValue" in instrument_header
    assert 'if(!std::strcmp(parameter,"module_mix"))' in instrument
    assert "project::kPresetModules" in view
    assert "project::kPresetModuleParameters" in view
    assert "modulePresetValue" in instrument_header
    assert "preset.moduleValues.push_back" in view
    assert "version=3" in view
    assert "version<1||version>3" in view
    assert "c.textFont" in view
    assert "c.textColorRgb" in view
    assert 'L"Outfit-wght.ttf"' in view
    assert 'L"Cormorant Garamond"' in view


def test_shared_preview_live_overlays_support_pure_fft_and_stereo_vectorscope():
    header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    instrument = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")
    view = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert "analysisSamplesLeft" in header
    assert "analysisSamplesRight" in header
    assert "copyAnalysisSamples(float*,std::size_t,int channel=-1)" in header
    assert "analysisSamplesLeft[analysisSlot].store(sl" in instrument
    assert "analysisSamplesRight[analysisSlot].store(sr" in instrument
    assert 'equals(currentControlVariant,"stereo-vectorscope")' in view
    assert 'equals(currentControlVariant,"pure-spectrum")' in view
    assert "drawVectorscope" in view
    assert "vectorscopeCorrelation+=(correlation-vectorscopeCorrelation)*.18f" in view
    assert "constexpr float gridFrequencies[]" in view


def test_shared_preview_live_waveform_and_linked_led_match_on_both_platforms():
    header = (SOURCE_DIR / "NativeView.h").read_text(encoding="utf-8")
    windows = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    macos = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")
    compiler = (SOURCE_DIR.parent / "tools" / "compile_manifest.py").read_text(encoding="utf-8")
    capture = (SOURCE_DIR.parent / "tools" / "render_visual_assets.py").read_text(encoding="utf-8")

    assert "drawWaveform(const D2D1_RECT_F&)" in header
    assert 'equals(currentControlVariant,"realtime-waveform")' in windows
    assert "copyAnalysisSamples(samples.data(),samples.size())" in windows
    assert "drawWaveformInRect" in macos
    assert 'equals(control.variant, "realtime-waveform")' in macos
    assert "indicatorSourceIndex" in compiler
    assert "indicatorValue" in windows
    assert "indicatorValue" in macos
    assert "'indicator'" in capture


def test_prism_contextual_bands_route_runtime_parameters_and_migrate_state_v4():
    header = (SOURCE_DIR / "NativeInstrument.h").read_text(encoding="utf-8")
    instrument = (SOURCE_DIR / "NativeInstrument.cpp").read_text(encoding="utf-8")
    windows_view = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac_view = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    assert "kPrismFrequencyBaseId=200" in header
    assert "kPrismQBaseId=210" in header
    assert "kPrismGainBaseId=220" in header
    assert "kPrismEnabledBaseId=230" in header
    assert "id>=kPrismFrequencyBaseId&&id<kPrismFrequencyBaseId+5" in instrument
    assert "id>=kPrismQBaseId&&id<kPrismQBaseId+5" in instrument
    assert "version>6" in instrument
    assert "b.writeInt32u(6)" in instrument
    assert "else prismFrequencies[0]=tone" in instrument
    assert "applyPrismRackParameter" in instrument
    assert "isPrismContextParameter(control.parameter)" in instrument
    assert "project::kControls[i].spectrumBand" in windows_view
    assert "displayedParameter" in windows_view
    assert "hitPrismBand" in windows_view
    assert "!project::kPrismContextualEnabled" in windows_view
    assert "project::kControls[index].spectrumBand" in mac_view
    assert "displayedParameter" in mac_view
    assert "prismBandAt" in mac_view
    assert "project::kPrismContextualEnabled" in mac_view


def test_native_windows_draws_mixer_metal_fader_and_led_ladder_variants():
    view = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")

    assert 'equals(currentControlVariant,"mixer-metal")' in view
    assert '(r.right-r.left)*.72f' in view
    assert 'thumbWidth=bodyWidth*.82f' in view
    assert 'thumbHeight=std::clamp((body.bottom-body.top)*.10f,10.f,36.f)' in view
    assert 'equals(currentControlVariant,"mixer-led-ladder")' in view
    assert "const int columns=stereo?2:1,segments=16" in view
    assert 'equals(currentControlVariant,"mechanical-toggle")' in view
    assert 'loadBitmap(L"mechanical-toggle-off-v4.png",mechanicalToggleOff)' in view
    assert 'loadBitmap(L"mechanical-toggle-on-v4.png",mechanicalToggleOn)' in view
    assert "active?mechanicalToggleOn.Get():mechanicalToggleOff.Get()" in view
    assert "availableWidth/608.f" in view
    assert "availableHeight/608.f" in view


def test_native_stomp_and_bar_spectrum_are_live_on_both_platforms():
    header = (SOURCE_DIR / "BarSpectrumAnalyzer.h").read_text(encoding="utf-8")
    windows = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    assert "fftSize = 2048" in header
    assert "bandCount = 48" in header
    assert "minimumFrequency = 35.f" in header
    assert "maximumFrequency = 18000.f" in header
    assert "tiltDbPerOctave = 4.5f" in header
    assert "attackSeconds = .045f" in header
    assert "releaseSeconds = .34f" in header
    assert 'equals(currentControlVariant,"bar-spectrum-visualizer")' in windows
    assert 'equals(control.variant, "bar-spectrum-visualizer")' in mac
    assert 'loadBitmap(L"stomp-footswitch-off-v1.png",stompFootswitchOff)' in windows
    assert 'active?stompFootswitchOn.Get():stompFootswitchOff.Get()' in windows
    capture = (SOURCE_DIR.parent / "tools" / "render_visual_assets.py").read_text(encoding="utf-8")
    verifier = (SOURCE_DIR.parent / "tools" / "verify_visual_assets.py").read_text(encoding="utf-8")
    assert "c.get('component_variant') == 'stomp-footswitch'" in capture
    assert "source.get('id') == state.get('id')" in verifier


def test_loading_native_presets_preserves_running_groove_transport():
    windows = (SOURCE_DIR / "NativeView.cpp").read_text(encoding="utf-8")
    mac = (SOURCE_DIR / "NativeViewMac.mm").read_text(encoding="utf-8")

    windows_factory = windows.split("void NativeView::applyFactoryPreset", 1)[1].split("NativeView::UserPreset", 1)[0]
    windows_user = windows.split("void NativeView::applyUserPreset", 1)[1].split("void NativeView::overwriteUserPreset", 1)[0]
    mac_factory = mac.split("- (void)applyFactoryPreset:", 1)[1].split("- (void)applyUserPreset:", 1)[0]
    mac_user = mac.split("- (void)applyUserPreset:", 1)[1].split("- (void)saveUserPreset", 1)[0]
    assert "stopMidiSequence" not in windows_factory
    assert "stopMidiSequence" not in windows_user
    assert "stopMidiSequence" not in mac_factory
    assert "stopMidiSequence" not in mac_user
    assert "selectedMidiSequence=p.midiSequenceIndex" in windows_factory
    assert "_selectedMidiSequence = preset.midiSequenceIndex" in mac_factory
