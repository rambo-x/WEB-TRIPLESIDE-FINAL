#include "DspModules.h"

#include <fstream>
#include <string_view>
#include <vector>

using namespace tripleside::dsp;

int main(int argc, char** argv) {
    if (argc != 3 && argc != 4) return 2;
    const bool customImpulse = argc == 4 && std::string_view(argv[3]) == "--custom-ir";
    const bool creative = argc == 4 && std::string_view(argv[3]) == "--creative";
    std::ifstream input(argv[1], std::ios::binary | std::ios::ate);
    if (!input) return 3;
    const auto bytes = input.tellg();
    input.seekg(0);
    std::vector<float> samples(static_cast<std::size_t>(bytes) / sizeof(float));
    input.read(reinterpret_cast<char*>(samples.data()), bytes);

    EffectRack rack;
    if (creative) {
        rack.configure(ProcessSpec{48000.0, 128}, {
            {RackModuleType::Chorus, false, 1.0f, 0.42f, false},
            {RackModuleType::Flanger, false, 1.0f, 0.31f, false},
            {RackModuleType::Tremolo, false, 1.0f, 0.8f, false},
            {RackModuleType::Vibrato, false, 1.0f, 0.35f, false},
            {RackModuleType::DigitalDelay, false, 1.0f, 0.24f, false},
            {RackModuleType::Reverb, false, 1.0f, 0.22f, false},
            {RackModuleType::Shimmer, false, 1.0f, 0.18f, false},
        });
        rack.setModuleParameter(0, "rate", 0.38f); rack.setModuleParameter(0, "depth", 0.58f); rack.setModuleParameter(0, "delay", 0.48f); rack.setModuleParameter(0, "feedback", 0.35f); rack.setModuleParameter(0, "stereo", 0.75f);
        rack.setModuleParameter(1, "rate", 0.32f); rack.setModuleParameter(1, "depth", 0.62f); rack.setModuleParameter(1, "manual", 0.38f); rack.setModuleParameter(1, "feedback", 0.68f); rack.setModuleParameter(1, "stereo", 0.6f);
        rack.setModuleParameter(2, "rate", 0.48f); rack.setModuleParameter(2, "depth", 0.7f); rack.setModuleParameter(2, "shape", 0.35f); rack.setModuleParameter(2, "stereo", 0.5f);
        rack.setModuleParameter(3, "rate", 0.45f); rack.setModuleParameter(3, "depth", 0.45f); rack.setModuleParameter(3, "stereo", 0.4f);
        rack.setModuleParameter(4, "time", 0.34f); rack.setModuleParameter(4, "feedback", 0.38f); rack.setModuleParameter(4, "tone", 0.58f); rack.setModuleParameter(4, "character", 0.72f); rack.setModuleParameter(4, "stereo", 0.35f);
        rack.setModuleParameter(5, "mode", 1.0f); rack.setModuleParameter(5, "size", 0.58f); rack.setModuleParameter(5, "decay", 0.52f); rack.setModuleParameter(5, "damping", 0.55f); rack.setModuleParameter(5, "pre_delay", 0.04f); rack.setModuleParameter(5, "modulation", 0.22f);
        rack.setModuleParameter(6, "size", 0.68f); rack.setModuleParameter(6, "decay", 0.68f); rack.setModuleParameter(6, "damping", 0.48f); rack.setModuleParameter(6, "pre_delay", 0.04f); rack.setModuleParameter(6, "shimmer", 0.5f);
    } else rack.configure(ProcessSpec{48000.0, 128}, {
        {RackModuleType::InputTrim, false, 1.0f, 0.56f, false},
        {RackModuleType::NoiseGate, false, 1.0f, 0.62f, false},
        {RackModuleType::DualHighGain, false, 1.0f, 0.82f, false},
        {RackModuleType::CabinetIr, false, 1.0f, 0.88f, false},
        {RackModuleType::OutputTrim, false, 1.0f, 0.66f, false},
    });
    if (!creative) {
    rack.setModuleParameter(1, "release", 0.2f);
    rack.setModuleParameter(2, "mode", 0.0f);
    rack.setModuleParameter(2, "tight", 0.72f);
    rack.setModuleParameter(2, "bass", 0.58f);
    rack.setModuleParameter(2, "mid", 0.36f);
    rack.setModuleParameter(2, "treble", 0.64f);
    rack.setModuleParameter(2, "presence", 0.62f);
    rack.setModuleParameter(2, "depth", 0.68f);
    rack.setModuleParameter(2, "sag", 0.2f);
    rack.setModuleParameter(2, "master", 0.62f);
    rack.setModuleParameter(3, "mic_position", 0.62f);
    rack.setModuleParameter(3, "mic_blend", 0.22f);
    rack.setModuleParameter(3, "distance", 0.08f);
    rack.setModuleParameter(3, "low_cut", 0.18f);
    rack.setModuleParameter(3, "high_cut", 0.48f);
    rack.setModuleParameter(3, "resonance", 0.64f);
    rack.setModuleParameter(3, "level", 0.53f);
    if (customImpulse) {
        rack.setCustomImpulse(3, {0, 3, 17, 63, 127, 191, 319},
            {0.72f, -0.18f, 0.12f, -0.08f, 0.052f, -0.03f, 0.018f});
    }
    }

    for (auto& left : samples) {
        float right = left * 0.97f;
        rack.processFrame(left, right);
    }
    std::ofstream output(argv[2], std::ios::binary);
    if (!output) return 4;
    output.write(reinterpret_cast<const char*>(samples.data()), static_cast<std::streamsize>(samples.size() * sizeof(float)));
    return output ? 0 : 5;
}
