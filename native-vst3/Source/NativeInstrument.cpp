#include "NativeInstrument.h"
#include "EmbeddedResource.h"
#include "LicenseRuntime.h"
#include "NativeView.h"
#include "base/source/fstreamer.h"
#include "base/source/fstring.h"
#include "pluginterfaces/base/ustring.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "public.sdk/source/main/pluginfactory.h"
#include "public.sdk/source/vst/vstparameters.h"
#include "signalsmith-stretch.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <string>
#if defined(_WIN32)
#include <windows.h>
#elif defined(__APPLE__)
#include <dlfcn.h>
#endif

namespace tripleside::native {
using namespace Steinberg; using namespace Steinberg::Vst;
struct NativeInstrument::TempoStretchState {
    static constexpr int kOutputChunk = 64;
    signalsmith::stretch::SignalsmithStretch<float> stretch;
    std::array<std::vector<float>, 2> history;
    std::array<std::vector<float>, 2> output;
    std::array<double, kOutputChunk> positions{};
    int outputCursor = 0;
    int outputCount = 0;
    double nextPosition = 0;
    bool configured = false;

    explicit TempoStretchState(long seed) : stretch(seed) {}

    void configure(double sampleRate) {
        const auto block = std::max(512, static_cast<int>(sampleRate * .08));
        const auto interval = std::max(128, static_cast<int>(sampleRate * .02));
        stretch.configure(2, block, interval, true);
        const auto historyLength = stretch.seekLength();
        for (auto& channel : history) channel.assign(static_cast<std::size_t>(historyLength), 0.f);
        for (auto& channel : output) channel.assign(kOutputChunk, 0.f);
        outputCursor = outputCount = 0;
        configured = true;
    }

    void restart(double position) {
        stretch.reset();
        outputCursor = outputCount = 0;
        nextPosition = position;
    }
};
namespace {
constexpr float pi=3.14159265358979323846f;
float clamp01(double v){return static_cast<float>(std::clamp(v,0.0,1.0));}
float waveVelocityGain(int velocity,float sensitivity,float curve,float minimum){const float normalized=std::clamp(velocity,1,127)/127.f;const float curved=curve<.25f?std::sqrt(normalized):curve<.75f?normalized:normalized*normalized;const float ranged=minimum+(1-minimum)*curved;return 1-sensitivity*(1-ranged);}
float polyBlep(float phase,float increment){if(increment<=0)return 0;if(phase<increment){const float x=phase/increment;return x+x-x*x-1;}if(phase>1-increment){const float x=(phase-1)/increment;return x*x+x+x+1;}return 0;}
float oscillatorSample(int shape,float phase,float increment,float pulseWidth){
    if(shape==0)return std::sin(2*pi*phase);
    if(shape==1)return (2.f/pi)*std::asin(std::sin(2*pi*phase));
    if(shape==2)return 2*phase-1-polyBlep(phase,increment);
    if(shape==3){float value=phase<pulseWidth?1.f:-1.f;value+=polyBlep(phase,increment);float shifted=phase-pulseWidth;if(shifted<0)shifted+=1;value-=polyBlep(shifted,increment);return value;}
    return 0;
}
bool hasControlParameter(const char* parameter){
    return std::any_of(project::kControls.begin(),project::kControls.end(),[parameter](const auto&control){
        return control.parameter&&std::strcmp(control.parameter,parameter)==0;
    });
}
bool isPrismContextParameter(const char* parameter){return parameter&&(!std::strcmp(parameter,"prism_frequency")||!std::strcmp(parameter,"prism_gain")||!std::strcmp(parameter,"prism_q"));}
dsp::RackModuleType rackModuleType(const char* type){
    if(!type)return dsp::RackModuleType::Unknown;
    if(!std::strcmp(type,"input_trim"))return dsp::RackModuleType::InputTrim;
    if(!std::strcmp(type,"soft_clip"))return dsp::RackModuleType::SoftClip;
    if(!std::strcmp(type,"linked_compressor"))return dsp::RackModuleType::LinkedCompressor;
    if(!std::strcmp(type,"de_esser"))return dsp::RackModuleType::DeEsser;
    if(!std::strcmp(type,"prism_eq"))return dsp::RackModuleType::PrismEq;
    if(!std::strcmp(type,"parametric_eq"))return dsp::RackModuleType::ParametricEq;
    if(!std::strcmp(type,"multiband_compressor"))return dsp::RackModuleType::MultibandCompressor;
    if(!std::strcmp(type,"tone_shaper"))return dsp::RackModuleType::ToneShaper;
    if(!std::strcmp(type,"stereo_width"))return dsp::RackModuleType::StereoWidth;
    if(!std::strcmp(type,"noise_gate"))return dsp::RackModuleType::NoiseGate;
    if(!std::strcmp(type,"amp_overdrive"))return dsp::RackModuleType::AmpOverdrive;
    if(!std::strcmp(type,"amp_model"))return dsp::RackModuleType::AmpModel;
    if(!std::strcmp(type,"dual_high_gain"))return dsp::RackModuleType::DualHighGain;
    if(!std::strcmp(type,"silk_bloom"))return dsp::RackModuleType::SilkBloom;
    if(!std::strcmp(type,"cabinet_ir"))return dsp::RackModuleType::CabinetIr;
    if(!std::strcmp(type,"cross_delay"))return dsp::RackModuleType::CrossDelay;
    if(!std::strcmp(type,"chorus"))return dsp::RackModuleType::Chorus;
    if(!std::strcmp(type,"flanger"))return dsp::RackModuleType::Flanger;
    if(!std::strcmp(type,"tremolo"))return dsp::RackModuleType::Tremolo;
    if(!std::strcmp(type,"vibrato"))return dsp::RackModuleType::Vibrato;
    if(!std::strcmp(type,"digital_delay"))return dsp::RackModuleType::DigitalDelay;
    if(!std::strcmp(type,"reverb"))return dsp::RackModuleType::Reverb;
    if(!std::strcmp(type,"shimmer"))return dsp::RackModuleType::Shimmer;
    if(!std::strcmp(type,"dry_wet"))return dsp::RackModuleType::DryWet;
    if(!std::strcmp(type,"output_trim"))return dsp::RackModuleType::OutputTrim;
    return dsp::RackModuleType::Unknown;
}
bool isPrimaryRackParameter(dsp::RackModuleType type,const char* key){
    if(!key)return false;
    if(!std::strcmp(key,"normalized")||!std::strcmp(key,"value")||!std::strcmp(key,"amount"))return true;
    if(type==dsp::RackModuleType::InputTrim)return!std::strcmp(key,"input")||!std::strcmp(key,"gain");
    if(type==dsp::RackModuleType::SoftClip)return!std::strcmp(key,"drive");
    if(type==dsp::RackModuleType::LinkedCompressor)return!std::strcmp(key,"compress");
    if(type==dsp::RackModuleType::DeEsser)return!std::strcmp(key,"amount");
    if(type==dsp::RackModuleType::PrismEq)return!std::strcmp(key,"band_3_gain");
    if(type==dsp::RackModuleType::ParametricEq)return!std::strcmp(key,"mid_gain");
    if(type==dsp::RackModuleType::MultibandCompressor)return!std::strcmp(key,"amount");
    if(type==dsp::RackModuleType::ToneShaper)return!std::strcmp(key,"tone");
    if(type==dsp::RackModuleType::StereoWidth)return!std::strcmp(key,"width");
    if(type==dsp::RackModuleType::NoiseGate)return!std::strcmp(key,"threshold");
    if(type==dsp::RackModuleType::AmpOverdrive)return!std::strcmp(key,"drive");
    if(type==dsp::RackModuleType::AmpModel)return!std::strcmp(key,"gain");
    if(type==dsp::RackModuleType::DualHighGain)return!std::strcmp(key,"gain");
    if(type==dsp::RackModuleType::SilkBloom)return!std::strcmp(key,"gain");
    if(type==dsp::RackModuleType::CabinetIr)return!std::strcmp(key,"cabinet");
    if(type==dsp::RackModuleType::CrossDelay)return!std::strcmp(key,"space");
    if(type==dsp::RackModuleType::Chorus||type==dsp::RackModuleType::Flanger||type==dsp::RackModuleType::Tremolo||type==dsp::RackModuleType::Vibrato||type==dsp::RackModuleType::DigitalDelay||type==dsp::RackModuleType::Reverb||type==dsp::RackModuleType::Shimmer)return!std::strcmp(key,"mix");
    if(type==dsp::RackModuleType::DryWet)return!std::strcmp(key,"mix");
    if(type==dsp::RackModuleType::OutputTrim)return!std::strcmp(key,"output")||!std::strcmp(key,"gain");
    return false;
}
float rackModuleValue(const project::DspModuleInfo&module,dsp::RackModuleType type,float fallback,bool&followsLegacy){
    followsLegacy=true;
    for(int offset=0;offset<module.parameterCount;++offset){
        const int index=module.parameterOffset+offset;
        if(index<0||index>=static_cast<int>(project::kDspParameters.size()))continue;
        const auto&parameter=project::kDspParameters[static_cast<size_t>(index)];
        if(parameter.moduleIndex<0||parameter.moduleIndex>=static_cast<int>(project::kDspModules.size()))continue;
        if(isPrimaryRackParameter(type,parameter.key)){followsLegacy=false;return clamp01(parameter.value);}
        if(!std::strcmp(parameter.key,"gain_db")){
            if(type==dsp::RackModuleType::InputTrim){followsLegacy=false;return clamp01((parameter.value+12.f)/24.f);}
            if(type==dsp::RackModuleType::OutputTrim){followsLegacy=false;return clamp01((parameter.value+12.f)/16.f);}
        }
    }
    if(type==dsp::RackModuleType::ParametricEq&&fallback==0.f)return .5f;
    if(type==dsp::RackModuleType::MultibandCompressor&&fallback==0.f)return .65f;
    return fallback;
}
float projectModuleParameter(int moduleIndex,const char*key,float fallback){
    if(moduleIndex<0||moduleIndex>=static_cast<int>(project::kDspModules.size())||!key)return fallback;
    const auto&module=project::kDspModules[static_cast<size_t>(moduleIndex)];
    for(int offset=0;offset<module.parameterCount;++offset){const int index=module.parameterOffset+offset;if(index<0||index>=static_cast<int>(project::kDspParameters.size()))continue;const auto&parameter=project::kDspParameters[static_cast<size_t>(index)];if(!std::strcmp(parameter.key,key))return clamp01(parameter.value);}
    return fallback;
}
bool isModuleControlKind(const char*kind){
    return kind&&std::strcmp(kind,"visual")&&std::strcmp(kind,"text")&&std::strcmp(kind,"gain_meter")&&std::strcmp(kind,"vu_meter")&&std::strcmp(kind,"keyboard")&&std::strcmp(kind,"pad");
}
bool buildCustomImpulse(const WavFile& source,const project::ImpulseResponseInfo& settings,double targetSampleRate,
    std::vector<std::size_t>& delays,std::vector<float>& coefficients){
    if(source.empty()||source.sampleRate<=0||targetSampleRate<=0)return false;
    const auto targetFrames=std::max<std::size_t>(1,static_cast<std::size_t>(std::ceil(
        static_cast<double>(source.frameCount())*targetSampleRate/static_cast<double>(source.sampleRate))));
    auto sampleAt=[&](std::size_t frame){
        const double position=static_cast<double>(frame)*static_cast<double>(source.sampleRate)/targetSampleRate;
        const auto first=std::min(source.frameCount()-1,static_cast<std::size_t>(position));
        const auto second=std::min(source.frameCount()-1,first+1);const float fraction=static_cast<float>(position-first);
        float mixed=0;for(int channel=0;channel<source.channels;++channel){const float a=source.sample(first,channel),b=source.sample(second,channel);mixed+=a+(b-a)*fraction;}
        return mixed/static_cast<float>(source.channels);
    };
    std::size_t start=std::min(targetFrames-1,static_cast<std::size_t>(settings.trimStart*targetFrames));
    std::size_t end=std::clamp<std::size_t>(static_cast<std::size_t>(std::ceil(settings.trimEnd*targetFrames)),start+1,targetFrames);
    if(settings.autoTrim){float peak=0;for(auto frame=start;frame<end;++frame)peak=std::max(peak,std::abs(sampleAt(frame)));const float threshold=peak*.001f;if(threshold>0){while(start+1<end&&std::abs(sampleAt(start))<threshold)++start;while(end>start+1&&std::abs(sampleAt(end-1))<threshold)--end;}}
    const auto phaseSamples=static_cast<long>(std::llround(settings.phaseMs*.001*targetSampleRate));
    if(phaseSamples<0)start=std::min(end-1,start+static_cast<std::size_t>(-phaseSamples));
    const auto prepend=static_cast<std::size_t>(std::max<long>(0,phaseSamples));
    const auto length=std::min<std::size_t>(2048,prepend+end-start);std::vector<float> response(length,0);
    const float polarity=settings.polarityInverted?-1.f:1.f;for(auto index=prepend;index<length;++index)response[index]=sampleAt(start+index-prepend)*polarity;
    if(settings.normalize){float peak=0;for(float value:response)peak=std::max(peak,std::abs(value));if(peak>1.e-12f)for(auto&value:response)value/=peak;}
    delays.clear();coefficients.clear();delays.reserve(368);coefficients.reserve(368);const auto exact=std::min<std::size_t>(128,response.size());
    for(std::size_t index=0;index<exact;++index){delays.push_back(index);coefficients.push_back(response[index]);}
    for(std::size_t offset=exact;offset<response.size();offset+=8){const auto groupEnd=std::min(response.size(),offset+8);float sum=0;for(auto index=offset;index<groupEnd;++index)sum+=response[index];delays.push_back(offset+(groupEnd-offset-1)/2);coefficients.push_back(sum);}
    return !coefficients.empty();
}
}
NativeInstrument::NativeInstrument() {
    for(size_t i=0;i<prismFrequencies.size();++i){
        prismFrequencies[i]=static_cast<float>(std::clamp<double>(std::log(std::max(10.f,project::kPrismBandFrequencies[i])/10.f)/std::log(3000.f),0.0,1.0));
        prismGains[i]=project::kPrismBandGains[i];
        prismQs[i]=static_cast<float>(std::clamp<double>(std::log(std::max(.025f,project::kPrismBandQs[i])/.025f)/std::log(1600.f),0.0,1.0));
        prismEnabled[i]=project::kPrismBandEnabled[i];
    }
    for(size_t i=0;i<project::kDspModules.size();++i){moduleMixValues[i].store(project::kDspModules[i].mix,std::memory_order_relaxed);moduleBypassValues[i].store(project::kDspModules[i].bypassed,std::memory_order_relaxed);compressorGainReductions[i].store(0,std::memory_order_relaxed);}
    for(size_t i=0;i<project::kDspParameters.size();++i)moduleParameterValues[i].store(project::kDspParameters[i].value,std::memory_order_relaxed);
}
NativeInstrument::~NativeInstrument() = default;

tresult PLUGIN_API NativeInstrument::initialize(FUnknown* context) {
    auto result=SingleComponentEffect::initialize(context); if(result!=kResultOk) return result;
    LicenseRuntime::initialize();
    if constexpr(project::kIsEffect)addAudioInput(STR16("Stereo Input"),SpeakerArr::kStereo);
    addAudioOutput(STR16("Master"), SpeakerArr::kStereo);
    if constexpr(!project::kIsEffect){
        for(const auto&group:project::kGroups)if(group.outputBusIndex>0){String name(group.name,kCP_Utf8);addAudioOutput(name.text16(),SpeakerArr::kStereo,kAux,BusInfo::kDefaultActive);}
    }
    if constexpr(!project::kIsEffect||!project::kMidiMappings.empty())addEventInput(STR16("MIDI Input"),16);
    if constexpr(project::kIsEffect){
        parameters.addParameter(STR16("Input"),STR16("dB"),0,project::kDefaultInput,ParameterInfo::kCanAutomate,kInputId);
        if constexpr(project::kIsPrismEq){
            parameters.addParameter(STR16("Low Body"),STR16("dB"),0,project::kDefaultDrive,ParameterInfo::kCanAutomate,kDriveId);
            parameters.addParameter(STR16("Mid Focus"),STR16("dB"),0,project::kDefaultCompress,ParameterInfo::kCanAutomate,kCompressId);
            parameters.addParameter(STR16("Low Cut"),STR16("Hz"),0,project::kDefaultTone,ParameterInfo::kCanAutomate,kToneId);
            parameters.addParameter(STR16("Presence"),STR16("dB"),0,project::kDefaultWidth,ParameterInfo::kCanAutomate,kWidthId);
            parameters.addParameter(STR16("Air"),STR16("dB"),0,project::kDefaultSpace,ParameterInfo::kCanAutomate,kSpaceId);
            if constexpr(project::kPrismLowCutEnabled){parameters.addParameter(STR16("Band 1 Frequency"),STR16("Hz"),0,prismFrequencies[0],ParameterInfo::kCanAutomate,kPrismFrequencyBaseId);parameters.addParameter(STR16("Band 1 Q"),nullptr,0,prismQs[0],ParameterInfo::kCanAutomate,kPrismQBaseId);}
            if constexpr(project::kPrismLowBodyEnabled){parameters.addParameter(STR16("Band 2 Frequency"),STR16("Hz"),0,prismFrequencies[1],ParameterInfo::kCanAutomate,kPrismFrequencyBaseId+1);parameters.addParameter(STR16("Band 2 Q"),nullptr,0,prismQs[1],ParameterInfo::kCanAutomate,kPrismQBaseId+1);}
            if constexpr(project::kPrismMidFocusEnabled){parameters.addParameter(STR16("Band 3 Frequency"),STR16("Hz"),0,prismFrequencies[2],ParameterInfo::kCanAutomate,kPrismFrequencyBaseId+2);parameters.addParameter(STR16("Band 3 Q"),nullptr,0,prismQs[2],ParameterInfo::kCanAutomate,kPrismQBaseId+2);}
            if constexpr(project::kPrismPresenceEnabled){parameters.addParameter(STR16("Band 4 Frequency"),STR16("Hz"),0,prismFrequencies[3],ParameterInfo::kCanAutomate,kPrismFrequencyBaseId+3);parameters.addParameter(STR16("Band 4 Q"),nullptr,0,prismQs[3],ParameterInfo::kCanAutomate,kPrismQBaseId+3);}
            if constexpr(project::kPrismAirEnabled){parameters.addParameter(STR16("Band 5 Frequency"),STR16("Hz"),0,prismFrequencies[4],ParameterInfo::kCanAutomate,kPrismFrequencyBaseId+4);parameters.addParameter(STR16("Band 5 Q"),nullptr,0,prismQs[4],ParameterInfo::kCanAutomate,kPrismQBaseId+4);}
        }else{
            parameters.addParameter(STR16("Drive"),nullptr,0,project::kDefaultDrive,ParameterInfo::kCanAutomate,kDriveId);
            parameters.addParameter(STR16("Compress"),nullptr,0,project::kDefaultCompress,ParameterInfo::kCanAutomate,kCompressId);
            parameters.addParameter(STR16("Tone"),nullptr,0,project::kDefaultTone,ParameterInfo::kCanAutomate,kToneId);
            parameters.addParameter(STR16("Width"),nullptr,0,project::kDefaultWidth,ParameterInfo::kCanAutomate,kWidthId);
            parameters.addParameter(STR16("Space"),nullptr,0,project::kDefaultSpace,ParameterInfo::kCanAutomate,kSpaceId);
        }
        parameters.addParameter(STR16("Mix"),STR16("%"),0,project::kDefaultMix,ParameterInfo::kCanAutomate,kMixId);
        parameters.addParameter(STR16("Output"),STR16("dB"),0,project::kDefaultOutput,ParameterInfo::kCanAutomate,kOutputId);
        parameters.addParameter(STR16("Pan"),nullptr,0,project::kDefaultPan,ParameterInfo::kCanAutomate,kPanId);
        parameters.addParameter(STR16("Bypass"),nullptr,1,project::kDefaultBypass,ParameterInfo::kCanAutomate|ParameterInfo::kIsBypass,kBypassId);
    } else {
    parameters.addParameter(STR16("Volume"), STR16("%"), 0, project::kDefaultVolume, ParameterInfo::kCanAutomate, kVolumeId);
    parameters.addParameter(STR16("Tone"), nullptr, 0, project::kDefaultTone, ParameterInfo::kCanAutomate, kToneId);
    parameters.addParameter(STR16("Attack"), nullptr, 0, project::kDefaultAttack, ParameterInfo::kCanAutomate, kAttackId);
    parameters.addParameter(STR16("Release"), nullptr, 0, project::kDefaultRelease, ParameterInfo::kCanAutomate, kReleaseId);
    parameters.addParameter(STR16("Space"), nullptr, 0, project::kDefaultSpace, ParameterInfo::kCanAutomate, kSpaceId);
    parameters.addParameter(STR16("Pan"), nullptr, 0, project::kDefaultPan, ParameterInfo::kCanAutomate, kPanId);
    if constexpr(project::kPitchBendEnabled)parameters.addParameter(STR16("Pitch Bend"), nullptr, 0, .5, ParameterInfo::kCanAutomate, kPitchBendId);
    if constexpr(project::kModulationEnabled)parameters.addParameter(STR16("Modulation"), nullptr, 0, 0, ParameterInfo::kCanAutomate, kModulationId);
    if(hasControlParameter("bypass"))parameters.addParameter(STR16("Bypass"),nullptr,1,project::kDefaultBypass,ParameterInfo::kCanAutomate|ParameterInfo::kIsBypass,kBypassId);
    parameters.addParameter(STR16("Mute"), nullptr, 1, 0, ParameterInfo::kCanAutomate, kMuteId);
    parameters.addParameter(STR16("Solo"), nullptr, 1, 0, ParameterInfo::kCanAutomate, kSoloId);
    auto* sustainParameter=new StringListParameter(STR16("Sustain Pedal"),kSustainId,nullptr,ParameterInfo::kCanAutomate);
    sustainParameter->appendString(STR16("Off"));
    sustainParameter->appendString(STR16("On"));
    const ParamValue sustainDefault=project::kDefaultSustain?1.:0.;
    sustainParameter->getInfo().defaultNormalizedValue=sustainDefault;
    sustainParameter->setNormalized(sustainDefault);
    parameters.addParameter(sustainParameter);
    parameters.addParameter(STR16("Articulation"), nullptr, std::max<int>(0,project::kArticulations.size()-1), 0, ParameterInfo::kCanAutomate|ParameterInfo::kIsList, kArticulationId);
    parameters.addParameter(STR16("Mic Position"), nullptr, std::max<int>(0,project::kMicPositions.size()-1), 0, ParameterInfo::kCanAutomate|ParameterInfo::kIsList, kMicId);
    }
    if constexpr(project::kHasPrismModule){for(size_t band=0;band<5;++band){
        const auto number=std::to_string(band+1);String frequency(("Band "+number+" Frequency").c_str(),kCP_Utf8),gain(("Band "+number+" Gain").c_str(),kCP_Utf8),q(("Band "+number+" Q").c_str(),kCP_Utf8),enabled(("Band "+number+" Enabled").c_str(),kCP_Utf8);
        parameters.addParameter(frequency.text16(),STR16("Hz"),0,prismFrequencies[band],ParameterInfo::kCanAutomate,kPrismFrequencyBaseId+static_cast<ParamID>(band));
        parameters.addParameter(gain.text16(),STR16("dB"),0,prismGains[band],ParameterInfo::kCanAutomate,kPrismGainBaseId+static_cast<ParamID>(band));
        parameters.addParameter(q.text16(),nullptr,0,prismQs[band],ParameterInfo::kCanAutomate,kPrismQBaseId+static_cast<ParamID>(band));
        parameters.addParameter(enabled.text16(),nullptr,1,prismEnabled[band]?1:0,ParameterInfo::kCanAutomate,kPrismEnabledBaseId+static_cast<ParamID>(band));
    }}
    for(size_t i=0;i<project::kControls.size();++i){
        const auto&control=project::kControls[i];
        moduleControlValues[i]=control.value;
        if(control.moduleIndex<0||!isModuleControlKind(control.kind)||isPrismContextParameter(control.parameter))continue;
        String title(project::kDspModules[static_cast<size_t>(control.moduleIndex)].name,kCP_Utf8);title.append(STR16(" · "));String label(control.label,kCP_Utf8);title.append(label.text16());
        const int32 steps=!std::strcmp(control.kind,"button")||!std::strcmp(control.kind,"mute")||!std::strcmp(control.kind,"solo")?1:0;
        parameters.addParameter(title.text16(),nullptr,steps,control.value,ParameterInfo::kCanAutomate,kModuleControlBaseId+static_cast<ParamID>(i));
    }
    for(size_t i=0;i<project::kGroups.size();++i) {
        String name(project::kGroups[i].name, kCP_Utf8); String volumeName(name); volumeName.append(STR16(" Volume"));
        String panName(name); panName.append(STR16(" Pan")); String muteName(name); muteName.append(STR16(" Mute")); String soloName(name); soloName.append(STR16(" Solo"));
        parameters.addParameter(volumeName.text16(), STR16("%"),0,project::kGroups[i].volume,ParameterInfo::kCanAutomate,groupParameterId(static_cast<int>(i),0));
        parameters.addParameter(panName.text16(),nullptr,0,(project::kGroups[i].pan+1)*.5,ParameterInfo::kCanAutomate,groupParameterId(static_cast<int>(i),1));
        parameters.addParameter(muteName.text16(),nullptr,1,project::kGroups[i].mute?1:0,ParameterInfo::kCanAutomate,groupParameterId(static_cast<int>(i),2));
        parameters.addParameter(soloName.text16(),nullptr,1,project::kGroups[i].solo?1:0,ParameterInfo::kCanAutomate,groupParameterId(static_cast<int>(i),3));
        String outputName(name); outputName.append(STR16(" Output")); auto* outputParameter=new StringListParameter(outputName.text16(),groupOutputParameterId(static_cast<int>(i)),nullptr,ParameterInfo::kCanAutomate);
        outputParameter->appendString(STR16("Master"));const auto separateLabel=std::string("Out")+std::to_string(project::kGroups[i].outputBusIndex);String separateName(separateLabel.c_str(),kCP_Utf8);outputParameter->appendString(separateName.text16());
        const auto outputDefault=project::kGroupOutputSeparateDefaults[i]?1.:0.;outputParameter->getInfo().defaultNormalizedValue=outputDefault;outputParameter->setNormalized(outputDefault);parameters.addParameter(outputParameter);
        groupVolumes[i]=project::kGroups[i].volume; groupPans[i]=project::kGroups[i].pan; groupMutes[i]=project::kGroups[i].mute; groupSolos[i]=project::kGroups[i].solo;groupOutputBuses[i]=project::kGroupOutputSeparateDefaults[i]?project::kGroups[i].outputBusIndex:0;
    }
    loadResources(); resetDsp(); applyCustomImpulses(); return result;
}
tresult PLUGIN_API NativeInstrument::setActive(TBool state){ for(auto& v:voices)v={};for(auto&v:oscillatorVoices)v={};hasLastWavePitch=false;for(auto&stretch:tempoStretchers)if(stretch&&stretch->configured)stretch->restart(0);for(auto&note:activeMidiNotes)note.store(0,std::memory_order_relaxed);audioGrooveIndex=-1;audioGrooveTranspose=0;audioGrooveVelocity=127;grooveActive.store(-1,std::memory_order_relaxed);grooveCommand.store(-2,std::memory_order_relaxed);liveTriggerPitch.store(-1,std::memory_order_relaxed);grooveHeldNotes.fill(0);sustain=project::kDefaultSustain;pitchBend=smoothedPitchBend=.5f;modulation=0;modulationPhase=0;hostTempoBpm=smoothedTempoBpm=project::kFallbackTempoBpm;if(state&&!project::kIsEffect&&std::none_of(samples.begin(),samples.end(),[](const auto&s){return!s.empty();}))loadResources();if(!state){resetDsp();applyCustomImpulses();} return SingleComponentEffect::setActive(state); }
tresult PLUGIN_API NativeInstrument::setBusArrangements(SpeakerArrangement* in,int32 ni,SpeakerArrangement* out,int32 no){bool validOutput=no==project::kAudioOutputBusCount&&out;for(int32 index=0;validOutput&&index<no;++index)validOutput=out[index]==SpeakerArr::kStereo;const bool validInput=project::kIsEffect?ni==1&&in&&in[0]==SpeakerArr::kStereo:ni==0;return validInput&&validOutput?SingleComponentEffect::setBusArrangements(in,ni,out,no):kResultFalse;}
tresult PLUGIN_API NativeInstrument::canProcessSampleSize(int32 size){ return size==kSample32?kResultTrue:kResultFalse; }
uint32 PLUGIN_API NativeInstrument::getTailSamples(){
    if constexpr(project::kIsPrismEq)return 0;
    if constexpr(project::kIsEffect){
        const bool hasDelay=project::kDspModules.empty()||std::any_of(project::kDspModules.begin(),project::kDspModules.end(),[](const auto&module){return module.type&&(!std::strcmp(module.type,"cross_delay")||!std::strcmp(module.type,"digital_delay")||!std::strcmp(module.type,"reverb")||!std::strcmp(module.type,"shimmer"));});
        if(hasDelay)return static_cast<uint32>(std::clamp(hostSampleRate*120.0,0.0,static_cast<double>(std::numeric_limits<uint32>::max())));
        return 0;
    }
    if constexpr(project::kDefaultSustain)return std::numeric_limits<uint32>::max();
    return static_cast<uint32>(std::clamp(hostSampleRate*12.0,0.0,static_cast<double>(std::numeric_limits<uint32>::max())));
}
tresult PLUGIN_API NativeInstrument::setupProcessing(ProcessSetup& setup){ if(setup.sampleRate<=0)return kInvalidArgument; hostSampleRate=setup.sampleRate;hostTempoBpm=smoothedTempoBpm=project::kFallbackTempoBpm;prepareTempoStretchers();resetDsp();applyCustomImpulses(); return SingleComponentEffect::setupProcessing(setup); }

void NativeInstrument::prepareTempoStretchers(){
    if constexpr(project::kIsEffect)return;
    const bool needsTempo=std::any_of(project::kZones.begin(),project::kZones.end(),[](const auto&zone){return zone.tempoSync;});
    if(!needsTempo)return;
    for(size_t index=0;index<tempoStretchers.size();++index){
        if(!tempoStretchers[index])tempoStretchers[index]=std::make_unique<TempoStretchState>(static_cast<long>(0x5453+index));
        tempoStretchers[index]->configure(hostSampleRate);
    }
}

ParamID NativeInstrument::parameterFor(const char* name) const noexcept {
    if(!name)return kNoParamId; if(!std::strcmp(name,"volume"))return kVolumeId; if(!std::strcmp(name,"tone"))return kToneId;
    if(!std::strcmp(name,"attack"))return kAttackId; if(!std::strcmp(name,"release"))return kReleaseId; if(!std::strcmp(name,"space"))return kSpaceId;
    if(!std::strcmp(name,"input"))return kInputId;if(!std::strcmp(name,"drive"))return kDriveId;if(!std::strcmp(name,"compress"))return kCompressId;
    if(!std::strcmp(name,"width"))return kWidthId;if(!std::strcmp(name,"mix"))return kMixId;if(!std::strcmp(name,"output"))return kOutputId;if(!std::strcmp(name,"pan"))return kPanId;if(!std::strcmp(name,"bypass"))return kBypassId;
    if(!std::strcmp(name,"mute"))return kMuteId; if(!std::strcmp(name,"solo"))return kSoloId; if(!std::strcmp(name,"articulation"))return kArticulationId; if(!std::strcmp(name,"mic_position"))return kMicId;
    if(!std::strcmp(name,"pitch_bend"))return project::kPitchBendEnabled?kPitchBendId:kNoParamId; if(!std::strcmp(name,"modulation"))return project::kModulationEnabled?kModulationId:kNoParamId;
    for(size_t i=0;i<project::kGroups.size();++i){ std::string p="group_"+std::to_string(i)+"_"; if(p+"volume"==name)return groupParameterId(i,0); if(p+"pan"==name)return groupParameterId(i,1); if(p+"mute"==name)return groupParameterId(i,2); if(p+"solo"==name)return groupParameterId(i,3); if(p+"output"==name)return groupOutputParameterId(i); }
    return kNoParamId;
}
ParamID NativeInstrument::parameterForControl(size_t index) const noexcept {
    if(index>=project::kControls.size())return kNoParamId;
    const auto&control=project::kControls[index];
    if(isPrismContextParameter(control.parameter))return kNoParamId;
    if(control.samplerGroupIndex>=0){if(!std::strcmp(control.parameter,"volume"))return groupParameterId(control.samplerGroupIndex,0);if(!std::strcmp(control.parameter,"pan"))return groupParameterId(control.samplerGroupIndex,1);if(!std::strcmp(control.parameter,"mute"))return groupParameterId(control.samplerGroupIndex,2);if(!std::strcmp(control.parameter,"solo"))return groupParameterId(control.samplerGroupIndex,3);}
    if(control.moduleIndex>=0&&isModuleControlKind(control.kind))return kModuleControlBaseId+static_cast<ParamID>(index);
    return parameterFor(control.parameter);
}
ParamID NativeInstrument::prismParameterFor(int band,int slot) const noexcept {
    if((!project::kIsPrismEq&&!project::kHasPrismModule)||band<0||band>=5)return kNoParamId;
    if(slot==0)return kPrismFrequencyBaseId+static_cast<ParamID>(band);
    if(slot==2)return kPrismQBaseId+static_cast<ParamID>(band);
    if(slot!=1||band==0)return kNoParamId;
    if constexpr(project::kHasPrismModule)return kPrismGainBaseId+static_cast<ParamID>(band);
    constexpr ParamID gainIds[]={kToneId,kDriveId,kCompressId,kWidthId,kSpaceId};
    return gainIds[band];
}
float NativeInstrument::prismBandValue(int band,int slot) const noexcept {
    if(band<0||band>=5)return .5f;
    const auto index=static_cast<size_t>(band);
    if(slot==0)return prismFrequencies[index];
    if(slot==2)return prismQs[index];
    if(slot!=1||band==0)return .5f;
    if constexpr(project::kHasPrismModule)return prismGains[index];
    switch(band){case 1:return drive;case 2:return compress;case 3:return width;case 4:return space;default:return .5f;}
}
bool NativeInstrument::prismBandEnabled(int band) const noexcept {
    return (project::kIsPrismEq||project::kHasPrismModule)&&band>=0&&band<5&&prismEnabled[static_cast<size_t>(band)];
}
float NativeInstrument::gainReduction(int moduleIndex) const noexcept {
    if(moduleIndex>=0&&moduleIndex<static_cast<int>(compressorGainReductions.size()))return compressorGainReductions[static_cast<size_t>(moduleIndex)].load(std::memory_order_relaxed);
    float maximum=0;for(const auto&value:compressorGainReductions)maximum=std::max(maximum,value.load(std::memory_order_relaxed));return maximum;
}
void NativeInstrument::applyModuleControl(size_t index,float value) noexcept {
    if(index>=project::kControls.size())return;
    const auto&control=project::kControls[index];
    if(control.moduleIndex<0||control.moduleIndex>=static_cast<int>(project::kDspModules.size()))return;
    moduleControlValues[index]=clamp01(value);
    applyModulePresetValue(static_cast<size_t>(control.moduleIndex),control.parameter,value);
}
void NativeInstrument::applyPrismRackParameter(int band,int slot,float value) noexcept {
    if constexpr(!project::kHasPrismModule)return;
    if(band<0||band>=5||project::kPrismModuleIndex<0)return;
    const char* suffix=slot==0?"frequency":slot==1?"gain":slot==2?"q":"enabled";
    const auto key="band_"+std::to_string(band+1)+"_"+suffix;
    applyModulePresetValue(static_cast<size_t>(project::kPrismModuleIndex),key.c_str(),value);
}
dsp::EffectRack& NativeInstrument::rackForModule(size_t moduleIndex) noexcept {
    const int group=moduleIndex<project::kDspModules.size()?project::kDspModules[moduleIndex].groupIndex:-1;
    return group>=0&&group<static_cast<int>(groupEffectRacks.size())?groupEffectRacks[static_cast<size_t>(group)]:effectRack;
}
const dsp::EffectRack& NativeInstrument::rackForModule(size_t moduleIndex) const noexcept {
    const int group=moduleIndex<project::kDspModules.size()?project::kDspModules[moduleIndex].groupIndex:-1;
    return group>=0&&group<static_cast<int>(groupEffectRacks.size())?groupEffectRacks[static_cast<size_t>(group)]:effectRack;
}
void NativeInstrument::applyModulePresetValue(size_t moduleIndex,const char*parameter,float value) noexcept {
    if(moduleIndex>=project::kDspModules.size()||!parameter||!std::isfinite(value))return;
    const float rawValue=value;value=clamp01(value);
    if(!std::strcmp(parameter,"bypass"))moduleBypassValues[moduleIndex].store(value>=.5f,std::memory_order_relaxed);
    else if(!std::strcmp(parameter,"module_mix"))moduleMixValues[moduleIndex].store(value,std::memory_order_relaxed);
    else for(size_t i=0;i<project::kDspParameters.size();++i)if(project::kDspParameters[i].moduleIndex==static_cast<int>(moduleIndex)&&!std::strcmp(project::kDspParameters[i].key,parameter)){moduleParameterValues[i].store(rawValue,std::memory_order_relaxed);break;}
    if(!std::strcmp(project::kDspModules[moduleIndex].type,"wave_generator")){
        if(!std::strcmp(parameter,"bypass")){waveEnabled=value<.5f;return;}
        if(!std::strcmp(parameter,"module_mix")){waveMix=value;return;}
        if(!std::strcmp(parameter,"waveform"))waveShape=std::min(4,static_cast<int>(std::lround(value*4)));
        else if(!std::strcmp(parameter,"octave"))waveOctave=std::lround(value*4)-2;
        else if(!std::strcmp(parameter,"semitone"))waveSemitone=std::lround(value*24)-12;
        else if(!std::strcmp(parameter,"fine"))waveFineCents=value*200-100;
        else if(!std::strcmp(parameter,"level"))waveLevel=value;
        else if(!std::strcmp(parameter,"pulse_width"))wavePulseWidth=.05f+value*.9f;
        else if(!std::strcmp(parameter,"phase_reset"))wavePhaseReset=value>=.5f;
        else if(!std::strcmp(parameter,"voice_mode"))waveMono=value>=.5f;
        else if(!std::strcmp(parameter,"retrigger"))waveRetrigger=value>=.5f;
        else if(!std::strcmp(parameter,"attack"))waveAttack=value;
        else if(!std::strcmp(parameter,"decay"))waveDecay=value;
        else if(!std::strcmp(parameter,"sustain"))waveSustain=value;
        else if(!std::strcmp(parameter,"release"))waveRelease=value;
        else if(!std::strcmp(parameter,"velocity_sensitivity"))waveVelocitySensitivity=value;
        else if(!std::strcmp(parameter,"velocity_curve"))waveVelocityCurve=value;
        else if(!std::strcmp(parameter,"velocity_min_level"))waveVelocityMinLevel=value;
        else if(!std::strcmp(parameter,"filter_cutoff"))waveFilterCutoff=value;
        else if(!std::strcmp(parameter,"filter_resonance"))waveFilterResonance=value;
        else if(!std::strcmp(parameter,"filter_env_amount"))waveFilterEnvAmount=value;
        else if(!std::strcmp(parameter,"filter_key_tracking"))waveFilterKeyTracking=value;
        else if(!std::strcmp(parameter,"osc2_enabled"))waveOsc2Enabled=value>=.5f;
        else if(!std::strcmp(parameter,"osc2_waveform"))waveOsc2Shape=std::min(4,static_cast<int>(std::lround(value*4)));
        else if(!std::strcmp(parameter,"osc2_octave"))waveOsc2Octave=std::lround(value*4)-2;
        else if(!std::strcmp(parameter,"osc2_detune"))waveOsc2Detune=value*200-100;
        else if(!std::strcmp(parameter,"osc2_level"))waveOsc2Level=value;
        else if(!std::strcmp(parameter,"osc2_pulse_width"))waveOsc2PulseWidth=.05f+value*.9f;
        else if(!std::strcmp(parameter,"sub_level"))waveSubLevel=value;
        else if(!std::strcmp(parameter,"noise_level"))waveNoiseLevel=value;
        else if(!std::strcmp(parameter,"noise_color"))waveNoiseColor=std::min(2,static_cast<int>(std::floor(value*3)));
        else if(!std::strcmp(parameter,"unison_voices"))waveUnisonVoices=1+std::lround(value*7);
        else if(!std::strcmp(parameter,"unison_detune"))waveUnisonDetune=value;
        else if(!std::strcmp(parameter,"stereo_spread"))waveStereoSpread=value;
        else if(!std::strcmp(parameter,"glide"))waveGlide=value;
        else if(!std::strcmp(parameter,"glide_mode"))waveGlideMode=value;
        else if(!std::strcmp(parameter,"vibrato_rate"))waveVibratoRate=value;
        else if(!std::strcmp(parameter,"vibrato_depth"))waveVibratoDepth=value;
        else if(!std::strcmp(parameter,"vibrato_delay"))waveVibratoDelay=value;
        return;
    }
    if(!std::strcmp(project::kDspModules[moduleIndex].type,"tuning")){
        configureGlobalTuning();
        return;
    }
    auto&rack=rackForModule(moduleIndex);const auto rackIndex=static_cast<size_t>(project::kDspModules[moduleIndex].rackIndex);
    if(!std::strcmp(parameter,"bypass")){rack.setModuleBypassed(rackIndex,value>=.5f);return;}
    if(!std::strcmp(parameter,"module_mix")){rack.setModuleMix(rackIndex,value);return;}
    const auto type=rackModuleType(project::kDspModules[moduleIndex].type);
    if(isPrimaryRackParameter(type,parameter))rack.setModuleNormalized(rackIndex,value);
    else rack.setModuleParameter(rackIndex,parameter,!std::strcmp(parameter,"gain_db")?rawValue:value);
}
float NativeInstrument::modulePresetValue(size_t moduleIndex,const char*parameter) const noexcept {
    if(moduleIndex>=project::kDspModules.size()||!parameter)return 0;
    if(!std::strcmp(parameter,"bypass"))return moduleBypassValues[moduleIndex].load(std::memory_order_relaxed)?1.f:0.f;
    if(!std::strcmp(parameter,"module_mix"))return moduleMixValues[moduleIndex].load(std::memory_order_relaxed);
    for(size_t i=0;i<project::kDspParameters.size();++i)if(project::kDspParameters[i].moduleIndex==static_cast<int>(moduleIndex)&&!std::strcmp(project::kDspParameters[i].key,parameter))return moduleParameterValues[i].load(std::memory_order_relaxed);
    return 0;
}
void NativeInstrument::applyParameterValue(ParamID id,float v) noexcept {
    v=clamp01(v);
    if(id>=kPrismFrequencyBaseId&&id<kPrismFrequencyBaseId+5){const int band=static_cast<int>(id-kPrismFrequencyBaseId);prismFrequencies[static_cast<size_t>(band)]=v;applyPrismRackParameter(band,0,v);}
    else if(id>=kPrismQBaseId&&id<kPrismQBaseId+5){const int band=static_cast<int>(id-kPrismQBaseId);prismQs[static_cast<size_t>(band)]=v;applyPrismRackParameter(band,2,v);}
    else if(id>=kPrismGainBaseId&&id<kPrismGainBaseId+5){const int band=static_cast<int>(id-kPrismGainBaseId);prismGains[static_cast<size_t>(band)]=v;applyPrismRackParameter(band,1,v);}
    else if(id>=kPrismEnabledBaseId&&id<kPrismEnabledBaseId+5){const int band=static_cast<int>(id-kPrismEnabledBaseId);prismEnabled[static_cast<size_t>(band)]=v>=.5f;applyPrismRackParameter(band,3,v);}
    else if(id==kVolumeId){volume=v;instrumentMasterGain.setNormalized(v);}
    else if(id==kToneId){tone=v;effectRack.setTone(v);instrumentSaturation.setNormalized(v);}
    else if(id==kAttackId)attack=v;
    else if(id==kReleaseId)releaseAmount=v;
    else if(id==kSpaceId){space=v;effectRack.setSpace(v);instrumentChorus.setNormalized(v);instrumentDelay.setNormalized(v);instrumentReverb.setNormalized(v);}
    else if(id==kPitchBendId&&project::kPitchBendEnabled)pitchBend=v;
    else if(id==kModulationId&&project::kModulationEnabled)modulation=v;
    else if(id==kInputId){input=v;effectInputTrim.setNormalized(v);effectRack.setInput(v);}
    else if(id==kDriveId){drive=v;effectRack.setDrive(v);}
    else if(id==kCompressId){compress=v;effectRack.setCompress(v);}
    else if(id==kWidthId){width=v;effectRack.setWidth(v);}
    else if(id==kMixId){mix=v;effectMix.setNormalized(v);effectRack.setDryWet(v);}
    else if(id==kOutputId){output=v;effectOutputTrim.setNormalized(v);effectRack.setOutput(v);}
    else if(id==kPanId){pan=v;masterPan.setTarget(v);}
    else if(id==kBypassId){bypass=v>=.5f;effectBypassMix.setTarget(bypass?1.0f:0.0f);}
    else if(id==kSustainId)setSustain(v>=.5f);
    else if(id==kMuteId)mute=hasControlParameter("mute")&&v>=.5f;
    else if(id==kSoloId)solo=hasControlParameter("solo")&&v>=.5f;
    else if(id==kArticulationId&&!project::kArticulations.empty())articulation=std::min<int>(project::kArticulations.size()-1,std::lround(v*std::max<int>(0,project::kArticulations.size()-1)));
    else if(id==kMicId&&!project::kMicPositions.empty())mic=std::min<int>(project::kMicPositions.size()-1,std::lround(v*std::max<int>(0,project::kMicPositions.size()-1)));
    else if(id>=kModuleControlBaseId&&id<kModuleControlBaseId+project::kControls.size())applyModuleControl(static_cast<size_t>(id-kModuleControlBaseId),v);
    else if(id>=kGroupOutputBaseId&&id<kGroupOutputBaseId+project::kGroups.size()){const int g=static_cast<int>(id-kGroupOutputBaseId);groupOutputBuses[static_cast<size_t>(g)]=v>=.5f?project::kGroups[static_cast<size_t>(g)].outputBusIndex:0;}
    else if(id>=kGroupBaseId&&id<kGroupBaseId+project::kGroups.size()*4){int g=(id-kGroupBaseId)/4,s=(id-kGroupBaseId)%4;if(g>=0&&g<(int)project::kGroups.size()){if(s==0)groupVolumes[g]=v;else if(s==1)groupPans[g]=v*2-1;else if(s==2){groupMutes[g]=v>=.5f;if(groupMutes[g])groupSolos[g]=false;}else groupSolos[g]=v>=.5f&&!groupMutes[g];}}
}
void NativeInstrument::applyParameterChanges(IParameterChanges* changes){
    if(!changes)return;
    for(int32 i=0;i<changes->getParameterCount();++i){
        auto*q=changes->getParameterData(i);if(!q)continue;
        ParamValue value=0;int32 offset=0;
        for(int32 p=0;p<q->getPointCount();++p)if(q->getPoint(p,offset,value)==kResultTrue)applyParameterValue(q->getParameterId(),clamp01(value));
    }
}
void NativeInstrument::applyEventsAt(IEventList* events,int32& index,int offset){if(!events)return;while(index<events->getEventCount()){Event e{};if(events->getEvent(index,e)!=kResultOk){++index;continue;}if(e.sampleOffset>offset)break;if(e.type==Event::kNoteOnEvent){const int velocity=std::clamp((int)std::lround(e.noteOn.velocity*127),1,127);if(!routeLivePatternNote(e.noteOn.pitch,velocity,true))noteOn(e.noteOn.pitch,velocity,e.noteOn.noteId);setMidiNoteActive(e.noteOn.pitch,true);}else if(e.type==Event::kNoteOffEvent){if(!routeLivePatternNote(e.noteOff.pitch,0,false))noteOff(e.noteOff.pitch,e.noteOff.noteId);setMidiNoteActive(e.noteOff.pitch,false);}++index;}}
bool NativeInstrument::isNoteActive(int pitch) const noexcept {return pitch>=0&&pitch<static_cast<int>(activeMidiNotes.size())&&activeMidiNotes[static_cast<size_t>(pitch)].load(std::memory_order_relaxed)>0;}
unsigned NativeInstrument::noteTriggerCount(int pitch) const noexcept {return pitch>=0&&pitch<static_cast<int>(noteTriggers.size())?noteTriggers[static_cast<size_t>(pitch)].load(std::memory_order_relaxed):0;}
void NativeInstrument::setMidiNoteActive(int pitch,bool on) noexcept {if(pitch<0||pitch>=static_cast<int>(activeMidiNotes.size()))return;auto&count=activeMidiNotes[static_cast<size_t>(pitch)];if(on){count.fetch_add(1,std::memory_order_relaxed);return;}auto current=count.load(std::memory_order_relaxed);while(current>0&&!count.compare_exchange_weak(current,current-1,std::memory_order_relaxed,std::memory_order_relaxed)){} }
void NativeInstrument::queueEditorNote(int pitch,int velocity,bool on,int samplerGroup) noexcept {unsigned w=uiWrite.load(std::memory_order_relaxed),next=(w+1)%uiNotes.size();if(next==uiRead.load(std::memory_order_acquire))return;uiNotes[w]={std::clamp(pitch,0,127),std::clamp(velocity,1,127),on,samplerGroup};uiWrite.store(next,std::memory_order_release);}
void NativeInstrument::drainEditorNotes(){unsigned r=uiRead.load(std::memory_order_relaxed),w=uiWrite.load(std::memory_order_acquire);while(r!=w){auto n=uiNotes[r];if(!routeLivePatternNote(n.pitch,n.velocity,n.on)){const int noteId=-1000-n.pitch-128*(n.samplerGroup+1);if(n.on)noteOn(n.pitch,n.velocity,noteId,n.samplerGroup);else noteOff(n.pitch,noteId,n.samplerGroup);}setMidiNoteActive(n.pitch,n.on);r=(r+1)%uiNotes.size();}uiRead.store(r,std::memory_order_release);}
void NativeInstrument::startGroove(int sequence,bool loop) noexcept {if(sequence<0||sequence>=static_cast<int>(project::kMidiSequences.size()))return;for(auto&note:liveChordNotes)note.store(0,std::memory_order_relaxed);grooveTranspose.store(0,std::memory_order_relaxed);grooveVelocity.store(127,std::memory_order_relaxed);grooveLiveTrigger.store(false,std::memory_order_relaxed);liveTriggerPitch.store(-1,std::memory_order_relaxed);grooveLoop.store(loop,std::memory_order_relaxed);grooveActive.store(sequence,std::memory_order_relaxed);grooveCommand.store(sequence,std::memory_order_release);}
void NativeInstrument::stopGroove() noexcept {grooveActive.store(-1,std::memory_order_relaxed);grooveCommand.store(-1,std::memory_order_release);}
void NativeInstrument::setGrooveLoop(bool loop) noexcept {grooveLoop.store(loop,std::memory_order_relaxed);}
void NativeInstrument::setLivePatternSequence(int sequence) noexcept {if(sequence>=0&&(sequence>=static_cast<int>(project::kMidiSequences.size())||project::kMidiSequences[static_cast<size_t>(sequence)].triggerRootPitch<0))return;if(sequence!=livePatternSequence.load(std::memory_order_relaxed)){for(auto&note:liveChordNotes)note.store(0,std::memory_order_relaxed);liveTriggerPitch.store(-1,std::memory_order_relaxed);stopGroove();}livePatternSequence.store(sequence,std::memory_order_relaxed);if(sequence<0){for(auto&note:liveChordNotes)note.store(0,std::memory_order_relaxed);liveTriggerPitch.store(-1,std::memory_order_relaxed);stopGroove();}}
bool NativeInstrument::routeLivePatternNote(int pitch,int velocity,bool on) noexcept {const int sequence=livePatternSequence.load(std::memory_order_relaxed);if(sequence<0||sequence>=static_cast<int>(project::kMidiSequences.size()))return false;const auto&pattern=project::kMidiSequences[static_cast<size_t>(sequence)];if(pattern.triggerRootPitch<0)return false;if(pattern.relativeChord){if(pitch<0||pitch>=128)return true;auto&count=liveChordNotes[static_cast<size_t>(pitch)];if(on)count.fetch_add(1,std::memory_order_relaxed);else{auto current=count.load(std::memory_order_relaxed);while(current>0&&!count.compare_exchange_weak(current,current-1,std::memory_order_relaxed,std::memory_order_relaxed)){}}int root=-1;for(int note=0;note<128;++note)if(liveChordNotes[static_cast<size_t>(note)].load(std::memory_order_relaxed)>0){root=note;break;}if(root>=0){liveTriggerPitch.store(root,std::memory_order_relaxed);grooveTranspose.store(root-pattern.triggerRootPitch,std::memory_order_relaxed);if(on)grooveVelocity.store(std::clamp(velocity,1,127),std::memory_order_relaxed);grooveLiveTrigger.store(true,std::memory_order_relaxed);grooveLoop.store(pattern.loopEnabled,std::memory_order_relaxed);grooveActive.store(sequence,std::memory_order_relaxed);grooveCommand.store(sequence,std::memory_order_release);}else{liveTriggerPitch.store(-1,std::memory_order_relaxed);stopGroove();}return true;}if(on){liveTriggerPitch.store(pitch,std::memory_order_relaxed);grooveTranspose.store(pitch-pattern.triggerRootPitch,std::memory_order_relaxed);grooveVelocity.store(std::clamp(velocity,1,127),std::memory_order_relaxed);grooveLiveTrigger.store(true,std::memory_order_relaxed);grooveLoop.store(pattern.loopEnabled,std::memory_order_relaxed);grooveActive.store(sequence,std::memory_order_relaxed);grooveCommand.store(sequence,std::memory_order_release);}else if(liveTriggerPitch.load(std::memory_order_relaxed)==pitch){liveTriggerPitch.store(-1,std::memory_order_relaxed);stopGroove();}return true;}
void NativeInstrument::releaseGrooveNotes() noexcept {for(int pitch=0;pitch<128;++pitch){const auto held=grooveHeldNotes[static_cast<size_t>(pitch)];if(!held)continue;noteOff(pitch,1000000+pitch);for(unsigned count=0;count<held;++count)setMidiNoteActive(pitch,false);}grooveHeldNotes.fill(0);}
void NativeInstrument::applyGrooveCommand() noexcept {const int command=grooveCommand.exchange(-2,std::memory_order_acq_rel);if(command==-2)return;releaseGrooveNotes();audioGrooveIndex=-1;audioLiveChordPitchCount=0;grooveEventCursor=grooveTempoCursor=0;grooveTick=0;grooveBpm=120;if(command>=0&&command<static_cast<int>(project::kMidiSequences.size())){audioGrooveIndex=command;audioGrooveTranspose=grooveTranspose.load(std::memory_order_relaxed);audioGrooveVelocity=grooveVelocity.load(std::memory_order_relaxed);audioGrooveLiveTrigger=grooveLiveTrigger.load(std::memory_order_relaxed);if(project::kMidiSequences[static_cast<size_t>(command)].relativeChord)for(int pitch=0;pitch<128;++pitch)if(liveChordNotes[static_cast<size_t>(pitch)].load(std::memory_order_relaxed)>0)audioLiveChordPitches[static_cast<size_t>(audioLiveChordPitchCount++)]=pitch;grooveActive.store(command,std::memory_order_relaxed);}else grooveActive.store(-1,std::memory_order_relaxed);}
void NativeInstrument::processGrooveSample() noexcept {
    if(audioGrooveIndex<0)return;const auto&sequence=project::kMidiSequences[static_cast<size_t>(audioGrooveIndex)];
    while(grooveTempoCursor<static_cast<size_t>(sequence.tempoCount)){const auto&tempo=project::kMidiTempos[static_cast<size_t>(sequence.tempoOffset)+grooveTempoCursor];if(tempo.tick>grooveTick)break;grooveBpm=std::clamp(static_cast<double>(tempo.bpm),20.,400.);++grooveTempoCursor;}
    while(grooveEventCursor<static_cast<size_t>(sequence.eventCount)){const auto&event=project::kMidiEvents[static_cast<size_t>(sequence.eventOffset)+grooveEventCursor];if(event.tick>grooveTick)break;int pitch=event.note+audioGrooveTranspose;if(sequence.relativeChord&&event.relativeDegree>=-128&&audioLiveChordPitchCount>0){int octave=event.relativeDegree/audioLiveChordPitchCount,index=event.relativeDegree%audioLiveChordPitchCount;if(index<0){index+=audioLiveChordPitchCount;--octave;}pitch=audioLiveChordPitches[static_cast<size_t>(index)]+octave*12;}pitch=std::clamp(pitch,0,127);if(event.noteOn){const int velocity=std::clamp(static_cast<int>(std::lround(event.velocity*audioGrooveVelocity/127.f)),1,127);noteOn(pitch,velocity,1000000+pitch);if(grooveHeldNotes[static_cast<size_t>(pitch)]<255)++grooveHeldNotes[static_cast<size_t>(pitch)];setMidiNoteActive(pitch,true);}else if(!(audioGrooveLiveTrigger&&sequence.liveHold)){noteOff(pitch,1000000+pitch);if(grooveHeldNotes[static_cast<size_t>(pitch)]>0)--grooveHeldNotes[static_cast<size_t>(pitch)];setMidiNoteActive(pitch,false);}++grooveEventCursor;}
    grooveTick+=std::max(1,sequence.ppq)*grooveBpm/(60.*std::max(8000.,hostSampleRate));if(grooveTick<std::max(1,sequence.durationTicks))return;
    if(audioGrooveLiveTrigger&&sequence.liveHold){grooveTick=std::max(1,sequence.durationTicks);return;}releaseGrooveNotes();if(grooveLoop.load(std::memory_order_relaxed)){grooveTick=0;grooveBpm=120;grooveEventCursor=grooveTempoCursor=0;}else{audioGrooveIndex=-1;grooveActive.store(-1,std::memory_order_relaxed);}
}
NativeInstrument::Voice& NativeInstrument::acquireVoice(){auto free=std::find_if(voices.begin(),voices.end(),[](auto&v){return!v.active;});if(free!=voices.end())return*free;return*std::min_element(voices.begin(),voices.end(),[](auto&a,auto&b){return a.envelope==b.envelope?a.age<b.age:a.envelope<b.envelope;});}
NativeInstrument::OscVoice& NativeInstrument::acquireOscVoice(){auto free=std::find_if(oscillatorVoices.begin(),oscillatorVoices.end(),[](auto&v){return!v.active;});if(free!=oscillatorVoices.end())return*free;return*std::min_element(oscillatorVoices.begin(),oscillatorVoices.end(),[](auto&a,auto&b){return a.envelope==b.envelope?a.age<b.age:a.envelope<b.envelope;});}
void NativeInstrument::setWavePitchTarget(OscVoice&voice,double target,bool glide)noexcept{voice.targetPitch=target;const double seconds=2.*waveGlide*waveGlide;voice.glideSamplesRemaining=glide&&seconds>.0001?static_cast<std::uint64_t>(std::max(1.,std::round(seconds*hostSampleRate))):0;if(!voice.glideSamplesRemaining)voice.currentPitch=target;}
void NativeInstrument::noteOn(int pitch,int velocity,int32 noteId,int targetGroup){
    if(pitch>=0&&pitch<static_cast<int>(noteTriggers.size()))noteTriggers[static_cast<size_t>(pitch)].fetch_add(1,std::memory_order_relaxed);
    if(waveEnabled&&targetGroup<0){
        monoWaveVelocities[static_cast<size_t>(pitch)]=velocity;
        monoWaveAges[static_cast<size_t>(pitch)]=++voiceAge;
        const int selected=pitch;
        if(!waveMono||selected==pitch){
            const bool hadHeld=std::any_of(oscillatorVoices.begin(),oscillatorVoices.end(),[](const auto&voice){return voice.active&&voice.held;});
            auto existing=std::find_if(oscillatorVoices.begin(),oscillatorVoices.end(),[](auto&voice){return voice.active;});
            if(waveMono&&existing!=oscillatorVoices.end()&&!waveRetrigger){
                existing->held=true;existing->releasing=false;existing->noteId=noteId;existing->pitch=pitch;setWavePitchTarget(*existing,pitch,waveGlide>0&&(waveGlideMode<.5f||hadHeld));
                existing->gain=waveVelocityGain(velocity,waveVelocitySensitivity,waveVelocityCurve,waveVelocityMinLevel)*waveMix*.32f;existing->age=voiceAge;
            }else{
                if(waveMono)for(auto&voice:oscillatorVoices)voice.active=false;
                auto&osc=acquireOscVoice();osc={};osc.active=true;osc.held=true;osc.noteId=noteId;osc.pitch=pitch;
                const bool glide=waveGlide>0&&hasLastWavePitch&&(waveGlideMode<.5f||hadHeld);osc.currentPitch=glide?lastWavePitch:pitch;setWavePitchTarget(osc,pitch,glide);
                const double seed=wavePhaseReset?0.:std::fmod((voiceAge+pitch)*.61803398875,1.);osc.phase1.fill(seed);osc.phase2.fill(std::fmod(seed+.25,1.));osc.subPhase=seed;
                osc.gain=waveVelocityGain(velocity,waveVelocitySensitivity,waveVelocityCurve,waveVelocityMinLevel)*waveMix*.32f;osc.envelope=waveAttack<.0001f?1:0;osc.envelopeStage=waveAttack<.0001f?1:0;
                osc.noiseState=static_cast<std::uint32_t>(0x9e3779b9u^(pitch*2654435761u)^static_cast<unsigned>(noteId));if(!osc.noiseState)osc.noiseState=1;osc.age=voiceAge;
            }
            lastWavePitch=pitch;hasLastWavePitch=true;
        }
    }
    std::array<bool,128> chokePitches{};
    for(const auto&z:project::kZones)if((targetGroup<0||z.groupIndex==targetGroup)&&z.articulationIndex==articulation&&z.micIndex==mic&&pitch>=z.lowPitch&&pitch<=z.highPitch&&velocity>=z.velocityLow&&velocity<=z.velocityHigh){for(int i=0;i<z.chokeTargetCount;++i){const int target=z.chokeTargetPitches[static_cast<size_t>(i)];if(target>=0&&target<128&&target!=pitch)chokePitches[static_cast<size_t>(target)]=true;}}
    for(auto&v:voices)if(v.active&&v.pitch>=0&&v.pitch<128&&chokePitches[static_cast<size_t>(v.pitch)]){v.held=false;v.releasing=true;v.retriggerRelease=true;}
    for(auto&v:voices)if(v.active&&v.pitch==pitch&&v.zoneIndex>=0&&(project::kZones[v.zoneIndex].loopEnabled||project::kZones[v.zoneIndex].tempoSync)){v.held=false;v.releasing=true;v.retriggerRelease=true;}
    std::array<int,project::kGroups.size()> nearest{}; nearest.fill(128); int matchingGroups=0;
    for(auto&z:project::kZones)if((targetGroup<0||z.groupIndex==targetGroup)&&z.articulationIndex==articulation&&z.micIndex==mic&&pitch>=z.lowPitch&&pitch<=z.highPitch&&velocity>=z.velocityLow&&velocity<=z.velocityHigh) nearest[z.groupIndex]=std::min(nearest[z.groupIndex],std::abs(pitch-z.rootPitch));
    for(auto n:nearest)if(n<128)++matchingGroups;
    for(size_t g=0;g<nearest.size();++g){if(nearest[g]>=128)continue;int anchor=-1;
        for(size_t i=0;i<project::kZones.size();++i){auto&z=project::kZones[i];if(z.groupIndex==(int)g&&z.articulationIndex==articulation&&z.micIndex==mic&&pitch>=z.lowPitch&&pitch<=z.highPitch&&velocity>=z.velocityLow&&velocity<=z.velocityHigh&&std::abs(pitch-z.rootPitch)==nearest[g]){if(anchor<0||(z.velocityHigh-z.velocityLow)<(project::kZones[anchor].velocityHigh-project::kZones[anchor].velocityLow))anchor=(int)i;}}
        if(anchor<0)continue;auto set=project::kZones[anchor].roundRobinSet;std::array<int,project::kZones.size()> candidates{};int count=0;for(size_t i=0;i<project::kZones.size();++i){auto&z=project::kZones[i];if(z.roundRobinSet==set&&z.articulationIndex==articulation&&z.micIndex==mic&&pitch>=z.lowPitch&&pitch<=z.highPitch&&velocity>=z.velocityLow&&velocity<=z.velocityHigh)candidates[count++]=(int)i;}if(!count)continue;
        std::sort(candidates.begin(),candidates.begin()+count,[](int a,int b){auto&x=project::kZones[a];auto&y=project::kZones[b];return x.roundRobin==y.roundRobin?a<b:x.roundRobin<y.roundRobin;});int& cursor=roundRobin[static_cast<size_t>(set)*128+pitch];auto zi=candidates[cursor++%count];auto&z=project::kZones[zi];if(z.sampleIndex<0||z.sampleIndex>=(int)samples.size()||samples[z.sampleIndex].empty())continue;auto&s=samples[z.sampleIndex];auto&v=acquireVoice();const auto voiceIndex=static_cast<size_t>(&v-voices.data());float velocityGain=(velocity/127.f)*(velocity/127.f);v={};v.active=true;v.held=true;v.noteId=noteId;v.pitch=pitch;v.zoneIndex=zi;v.position=z.sampleStart*(s.frameCount()-1);v.increment=(s.sampleRate/hostSampleRate)*std::pow(2.0,(pitch-z.rootPitch+z.tuneSemitones+z.tuneCents/100.)/12.);v.gain=std::pow(10.f,z.gainDb/20.f)*velocityGain/std::sqrt((float)std::max(1,matchingGroups));v.envelope=attack<.0001f?1:0;v.age=++voiceAge;if(z.tempoSync&&voiceIndex<tempoStretchers.size()){if(!tempoStretchers[voiceIndex]){tempoStretchers[voiceIndex]=std::make_unique<TempoStretchState>(static_cast<long>(0x5453+voiceIndex));tempoStretchers[voiceIndex]->configure(hostSampleRate);}tempoStretchers[voiceIndex]->restart(v.position);}
    }}
void NativeInstrument::noteOff(int pitch,int32 noteId,int targetGroup){
    for(auto&v:voices)if(v.active&&(targetGroup<0||(v.zoneIndex>=0&&project::kZones[static_cast<size_t>(v.zoneIndex)].groupIndex==targetGroup))&&((noteId>=0&&v.noteId==noteId)||v.pitch==pitch)){v.held=false;if(!sustain)v.releasing=true;}
    if(targetGroup>=0)return;
    monoWaveVelocities[static_cast<size_t>(std::clamp(pitch,0,127))]=0;
    if(waveMono){
        int selected=-1;
        for(int candidate=0;candidate<128;++candidate){
            if(monoWaveVelocities[static_cast<size_t>(candidate)]<=0)continue;
            if(selected<0)selected=candidate;
            else if(monoWaveAges[static_cast<size_t>(candidate)]>monoWaveAges[static_cast<size_t>(selected)])selected=candidate;
        }
        auto current=std::find_if(oscillatorVoices.begin(),oscillatorVoices.end(),[](auto&voice){return voice.active;});
        if(current!=oscillatorVoices.end()&&selected>=0){current->pitch=selected;setWavePitchTarget(*current,selected,waveGlide>0);current->held=true;current->releasing=false;current->gain=waveVelocityGain(monoWaveVelocities[static_cast<size_t>(selected)],waveVelocitySensitivity,waveVelocityCurve,waveVelocityMinLevel)*waveMix*.32f;lastWavePitch=selected;}
        else if(current!=oscillatorVoices.end()){current->held=false;if(!sustain)current->releasing=true;}
        return;
    }
    for(auto&v:oscillatorVoices)if(v.active&&((noteId>=0&&v.noteId==noteId)||v.pitch==pitch)){v.held=false;if(!sustain)v.releasing=true;}
}
void NativeInstrument::setSustain(bool on) noexcept {const bool effective=project::kDefaultSustain||on;if(sustain==effective)return;sustain=effective;if(!sustain){for(auto&voice:voices)if(voice.active&&!voice.held)voice.releasing=true;for(auto&voice:oscillatorVoices)if(voice.active&&!voice.held)voice.releasing=true;}}
bool NativeInstrument::renderTempoVoiceFrame(Voice&voice,size_t voiceIndex,const project::ZoneInfo&zone,const WavFile&sample,float expressionSemitones,float&left,float&right){
    if(voiceIndex>=tempoStretchers.size()||!tempoStretchers[voiceIndex])return false;
    auto&state=*tempoStretchers[voiceIndex];
    if(!state.configured)state.configure(hostSampleRate);
    const double length=static_cast<double>(sample.frameCount());
    const double start=zone.sampleStart*(length-1),end=zone.sampleEnd*(length-1);
    const double loopStart=zone.loopStart*(length-1),loopEnd=zone.loopEnd*(length-1);
    const bool looping=zone.loopEnabled&&!voice.releasing&&loopEnd>loopStart;
    auto wrap=[&](double position){
        if(looping&&position>=loopEnd)return loopStart+std::fmod(position-loopStart,loopEnd-loopStart);
        return position;
    };
    auto read=[&](double position,int channel){
        if(position<start)return 0.f;
        position=wrap(position);
        if(position>=end||position<0)return 0.f;
        const auto frame=std::min<size_t>(sample.frameCount()-2,static_cast<size_t>(position));
        const float fraction=static_cast<float>(position-frame);
        const float a=sample.sample(frame,channel),b=sample.sample(frame+1,channel);
        float value=a+(b-a)*fraction;
        if(looping&&zone.loopCrossfadeMs>0){
            const double requested=zone.loopCrossfadeMs*sample.sampleRate/1000.;
            const double crossfade=std::min(requested,(loopEnd-loopStart)*.5);
            const double fadeStart=loopEnd-crossfade;
            if(crossfade>1&&position>=fadeStart&&position<loopEnd){
                const float mix=static_cast<float>((position-fadeStart)/crossfade);
                const double incoming=loopStart+(position-fadeStart);
                const auto incomingFrame=std::min<size_t>(sample.frameCount()-2,static_cast<size_t>(incoming));
                const float incomingFraction=static_cast<float>(incoming-incomingFrame);
                const float incomingValue=sample.sample(incomingFrame,channel)+(sample.sample(incomingFrame+1,channel)-sample.sample(incomingFrame,channel))*incomingFraction;
                value=value*std::cos(mix*pi*.5f)+incomingValue*std::sin(mix*pi*.5f);
            }
        }
        return value;
    };
    if(state.outputCursor>=state.outputCount){
        state.outputCursor=0;
        state.outputCount=0;
        state.nextPosition=wrap(state.nextPosition);
        if(!looping&&state.nextPosition>=end)return false;
        const double tempoRate=std::clamp(smoothedTempoBpm/static_cast<double>(zone.sourceBpm),1./15.,15.);
        const auto historyLength=static_cast<int>(state.history[0].size());
        const double sourcePerHostSample=sample.sampleRate/hostSampleRate;
        const double historyStart=state.nextPosition+(state.stretch.inputLatency()-historyLength)*sourcePerHostSample;
        for(int index=0;index<historyLength;++index){
            const double position=historyStart+index*sourcePerHostSample;
            state.history[0][static_cast<size_t>(index)]=read(position,0);
            state.history[1][static_cast<size_t>(index)]=read(position,sample.channels>1?1:0);
        }
        state.stretch.setTransposeSemitones(static_cast<float>(voice.pitch-zone.rootPitch+zone.tuneSemitones+zone.tuneCents/100.f+expressionSemitones),8000.f/static_cast<float>(hostSampleRate));
        state.stretch.seek(state.history,historyLength,tempoRate);
        int valid=TempoStretchState::kOutputChunk;
        for(int index=0;index<TempoStretchState::kOutputChunk;++index){
            state.positions[static_cast<size_t>(index)]=wrap(state.nextPosition);
            if(!looping&&state.nextPosition>=end){valid=index;break;}
            state.nextPosition+=tempoRate*sourcePerHostSample;
            state.nextPosition=wrap(state.nextPosition);
        }
        if(valid<=0)return false;
        state.stretch.process(state.history,0,state.output,TempoStretchState::kOutputChunk);
        state.outputCount=valid;
    }
    const auto cursor=state.outputCursor++;
    voice.position=state.positions[static_cast<size_t>(cursor)];
    left=state.output[0][static_cast<size_t>(cursor)];
    right=state.output[1][static_cast<size_t>(cursor)];
    return true;
}

void NativeInstrument::renderFrame(float&left,float&right,std::array<float,project::kGroups.size()>&groupLeft,std::array<float,project::kGroups.size()>&groupRight,std::array<float,project::kGroups.size()>&gp){bool anySolo=std::any_of(groupSolos.begin(),groupSolos.end(),[](bool v){return v;});float attackMs=5000*std::pow(attack,2.5f),releaseMs=10+9990*std::pow(releaseAmount,2.2f);float aStep=attackMs<=.01f?1:1000.f/(attackMs*hostSampleRate),rStep=1000.f/(releaseMs*hostSampleRate);if constexpr(project::kPitchBendEnabled){const float bendAlpha=static_cast<float>(1-std::exp(-1./(.003*hostSampleRate)));smoothedPitchBend+=bendAlpha*(pitchBend-smoothedPitchBend);}const float bendSemitones=project::kPitchBendEnabled?(smoothedPitchBend-.5f)*4.f:0.f;const float vibratoSemitones=project::kModulationEnabled?std::sin(modulationPhase)*modulation*.5f:0.f;const float globalTuning=globalTuningEnabled?globalTuneSemitones+globalFineCents/100.f:0.f;const float expressionSemitones=bendSemitones+vibratoSemitones+globalTuning;const double tempoAlpha=1-std::exp(-1./(.03*hostSampleRate));smoothedTempoBpm+=tempoAlpha*(hostTempoBpm-smoothedTempoBpm);if constexpr(project::kModulationEnabled){modulationPhase+=2.0*pi*5.0/hostSampleRate;if(modulationPhase>=2.0*pi)modulationPhase-=2.0*pi;}
    if(waveEnabled){for(auto&v:oscillatorVoices){if(!v.active)continue;v.noteSeconds+=static_cast<float>(1/hostSampleRate);if(v.releasing)v.envelopeStage=3;const float attackSeconds=5*std::pow(waveAttack,2.5f),decaySeconds=.01f+4.99f*std::pow(waveDecay,2.2f),releaseSeconds=.01f+9.99f*std::pow(waveRelease,2.2f);if(v.envelopeStage==0){v.envelope=attackSeconds<=.0001f?1.f:std::min(1.f,static_cast<float>(v.envelope+1.f/(attackSeconds*hostSampleRate)));if(v.envelope>=1)v.envelopeStage=1;}else if(v.envelopeStage==1){v.envelope=std::max(waveSustain,static_cast<float>(v.envelope-(1-waveSustain)/(decaySeconds*hostSampleRate)));if(v.envelope<=waveSustain)v.envelopeStage=2;}else if(v.envelopeStage==2)v.envelope=waveSustain;else v.envelope=std::max(0.f,static_cast<float>(v.envelope-1.f/(releaseSeconds*hostSampleRate)));if(v.envelopeStage==3&&v.envelope<=0){v.active=false;continue;}if(v.glideSamplesRemaining){v.currentPitch+=(v.targetPitch-v.currentPitch)/static_cast<double>(v.glideSamplesRemaining);if(!--v.glideSamplesRemaining)v.currentPitch=v.targetPitch;}else v.currentPitch=v.targetPitch;const float localVibrato=v.noteSeconds>=waveVibratoDelay*2?std::sin(2*pi*(.1f+waveVibratoRate*11.9f)*v.noteSeconds)*waveVibratoDepth:0;const double tune=waveOctave*12+waveSemitone+waveFineCents/100.;const double baseFrequency=440.*std::pow(2.,(v.currentPitch-69+tune+expressionSemitones+localVibrato)/12.);v.noiseState^=v.noiseState<<13;v.noiseState^=v.noiseState>>17;v.noiseState^=v.noiseState<<5;float noise=(static_cast<float>(v.noiseState)/static_cast<float>(std::numeric_limits<std::uint32_t>::max()))*2-1;if(waveNoiseColor==0){v.brown=(v.brown+.02f*noise)/1.02f;noise=v.brown*3.5f;}else if(waveNoiseColor==1){v.pink=.985f*v.pink+.15f*noise;noise=v.pink;}float voiceLeft=0,voiceRight=0;const int unison=std::clamp(waveUnisonVoices,1,8);for(int index=0;index<unison;++index){const float position=unison==1?0.f:(2.f*index/(unison-1)-1.f);const float detune=position*waveUnisonDetune*50/100;const double frequency=baseFrequency*std::pow(2.,detune/12.);const float increment=static_cast<float>(std::min(.49,frequency/hostSampleRate));float osc1=waveShape==4?noise:oscillatorSample(waveShape,static_cast<float>(v.phase1[index]),increment,wavePulseWidth);float mixed=osc1*waveLevel;if(waveOsc2Level>0){const double frequency2=frequency*std::pow(2.,(waveOsc2Octave*12+waveOsc2Detune/100)/12.);const float increment2=static_cast<float>(std::min(.49,frequency2/hostSampleRate));mixed+=(waveOsc2Shape==4?noise:oscillatorSample(waveOsc2Shape,static_cast<float>(v.phase2[index]),increment2,waveOsc2PulseWidth))*waveOsc2Level;v.phase2[index]+=frequency2/hostSampleRate;v.phase2[index]-=std::floor(v.phase2[index]);}const float pan=position*waveStereoSpread,angle=(pan+1)*pi/4;voiceLeft+=mixed*std::cos(angle)/std::sqrt(static_cast<float>(unison));voiceRight+=mixed*std::sin(angle)/std::sqrt(static_cast<float>(unison));v.phase1[index]+=frequency/hostSampleRate;v.phase1[index]-=std::floor(v.phase1[index]);}if(waveSubLevel>0){const double subFrequency=baseFrequency*.5;const float sub=std::sin(2*pi*static_cast<float>(v.subPhase))*waveSubLevel*.70710678f;voiceLeft+=sub;voiceRight+=sub;v.subPhase+=subFrequency/hostSampleRate;v.subPhase-=std::floor(v.subPhase);}if(waveNoiseLevel>0){voiceLeft+=noise*waveNoiseLevel*.70710678f;voiceRight+=noise*waveNoiseLevel*.70710678f;}const float envSemitones=(waveFilterEnvAmount-.5f)*96*v.envelope;const float tracked=20*std::pow(1000.f,waveFilterCutoff)*std::pow(2.f,((v.pitch-60)*waveFilterKeyTracking+envSemitones)/12.f);const float cutoff=std::clamp(tracked,20.f,static_cast<float>(hostSampleRate*.45)),alpha=1-std::exp(-2*pi*cutoff/static_cast<float>(hostSampleRate)),resonance=waveFilterResonance*.92f;float channels[]={voiceLeft,voiceRight};for(int channel=0;channel<2;++channel){v.filterInput[channel]+=alpha*(channels[channel]-v.filterInput[channel]+resonance*(v.filterInput[channel]-v.filterState[channel]));v.filterState[channel]+=alpha*(v.filterInput[channel]-v.filterState[channel]);channels[channel]=v.filterState[channel];}const float gain=v.gain*v.envelope;left+=channels[0]*gain;right+=channels[1]*gain;}}
    for(size_t group=0;group<groupOutputGains.size();++group)groupOutputGains[group].setTarget(!groupMutes[group]&&(!anySolo||groupSolos[group])?1.f:0.f);
    std::array<float,project::kGroups.size()> groupOutputLevels{};for(size_t group=0;group<groupOutputLevels.size();++group)groupOutputLevels[group]=groupOutputGains[group].next();
    for(size_t voiceIndex=0;voiceIndex<voices.size();++voiceIndex){auto&v=voices[voiceIndex];if(!v.active||v.zoneIndex<0)continue;auto&z=project::kZones[v.zoneIndex];auto&s=samples[z.sampleIndex];int g=z.groupIndex;const float groupExpressionSemitones=bendSemitones+vibratoSemitones+groupTuningSemitones[static_cast<size_t>(g)];const double groupExpressionRate=std::pow(2.0,groupExpressionSemitones/12.0);double length=(double)s.frameCount(),end=z.sampleEnd*(length-1),ls=z.loopStart*(length-1),le=z.loopEnd*(length-1);float sourceLeft=0,sourceRight=0;if(z.tempoSync){if(!renderTempoVoiceFrame(v,voiceIndex,z,s,groupExpressionSemitones,sourceLeft,sourceRight)){v.active=false;continue;}}else{if(z.loopEnabled&&!v.releasing&&le>ls&&v.position>=le)v.position=ls+std::fmod(v.position-ls,le-ls);if(v.position>=end){v.active=false;continue;}size_t frame=std::min<size_t>(s.frameCount()-2,(size_t)v.position);float frac=(float)(v.position-frame);auto read=[&](int c){float a=s.sample(frame,c),b=s.sample(frame+1,c);return a+(b-a)*frac;};sourceLeft=read(0);sourceRight=read(s.channels>1?1:0);}const float voiceReleaseStep=v.retriggerRelease?1.f/std::max(1.f,.008f*static_cast<float>(hostSampleRate)):rStep;v.envelope=v.releasing?std::max(0.f,v.envelope-voiceReleaseStep):std::min(1.f,v.envelope+aStep);if(v.releasing&&v.envelope<=0){v.active=false;continue;}double start=z.sampleStart*(length-1),fi=z.fadeInMs*s.sampleRate/1000.,fo=z.fadeOutMs*s.sampleRate/1000.;float trim=fi>0?std::clamp((float)((v.position-start)/fi),0.f,1.f):1;if(fo>0&&!z.loopEnabled)trim=std::min(trim,std::clamp((float)((end-v.position)/fo),0.f,1.f));float pan=std::clamp(z.pan+groupPans[g],-1.f,1.f),angle=(pan+1)*pi/4,gain=v.gain*groupVolumes[g]*v.envelope*trim*groupOutputLevels[g];float l=0,r=0;if(s.channels>1){float gl=pan>0?std::cos(pan*pi*.5f):1.f,gr=pan<0?std::cos(-pan*pi*.5f):1.f;l=sourceLeft*gain*gl;r=sourceRight*gain*gr;}else{l=sourceLeft*gain*std::cos(angle);r=sourceRight*gain*std::sin(angle);}groupLeft[static_cast<size_t>(g)]+=l;groupRight[static_cast<size_t>(g)]+=r;gp[g]=std::max(gp[g],std::max(std::abs(l),std::abs(r)));if(!z.tempoSync)v.position+=v.increment*groupExpressionRate;}}
void NativeInstrument::configureGlobalTuning(){
    tuningModule=-1;globalTuningEnabled=false;globalTuneSemitones=0;globalFineCents=0;groupTuningSemitones.fill(0);
    for(size_t index=0;index<project::kDspModules.size();++index){
        const auto&module=project::kDspModules[index];if(std::strcmp(module.type,"tuning")||module.groupIndex>=0||moduleBypassValues[index].load(std::memory_order_relaxed))continue;
        tuningModule=static_cast<int>(index);globalTuningEnabled=true;
        globalTuneSemitones=static_cast<float>(std::lround(modulePresetValue(index,"tuning")*48)-24);
        globalFineCents=modulePresetValue(index,"fine_tune")*200-100;break;
    }
    const float masterTuning=globalTuningEnabled?globalTuneSemitones+globalFineCents/100.f:0.f;groupTuningSemitones.fill(masterTuning);
    for(size_t index=0;index<project::kDspModules.size();++index){const auto&module=project::kDspModules[index];if(std::strcmp(module.type,"tuning")||module.groupIndex<0||module.groupIndex>=static_cast<int>(groupTuningSemitones.size())||moduleBypassValues[index].load(std::memory_order_relaxed))continue;groupTuningSemitones[static_cast<size_t>(module.groupIndex)]=static_cast<float>(std::lround(modulePresetValue(index,"tuning")*48)-24)+(modulePresetValue(index,"fine_tune")*200-100)/100.f;}
}
void NativeInstrument::configureWaveGenerator(){
    configureGlobalTuning();
    waveGeneratorModule=-1;
    waveEnabled=false;
    monoWaveVelocities.fill(0);
    monoWaveAges.fill(0);
    for(size_t index=0;index<project::kDspModules.size();++index){
        const auto&module=project::kDspModules[index];
        if(std::strcmp(module.type,"wave_generator"))continue;
        waveGeneratorModule=static_cast<int>(index);
        waveEnabled=!module.bypassed;
        waveMix=module.mix;
        auto p=[&](const char*key,float fallback){return projectModuleParameter(waveGeneratorModule,key,fallback);};
        waveShape=std::min(4,static_cast<int>(std::lround(p("waveform",0)*4)));
        waveOctave=std::lround(p("octave",.5f)*4)-2;
        waveSemitone=std::lround(p("semitone",.5f)*24)-12;
        waveFineCents=p("fine",.5f)*200-100;
        waveLevel=p("level",.65f);
        wavePulseWidth=.05f+p("pulse_width",.5f)*.9f;
        wavePhaseReset=p("phase_reset",1)>=.5f;
        waveMono=p("voice_mode",0)>=.5f;
        waveRetrigger=p("retrigger",1)>=.5f;
        waveAttack=p("attack",0);
        waveDecay=p("decay",.2f);
        waveSustain=p("sustain",1);
        waveRelease=p("release",.18f);
        waveVelocitySensitivity=p("velocity_sensitivity",1);
        waveVelocityCurve=p("velocity_curve",1);
        waveVelocityMinLevel=p("velocity_min_level",0);
        waveFilterCutoff=p("filter_cutoff",1);
        waveFilterResonance=p("filter_resonance",0);
        waveFilterEnvAmount=p("filter_env_amount",.5f);
        waveFilterKeyTracking=p("filter_key_tracking",0);
        waveOsc2Shape=std::min(4,static_cast<int>(std::lround(p("osc2_waveform",0)*4)));
        waveOsc2Octave=std::lround(p("osc2_octave",.5f)*4)-2;
        waveOsc2Detune=p("osc2_detune",.5f)*200-100;
        waveOsc2Level=p("osc2_level",0);
        // Older manifests predate the explicit switch; preserve their audible OSC2 state.
        waveOsc2Enabled=p("osc2_enabled",waveOsc2Level>0?1.f:0.f)>=.5f;
        if(!waveOsc2Enabled)waveOsc2Level=0;
        waveOsc2PulseWidth=.05f+p("osc2_pulse_width",.5f)*.9f;
        waveSubLevel=p("sub_level",0);
        waveNoiseLevel=p("noise_level",0);
        waveNoiseColor=std::min(2,static_cast<int>(std::floor(p("noise_color",.5f)*3)));
        waveUnisonVoices=1+std::lround(p("unison_voices",0)*7);
        waveUnisonDetune=p("unison_detune",.12f);
        waveStereoSpread=p("stereo_spread",0);
        waveGlide=p("glide",0);
        waveGlideMode=p("glide_mode",0);
        waveVibratoRate=p("vibrato_rate",.45f);
        waveVibratoDepth=p("vibrato_depth",0);
        waveVibratoDelay=p("vibrato_delay",0);
        break;
    }
}
void NativeInstrument::configureRack(dsp::EffectRack&rack,int groupIndex,const dsp::ProcessSpec&spec){
    std::vector<dsp::RackModuleConfig>modules;
    modules.reserve(project::kDspModules.size()?project::kDspModules.size():8);
    if(project::kDspModules.empty()&&groupIndex<0&&project::kIsEffect){
        modules={{dsp::RackModuleType::InputTrim,false,1,input,true},{dsp::RackModuleType::SoftClip,false,1,drive,true},{dsp::RackModuleType::LinkedCompressor,false,1,compress,true},{dsp::RackModuleType::ToneShaper,false,1,tone,true},{dsp::RackModuleType::StereoWidth,false,1,width,true},{dsp::RackModuleType::CrossDelay,false,1,space,true},{dsp::RackModuleType::DryWet,false,1,mix,true},{dsp::RackModuleType::OutputTrim,false,1,output,true}};
    }else for(const auto&module:project::kDspModules){
        if(module.groupIndex!=groupIndex)continue;
        const auto type=rackModuleType(module.type);float fallback=0;
        switch(type){case dsp::RackModuleType::InputTrim:fallback=input;break;case dsp::RackModuleType::SoftClip:fallback=drive;break;case dsp::RackModuleType::LinkedCompressor:fallback=compress;break;case dsp::RackModuleType::DeEsser:fallback=.55f;break;case dsp::RackModuleType::ParametricEq:fallback=.5f;break;case dsp::RackModuleType::MultibandCompressor:fallback=.65f;break;case dsp::RackModuleType::ToneShaper:fallback=tone;break;case dsp::RackModuleType::StereoWidth:fallback=width;break;case dsp::RackModuleType::CrossDelay:fallback=space;break;case dsp::RackModuleType::Chorus:case dsp::RackModuleType::Flanger:case dsp::RackModuleType::Tremolo:case dsp::RackModuleType::Vibrato:case dsp::RackModuleType::DigitalDelay:case dsp::RackModuleType::Reverb:case dsp::RackModuleType::Shimmer:fallback=.5f;break;case dsp::RackModuleType::DryWet:fallback=mix;break;case dsp::RackModuleType::OutputTrim:fallback=output;break;case dsp::RackModuleType::NoiseGate:case dsp::RackModuleType::AmpOverdrive:case dsp::RackModuleType::AmpModel:case dsp::RackModuleType::DualHighGain:case dsp::RackModuleType::SilkBloom:case dsp::RackModuleType::CabinetIr:case dsp::RackModuleType::Unknown:break;}
        bool follows=true;const float value=rackModuleValue(module,type,fallback,follows);modules.push_back({type,module.bypassed,module.mix,value,follows});
    }
    rack.configure(spec,modules);
    for(const auto&parameter:project::kDspParameters)if(parameter.moduleIndex>=0&&parameter.moduleIndex<static_cast<int>(project::kDspModules.size())&&project::kDspModules[static_cast<size_t>(parameter.moduleIndex)].groupIndex==groupIndex&&std::strcmp(parameter.key,"gain_db"))rack.setModuleParameter(static_cast<size_t>(project::kDspModules[static_cast<size_t>(parameter.moduleIndex)].rackIndex),parameter.key,clamp01(parameter.value));
}
void NativeInstrument::resetDsp(){
    configureWaveGenerator();filterLeft=filterRight=0;roundRobin.fill(0);prismLowCut.reset();prismLowBody.reset();prismMidFocus.reset();prismPresence.reset();prismAir.reset();
    instrumentUsesDspRack=!project::kIsEffect&&std::any_of(project::kDspModules.begin(),project::kDspModules.end(),[](const auto&module){return module.groupIndex<0&&module.type&&std::strcmp(module.type,"wave_generator")&&std::strcmp(module.type,"tuning");});
    const dsp::ProcessSpec spec{hostSampleRate,0};effectBypassMix.prepare(spec.sampleRate,10.0);effectBypassMix.reset(bypass?1.0f:0.0f);masterPan.prepare(spec.sampleRate,10.0);masterPan.reset(pan);
    const bool anyGroupSolo=std::any_of(groupSolos.begin(),groupSolos.end(),[](bool value){return value;});for(size_t group=0;group<groupOutputGains.size();++group){groupOutputGains[group].prepare(spec.sampleRate,5.0);groupOutputGains[group].reset(!groupMutes[group]&&(!anyGroupSolo||groupSolos[group])?1.f:0.f);}
    instrumentMasterGain.prepare(spec);instrumentMasterGain.reset(volume);
    if constexpr(!project::kIsEffect){instrumentSaturation.prepare(spec);instrumentSaturation.reset(tone);instrumentChorus.prepare(spec);instrumentChorus.reset(space);instrumentDelay.prepare(spec);instrumentDelay.reset(space);instrumentDelay.setTempoBpm(static_cast<float>(hostTempoBpm));instrumentReverb.prepare(spec);instrumentReverb.reset(space);}
    if constexpr(project::kIsEffect&&project::kIsPrismEq){effectInputTrim.prepare(spec);effectMix.prepare(spec);effectOutputTrim.prepare(spec);effectInputTrim.reset(input);effectMix.reset(mix);effectOutputTrim.reset(output);}
    if constexpr(!project::kIsPrismEq){if(project::kIsEffect||instrumentUsesDspRack)configureRack(effectRack,-1,spec);for(size_t group=0;group<groupEffectRacks.size();++group)configureRack(groupEffectRacks[group],static_cast<int>(group),spec);for(size_t i=0;i<project::kControls.size();++i)if(project::kControls[i].moduleIndex>=0)applyModuleControl(i,moduleControlValues[i]);}
    updatePrismEq();
}
void NativeInstrument::applyCustomImpulses(){
    for(size_t index=0;index<project::kImpulseResponses.size()&&index<impulseResponses.size();++index){
        const auto&settings=project::kImpulseResponses[index];std::vector<size_t>delays;std::vector<float>coefficients;
        if(buildCustomImpulse(impulseResponses[index],settings,hostSampleRate,delays,coefficients))
            rackForModule(static_cast<size_t>(settings.moduleIndex)).setCustomImpulse(static_cast<size_t>(project::kDspModules[static_cast<size_t>(settings.moduleIndex)].rackIndex),delays,coefficients);
    }
}
void NativeInstrument::applyToneAndSpace(float&l,float&r){
    if constexpr(!project::kIsNeonDrums){const float hz=200.f*std::pow(100.f,tone),alpha=1-std::exp(-2*pi*hz/(float)hostSampleRate);filterLeft+=alpha*(l-filterLeft);filterRight+=alpha*(r-filterRight);l=filterLeft;r=filterRight;}
    if constexpr(project::kSaturationEnabled){if constexpr(project::kIsNeonDrums){const float amount=tone*.55f;const auto saturate=[amount](float sample){sample=std::clamp(sample,-1.f,1.f);return sample*(1.f+amount)/(1.f+amount*std::abs(sample));};l=saturate(l);r=saturate(r);}else instrumentSaturation.processFrame(l,r);}
    if constexpr(project::kIsNeonDrums){l*=.92f;r*=.92f;}
    const float dryLeft=l,dryRight=r;float outputLeft=dryLeft,outputRight=dryRight;
    if constexpr(project::kReverbEnabled){float wetLeft=dryLeft,wetRight=dryRight;instrumentReverb.processFrame(wetLeft,wetRight);if constexpr(project::kIsNeonDrums){const float nativeWet=.08f+space*.25f,targetWet=.02f+space*.12f,scale=targetWet/nativeWet;outputLeft+=(wetLeft-dryLeft)*scale;outputRight+=(wetRight-dryRight)*scale;}else{outputLeft+=wetLeft-dryLeft;outputRight+=wetRight-dryRight;}}
    if constexpr(project::kDelayEnabled){float wetLeft=dryLeft,wetRight=dryRight;instrumentDelay.setTempoBpm(static_cast<float>(smoothedTempoBpm));instrumentDelay.processFrame(wetLeft,wetRight);outputLeft+=wetLeft-dryLeft;outputRight+=wetRight-dryRight;}if constexpr(project::kChorusEnabled){float wetLeft=dryLeft,wetRight=dryRight;instrumentChorus.processFrame(wetLeft,wetRight);outputLeft+=wetLeft-dryLeft;outputRight+=wetRight-dryRight;}l=outputLeft;r=outputRight;
}
void NativeInstrument::updatePrismEq(){
    if constexpr(!project::kIsPrismEq)return;
    const float sampleRate=static_cast<float>(std::max(8000.0,hostSampleRate));
    auto normalize=[](StereoBiquad&f,float b0,float b1,float b2,float a0,float a1,float a2){f.b0=b0/a0;f.b1=b1/a0;f.b2=b2/a0;f.a1=a1/a0;f.a2=a2/a0;};
    auto highPass=[&](StereoBiquad&f,float frequency,float q){const float w=2*pi*std::clamp(frequency,10.f,sampleRate*.45f)/sampleRate,c=std::cos(w),s=std::sin(w),a=s/(2*q);normalize(f,(1+c)*.5f,-(1+c),(1+c)*.5f,1+a,-2*c,1-a);};
    auto peak=[&](StereoBiquad&f,float frequency,float gainDb,float q){const float A=std::pow(10.f,gainDb/40.f),w=2*pi*std::clamp(frequency,10.f,sampleRate*.45f)/sampleRate,c=std::cos(w),s=std::sin(w),a=s/(2*q);normalize(f,1+a*A,-2*c,1-a*A,1+a/A,-2*c,1-a/A);};
    const auto frequency=[&](size_t band){return 10.f*std::pow(3000.f,std::clamp(prismFrequencies[band],0.f,1.f));};
    const auto q=[&](size_t band){return .025f*std::pow(1600.f,std::clamp(prismQs[band],0.f,1.f));};
    if constexpr(project::kPrismLowCutEnabled)highPass(prismLowCut,frequency(0),q(0));else prismLowCut={};
    if constexpr(project::kPrismLowBodyEnabled)peak(prismLowBody,frequency(1),(drive-.5f)*24.f,q(1));else prismLowBody={};
    if constexpr(project::kPrismMidFocusEnabled)peak(prismMidFocus,frequency(2),(compress-.5f)*24.f,q(2));else prismMidFocus={};
    if constexpr(project::kPrismPresenceEnabled)peak(prismPresence,frequency(3),(width-.5f)*24.f,q(3));else prismPresence={};
    if constexpr(project::kPrismAirEnabled)peak(prismAir,frequency(4),(space-.5f)*24.f,q(4));else prismAir={};
}
void NativeInstrument::processEffectFrame(float dryL,float dryR,float&l,float&r){if constexpr(!project::kIsPrismEq){l=dryL;r=dryR;effectRack.processFrame(l,r);}else{float inputDryL=dryL,inputDryR=dryR;effectInputTrim.processFrame(inputDryL,inputDryR);l=inputDryL;r=inputDryR;StereoBiquad*filters[]={&prismLowCut,&prismLowBody,&prismMidFocus,&prismPresence,&prismAir};for(auto*f:filters){l=f->process(l,0);r=f->process(r,1);}effectMix.processFrame(inputDryL,inputDryR,l,r);effectOutputTrim.processFrame(l,r);}const float bypassMix=effectBypassMix.next();l+=(dryL-l)*bypassMix;r+=(dryR-r)*bypassMix;}
void NativeInstrument::applyMasterPan(float&l,float&r)noexcept{const float position=masterPan.next()*2.f-1.f;if(position>0.f)l*=std::cos(position*pi*.5f);else if(position<0.f)r*=std::cos(-position*pi*.5f);}
tresult PLUGIN_API NativeInstrument::process(ProcessData&data){
    if constexpr(!project::kIsEffect){
        if(data.processContext&&(data.processContext->state&ProcessContext::kTempoValid)!=0&&std::isfinite(data.processContext->tempo)&&data.processContext->tempo>=20.&&data.processContext->tempo<=300.)hostTempoBpm=data.processContext->tempo;
    }
    if constexpr(!project::kIsEffect)drainEditorNotes();
    if(data.numOutputs<1||!data.outputs||data.numSamples<=0||data.symbolicSampleSize!=kSample32){applyParameterChanges(data.inputParameterChanges);return kResultOk;}
    std::array<float*,project::kAudioOutputBusCount>outL{},outR{};
    const auto availableOutputs=std::min<int32>(data.numOutputs,project::kAudioOutputBusCount);
    for(int32 bus=0;bus<availableOutputs;++bus){if(data.outputs[bus].numChannels>0&&data.outputs[bus].channelBuffers32){outL[static_cast<size_t>(bus)]=data.outputs[bus].channelBuffers32[0];outR[static_cast<size_t>(bus)]=data.outputs[bus].numChannels>1?data.outputs[bus].channelBuffers32[1]:outL[static_cast<size_t>(bus)];}}
    if(!outL[0]||!outR[0])return kResultFalse;
    for(size_t bus=0;bus<outL.size();++bus){if(outL[bus])std::fill(outL[bus],outL[bus]+data.numSamples,0);if(outR[bus]&&outR[bus]!=outL[bus])std::fill(outR[bus],outR[bus]+data.numSamples,0);}
    if constexpr(project::kLicenseRequired){if(!LicenseRuntime::isLicensed()){for(int32 bus=0;bus<availableOutputs;++bus)data.outputs[bus].silenceFlags=std::numeric_limits<uint64>::max();applyParameterChanges(data.inputParameterChanges);return kResultOk;}}
    float*inL=nullptr,*inR=nullptr;
    if constexpr(project::kIsEffect){if(data.numInputs>0&&data.inputs){inL=data.inputs[0].channelBuffers32[0];inR=data.inputs[0].numChannels>1?data.inputs[0].channelBuffers32[1]:inL;}}
    struct AutomationCursor{IParamValueQueue*queue=nullptr;int32 point=0;int32 count=0;};
    std::array<AutomationCursor,256> automation{};int32 automationCount=0;
    if(data.inputParameterChanges){
        const int32 queueCount=data.inputParameterChanges->getParameterCount();
        for(int32 index=0;index<queueCount&&automationCount<static_cast<int32>(automation.size());++index){
            auto*queue=data.inputParameterChanges->getParameterData(index);if(!queue)continue;
            automation[static_cast<size_t>(automationCount++)]={queue,0,queue->getPointCount()};
        }
    }
    auto applyAutomationAt=[&](int32 sampleOffset){
        bool prismChanged=false;
        for(int32 index=0;index<automationCount;++index){
            auto&cursor=automation[static_cast<size_t>(index)];
            while(cursor.point<cursor.count){int32 offset=0;ParamValue value=0;if(cursor.queue->getPoint(cursor.point,offset,value)!=kResultTrue){++cursor.point;continue;}if(offset>sampleOffset)break;applyParameterValue(cursor.queue->getParameterId(),clamp01(value));prismChanged=true;++cursor.point;}
        }
        if constexpr(project::kIsPrismEq)if(prismChanged)updatePrismEq();
    };
    int32 event=0;float peakL=0,peakR=0;double energyL=0,energyR=0;std::array<float,project::kGroups.size()>gp{},groupPeakL{},groupPeakR{};std::array<double,project::kGroups.size()>groupEnergyL{},groupEnergyR{};std::array<float,project::kAudioOutputBusCount>busPeaks{};if constexpr(!project::kIsEffect)applyGrooveCommand();
    for(int32 i=0;i<data.numSamples;++i){
        applyAutomationAt(i);
        float sl=0,sr=0;
        if constexpr(project::kIsEffect){const float dryL=inL?inL[i]:0,dryR=inR?inR[i]:dryL;processEffectFrame(dryL,dryR,sl,sr);}
        else{
            applyEventsAt(data.inputEvents,event,i);processGrooveSample();std::array<float,project::kGroups.size()>groupLeft{},groupRight{};renderFrame(sl,sr,groupLeft,groupRight,gp);const float bypassMix=effectBypassMix.next();
            const auto groupAnalysisSlot=static_cast<size_t>(groupAnalysisWrite.fetch_add(1,std::memory_order_relaxed)%kAnalysisSampleCount);
            for(size_t group=0;group<project::kGroups.size();++group){float gl=groupLeft[group],gr=groupRight[group],dryL=gl,dryR=gr;if(groupEffectRacks[group].size())groupEffectRacks[group].processFrame(gl,gr);gl+=(dryL-gl)*bypassMix;gr+=(dryR-gr)*bypassMix;if(mute&&!solo)gl=gr=0;groupAnalysisSamplesLeft[group][groupAnalysisSlot].store(gl,std::memory_order_relaxed);groupAnalysisSamplesRight[group][groupAnalysisSlot].store(gr,std::memory_order_relaxed);groupPeakL[group]=std::max(groupPeakL[group],std::abs(gl));groupPeakR[group]=std::max(groupPeakR[group],std::abs(gr));groupEnergyL[group]+=gl*gl;groupEnergyR[group]+=gr*gr;const auto bus=static_cast<size_t>(groupOutputBuses[group]);if(bus==0){sl+=gl;sr+=gr;}else if(bus<outL.size()){if(outL[bus])outL[bus][i]+=gl;if(outR[bus])outR[bus][i]+=gr;busPeaks[bus]=std::max(busPeaks[bus],std::max(std::abs(gl),std::abs(gr)));}}
            const float dryL=sl,dryR=sr;if(instrumentUsesDspRack)effectRack.processFrame(sl,sr);else applyToneAndSpace(sl,sr);sl+=(dryL-sl)*bypassMix;sr+=(dryR-sr)*bypassMix;if(mute&&!solo)sl=sr=0;instrumentMasterGain.processFrame(sl,sr);
        }
        applyMasterPan(sl,sr);outL[0][i]+=sl;outR[0][i]+=sr;busPeaks[0]=std::max(busPeaks[0],std::max(std::abs(sl),std::abs(sr)));
        float analysisL=sl,analysisR=sr;if constexpr(!project::kIsEffect)for(size_t bus=1;bus<outL.size();++bus){if(outL[bus])analysisL+=outL[bus][i];if(outR[bus])analysisR+=outR[bus][i];}
        const auto analysisIndex=analysisWrite.fetch_add(1,std::memory_order_relaxed);const auto analysisSlot=static_cast<size_t>(analysisIndex%kAnalysisSampleCount);analysisSamplesLeft[analysisSlot].store(analysisL,std::memory_order_relaxed);analysisSamplesRight[analysisSlot].store(analysisR,std::memory_order_relaxed);peakL=std::max(peakL,std::abs(analysisL));peakR=std::max(peakR,std::abs(analysisR));energyL+=analysisL*analysisL;energyR+=analysisR*analysisR;
    }
    peaks[0]=peakL;peaks[1]=peakR;rms[0]=std::sqrt(energyL/data.numSamples);rms[1]=std::sqrt(energyR/data.numSamples);for(size_t g=0;g<gp.size();++g){groupPeaks[g]=gp[g];groupPeaksStereo[g][0]=groupPeakL[g];groupPeaksStereo[g][1]=groupPeakR[g];groupRmsStereo[g][0]=std::sqrt(groupEnergyL[g]/data.numSamples);groupRmsStereo[g][1]=std::sqrt(groupEnergyR[g]/data.numSamples);}const float rackActive=1.f-effectBypassMix.current();for(size_t module=0;module<compressorGainReductions.size();++module)compressorGainReductions[module].store(rackActive*rackForModule(module).gainReduction(static_cast<size_t>(project::kDspModules[module].rackIndex)),std::memory_order_relaxed);for(int32 bus=0;bus<availableOutputs;++bus)data.outputs[bus].silenceFlags=busPeaks[static_cast<size_t>(bus)]<1e-8f?std::numeric_limits<uint64>::max():0;return kResultOk;
}

void NativeInstrument::copyAnalysisSamples(float*destination,std::size_t count,int channel)const noexcept{
    if(!destination||!count)return;count=std::min(count,kAnalysisSampleCount);const auto end=analysisWrite.load(std::memory_order_acquire);const auto available=static_cast<std::size_t>(std::min<std::uint64_t>(end,count));const auto missing=count-available;const auto start=end-available;
    std::fill(destination,destination+missing,0.f);for(std::size_t i=0;i<available;++i){const auto slot=static_cast<size_t>((start+i)%kAnalysisSampleCount);const auto left=analysisSamplesLeft[slot].load(std::memory_order_relaxed),right=analysisSamplesRight[slot].load(std::memory_order_relaxed);destination[missing+i]=channel==0?left:channel==1?right:(left+right)*.5f;}
}

void NativeInstrument::copyGroupAnalysisSamples(int group,float*destination,std::size_t count,int channel)const noexcept{
    if(!destination||!count||group<0||group>=static_cast<int>(project::kGroups.size()))return;count=std::min(count,kAnalysisSampleCount);const auto end=groupAnalysisWrite.load(std::memory_order_acquire);const auto available=static_cast<std::size_t>(std::min<std::uint64_t>(end,count));const auto missing=count-available;const auto start=end-available;
    std::fill(destination,destination+missing,0.f);for(std::size_t i=0;i<available;++i){const auto slot=static_cast<size_t>((start+i)%kAnalysisSampleCount);const auto left=groupAnalysisSamplesLeft[static_cast<size_t>(group)][slot].load(std::memory_order_relaxed),right=groupAnalysisSamplesRight[static_cast<size_t>(group)][slot].load(std::memory_order_relaxed);destination[missing+i]=channel==0?left:channel==1?right:(left+right)*.5f;}
}

tresult PLUGIN_API NativeInstrument::setState(IBStream*s){
    if(!s)return kResultFalse;IBStreamer b(s,kLittleEndian);uint32 magic=0,version=0;if(!b.readInt32u(magic)||!b.readInt32u(version)||magic!=0x54535633||version<1||version>7)return kResultFalse;
    std::array<float,9>v{};for(auto&x:v)if(!b.readFloat(x))return kResultFalse;
    if constexpr(project::kIsEffect){input=clamp01(v[0]);drive=clamp01(v[1]);compress=clamp01(v[2]);tone=clamp01(v[3]);width=clamp01(v[4]);space=clamp01(v[5]);mix=clamp01(v[6]);output=clamp01(v[7]);bypass=v[8]>=.5f;}else{volume=clamp01(v[0]);tone=clamp01(v[1]);attack=clamp01(v[2]);releaseAmount=clamp01(v[3]);space=clamp01(v[4]);mute=hasControlParameter("mute")&&v[5]>=.5f;solo=hasControlParameter("solo")&&v[6]>=.5f;v[5]=mute?1.f:0.f;v[6]=solo?1.f:0.f;
    articulation=project::kArticulations.size()>1?std::lround(clamp01(v[7])*(project::kArticulations.size()-1)):0;mic=project::kMicPositions.size()>1?std::lround(clamp01(v[8])*(project::kMicPositions.size()-1)):0;
    }if constexpr(project::kIsEffect){effectBypassMix.reset(bypass?1.0f:0.0f);effectInputTrim.reset(input);effectMix.reset(mix);effectOutputTrim.reset(output);effectRack.setInput(input);effectRack.setDrive(drive);effectRack.setCompress(compress);effectRack.setTone(tone);effectRack.setWidth(width);effectRack.setSpace(space);effectRack.setDryWet(mix);effectRack.setOutput(output);effectRack.reset();}else{instrumentMasterGain.reset(volume);instrumentSaturation.reset(tone);instrumentChorus.reset(space);instrumentDelay.reset(space);instrumentReverb.reset(space);effectRack.setTone(tone);effectRack.setSpace(space);effectRack.reset();for(auto&rack:groupEffectRacks)rack.reset();}ParamID effectIds[]={kInputId,kDriveId,kCompressId,kToneId,kWidthId,kSpaceId,kMixId,kOutputId,kBypassId};ParamID instrumentIds[]={kVolumeId,kToneId,kAttackId,kReleaseId,kSpaceId,kMuteId,kSoloId,kArticulationId,kMicId};auto*ids=project::kIsEffect?effectIds:instrumentIds;for(int i=0;i<9;++i)setParamNormalized(ids[i],clamp01(v[i]));if constexpr(!project::kIsEffect){setSustain(project::kDefaultSustain);setParamNormalized(kSustainId,project::kDefaultSustain?1:0);}
    for(size_t g=0;g<project::kGroups.size();++g){float values[4]{};for(auto&x:values)if(!b.readFloat(x))return kResultFalse;groupVolumes[g]=clamp01(values[0]);groupPans[g]=clamp01(values[1])*2-1;groupMutes[g]=values[2]>=.5f;groupSolos[g]=!groupMutes[g]&&values[3]>=.5f;values[2]=groupMutes[g]?1.f:0.f;values[3]=groupSolos[g]?1.f:0.f;for(int slot=0;slot<4;++slot)setParamNormalized(groupParameterId(static_cast<int>(g),slot),clamp01(values[slot]));}
    if(version>=2){uint32 count=0;if(!b.readInt32u(count)||count>4096)return kResultFalse;for(uint32 i=0;i<count;++i){float value=0;if(!b.readFloat(value))return kResultFalse;if(i<project::kControls.size()&&project::kControls[i].moduleIndex>=0&&!isPrismContextParameter(project::kControls[i].parameter)){const float normalized=clamp01(value);setParamNormalized(kModuleControlBaseId+i,normalized);applyModuleControl(i,normalized);}}}
    pan=project::kDefaultPan;if(version>=3&&!b.readFloat(pan))return kResultFalse;pan=clamp01(pan);masterPan.reset(pan);setParamNormalized(kPanId,pan);
    if constexpr(project::kIsPrismEq||project::kHasPrismModule){
        if(version>=5){for(auto&value:prismFrequencies)if(!b.readFloat(value))return kResultFalse;for(auto&value:prismGains)if(!b.readFloat(value))return kResultFalse;for(auto&value:prismQs)if(!b.readFloat(value))return kResultFalse;for(auto&enabled:prismEnabled){float value=0;if(!b.readFloat(value))return kResultFalse;enabled=value>=.5f;}}
        else if constexpr(project::kIsPrismEq){if(version>=4){for(auto&value:prismFrequencies)if(!b.readFloat(value))return kResultFalse;for(auto&value:prismQs)if(!b.readFloat(value))return kResultFalse;}else prismFrequencies[0]=tone;}
        for(size_t band=0;band<5;++band){
            prismFrequencies[band]=clamp01(prismFrequencies[band]);prismGains[band]=clamp01(prismGains[band]);prismQs[band]=clamp01(prismQs[band]);
            const auto frequencyId=kPrismFrequencyBaseId+static_cast<ParamID>(band),qId=kPrismQBaseId+static_cast<ParamID>(band);setParamNormalized(frequencyId,prismFrequencies[band]);setParamNormalized(qId,prismQs[band]);applyParameterValue(frequencyId,prismFrequencies[band]);applyParameterValue(qId,prismQs[band]);
            if constexpr(project::kHasPrismModule){const auto gainId=kPrismGainBaseId+static_cast<ParamID>(band),enabledId=kPrismEnabledBaseId+static_cast<ParamID>(band);setParamNormalized(gainId,prismGains[band]);setParamNormalized(enabledId,prismEnabled[band]?1.f:0.f);applyParameterValue(gainId,prismGains[band]);applyParameterValue(enabledId,prismEnabled[band]?1.f:0.f);}
        }
        if constexpr(project::kIsPrismEq)updatePrismEq();
    }
    if constexpr(!project::kIsEffect){float bypassValue=project::kDefaultBypass;if(version>=6&&!b.readFloat(bypassValue))return kResultFalse;bypass=clamp01(bypassValue)>=.5f;setParamNormalized(kBypassId,bypass?1.f:0.f);effectBypassMix.reset(bypass?1.f:0.f);}
    if(version>=7){for(size_t group=0;group<project::kGroups.size();++group){float route=0;if(!b.readFloat(route))return kResultFalse;route=route>0?1.f:0.f;applyParameterValue(groupOutputParameterId(static_cast<int>(group)),route);setParamNormalized(groupOutputParameterId(static_cast<int>(group)),route);}}
    else for(size_t group=0;group<project::kGroups.size();++group)groupOutputBuses[group]=project::kGroupOutputSeparateDefaults[group]?project::kGroups[group].outputBusIndex:0;
    return kResultOk;
}
tresult PLUGIN_API NativeInstrument::getState(IBStream*s){
    if(!s)return kResultFalse;IBStreamer b(s,kLittleEndian);if(!b.writeInt32u(0x54535633)||!b.writeInt32u(7))return kResultFalse;
    float articulationValue=project::kArticulations.size()>1?(float)articulation/(project::kArticulations.size()-1):0,micValue=project::kMicPositions.size()>1?(float)mic/(project::kMicPositions.size()-1):0;
    float instrumentValues[]={volume,tone,attack,releaseAmount,space,mute?1.f:0.f,solo?1.f:0.f,articulationValue,micValue};float effectValues[]={input,drive,compress,tone,width,space,mix,output,bypass?1.f:0.f};auto*values=project::kIsEffect?effectValues:instrumentValues;for(int i=0;i<9;++i)if(!b.writeFloat(values[i]))return kResultFalse;
    for(size_t g=0;g<project::kGroups.size();++g){float values[]={groupVolumes[g],(groupPans[g]+1)*.5f,groupMutes[g]?1.f:0.f,groupSolos[g]?1.f:0.f};for(float x:values)if(!b.writeFloat(x))return kResultFalse;}
    if(!b.writeInt32u(static_cast<uint32>(moduleControlValues.size())))return kResultFalse;for(float value:moduleControlValues)if(!b.writeFloat(value))return kResultFalse;if(!b.writeFloat(pan))return kResultFalse;
    if constexpr(project::kIsPrismEq||project::kHasPrismModule){for(float value:prismFrequencies)if(!b.writeFloat(value))return kResultFalse;for(int band=0;band<5;++band)if(!b.writeFloat(prismBandValue(band,1)))return kResultFalse;for(float value:prismQs)if(!b.writeFloat(value))return kResultFalse;for(int band=0;band<5;++band)if(!b.writeFloat(prismBandEnabled(band)?1.f:0.f))return kResultFalse;}
    if constexpr(!project::kIsEffect)if(!b.writeFloat(bypass?1.f:0.f))return kResultFalse;
    for(int bus:groupOutputBuses)if(!b.writeFloat(bus>0?1.f:0.f))return kResultFalse;
    return kResultOk;
}
tresult PLUGIN_API NativeInstrument::setEditorState(IBStream*s){return setState(s);} tresult PLUGIN_API NativeInstrument::getEditorState(IBStream*s){return getState(s);}
IPlugView* PLUGIN_API NativeInstrument::createView(FIDString name){return name&&std::strcmp(name,ViewType::kEditor)==0?new NativeView(*this):nullptr;}
tresult PLUGIN_API NativeInstrument::getMidiControllerAssignment(int32 busIndex,int16 channel,CtrlNumber controller,ParamID&id){
    if(busIndex!=0)return kResultFalse;
    for(const auto&mapping:project::kMidiMappings){
        if(mapping.note||mapping.sourceNumber!=controller||(mapping.channel!=0&&mapping.channel-1!=channel))continue;
        id=parameterForControl(static_cast<size_t>(mapping.targetControlIndex));
        if(id!=kNoParamId)return kResultTrue;
    }
    if(controller==kCtrlSustainOnOff)id=kSustainId;else if(controller==kPitchBend&&project::kPitchBendEnabled)id=kPitchBendId;else if(controller==kCtrlModWheel&&project::kModulationEnabled)id=kModulationId;else return kResultFalse;return kResultTrue;
}
uint32 PLUGIN_API NativeInstrument::getProcessContextRequirements(){return project::kIsEffect?0u:static_cast<uint32>(IProcessContextRequirements::kNeedTempo);}
tresult PLUGIN_API NativeInstrument::queryInterface(const TUID _iid,void**obj){DEF_INTERFACE(IMidiMapping)return SingleComponentEffect::queryInterface(_iid,obj);}
std::filesystem::path NativeInstrument::resourceDirectory(){
#if defined(_WIN32)
    HMODULE module=nullptr;auto address=reinterpret_cast<LPCWSTR>(&NativeInstrument::resourceDirectory);if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,address,&module))return{};std::wstring path(32768,L'\0');auto n=GetModuleFileNameW(module,path.data(),(DWORD)path.size());if(!n||n>=path.size())return{};path.resize(n);
    const auto moduleDir=std::filesystem::path(path).parent_path();
    const std::array candidates={moduleDir.parent_path()/L"Resources",moduleDir/L"Resources",moduleDir};
    for(const auto&candidate:candidates)if(std::filesystem::exists(candidate/L"project.json"))return candidate;
    return candidates.front();
#elif defined(__APPLE__)
    Dl_info info{};
    if(dladdr(reinterpret_cast<const void*>(&NativeInstrument::resourceDirectory),&info)==0||!info.dli_fname)return{};
    const auto moduleDir=std::filesystem::path(info.dli_fname).parent_path();
    const auto resources=moduleDir.parent_path()/"Resources";
    return resources;
#else
    return{};
#endif
}
void NativeInstrument::loadResources(){
    samples.assign(project::kSamples.size(),{});auto root=resourceDirectory();
    for(size_t i=0;i<project::kSamples.size();++i){
        std::string error;const auto resourceName=std::filesystem::path(project::kSamples[i].resourceFile).wstring();
        const auto embedded=findEmbeddedResource(resourceName.c_str());
        const bool loaded=!embedded.empty()
            ? WavFile::load(embedded.data,embedded.size,samples[i],error)
            : WavFile::load(root/project::kSamples[i].resourceFile,samples[i],error);
        if(!loaded){auto message=std::string("TripleSide failed to load embedded ")+project::kSamples[i].resourceFile+": "+error+"\n";
#if defined(_WIN32)
            OutputDebugStringA(message.c_str());
#else
            std::fputs(message.c_str(),stderr);
#endif
        }
    }
    impulseResponses.assign(project::kImpulseResponses.size(),{});
    for(size_t i=0;i<project::kImpulseResponses.size();++i){
        std::string error;const auto resourceName=std::filesystem::path(project::kImpulseResponses[i].resourceFile).wstring();
        const auto embedded=findEmbeddedResource(resourceName.c_str());
        const bool loaded=!embedded.empty()
            ? WavFile::load(embedded.data,embedded.size,impulseResponses[i],error)
            : WavFile::load(root/project::kImpulseResponses[i].resourceFile,impulseResponses[i],error);
        if(!loaded){auto message=std::string("TripleSide failed to load cabinet IR ")+project::kImpulseResponses[i].resourceFile+": "+error+"\n";
#if defined(_WIN32)
            OutputDebugStringA(message.c_str());
#else
            std::fputs(message.c_str(),stderr);
#endif
        }
    }
}
} // namespace tripleside::native

namespace tripleside::native {
static const Steinberg::FUID kNativeInstrumentCid(TS_PLUGIN_CID_A, TS_PLUGIN_CID_B, TS_PLUGIN_CID_C, TS_PLUGIN_CID_D);
}

BEGIN_FACTORY_DEF(TS_COMPANY_NAME, "https://triplesidestudio.com", "mailto:support@triplesidestudio.com")
DEF_CLASS2(INLINE_UID_FROM_FUID(tripleside::native::kNativeInstrumentCid),
    Steinberg::PClassInfo::kManyInstances,
    kVstAudioEffectClass,
    TS_PRODUCT_NAME,
    0,
    tripleside::project::kVstCategory,
    TS_PLUGIN_VERSION,
    kVstVersionString,
    tripleside::native::NativeInstrument::createInstance)
END_FACTORY
