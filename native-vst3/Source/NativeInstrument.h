#pragma once
#include "DspModules.h"
#include "WavFile.h"
#include "NativeProject.h"
#include "public.sdk/source/vst/vstsinglecomponenteffect.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include <array>
#include <atomic>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <vector>

namespace tripleside::native {
enum ParameterIds : Steinberg::Vst::ParamID {
    kVolumeId=100, kToneId=101, kAttackId=102, kReleaseId=103, kSpaceId=104,
    kMuteId=105, kSoloId=106, kArticulationId=107, kMicId=108,
    kInputId=109, kDriveId=110, kCompressId=111, kWidthId=112, kMixId=113,
    kOutputId=114, kBypassId=115, kSustainId=116, kPitchBendId=117, kModulationId=118, kPanId=119,
    kPrismFrequencyBaseId=200, kPrismQBaseId=210, kPrismGainBaseId=220, kPrismEnabledBaseId=230,
    kGroupBaseId=1000, kModuleControlBaseId=10000
};
inline Steinberg::Vst::ParamID groupParameterId(int group, int slot) { return kGroupBaseId + group * 4 + slot; }

class NativeInstrument final : public Steinberg::Vst::SingleComponentEffect,
                               public Steinberg::Vst::IMidiMapping {
public:
    OBJ_METHODS(NativeInstrument, Steinberg::Vst::SingleComponentEffect)
    NativeInstrument();
    ~NativeInstrument() override;
    static Steinberg::FUnknown* createInstance(void*) { return static_cast<Steinberg::Vst::IAudioProcessor*>(new NativeInstrument()); }
    Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown*) override;
    Steinberg::tresult PLUGIN_API setActive(Steinberg::TBool) override;
    Steinberg::tresult PLUGIN_API setBusArrangements(Steinberg::Vst::SpeakerArrangement*, Steinberg::int32, Steinberg::Vst::SpeakerArrangement*, Steinberg::int32) override;
    Steinberg::tresult PLUGIN_API setupProcessing(Steinberg::Vst::ProcessSetup&) override;
    Steinberg::tresult PLUGIN_API canProcessSampleSize(Steinberg::int32) override;
    Steinberg::uint32 PLUGIN_API getTailSamples() override;
    Steinberg::tresult PLUGIN_API process(Steinberg::Vst::ProcessData&) override;
    Steinberg::tresult PLUGIN_API setState(Steinberg::IBStream*) override;
    Steinberg::tresult PLUGIN_API getState(Steinberg::IBStream*) override;
    Steinberg::tresult PLUGIN_API setEditorState(Steinberg::IBStream*) override;
    Steinberg::tresult PLUGIN_API getEditorState(Steinberg::IBStream*) override;
    Steinberg::IPlugView* PLUGIN_API createView(Steinberg::FIDString) override;
    Steinberg::tresult PLUGIN_API getMidiControllerAssignment(
        Steinberg::int32, Steinberg::int16, Steinberg::Vst::CtrlNumber,
        Steinberg::Vst::ParamID&) override;
    Steinberg::uint32 PLUGIN_API getProcessContextRequirements() override;
    Steinberg::tresult PLUGIN_API queryInterface(const Steinberg::TUID, void**) override;
    REFCOUNT_METHODS(Steinberg::Vst::SingleComponentEffect)

    void queueEditorNote(int pitch, int velocity, bool on) noexcept;
    bool isNoteActive(int pitch) const noexcept;
    unsigned noteTriggerCount(int pitch) const noexcept;
    float outputPeak(int channel) const noexcept { return peaks[static_cast<size_t>(channel)].load(std::memory_order_relaxed); }
    float outputRms(int channel) const noexcept { return rms[static_cast<size_t>(channel)].load(std::memory_order_relaxed); }
    float gainReduction(int moduleIndex = -1) const noexcept;
    float groupPeak(int group) const noexcept { return groupPeaks[static_cast<size_t>(group)].load(std::memory_order_relaxed); }
    static constexpr std::size_t kAnalysisSampleCount=2048;
    void copyAnalysisSamples(float*,std::size_t,int channel=-1) const noexcept;
    double analysisSampleRate() const noexcept { return hostSampleRate; }
    Steinberg::Vst::ParamID parameterFor(const char*) const noexcept;
    Steinberg::Vst::ParamID parameterForControl(std::size_t) const noexcept;
    Steinberg::Vst::ParamID prismParameterFor(int band, int slot) const noexcept;
    float prismBandValue(int band, int slot) const noexcept;
    bool prismBandEnabled(int band) const noexcept;
    void applyModulePresetValue(std::size_t, const char*, float) noexcept;
    float modulePresetValue(std::size_t, const char*) const noexcept;
    static std::filesystem::path resourceDirectory();

private:
    struct TempoStretchState;
    struct StereoBiquad {
        float b0=1, b1=0, b2=0, a1=0, a2=0;
        std::array<float,2> z1{}, z2{};
        float process(float sample, int channel) noexcept { const float out=b0*sample+z1[channel]; z1[channel]=b1*sample-a1*out+z2[channel]; z2[channel]=b2*sample-a2*out; return out; }
        void reset() noexcept { z1.fill(0); z2.fill(0); }
    };
    struct Voice { bool active=false, releasing=false, held=false, retriggerRelease=false; Steinberg::int32 noteId=-1; int pitch=60, zoneIndex=-1; double position=0, increment=1; float gain=0, envelope=0; std::uint64_t age=0; };
    struct OscVoice {
        bool active=false, releasing=false, held=false; Steinberg::int32 noteId=-1; int pitch=60;
        std::array<double,8> phase1{}, phase2{}; double subPhase=0, currentPitch=60, targetPitch=60; std::uint64_t glideSamplesRemaining=0;
        std::array<float,2> filterState{}, filterInput{}; float gain=0, envelope=0, noteSeconds=0, pink=0, brown=0;
        int envelopeStage=0; std::uint32_t noiseState=1; std::uint64_t age=0;
    };
    struct UiNote { int pitch=60, velocity=100; bool on=true; };
    void loadResources(); void applyParameterChanges(Steinberg::Vst::IParameterChanges*);
    void applyParameterValue(Steinberg::Vst::ParamID, float) noexcept;
    void applyModuleControl(std::size_t, float) noexcept; void applyPrismRackParameter(int,int,float) noexcept;
    void applyEventsAt(Steinberg::Vst::IEventList*, Steinberg::int32&, int); void drainEditorNotes();
    void setMidiNoteActive(int pitch, bool on) noexcept;
    void setSustain(bool on) noexcept;
    void noteOn(int pitch, int velocity, Steinberg::int32 noteId); void noteOff(int pitch, Steinberg::int32 noteId);
    void renderFrame(float&, float&, std::array<float, project::kGroups.size()>&);
    bool renderTempoVoiceFrame(Voice&, std::size_t, const project::ZoneInfo&, const WavFile&, float, float&, float&);
    void prepareTempoStretchers(); void applyMasterPan(float&, float&) noexcept; void setWavePitchTarget(OscVoice&,double,bool) noexcept;
    Voice& acquireVoice(); OscVoice& acquireOscVoice(); void configureGlobalTuning(); void configureWaveGenerator(); void resetDsp(); void applyCustomImpulses(); void applyToneAndSpace(float&, float&); void processEffectFrame(float, float, float&, float&); void updatePrismEq();
    std::vector<WavFile> samples;
    std::vector<WavFile> impulseResponses;
    std::array<Voice, project::kPolyphony> voices{};
    std::array<OscVoice, project::kPolyphony> oscillatorVoices{};
    std::array<std::unique_ptr<TempoStretchState>, project::kPolyphony> tempoStretchers{};
    std::array<int, project::kZones.size() * 128> roundRobin{};
    std::array<float, project::kGroups.size()> groupVolumes{}; std::array<float, project::kGroups.size()> groupPans{};
    std::array<bool, project::kGroups.size()> groupMutes{}, groupSolos{};
    std::array<std::atomic<float>, 2> peaks{}, rms{}; std::array<std::atomic<float>, project::kGroups.size()> groupPeaks{};
    std::array<std::atomic<float>, kAnalysisSampleCount> analysisSamplesLeft{},analysisSamplesRight{}; std::atomic<std::uint64_t> analysisWrite{0};
    std::array<std::atomic<float>, project::kDspModules.size()> compressorGainReductions{};
    std::array<UiNote, 128> uiNotes{}; std::atomic<unsigned> uiWrite{0}, uiRead{0};
    std::array<std::atomic<unsigned>, 128> activeMidiNotes{};
    std::array<std::atomic<unsigned>, 128> noteTriggers{};
    float filterLeft=0, filterRight=0;
    StereoBiquad prismLowCut, prismLowBody, prismMidFocus, prismPresence, prismAir;
    std::array<float,5> prismFrequencies{}, prismGains{}, prismQs{}; std::array<bool,5> prismEnabled{};
    double hostSampleRate=44100, hostTempoBpm=project::kFallbackTempoBpm, smoothedTempoBpm=project::kFallbackTempoBpm; float volume=project::kDefaultVolume, tone=project::kDefaultTone, attack=project::kDefaultAttack, releaseAmount=project::kDefaultRelease, space=project::kDefaultSpace;
    float input=project::kDefaultInput, drive=project::kDefaultDrive, compress=project::kDefaultCompress, width=project::kDefaultWidth, mix=project::kDefaultMix, output=project::kDefaultOutput, pan=project::kDefaultPan;
    dsp::StereoGain instrumentMasterGain{dsp::GainLaw::Linear};
    dsp::SoftClip instrumentSaturation{};
    dsp::StereoChorus instrumentChorus{};
    dsp::TempoDelay instrumentDelay{};
    dsp::StereoReverb instrumentReverb{};
    dsp::StereoGain effectInputTrim{dsp::GainLaw::InputTrim};
    dsp::DryWet effectMix{};
    dsp::StereoGain effectOutputTrim{dsp::GainLaw::OutputTrim};
    dsp::EffectRack effectRack{};
    dsp::SmoothedValue effectBypassMix{};
    dsp::SmoothedValue masterPan{};
    std::array<float, project::kControls.size()> moduleControlValues{};
    std::array<std::atomic<float>, project::kDspModules.size()> moduleMixValues{};
    std::array<std::atomic<bool>, project::kDspModules.size()> moduleBypassValues{};
    std::array<std::atomic<float>, project::kDspParameters.size()> moduleParameterValues{};
    bool bypass=project::kDefaultBypass>=.5f, instrumentUsesDspRack=false;
    bool mute=false, solo=false, sustain=project::kDefaultSustain; int articulation=0, mic=0; std::uint64_t voiceAge=0;
    float pitchBend=.5f, smoothedPitchBend=.5f, modulation=0; double modulationPhase=0;
    int tuningModule=-1; bool globalTuningEnabled=false; float globalTuneSemitones=0, globalFineCents=0;
    int waveGeneratorModule=-1, waveShape=0, waveOctave=0, waveSemitone=0, waveOsc2Shape=0, waveOsc2Octave=0, waveNoiseColor=1, waveUnisonVoices=1;
    float waveFineCents=0, waveLevel=.65f, wavePulseWidth=.5f, waveMix=1, waveAttack=0, waveDecay=.2f, waveSustain=1, waveRelease=.18f;
    float waveVelocitySensitivity=1, waveVelocityCurve=1, waveVelocityMinLevel=0;
    float waveFilterCutoff=1, waveFilterResonance=0, waveFilterEnvAmount=.5f, waveFilterKeyTracking=0;
    float waveOsc2Detune=0, waveOsc2Level=0, waveOsc2PulseWidth=.5f, waveSubLevel=0, waveNoiseLevel=0;
    float waveUnisonDetune=.12f, waveStereoSpread=0, waveGlide=0, waveGlideMode=0, waveVibratoRate=.45f, waveVibratoDepth=0, waveVibratoDelay=0;
    std::array<int,128> monoWaveVelocities{}; std::array<std::uint64_t,128> monoWaveAges{};
    double lastWavePitch=60; bool hasLastWavePitch=false, waveEnabled=false, wavePhaseReset=true, waveOsc2Enabled=false, waveMono=true, waveRetrigger=true;
};
} // namespace tripleside::native
