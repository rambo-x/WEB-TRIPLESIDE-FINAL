#include "NativeView.h"
#include "NativeInstrument.h"
#include "LicenseRuntime.h"
#include "NativeProject.h"
#include "pluginterfaces/gui/iplugview.h"

#import <Cocoa/Cocoa.h>
#import <CoreText/CoreText.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <vector>

namespace tripleside::native {
using namespace Steinberg;
using namespace Steinberg::Vst;

namespace {
bool equals(const char* left, const char* right) {
    return left && right && std::strcmp(left, right) == 0;
}

bool startsWith(const char* value, const char* prefix) {
    return value && prefix && std::strncmp(value, prefix, std::strlen(prefix)) == 0;
}

bool containsIgnoreCase(const char* value, const char* needle) {
    if (!value || !needle) return false;
    std::string haystack(value), query(needle);
    std::transform(haystack.begin(), haystack.end(), haystack.begin(), [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
    std::transform(query.begin(), query.end(), query.begin(), [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
    return haystack.find(query) != std::string::npos;
}

float neutralControlValue(const project::ControlInfo& control) {
    const auto* parameter = control.parameter ? control.parameter : "";
    if (containsIgnoreCase(control.label, "low cut") || (project::kIsPrismEq && equals(parameter, "tone"))) return 0.f;
    if (startsWith(parameter, "group_") && std::strstr(parameter, "_volume")) return 1.f;
    if (control.moduleIndex >= 0 || startsWith(control.variant, "pan-") || (startsWith(parameter, "group_") && std::strstr(parameter, "_pan"))) return .5f;
    if (project::kIsPrismEq && (equals(parameter, "drive") || equals(parameter, "compress") || equals(parameter, "tone") || equals(parameter, "width") || equals(parameter, "space"))) return .5f;
    if (equals(parameter, "input") || equals(parameter, "tone") || equals(parameter, "width")) return .5f;
    if (equals(parameter, "output")) return .75f;
    if (equals(parameter, "volume") || equals(parameter, "mix")) return 1.f;
    if (equals(parameter, "drive") || equals(parameter, "compress") || equals(parameter, "attack") || equals(parameter, "release") || equals(parameter, "space")) return 0.f;
    return .5f;
}

bool interactiveKind(const char* kind) {
    return equals(kind, "knob") || equals(kind, "fader") || equals(kind, "button")
        || equals(kind, "mute") || equals(kind, "solo") || equals(kind, "pad")
        || equals(kind, "keyboard") || equals(kind, "panel_button") || equals(kind, "output_selector");
}

struct RuntimeMidiEvent { int tick = 0, note = 60, velocity = 0, channel = 0; bool on = false; };
struct RuntimeMidiTempo { int tick = 0; float bpm = 120; };
struct RuntimeMidiSequence {
    std::string name;
    int ppq = 480, durationTicks = 0;
    bool loopEnabled = false;
    std::vector<RuntimeMidiEvent> events;
    std::vector<RuntimeMidiTempo> tempos;
};
struct RuntimeUserPreset {
    std::string name;
    std::vector<float> values, groups, moduleValues;
    int midiSequenceIndex = -1;
};

NSColor* rgbColor(unsigned rgb, CGFloat alpha = 1) {
    return [NSColor colorWithCalibratedRed:((rgb >> 16) & 255) / 255.
                                     green:((rgb >> 8) & 255) / 255.
                                      blue:(rgb & 255) / 255.
                                     alpha:alpha];
}

NSDictionary* panelTextAttributes(CGFloat size, NSColor* color, NSTextAlignment alignment = NSTextAlignmentLeft, NSFontWeight weight = NSFontWeightRegular) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        const auto path = NativeInstrument::resourceDirectory() / "Manrope-wght.ttf";
        NSString* value = [NSString stringWithUTF8String:path.string().c_str()];
        if (value.length) CTFontManagerRegisterFontsForURL((__bridge CFURLRef)[NSURL fileURLWithPath:value], kCTFontManagerScopeProcess, nullptr);
    });
    NSMutableParagraphStyle* paragraph = [[NSMutableParagraphStyle alloc] init];
    paragraph.alignment = alignment;
    paragraph.lineBreakMode = NSLineBreakByTruncatingTail;
    NSFontDescriptor* descriptor = [[NSFontDescriptor fontDescriptorWithFontAttributes:@{ NSFontFamilyAttribute: @"Manrope" }]
        fontDescriptorByAddingAttributes:@{ NSFontTraitsAttribute: @{ NSFontWeightTrait: @(weight) } }];
    NSFont* font = [NSFont fontWithDescriptor:descriptor size:size] ?: [NSFont systemFontOfSize:size weight:weight];
    return @{
        NSFontAttributeName: font,
        NSForegroundColorAttributeName: color,
        NSParagraphStyleAttributeName: paragraph,
    };
}

void fillRounded(NSRect rect, CGFloat radius, NSColor* color) {
    [color setFill];
    [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius] fill];
}

void strokeRounded(NSRect rect, CGFloat radius, NSColor* color, CGFloat width = 1) {
    NSBezierPath* path = [NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius];
    path.lineWidth = width;
    [color setStroke];
    [path stroke];
}

bool hitPadVariant(const char* variant) {
    return equals(variant, "hit-effect") || equals(variant, "diffuse-hit") || equals(variant, "smooth-diffuse-hit");
}

int prismContextSlot(std::size_t index) {
    if ((!project::kIsPrismEq && !project::kHasPrismModule) || index >= project::kControls.size()) return -1;
    const auto* parameter = project::kControls[index].parameter;
    return equals(parameter, "prism_frequency") ? 0 : equals(parameter, "prism_gain") ? 1 : equals(parameter, "prism_q") ? 2 : -1;
}

bool controlVisible(std::size_t index) {
    if (index >= project::kControls.size() || project::kControls[index].spectrumBand) return false;
    return prismContextSlot(index) < 0 || project::kPrismContextualEnabled;
}

ParamID displayedParameter(NativeInstrument& instrument, std::size_t index, NSInteger selectedPrismBand) {
    const int slot = prismContextSlot(index);
    return slot >= 0 ? instrument.prismParameterFor(static_cast<int>(selectedPrismBand), slot) : instrument.parameterForControl(index);
}

float displayedValue(NativeInstrument& instrument, std::size_t index, NSInteger selectedPrismBand) {
    const auto& control = project::kControls[index];
    if (equals(control.kind, "gain_meter") || equals(control.kind, "vu_meter")) {
        if (control.meterMode && std::strcmp(control.meterMode, "gain_reduction") == 0)
            return std::clamp(instrument.gainReduction(control.moduleIndex), 0.f, 1.f);
        const bool peak = equals(control.kind, "gain_meter");
        const float left = control.samplerGroupIndex >= 0 ? (peak ? instrument.groupOutputPeak(control.samplerGroupIndex, 0) : instrument.groupOutputRms(control.samplerGroupIndex, 0)) : (peak ? instrument.outputPeak(0) : instrument.outputRms(0));
        const float right = control.samplerGroupIndex >= 0 ? (peak ? instrument.groupOutputPeak(control.samplerGroupIndex, 1) : instrument.groupOutputRms(control.samplerGroupIndex, 1)) : (peak ? instrument.outputPeak(1) : instrument.outputRms(1));
        return std::clamp(std::max(left, right) * (peak ? 1.5f : 2.8f), 0.f, 1.f);
    }
    const auto parameter = displayedParameter(instrument, index, selectedPrismBand);
    return parameter == kNoParamId ? std::clamp(control.value, 0.f, 1.f)
                                   : static_cast<float>(instrument.getParamNormalized(parameter));
}

float indicatorValue(NativeInstrument& instrument, std::size_t index, NSInteger selectedPrismBand, NSInteger openPanel, NSInteger activeNote, NSInteger playingMidiSequence) {
    if (index >= project::kControls.size()) return 0.f;
    const auto& indicator = project::kControls[index];
    if (indicator.samplerGroupIndex >= 0) {
        const auto parameter = instrument.parameterForControl(index);
        return parameter == kNoParamId ? std::clamp(indicator.value, 0.f, 1.f) : static_cast<float>(instrument.getParamNormalized(parameter));
    }
    const int sourceIndex = indicator.indicatorSourceIndex;
    if (sourceIndex < 0 || sourceIndex >= static_cast<int>(project::kControls.size())) return std::clamp(indicator.value, 0.f, 1.f);
    const auto& source = project::kControls[static_cast<std::size_t>(sourceIndex)];
    if (equals(source.kind, "panel_button")) return openPanel == sourceIndex ? 1.f : 0.f;
    if (source.midiSequenceIndex >= 0) return instrument.livePatternSequenceIndex() == source.midiSequenceIndex ? 1.f : 0.f;
    if (equals(source.kind, "pad")) return instrument.isNoteActive(source.notePitch) || activeNote == source.notePitch ? 1.f : 0.f;
    const float value = displayedValue(instrument, static_cast<std::size_t>(sourceIndex), selectedPrismBand);
    if (equals(source.kind, "button") && equals(source.parameter, "bypass")) return value < .5f ? 1.f : 0.f;
    return value >= .5f ? 1.f : 0.f;
}

NSImage* loadResourceImage(NSString* filename) {
    if (!filename.length) return nil;
    const auto root = NativeInstrument::resourceDirectory();
    const auto path = root / std::string(filename.UTF8String ?: "");
    return [[NSImage alloc] initWithContentsOfFile:[NSString stringWithUTF8String:path.string().c_str()]];
}

NSPoint controlLocalPoint(const project::ControlInfo& control, NSPoint point) {
    if (std::abs(control.rotation) < .001f) return point;
    const CGFloat centerX = project::kCanvasWidth * control.x / 100.;
    const CGFloat centerY = project::kCanvasHeight * control.y / 100.;
    const CGFloat radians = -control.rotation * M_PI / 180.;
    const CGFloat dx = point.x - centerX, dy = point.y - centerY;
    return NSMakePoint(centerX + dx * std::cos(radians) - dy * std::sin(radians),
                       centerY + dx * std::sin(radians) + dy * std::cos(radians));
}

NSRect controlLayoutRect(const project::ControlInfo& control, const project::VisualControl& visual) {
    if (std::abs(control.rotation) < .001f) return NSMakeRect(visual.hx, visual.hy, visual.hw, visual.hh);
    const CGFloat centerX = project::kCanvasWidth * control.x / 100.;
    const CGFloat centerY = project::kCanvasHeight * control.y / 100.;
    return NSMakeRect(centerX - control.width * .5, centerY - control.height * .5, control.width, control.height);
}
}
} // namespace tripleside::native

using tripleside::native::NativeInstrument;
using tripleside::native::LicenseRuntime;
using tripleside::native::BarSpectrumAnalyzer;
using tripleside::native::displayedValue;
using tripleside::native::indicatorValue;
using tripleside::native::displayedParameter;
using tripleside::native::controlVisible;
using tripleside::native::equals;
using tripleside::native::interactiveKind;
using tripleside::native::hitPadVariant;
using tripleside::native::loadResourceImage;
using tripleside::native::neutralControlValue;
using tripleside::native::controlLocalPoint;
using tripleside::native::controlLayoutRect;
using tripleside::native::fillRounded;
using tripleside::native::groupParameterId;
using tripleside::native::kGroupBaseId;
using tripleside::native::panelTextAttributes;
using tripleside::native::rgbColor;
using tripleside::native::RuntimeMidiEvent;
using tripleside::native::RuntimeMidiSequence;
using tripleside::native::RuntimeMidiTempo;
using tripleside::native::RuntimeUserPreset;
using tripleside::native::strokeRounded;
using tripleside::native::startsWith;
using tripleside::native::kPrismEnabledBaseId;
using Steinberg::Vst::kNoParamId;
using Steinberg::Vst::ParamID;
namespace project = tripleside::project;

@interface TripleSideNativeMacView : NSView <NSDraggingSource> {
@private
    NativeInstrument* _instrument;
    NSMutableDictionary<NSString*, NSImage*>* _images;
    NSTimer* _timer;
    NSInteger _dragControl;
    CGFloat _dragStartY;
    float _dragStartValue;
    NSInteger _activeNote;
    NSInteger _activeNoteSamplerGroup;
    NSInteger _selectedPrismBand;
    NSInteger _dragPrismBand;
    std::array<unsigned, 128> _padTriggerGenerations;
    std::array<double, 128> _padFlashUntil;
    std::map<std::size_t, float> _visualMeterLevels;
    std::map<std::size_t, double> _visualMeterUpdatedAt;
    BarSpectrumAnalyzer _barSpectrumAnalyzer;
    double _barSpectrumUpdatedAt;
    NSInteger _openPanel;
    NSInteger _panelDragMode;
    NSInteger _mixerDragGroup;
    NSInteger _mixerDragSlot;
    NSInteger _selectedMidiSequence;
    NSInteger _playingMidiSequence;
    NSInteger _midiDragCandidate;
    NSInteger _grooveScrollOffset;
    NSInteger _presetScrollOffset;
    NSInteger _selectedPresetRow;
    NSInteger _hoveredPresetRow;
    NSInteger _hoveredControl;
    NSInteger _outputMenuControl;
    NSTrackingArea* _trackingArea;
    CGFloat _panelX, _panelY, _panelWidth, _panelHeight;
    CGFloat _panelDragX, _panelDragY, _midiDragX, _midiDragY;
    std::map<int, std::array<CGFloat, 4>> _panelRuntimeBounds;
    std::vector<RuntimeMidiSequence> _importedMidi;
    std::map<int, bool> _midiLoopOverrides;
    std::set<int> _hiddenMidiSequences;
    std::vector<RuntimeUserPreset> _userPresets;
    std::string _presetNameInput;
    BOOL _presetNameFocused;
}
- (instancetype)initWithFrame:(NSRect)frame instrument:(NativeInstrument*)instrument;
- (BOOL)hitPadFlashActive:(int)pitch;
- (float)displayedValueForControl:(std::size_t)index;
- (void)drawOpenPanel;
- (void)updateMidiPlayback;
- (NSRect)panelRect:(NSInteger)index;
- (NSRect)panelChildRect:(NSInteger)index;
- (NSRect)runtimeControlRect:(NSInteger)index;
- (NSRect)outputMenuRect:(NSInteger)index;
- (void)drawOutputMenu;
- (BOOL)handleOutputMenuMouseDown:(NSPoint)point;
- (NSInteger)panelControlAt:(NSPoint)point;
- (void)drawPanelControl:(NSInteger)index;
- (void)drawWaveformInRect:(NSRect)rect color:(unsigned)color lineWidth:(CGFloat)lineWidth samplerGroup:(int)samplerGroup;
- (void)drawBarSpectrumInRect:(NSRect)rect color:(unsigned)color barWidthRatio:(CGFloat)barWidthRatio samplerGroup:(int)samplerGroup;
- (void)drawSpectrumInRect:(NSRect)rect color:(unsigned)color samplerGroup:(int)samplerGroup;
- (void)drawVectorscopeInRect:(NSRect)rect color:(unsigned)color samplerGroup:(int)samplerGroup showCorrelation:(BOOL)showCorrelation;
- (void)drawInlineFaderMeter:(std::size_t)index rect:(NSRect)rect exact:(BOOL)exact;
- (void)drawControlValue:(std::size_t)index rect:(NSRect)rect value:(float)value;
- (BOOL)panelMouseDown:(NSPoint)point;
- (BOOL)importMidiPath:(NSString*)path;
- (std::filesystem::path)exportMidiSequence:(NSInteger)index;
- (std::vector<int>)visibleMidiSequences;
- (BOOL)midiSequenceLoopEnabled:(NSInteger)index;
- (NSString*)midiName:(NSInteger)index;
- (RuntimeUserPreset)captureUserPreset:(const std::string&)name;
- (std::filesystem::path)userPresetPath;
- (void)loadUserPresets;
- (void)persistUserPresets;
@end

@implementation TripleSideNativeMacView

- (instancetype)initWithFrame:(NSRect)frame instrument:(NativeInstrument*)instrument {
    self = [super initWithFrame:frame];
    if (self) {
        _instrument = instrument;
        _images = [NSMutableDictionary dictionary];
        _dragControl = -1;
        _activeNote = -1;
        _activeNoteSamplerGroup = -1;
        _selectedPrismBand = 0;
        while (_selectedPrismBand < 5 && !_instrument->prismBandEnabled(static_cast<int>(_selectedPrismBand))) ++_selectedPrismBand;
        if (_selectedPrismBand >= 5) _selectedPrismBand = 0;
        _dragPrismBand = -1;
        _openPanel = -1;
        _panelDragMode = 0;
        _mixerDragGroup = -1;
        _mixerDragSlot = -1;
        _selectedMidiSequence = project::kMidiSequences.empty() ? -1 : 0;
        _playingMidiSequence = -1;
        _midiDragCandidate = -1;
        _grooveScrollOffset = 0;
        _presetScrollOffset = 0;
        _selectedPresetRow = -1;
        _hoveredPresetRow = -1;
        _hoveredControl = -1;
        _outputMenuControl = -1;
        _presetNameFocused = NO;
        _panelX = 50;
        _panelY = 52;
        _panelWidth = 88;
        _panelHeight = 78;
        [self loadUserPresets];
        _padTriggerGenerations.fill(0);
        _padFlashUntil.fill(0);
        __weak TripleSideNativeMacView* weakSelf = self;
        _timer = [NSTimer scheduledTimerWithTimeInterval:(1.0 / 30.0) repeats:YES block:^(NSTimer*) {
            [weakSelf updateMidiPlayback];
            [weakSelf setNeedsDisplay:YES];
        }];
    }
    return self;
}

- (void)dealloc {
    [_timer invalidate];
    if (_instrument) _instrument->stopGroove();
    if (_activeNote >= 0 && _instrument) _instrument->queueEditorNote(static_cast<int>(_activeNote), 0, false, static_cast<int>(_activeNoteSamplerGroup));
}

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstResponder { return YES; }

- (float)displayedValueForControl:(std::size_t)index {
    const auto measured = displayedValue(*_instrument, index, _selectedPrismBand);
    if (index >= project::kControls.size()) return measured;
    const auto& control = project::kControls[index];
    if (!equals(control.kind, "gain_meter") && !equals(control.kind, "vu_meter")) return measured;
    const auto now = NSProcessInfo.processInfo.systemUptime;
    auto& updatedAt = _visualMeterUpdatedAt[index];
    const auto elapsedMs = updatedAt > 0 ? std::clamp((now - updatedAt) * 1000., 1., 250.) : (1000. / 30.);
    updatedAt = now;
    auto& smoothed = _visualMeterLevels[index];
    const bool reduction = equals(control.parameter, "gain_reduction");
    const auto timeConstantMs = measured > smoothed
        ? (reduction ? 32. : equals(control.kind, "vu_meter") ? 45. : 28.)
        : (reduction ? 360. : equals(control.kind, "vu_meter") ? 420. : 320.);
    const auto alpha = 1. - std::exp(-elapsedMs / timeConstantMs);
    smoothed += static_cast<float>(alpha * (measured - smoothed));
    return std::clamp(smoothed, 0.f, 1.f);
}

- (void)drawInlineFaderMeter:(std::size_t)index rect:(NSRect)rect exact:(BOOL)exact {
    if (index >= project::kControls.size()) return;
    const auto& control = project::kControls[index];
    if (!control.faderMeterEnabled) return;
    const float left = control.samplerGroupIndex >= 0 ? _instrument->groupOutputPeak(control.samplerGroupIndex, 0) : _instrument->outputPeak(0);
    const float right = control.samplerGroupIndex >= 0 ? _instrument->groupOutputPeak(control.samplerGroupIndex, 1) : _instrument->outputPeak(1);
    const float measured = std::clamp(std::max(left, right) * 1.5f, 0.f, 1.f);
    const auto now = NSProcessInfo.processInfo.systemUptime;
    auto& updatedAt = _visualMeterUpdatedAt[index];
    const auto elapsedMs = updatedAt > 0 ? std::clamp((now - updatedAt) * 1000., 1., 250.) : (1000. / 30.);
    updatedAt = now;
    auto& smoothed = _visualMeterLevels[index];
    const auto alpha = 1. - std::exp(-elapsedMs / (measured > smoothed ? 28. : 320.));
    smoothed += static_cast<float>(alpha * (measured - smoothed));
    NSRect track = rect;
    if (!exact) {
        const CGFloat layoutWidth = std::max<CGFloat>(1, NSWidth(rect) - 8), contentTop = NSMinY(rect) + 18, contentBottom = NSMaxY(rect) - 4;
        const CGFloat contentHeight = std::max<CGFloat>(1, contentBottom - contentTop), meterWidth = std::min<CGFloat>(control.faderMeterWidth, layoutWidth);
        const CGFloat gap = std::min<CGFloat>(control.faderMeterGap, std::max<CGFloat>(0, layoutWidth - meterWidth));
        const CGFloat faderWidth = std::max<CGFloat>(1, std::min({layoutWidth * .72, contentHeight, layoutWidth - meterWidth - gap}));
        const CGFloat groupWidth = faderWidth + gap + meterWidth, start = NSMidX(rect) - groupWidth * .5;
        const CGFloat meterLeft = equals(control.faderMeterPosition, "left") ? start : start + faderWidth + gap;
        const CGFloat meterHeight = contentHeight * std::clamp(control.faderMeterHeight / 100., .2, 1.);
        track = NSMakeRect(meterLeft, contentTop + (contentHeight - meterHeight) * .5, meterWidth, meterHeight);
    }
    if (!exact) fillRounded(track, NSWidth(track) * .5, rgbColor(0xffffff, .035));
    const CGFloat inset = std::min<CGFloat>(1, NSWidth(track) * .18), innerHeight = std::max<CGFloat>(0, NSHeight(track) - inset * 2);
    const CGFloat fillHeight = innerHeight * std::clamp<CGFloat>(smoothed, 0, 1);
    if (fillHeight > 0) {
        const NSRect fill = NSMakeRect(NSMinX(track) + inset, NSMaxY(track) - inset - fillHeight, std::max<CGFloat>(1, NSWidth(track) - inset * 2), fillHeight);
        NSBezierPath* path = [NSBezierPath bezierPathWithRoundedRect:fill xRadius:std::max<CGFloat>(1, NSWidth(fill) * .5) yRadius:std::max<CGFloat>(1, NSWidth(fill) * .5)];
        const unsigned color = control.faderMeterColorRgb; const CGFloat red = ((color >> 16) & 255) / 255., green = ((color >> 8) & 255) / 255., blue = (color & 255) / 255.;
        NSGradient* gradient = [[NSGradient alloc] initWithColorsAndLocations:[NSColor colorWithCalibratedRed:red * .76 green:green * .76 blue:blue * .76 alpha:1], 0., [NSColor colorWithCalibratedRed:red green:green blue:blue alpha:1], .72, [NSColor colorWithCalibratedRed:red + (1-red) * .28 green:green + (1-green) * .28 blue:blue + (1-blue) * .28 alpha:1], 1., nil];
        [gradient drawInBezierPath:path angle:90];
    }
}

- (void)drawControlValue:(std::size_t)index rect:(NSRect)rect value:(float)value {
    if (index >= project::kControls.size()) return; const auto& control = project::kControls[index]; const NSInteger percent = std::lround(std::clamp(value, 0.f, 1.f) * 100); NSString* text = nil;
    if (control.moduleIndex >= 0 && equals(control.parameter, "tuning")) { const NSInteger amount = std::lround(value * 48) - 24; text = [NSString stringWithFormat:amount >= 0 ? @"+%ld st" : @"%ld st", (long)amount]; }
    else if (control.moduleIndex >= 0 && equals(control.parameter, "fine_tune")) { const NSInteger amount = std::lround(value * 200) - 100; text = [NSString stringWithFormat:amount >= 0 ? @"+%ld ct" : @"%ld ct", (long)amount]; }
    else if (equals(control.parameter, "pan") || startsWith(control.variant, "pan-")) text = percent == 50 ? @"C" : percent < 50 ? [NSString stringWithFormat:@"L%ld", (long)(100-percent*2)] : [NSString stringWithFormat:@"R%ld", (long)((percent-50)*2)];
    else if (equals(control.kind, "fader") && (equals(control.parameter, "input") || equals(control.parameter, "output"))) { const CGFloat db = equals(control.parameter, "input") ? value * 24 - 12 : value * 16 - 12; text = std::abs(db) < .05 ? @"0 dB" : [NSString stringWithFormat:db > 0 ? @"+%.1f dB" : @"%.1f dB", db]; }
    else text = [NSString stringWithFormat:equals(control.kind, "fader") ? @"%ld%%" : @"%ld", (long)percent];
    NSFont* font = [NSFont monospacedSystemFontOfSize:8 weight:NSFontWeightHeavy]; NSDictionary* attributes = @{NSFontAttributeName:font, NSForegroundColorAttributeName:equals(control.kind, "fader") ? rgbColor(0xf4f4f5) : rgbColor(0xf3e4be)}; const NSSize size = [text sizeWithAttributes:attributes]; const CGFloat width = std::max<CGFloat>(24, size.width + 10), height = 14; const BOOL fader = equals(control.kind, "fader"); const CGFloat center = fader ? NSMidX(rect) : NSMaxX(rect) - NSWidth(rect) * .08 - width * .5, bottom = fader ? NSMaxY(rect) - 2 : NSMaxY(rect) - NSHeight(rect) * .07; const NSRect pill = NSMakeRect(center - width * .5, bottom - height, width, height); fillRounded(pill, 7, rgbColor(0x050505, fader ? .84 : .78)); [text drawInRect:NSMakeRect(NSMinX(pill)+5, NSMinY(pill)+2, NSWidth(pill)-10, NSHeight(pill)-2) withAttributes:attributes];
}

- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    if (_trackingArea) [self removeTrackingArea:_trackingArea];
    _trackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
        options:NSTrackingMouseMoved | NSTrackingMouseEnteredAndExited | NSTrackingActiveInActiveApp | NSTrackingInVisibleRect
        owner:self userInfo:nil];
    [self addTrackingArea:_trackingArea];
}

- (BOOL)hitPadFlashActive:(int)pitch {
    if (pitch < 0 || pitch >= 128) return NO;
    const auto index = static_cast<std::size_t>(pitch);
    const auto generation = _instrument->noteTriggerCount(pitch);
    const double now = [[NSProcessInfo processInfo] systemUptime];
    if (generation != _padTriggerGenerations[index]) {
        _padTriggerGenerations[index] = generation;
        _padFlashUntil[index] = now + .115;
    }
    return now < _padFlashUntil[index];
}

- (NSImage*)imageNamed:(const char*)name {
    if (!name || !*name) return nil;
    NSString* key = [NSString stringWithUTF8String:name];
    NSImage* image = _images[key];
    if (!image) {
        image = loadResourceImage(key);
        if (image) _images[key] = image;
    }
    return image;
}

- (void)canvasScale:(CGFloat*)scale offsetX:(CGFloat*)offsetX offsetY:(CGFloat*)offsetY {
    const CGFloat sx = self.bounds.size.width / std::max(1, project::kCanvasWidth);
    const CGFloat sy = self.bounds.size.height / std::max(1, project::kCanvasHeight);
    *scale = std::min(sx, sy);
    *offsetX = (self.bounds.size.width - project::kCanvasWidth * *scale) * .5;
    *offsetY = (self.bounds.size.height - project::kCanvasHeight * *scale) * .5;
}

- (NSPoint)designPoint:(NSPoint)point {
    CGFloat scale = 1, offsetX = 0, offsetY = 0;
    [self canvasScale:&scale offsetX:&offsetX offsetY:&offsetY];
    return NSMakePoint((point.x - offsetX) / std::max<CGFloat>(scale, .0001),
                       (point.y - offsetY) / std::max<CGFloat>(scale, .0001));
}

- (NSRect)panelRect:(NSInteger)index {
    if (index < 0 || static_cast<std::size_t>(index) >= project::kPanelControls.size()) return NSZeroRect;
    const auto& panel = project::kPanelControls[static_cast<std::size_t>(index)];
    const CGFloat x = index == _openPanel ? _panelX : panel.panelX;
    const CGFloat y = index == _openPanel ? _panelY : panel.panelY;
    const CGFloat widthPercent = index == _openPanel ? _panelWidth : panel.panelWidth;
    const CGFloat heightPercent = index == _openPanel ? _panelHeight : panel.panelHeight;
    const CGFloat width = project::kCanvasWidth * widthPercent / 100.;
    const CGFloat height = project::kCanvasHeight * heightPercent / 100.;
    const CGFloat left = std::clamp(project::kCanvasWidth * x / 100. - width * .5, 0., std::max<CGFloat>(0, project::kCanvasWidth - width));
    const CGFloat top = std::clamp(project::kCanvasHeight * y / 100. - height * .5, 0., std::max<CGFloat>(0, project::kCanvasHeight - height));
    return NSMakeRect(left, top, width, height);
}

- (NSRect)panelChildRect:(NSInteger)index {
    if (index < 0 || static_cast<std::size_t>(index) >= project::kControls.size()) return NSZeroRect;
    const NSInteger parent = project::kPanelControls[static_cast<std::size_t>(index)].parentPanelIndex;
    if (parent < 0) return NSZeroRect;
    const auto& control = project::kControls[static_cast<std::size_t>(index)];
    const NSRect panel = [self panelRect:parent];
    const CGFloat contentTop = NSMinY(panel) + 44;
    const CGFloat width = std::min<CGFloat>(control.width, NSWidth(panel) - 16);
    const CGFloat height = std::min<CGFloat>(control.height, NSMaxY(panel) - contentTop - 12);
    const CGFloat centerX = NSMinX(panel) + NSWidth(panel) * control.x / 100.;
    const CGFloat centerY = contentTop + (NSMaxY(panel) - contentTop) * control.y / 100.;
    const CGFloat left = std::clamp(centerX - width * .5, NSMinX(panel) + 8, NSMaxX(panel) - 8 - width);
    const CGFloat top = std::clamp(centerY - height * .5, contentTop, NSMaxY(panel) - 8 - height);
    return NSMakeRect(left, top, width, height);
}

- (NSRect)runtimeControlRect:(NSInteger)index {
    if (index < 0 || static_cast<std::size_t>(index) >= project::kControls.size()) return NSZeroRect;
    if (project::kPanelControls[static_cast<std::size_t>(index)].parentPanelIndex >= 0) return [self panelChildRect:index];
    const auto& control = project::kControls[static_cast<std::size_t>(index)];
    if (static_cast<std::size_t>(index) < project::kVisualControls.size()) {
        const auto& visual = project::kVisualControls[static_cast<std::size_t>(index)];
        if (visual.hw > 0 && visual.hh > 0) return controlLayoutRect(control, visual);
    }
    return NSMakeRect(project::kCanvasWidth * control.x / 100. - control.width * .5,
                      project::kCanvasHeight * control.y / 100. - control.height * .5,
                      control.width, control.height);
}

- (NSRect)outputMenuRect:(NSInteger)index {
    const NSRect anchor = [self runtimeControlRect:index];
    const CGFloat width = std::min<CGFloat>(std::max<CGFloat>(96, NSWidth(anchor)), project::kCanvasWidth - 8);
    const CGFloat height = 64;
    const CGFloat left = std::clamp<CGFloat>(NSMinX(anchor), 4, project::kCanvasWidth - width - 4);
    CGFloat top = NSMaxY(anchor) + 4;
    if (top + height > project::kCanvasHeight - 4) top = std::max<CGFloat>(4, NSMinY(anchor) - height - 4);
    return NSMakeRect(left, top, width, height);
}

- (void)drawOutputMenu {
    if (_outputMenuControl < 0 || static_cast<std::size_t>(_outputMenuControl) >= project::kControls.size()
        || !controlVisible(static_cast<std::size_t>(_outputMenuControl))) return;
    const auto& control = project::kControls[static_cast<std::size_t>(_outputMenuControl)];
    if (!equals(control.kind, "output_selector")) return;
    const NSRect menu = [self outputMenuRect:_outputMenuControl];
    const CGFloat rowHeight = (NSHeight(menu) - 8) * .5;
    const auto parameter = displayedParameter(*_instrument, static_cast<std::size_t>(_outputMenuControl), _selectedPrismBand);
    const BOOL selected = parameter != kNoParamId && _instrument->getParamNormalized(parameter) >= .5;
    fillRounded(menu, 8, rgbColor(0x09090b, .99));
    strokeRounded(NSInsetRect(menu, .5, .5), 8, rgbColor(0xffffff, .14));
    for (NSInteger row = 0; row < 2; ++row) {
        const NSRect item = NSMakeRect(NSMinX(menu) + 4, NSMinY(menu) + 4 + row * rowHeight, NSWidth(menu) - 8, rowHeight);
        const BOOL active = row == (selected ? 1 : 0);
        if (active) fillRounded(item, 5, rgbColor(project::kAccentRgb, .16));
        NSString* label = @"Master";
        if (row) {
            NSInteger bus = 1;
            if (control.samplerGroupIndex >= 0) bus = project::kGroups[static_cast<std::size_t>(control.samplerGroupIndex)].outputBusIndex;
            label = [NSString stringWithFormat:@"Out%ld", static_cast<long>(bus)];
        }
        [label drawInRect:NSMakeRect(NSMinX(item) + 9, NSMinY(item), NSWidth(item) - 31, NSHeight(item))
           withAttributes:panelTextAttributes(10, active ? rgbColor(project::kAccentRgb) : rgbColor(control.textColorRgb), NSTextAlignmentLeft, NSFontWeightSemibold)];
        if (active) {
            [rgbColor(project::kAccentRgb) setFill];
            [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(NSMaxX(item) - 14.5, NSMidY(item) - 2.5, 5, 5)] fill];
        }
    }
}

- (BOOL)handleOutputMenuMouseDown:(NSPoint)point {
    if (_outputMenuControl < 0) return NO;
    const NSInteger index = _outputMenuControl;
    const NSRect menu = [self outputMenuRect:index];
    if (NSPointInRect(point, menu)) {
        const CGFloat rowHeight = (NSHeight(menu) - 8) * .5;
        const NSInteger row = std::clamp<NSInteger>(static_cast<NSInteger>((point.y - NSMinY(menu) - 4) / std::max<CGFloat>(1, rowHeight)), 0, 1);
        [self setControl:index value:row ? 1.f : 0.f];
        _outputMenuControl = -1;
        _dragControl = -1;
        [self setNeedsDisplay:YES];
        return YES;
    }
    if (NSPointInRect(point, [self runtimeControlRect:index])) {
        _outputMenuControl = -1;
        _dragControl = -1;
        [self setNeedsDisplay:YES];
        return YES;
    }
    _outputMenuControl = -1;
    [self setNeedsDisplay:YES];
    return NO;
}

- (NSInteger)panelControlAt:(NSPoint)point {
    if (_openPanel < 0) return -1;
    for (NSInteger index = static_cast<NSInteger>(project::kControls.size()) - 1; index >= 0; --index) {
        if (project::kPanelControls[static_cast<std::size_t>(index)].parentPanelIndex != _openPanel) continue;
        const auto& control = project::kControls[static_cast<std::size_t>(index)];
        if (!interactiveKind(control.kind)) continue;
        if (NSPointInRect(point, [self panelChildRect:index])) return index;
    }
    return -1;
}

- (void)setParameter:(ParamID)parameter value:(float)value {
    if (parameter == kNoParamId) return;
    value = std::clamp(value, 0.f, 1.f);
    if (value >= .5f && parameter >= kGroupBaseId && parameter < kGroupBaseId + project::kGroups.size() * 4) {
        const int slot = (parameter - kGroupBaseId) % 4;
        if (slot == 2 || slot == 3) { const auto opposite = parameter + (slot == 2 ? 1 : -1); _instrument->beginEdit(opposite); _instrument->setParamNormalized(opposite, 0); _instrument->performEdit(opposite, 0); _instrument->endEdit(opposite); }
    }
    _instrument->beginEdit(parameter);
    _instrument->setParamNormalized(parameter, value);
    _instrument->performEdit(parameter, value);
    _instrument->endEdit(parameter);
}

- (void)openPanel:(NSInteger)index {
    if (index < 0 || static_cast<std::size_t>(index) >= project::kControls.size()) return;
    const auto& info = project::kPanelControls[static_cast<std::size_t>(index)];
    if (!equals(project::kControls[static_cast<std::size_t>(index)].kind, "panel_button") || !info.panelType || !*info.panelType) return;
    if (_openPanel >= 0) _panelRuntimeBounds[static_cast<int>(_openPanel)] = {_panelX, _panelY, _panelWidth, _panelHeight};
    _openPanel = index;
    if (const auto saved = _panelRuntimeBounds.find(static_cast<int>(index)); saved != _panelRuntimeBounds.end()) {
        _panelX = saved->second[0]; _panelY = saved->second[1];
        _panelWidth = saved->second[2]; _panelHeight = saved->second[3];
    } else {
        _panelX = info.panelX; _panelY = info.panelY;
        _panelWidth = info.panelWidth; _panelHeight = info.panelHeight;
    }
    [self.window invalidateCursorRectsForView:self];
    [self setNeedsDisplay:YES];
}

- (void)closePanel {
    if (_openPanel >= 0) _panelRuntimeBounds[static_cast<int>(_openPanel)] = {_panelX, _panelY, _panelWidth, _panelHeight};
    _openPanel = -1;
    _panelDragMode = 0;
    _mixerDragGroup = -1;
    _mixerDragSlot = -1;
    _midiDragCandidate = -1;
    _presetNameFocused = NO;
    _hoveredPresetRow = -1;
    [self.window invalidateCursorRectsForView:self];
    [self setNeedsDisplay:YES];
}

- (BOOL)midiSequenceLoopEnabled:(NSInteger)index {
    const NSInteger embedded = static_cast<NSInteger>(project::kMidiSequences.size());
    if (index < 0 || index >= embedded + static_cast<NSInteger>(_importedMidi.size())) return NO;
    if (const auto found = _midiLoopOverrides.find(static_cast<int>(index)); found != _midiLoopOverrides.end()) return found->second;
    return index < embedded ? project::kMidiSequences[static_cast<std::size_t>(index)].loopEnabled
                            : _importedMidi[static_cast<std::size_t>(index - embedded)].loopEnabled;
}

- (std::vector<int>)visibleMidiSequences {
    std::vector<int> result;
    const int count = static_cast<int>(project::kMidiSequences.size() + _importedMidi.size());
    for (int index = 0; index < count; ++index) if (!_hiddenMidiSequences.contains(index)) result.push_back(index);
    return result;
}

- (NSString*)midiName:(NSInteger)index {
    if (index < 0) return @"";
    const NSInteger embedded = static_cast<NSInteger>(project::kMidiSequences.size());
    if (index < embedded) return [NSString stringWithUTF8String:project::kMidiSequences[static_cast<std::size_t>(index)].name ?: ""];
    const auto runtime = static_cast<std::size_t>(index - embedded);
    return runtime < _importedMidi.size() ? [NSString stringWithUTF8String:_importedMidi[runtime].name.c_str()] : @"";
}

- (void)stopMidiSequence {
    _instrument->stopGroove();
    _playingMidiSequence = -1;
}

- (void)startMidiSequence:(NSInteger)index {
    [self stopMidiSequence];
    const NSInteger count = static_cast<NSInteger>(project::kMidiSequences.size());
    if (index < 0 || index >= count) return;
    _selectedMidiSequence = index;
    _playingMidiSequence = index;
    _instrument->startGroove(static_cast<int>(index), [self midiSequenceLoopEnabled:index]);
}

- (void)drawOpenPanel {
    if (_openPanel < 0 || static_cast<std::size_t>(_openPanel) >= project::kControls.size()) return;
    const NSRect panelRect = [self panelRect:_openPanel];
    const auto& panel = project::kPanelControls[static_cast<std::size_t>(_openPanel)];
    NSColor* accent = rgbColor(project::kAccentRgb);
    fillRounded(panelRect, 18, rgbColor(0x09090b, .99));
    strokeRounded(NSInsetRect(panelRect, .5, .5), 18, rgbColor(project::kAccentRgb, .48));

    const NSRect header = NSMakeRect(NSMinX(panelRect), NSMinY(panelRect), NSWidth(panelRect), 44);
    [[NSColor colorWithCalibratedWhite:1 alpha:.035] setFill];
    [[NSBezierPath bezierPathWithRoundedRect:header xRadius:18 yRadius:18] fill];
    [rgbColor(0xffffff, .08) setFill];
    NSRectFill(NSMakeRect(NSMinX(panelRect), NSMaxY(header) - 1, NSWidth(panelRect), 1));
    NSString* type = equals(panel.panelType, "preset_browser") ? @"PRESET BROWSER" : equals(panel.panelType, "mixer") ? @"MIXER" : @"GROOVE BROWSER";
    [type drawInRect:NSMakeRect(NSMinX(panelRect) + 16, NSMinY(panelRect) + 15, NSWidth(panelRect) - 64, 15)
      withAttributes:panelTextAttributes(8, rgbColor(project::kAccentRgb), NSTextAlignmentLeft, NSFontWeightBold)];
    const NSRect close = NSMakeRect(NSMaxX(panelRect) - 39, NSMinY(panelRect) + 8, 27, 27);
    fillRounded(close, 14, rgbColor(0xffffff, .05));
    [rgbColor(0xa1a1aa) setStroke]; NSBezierPath* closeIcon = [NSBezierPath bezierPath]; closeIcon.lineWidth = 1.5;
    [closeIcon moveToPoint:NSMakePoint(NSMidX(close) - 4.5, NSMidY(close) - 4.5)]; [closeIcon lineToPoint:NSMakePoint(NSMidX(close) + 4.5, NSMidY(close) + 4.5)];
    [closeIcon moveToPoint:NSMakePoint(NSMidX(close) + 4.5, NSMidY(close) - 4.5)]; [closeIcon lineToPoint:NSMakePoint(NSMidX(close) - 4.5, NSMidY(close) + 4.5)]; [closeIcon stroke];

    const CGFloat left = NSMinX(panelRect) + 16;
    const CGFloat right = NSMaxX(panelRect) - 16;
    const CGFloat top = NSMinY(panelRect) + 60;
    if (equals(panel.panelType, "midi_map")) {
        [@"GROOVE LIBRARY" drawInRect:NSMakeRect(left, top, 180, 14)
            withAttributes:panelTextAttributes(8, rgbColor(0xa1a1aa), NSTextAlignmentLeft, NSFontWeightBold)];
        const auto visible = [self visibleMidiSequences];
        const CGFloat rowStart = top + 23;
        const NSInteger capacity = std::max<NSInteger>(1, static_cast<NSInteger>((NSMaxY(panelRect) - 12 - rowStart + 6) / 53));
        const NSInteger maxOffset = std::max<NSInteger>(0, static_cast<NSInteger>(visible.size()) - capacity);
        _grooveScrollOffset = std::clamp(_grooveScrollOffset, static_cast<NSInteger>(0), maxOffset);
        const BOOL scrollable = maxOffset > 0;
        const CGFloat contentRight = right - (scrollable ? 12 : 0);
        CGFloat rowTop = rowStart;
        for (NSInteger rowIndex = 0; rowIndex < capacity && _grooveScrollOffset + rowIndex < static_cast<NSInteger>(visible.size()); ++rowIndex) {
            const int sourceIndex = visible[static_cast<std::size_t>(_grooveScrollOffset + rowIndex)];
            const BOOL selected = sourceIndex == _selectedMidiSequence;
            const BOOL playing = sourceIndex == _playingMidiSequence;
            const NSRect row = NSMakeRect(left, rowTop, contentRight - left, 47);
            fillRounded(row, 10, selected ? rgbColor(project::kAccentRgb, .11) : rgbColor(0xffffff, .025));
            strokeRounded(NSInsetRect(row, .5, .5), 10, selected ? rgbColor(project::kAccentRgb, .58) : rgbColor(0xffffff, .07));
            [@"♫" drawInRect:NSMakeRect(left + 9, rowTop + 14, 18, 18)
              withAttributes:panelTextAttributes(14, selected ? accent : rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightMedium)];
            NSString* name = [self midiName:sourceIndex];
            [name drawInRect:NSMakeRect(left + 34, rowTop + 8, std::max<CGFloat>(40, NSWidth(row) - 112), 15)
              withAttributes:panelTextAttributes(10, rgbColor(0xe4e4e7), NSTextAlignmentLeft, NSFontWeightBold)];
            int duration = 0, ppq = 480; float bpm = 120;
            if (sourceIndex < static_cast<int>(project::kMidiSequences.size())) {
                const auto& sequence = project::kMidiSequences[static_cast<std::size_t>(sourceIndex)];
                duration = sequence.durationTicks; ppq = sequence.ppq;
                if (sequence.tempoCount > 0) bpm = project::kMidiTempos[static_cast<std::size_t>(sequence.tempoOffset)].bpm;
            } else {
                const auto& sequence = _importedMidi[static_cast<std::size_t>(sourceIndex - static_cast<int>(project::kMidiSequences.size()))];
                duration = sequence.durationTicks; ppq = sequence.ppq; if (!sequence.tempos.empty()) bpm = sequence.tempos.front().bpm;
            }
            NSString* meta = [NSString stringWithFormat:@"%d bar · %.0f BPM", std::max(1, static_cast<int>(std::ceil(duration / std::max(1., ppq * 4.)))), bpm];
            [meta drawInRect:NSMakeRect(left + 34, rowTop + 25, std::max<CGFloat>(40, NSWidth(row) - 112), 13)
              withAttributes:panelTextAttributes(8, rgbColor(0x71717a), NSTextAlignmentLeft, NSFontWeightMedium)];
            const NSRect loop = NSMakeRect(contentRight - 64, rowTop + 9, 30, 28);
            fillRounded(loop, 9, [self midiSequenceLoopEnabled:sourceIndex] ? rgbColor(project::kAccentRgb, .26) : rgbColor(0xffffff, .05));
            [@"↻" drawInRect:NSMakeRect(NSMinX(loop), NSMinY(loop) + 6, 30, 15)
              withAttributes:panelTextAttributes(12, [self midiSequenceLoopEnabled:sourceIndex] ? accent : rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightBold)];
            const NSRect play = NSMakeRect(contentRight - 30, rowTop + 9, 30, 28);
            fillRounded(play, 9, accent);
            [(playing ? @"■" : @"▶") drawInRect:NSMakeRect(NSMinX(play), NSMinY(play) + 7, 30, 14)
              withAttributes:panelTextAttributes(10, NSColor.whiteColor, NSTextAlignmentCenter, NSFontWeightBold)];
            rowTop += 53;
        }
        if (scrollable) {
            const CGFloat trackHeight = std::max<CGFloat>(1, NSMaxY(panelRect) - 12 - rowStart);
            const CGFloat thumbHeight = std::max<CGFloat>(28, trackHeight * capacity / visible.size());
            const CGFloat thumbTop = rowStart + (trackHeight - thumbHeight) * _grooveScrollOffset / std::max<NSInteger>(1, maxOffset);
            fillRounded(NSMakeRect(right - 6, rowStart, 6, trackHeight), 3, rgbColor(0xffffff, .07));
            fillRounded(NSMakeRect(right - 6, thumbTop, 6, thumbHeight), 3, rgbColor(project::kAccentRgb, .65));
        }
        if (visible.empty()) [@"Belum ada groove pada project ini." drawInRect:NSMakeRect(left, rowStart, right - left, 80)
            withAttributes:panelTextAttributes(10, rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightMedium)];
    } else if (equals(panel.panelType, "preset_browser")) {
        const NSRect field = NSMakeRect(left, top, std::max<CGFloat>(80, right - left - 156), 35);
        fillRounded(field, 9, rgbColor(0x09090b)); strokeRounded(NSInsetRect(field, .5, .5), 9, rgbColor(0xffffff, .10));
        NSString* presetFieldText = _presetNameInput.empty() ? @"Nama preset baru" : [NSString stringWithUTF8String:_presetNameInput.c_str()];
        [presetFieldText drawInRect:NSInsetRect(field, 10, 10)
           withAttributes:panelTextAttributes(10, _presetNameInput.empty() ? rgbColor(0x71717a) : rgbColor(0xf4f4f5), NSTextAlignmentLeft, NSFontWeightRegular)];
        const NSRect save = NSMakeRect(NSMaxX(field) + 8, top, right - NSMaxX(field) - 8, 35);
        fillRounded(save, 9, accent);
        [@"▣  Simpan kondisi" drawInRect:NSMakeRect(NSMinX(save) + 6, NSMinY(save) + 10, NSWidth(save) - 12, 15)
          withAttributes:panelTextAttributes(9, NSColor.whiteColor, NSTextAlignmentCenter, NSFontWeightBold)];
        const NSInteger total = static_cast<NSInteger>(project::kPresets.size() + _userPresets.size());
        const CGFloat rowStart = top + 47;
        const NSInteger capacity = std::max<NSInteger>(1, static_cast<NSInteger>((NSMaxY(panelRect) - 12 - rowStart + 6) / 47));
        const NSInteger maxOffset = std::max<NSInteger>(0, total - capacity);
        _presetScrollOffset = std::clamp(_presetScrollOffset, static_cast<NSInteger>(0), maxOffset);
        const BOOL scrollable = maxOffset > 0;
        const CGFloat contentRight = right - (scrollable ? 12 : 0);
        CGFloat y = rowStart;
        for (NSInteger slot = 0; slot < capacity && _presetScrollOffset + slot < total; ++slot, y += 47) {
            const NSInteger absolute = _presetScrollOffset + slot;
            const BOOL user = absolute >= static_cast<NSInteger>(project::kPresets.size());
            const NSInteger userIndex = absolute - static_cast<NSInteger>(project::kPresets.size());
            NSString* name = user ? [NSString stringWithUTF8String:_userPresets[static_cast<std::size_t>(userIndex)].name.c_str()]
                                  : [NSString stringWithUTF8String:project::kPresets[static_cast<std::size_t>(absolute)].name ?: "Preset"];
            const BOOL selected = absolute == _selectedPresetRow, hovered = absolute == _hoveredPresetRow;
            const NSRect row = NSMakeRect(left, y, contentRight - left, 41);
            fillRounded(row, 10, selected ? rgbColor(project::kAccentRgb, .11) : hovered ? rgbColor(project::kAccentRgb, .065) : rgbColor(0xffffff, .025));
            strokeRounded(NSInsetRect(row, .5, .5), 10, selected ? rgbColor(project::kAccentRgb, .58) : hovered ? rgbColor(project::kAccentRgb, .32) : rgbColor(0xffffff, .08));
            [name drawInRect:NSMakeRect(left + 14, y + 7, NSWidth(row) - (user ? 104 : 76), 16)
              withAttributes:panelTextAttributes(10, rgbColor(0xe4e4e7), NSTextAlignmentLeft, NSFontWeightBold)];
            [(user ? @"USER" : @"FACTORY") drawInRect:NSMakeRect(user ? contentRight - 95 : contentRight - 68, y + 9, 58, 14)
              withAttributes:panelTextAttributes(7, selected ? accent : rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightBold)];
            if (user) {
                fillRounded(NSMakeRect(contentRight - 27, y + 7, 27, 27), 7, rgbColor(0xffffff, .05));
                [rgbColor(0xfb7185) setStroke]; NSBezierPath* removeIcon = [NSBezierPath bezierPath]; removeIcon.lineWidth = 1.4;
                [removeIcon moveToPoint:NSMakePoint(contentRight - 19, y + 15)]; [removeIcon lineToPoint:NSMakePoint(contentRight - 8, y + 26)];
                [removeIcon moveToPoint:NSMakePoint(contentRight - 8, y + 15)]; [removeIcon lineToPoint:NSMakePoint(contentRight - 19, y + 26)]; [removeIcon stroke];
            }
        }
        if (scrollable) {
            const CGFloat trackHeight = std::max<CGFloat>(1, NSMaxY(panelRect) - 12 - rowStart);
            const CGFloat thumbHeight = std::max<CGFloat>(28, trackHeight * capacity / std::max<NSInteger>(1, total));
            const CGFloat thumbTop = rowStart + (trackHeight - thumbHeight) * _presetScrollOffset / std::max<NSInteger>(1, maxOffset);
            fillRounded(NSMakeRect(right - 6, rowStart, 6, trackHeight), 3, rgbColor(0xffffff, .07));
            fillRounded(NSMakeRect(right - 6, thumbTop, 6, thumbHeight), 3, rgbColor(project::kAccentRgb, .65));
        }
        if (!total) [@"Belum ada preset. Atur suara lalu simpan kondisi saat ini." drawInRect:NSMakeRect(left, top + 50, right - left, 100)
            withAttributes:panelTextAttributes(10, rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightMedium)];
    } else if (equals(panel.panelType, "mixer") && panel.mixerShowDefaultControls) {
        CGFloat x = left;
        for (std::size_t index = 0; index < project::kGroups.size() && x + 112 <= right; ++index, x += 122) {
            const NSRect channel = NSMakeRect(x, top, 112, std::max<CGFloat>(40, std::min<CGFloat>(159, NSMaxY(panelRect) - top - 16)));
            fillRounded(channel, 12, rgbColor(0xffffff, .025)); strokeRounded(NSInsetRect(channel, .5, .5), 12, rgbColor(0xffffff, .08));
            NSString* name = [NSString stringWithUTF8String:project::kGroups[index].name ?: "Group"];
            [name drawInRect:NSMakeRect(x + 11, top + 11, 90, 14) withAttributes:panelTextAttributes(9, rgbColor(0xe4e4e7), NSTextAlignmentLeft, NSFontWeightBold)];
            const float volume = _instrument->getParamNormalized(groupParameterId(static_cast<int>(index), 0));
            const float pan = _instrument->getParamNormalized(groupParameterId(static_cast<int>(index), 1));
            [@"VOL" drawInRect:NSMakeRect(x + 11, top + 35, 90, 11) withAttributes:panelTextAttributes(7, rgbColor(0x71717a), NSTextAlignmentLeft, NSFontWeightMedium)];
            fillRounded(NSMakeRect(x + 11, top + 53, 90, 5), 3, rgbColor(0xffffff, .10));
            fillRounded(NSMakeRect(x + 11, top + 53, 90 * volume, 5), 3, accent);
            [accent setFill]; [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(x + 5 + 90 * volume, top + 49.5, 12, 12)] fill];
            [@"PAN" drawInRect:NSMakeRect(x + 11, top + 80, 90, 11) withAttributes:panelTextAttributes(7, rgbColor(0x71717a), NSTextAlignmentLeft, NSFontWeightMedium)];
            fillRounded(NSMakeRect(x + 11, top + 98, 90, 5), 3, rgbColor(0xffffff, .10));
            fillRounded(NSMakeRect(x + 11, top + 98, 90 * pan, 5), 3, accent);
            [accent setFill]; [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(x + 5 + 90 * pan, top + 94.5, 12, 12)] fill];
            for (int slot = 2; slot <= 3; ++slot) {
                const NSRect button = NSMakeRect(x + 11 + (slot - 2) * 47.5, top + 126, 42.5, 22);
                fillRounded(button, 6, _instrument->getParamNormalized(groupParameterId(static_cast<int>(index), slot)) >= .5 ? accent : rgbColor(0x27272a));
                [(slot == 2 ? @"M" : @"S") drawInRect:NSMakeRect(NSMinX(button), NSMinY(button) + 5, NSWidth(button), 12)
                  withAttributes:panelTextAttributes(8, NSColor.whiteColor, NSTextAlignmentCenter, NSFontWeightBold)];
            }
        }
        if (project::kGroups.empty()) [@"Belum ada sampler group untuk ditampilkan." drawInRect:NSMakeRect(left, top + 20, right - left, 100)
            withAttributes:panelTextAttributes(10, rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightMedium)];
    }
    for (std::size_t index = 0; index < project::kControls.size(); ++index)
        if (project::kPanelControls[index].parentPanelIndex == _openPanel) [self drawPanelControl:static_cast<NSInteger>(index)];
    const NSRect resize = NSMakeRect(NSMaxX(panelRect) - 22, NSMaxY(panelRect) - 22, 20, 20);
    [accent setStroke];
    NSBezierPath* grip = [NSBezierPath bezierPath]; grip.lineWidth = 1.5;
    [grip moveToPoint:NSMakePoint(NSMinX(resize) + 7, NSMaxY(resize) - 2)]; [grip lineToPoint:NSMakePoint(NSMaxX(resize) - 2, NSMinY(resize) + 7)];
    [grip moveToPoint:NSMakePoint(NSMinX(resize) + 13, NSMaxY(resize) - 2)]; [grip lineToPoint:NSMakePoint(NSMaxX(resize) - 2, NSMinY(resize) + 13)]; [grip stroke];
}

- (RuntimeUserPreset)captureUserPreset:(const std::string&)name {
    RuntimeUserPreset preset; preset.name = name;
    preset.midiSequenceIndex = _selectedMidiSequence >= 0 && _selectedMidiSequence < static_cast<NSInteger>(project::kMidiSequences.size()) ? static_cast<int>(_selectedMidiSequence) : -1;
    preset.values.reserve(project::kControls.size());
    for (std::size_t index = 0; index < project::kControls.size(); ++index) {
        const auto parameter = _instrument->parameterForControl(index);
        preset.values.push_back(parameter == kNoParamId ? project::kControls[index].value : static_cast<float>(_instrument->getParamNormalized(parameter)));
    }
    preset.groups.reserve(project::kGroups.size() * 4);
    for (std::size_t group = 0; group < project::kGroups.size(); ++group)
        for (int slot = 0; slot < 4; ++slot) preset.groups.push_back(static_cast<float>(_instrument->getParamNormalized(groupParameterId(static_cast<int>(group), slot))));
    preset.moduleValues.reserve(project::kDspModules.size() * 2 + project::kDspParameters.size());
    for (std::size_t module = 0; module < project::kDspModules.size(); ++module) {
        preset.moduleValues.push_back(_instrument->modulePresetValue(module, "bypass"));
        preset.moduleValues.push_back(_instrument->modulePresetValue(module, "module_mix"));
    }
    for (const auto& parameter : project::kDspParameters)
        preset.moduleValues.push_back(_instrument->modulePresetValue(static_cast<std::size_t>(parameter.moduleIndex), parameter.key));
    return preset;
}

- (void)applyFactoryPreset:(NSInteger)index {
    if (index < 0 || index >= static_cast<NSInteger>(project::kPresets.size())) return;
    const auto& preset = project::kPresets[static_cast<std::size_t>(index)];
    for (int item = 0; item < preset.valueCount; ++item) {
        const auto& value = project::kPresetValues[static_cast<std::size_t>(preset.valueOffset + item)];
        [self setParameter:_instrument->parameterForControl(static_cast<std::size_t>(value.controlIndex)) value:value.value];
    }
    for (int item = 0; item < preset.groupCount; ++item) {
        const auto& group = project::kPresetGroups[static_cast<std::size_t>(preset.groupOffset + item)];
        [self setParameter:groupParameterId(group.groupIndex, 0) value:group.volume];
        [self setParameter:groupParameterId(group.groupIndex, 1) value:group.pan];
        [self setParameter:groupParameterId(group.groupIndex, 2) value:group.mute ? 1.f : 0.f];
        [self setParameter:groupParameterId(group.groupIndex, 3) value:group.solo ? 1.f : 0.f];
    }
    for (int item = 0; item < preset.moduleCount; ++item) {
        const auto& module = project::kPresetModules[static_cast<std::size_t>(preset.moduleOffset + item)];
        _instrument->applyModulePresetValue(static_cast<std::size_t>(module.moduleIndex), "bypass", module.bypassed ? 1.f : 0.f);
        _instrument->applyModulePresetValue(static_cast<std::size_t>(module.moduleIndex), "module_mix", module.mix);
        for (int parameterIndex = 0; parameterIndex < module.parameterCount; ++parameterIndex) {
            const auto& parameter = project::kPresetModuleParameters[static_cast<std::size_t>(module.parameterOffset + parameterIndex)];
            _instrument->applyModulePresetValue(static_cast<std::size_t>(parameter.moduleIndex), parameter.key, parameter.value);
        }
    }
    _selectedMidiSequence = preset.midiSequenceIndex;
}

- (void)applyUserPreset:(NSInteger)index {
    if (index < 0 || index >= static_cast<NSInteger>(_userPresets.size())) return;
    const auto& preset = _userPresets[static_cast<std::size_t>(index)];
    for (std::size_t item = 0; item < preset.values.size() && item < project::kControls.size(); ++item)
        [self setParameter:_instrument->parameterForControl(item) value:preset.values[item]];
    for (std::size_t item = 0; item < preset.groups.size(); ++item)
        [self setParameter:groupParameterId(static_cast<int>(item / 4), static_cast<int>(item % 4)) value:preset.groups[item]];
    std::size_t cursor = 0;
    for (std::size_t module = 0; module < project::kDspModules.size() && cursor + 1 < preset.moduleValues.size(); ++module) {
        _instrument->applyModulePresetValue(module, "bypass", preset.moduleValues[cursor++]);
        _instrument->applyModulePresetValue(module, "module_mix", preset.moduleValues[cursor++]);
    }
    for (const auto& parameter : project::kDspParameters) {
        if (cursor >= preset.moduleValues.size()) break;
        _instrument->applyModulePresetValue(static_cast<std::size_t>(parameter.moduleIndex), parameter.key, preset.moduleValues[cursor++]);
    }
    _selectedMidiSequence = preset.midiSequenceIndex;
}

- (void)saveUserPreset {
    while (!_presetNameInput.empty() && std::isspace(static_cast<unsigned char>(_presetNameInput.front()))) _presetNameInput.erase(_presetNameInput.begin());
    while (!_presetNameInput.empty() && std::isspace(static_cast<unsigned char>(_presetNameInput.back()))) _presetNameInput.pop_back();
    if (_presetNameInput.empty() || std::any_of(_userPresets.begin(), _userPresets.end(), [&](const auto& preset) { return preset.name == _presetNameInput; })) return;
    if (_userPresets.size() >= 128) _userPresets.erase(_userPresets.begin());
    _userPresets.push_back([self captureUserPreset:_presetNameInput]);
    _selectedPresetRow = static_cast<NSInteger>(project::kPresets.size() + _userPresets.size() - 1);
    _presetScrollOffset = _selectedPresetRow;
    _presetNameInput.clear(); _presetNameFocused = NO;
    [self persistUserPresets];
}

- (std::filesystem::path)userPresetPath {
    NSString* applicationSupport = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
    if (!applicationSupport.length) return {};
    char identity[96]{};
    std::snprintf(identity, sizeof(identity), "%08X%08X%08X%08X-macos.tspresets", TS_PLUGIN_CID_A, TS_PLUGIN_CID_B, TS_PLUGIN_CID_C, TS_PLUGIN_CID_D);
    std::filesystem::path directory = std::filesystem::path(applicationSupport.fileSystemRepresentation) / "TripleSide Studio" / "VST3 Presets";
    std::error_code error; std::filesystem::create_directories(directory, error);
    return error ? std::filesystem::path{} : directory / identity;
}

- (void)loadUserPresets {
    _userPresets.clear(); const auto path = [self userPresetPath]; if (path.empty()) return;
    std::ifstream input(path, std::ios::binary); std::uint32_t magic = 0, version = 0, count = 0;
    input.read(reinterpret_cast<char*>(&magic), 4); input.read(reinterpret_cast<char*>(&version), 4); input.read(reinterpret_cast<char*>(&count), 4);
    if (!input || magic != 0x54534d50u || (version != 1 && version != 2) || count > 128) return;
    for (std::uint32_t index = 0; index < count; ++index) {
        std::uint32_t nameSize = 0, valueCount = 0, groupCount = 0, moduleCount = 0;
        std::int32_t midiSequenceIndex = -1;
        input.read(reinterpret_cast<char*>(&nameSize), 4); input.read(reinterpret_cast<char*>(&valueCount), 4); input.read(reinterpret_cast<char*>(&groupCount), 4); input.read(reinterpret_cast<char*>(&moduleCount), 4); if (version >= 2) input.read(reinterpret_cast<char*>(&midiSequenceIndex), 4);
        if (!input || !nameSize || nameSize > 192 || valueCount > project::kControls.size() || groupCount > project::kGroups.size() * 4 || moduleCount > project::kDspModules.size() * 2 + project::kDspParameters.size() || midiSequenceIndex >= static_cast<std::int32_t>(project::kMidiSequences.size())) { _userPresets.clear(); return; }
        RuntimeUserPreset preset; preset.name.resize(nameSize); preset.values.resize(valueCount); preset.groups.resize(groupCount); preset.moduleValues.resize(moduleCount); preset.midiSequenceIndex = midiSequenceIndex;
        input.read(preset.name.data(), static_cast<std::streamsize>(nameSize));
        input.read(reinterpret_cast<char*>(preset.values.data()), static_cast<std::streamsize>(valueCount * sizeof(float)));
        input.read(reinterpret_cast<char*>(preset.groups.data()), static_cast<std::streamsize>(groupCount * sizeof(float)));
        input.read(reinterpret_cast<char*>(preset.moduleValues.data()), static_cast<std::streamsize>(moduleCount * sizeof(float)));
        if (!input || std::any_of(preset.values.begin(), preset.values.end(), [](float value) { return !std::isfinite(value); }) || std::any_of(preset.groups.begin(), preset.groups.end(), [](float value) { return !std::isfinite(value); }) || std::any_of(preset.moduleValues.begin(), preset.moduleValues.end(), [](float value) { return !std::isfinite(value); })) { _userPresets.clear(); return; }
        _userPresets.push_back(std::move(preset));
    }
}

- (void)persistUserPresets {
    const auto path = [self userPresetPath]; if (path.empty()) return; const auto temporary = path.string() + ".tmp";
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc); const std::uint32_t magic = 0x54534d50u, version = 2, count = static_cast<std::uint32_t>(std::min<std::size_t>(128, _userPresets.size()));
    output.write(reinterpret_cast<const char*>(&magic), 4); output.write(reinterpret_cast<const char*>(&version), 4); output.write(reinterpret_cast<const char*>(&count), 4);
    for (std::size_t index = 0; index < count; ++index) {
        const auto& preset = _userPresets[index]; const std::uint32_t nameSize = static_cast<std::uint32_t>(std::min<std::size_t>(192, preset.name.size())), valueCount = static_cast<std::uint32_t>(preset.values.size()), groupCount = static_cast<std::uint32_t>(preset.groups.size()), moduleCount = static_cast<std::uint32_t>(preset.moduleValues.size()); const std::int32_t midiSequenceIndex = preset.midiSequenceIndex;
        output.write(reinterpret_cast<const char*>(&nameSize), 4); output.write(reinterpret_cast<const char*>(&valueCount), 4); output.write(reinterpret_cast<const char*>(&groupCount), 4); output.write(reinterpret_cast<const char*>(&moduleCount), 4); output.write(reinterpret_cast<const char*>(&midiSequenceIndex), 4);
        output.write(preset.name.data(), static_cast<std::streamsize>(nameSize)); output.write(reinterpret_cast<const char*>(preset.values.data()), static_cast<std::streamsize>(valueCount * sizeof(float))); output.write(reinterpret_cast<const char*>(preset.groups.data()), static_cast<std::streamsize>(groupCount * sizeof(float))); output.write(reinterpret_cast<const char*>(preset.moduleValues.data()), static_cast<std::streamsize>(moduleCount * sizeof(float)));
    }
    output.close(); std::error_code error; if (output) std::filesystem::rename(temporary, path, error); if (error) { std::filesystem::remove(path, error); error.clear(); std::filesystem::rename(temporary, path, error); } if (!output || error) std::filesystem::remove(temporary, error);
}

- (BOOL)panelMouseDown:(NSPoint)point {
    if (_openPanel < 0) return NO;
    const NSRect rect = [self panelRect:_openPanel];
    if (!NSPointInRect(point, rect)) return NO;
    if (point.x >= NSMaxX(rect) - 44 && point.y <= NSMinY(rect) + 44) { [self closePanel]; return YES; }
    if (point.x >= NSMaxX(rect) - 22 && point.y >= NSMaxY(rect) - 22) {
        _panelDragMode = 2; _panelDragX = point.x; _panelDragY = point.y; return YES;
    }
    if (point.y <= NSMinY(rect) + 44) {
        _panelDragMode = 1; _panelDragX = point.x; _panelDragY = point.y; return YES;
    }
    const auto& panel = project::kPanelControls[static_cast<std::size_t>(_openPanel)];
    const CGFloat left = NSMinX(rect) + 16, right = NSMaxX(rect) - 16, top = NSMinY(rect) + 60;
    if (equals(panel.panelType, "midi_map")) {
        const auto visible = [self visibleMidiSequences];
        const CGFloat rowStart = top + 23;
        if (point.y >= rowStart) {
            const NSInteger slot = static_cast<NSInteger>((point.y - rowStart) / 53);
            const CGFloat rowOffset = std::fmod(point.y - rowStart, 53.);
            const NSInteger row = _grooveScrollOffset + slot;
            const NSInteger capacity = std::max<NSInteger>(1, static_cast<NSInteger>((NSMaxY(rect) - 12 - rowStart + 6) / 53));
            const BOOL scrollable = static_cast<NSInteger>(visible.size()) > capacity;
            const CGFloat contentRight = right - (scrollable ? 12 : 0);
            if (slot >= 0 && row >= 0 && row < static_cast<NSInteger>(visible.size()) && rowOffset <= 47 && point.x >= left && point.x <= contentRight) {
                const int source = visible[static_cast<std::size_t>(row)]; _selectedMidiSequence = source;
                if (point.x >= contentRight - 64 && point.x <= contentRight - 34) { _midiLoopOverrides[source] = ![self midiSequenceLoopEnabled:source]; if (_playingMidiSequence == source) _instrument->setGrooveLoop(_midiLoopOverrides[source]); }
                else if (point.x >= contentRight - 30) {
                    if (_playingMidiSequence == source) [self stopMidiSequence]; else [self startMidiSequence:source];
                } else {
                    _midiDragCandidate = source; _midiDragX = point.x; _midiDragY = point.y;
                }
                [self setNeedsDisplay:YES]; return YES;
            }
        }
    } else if (equals(panel.panelType, "preset_browser")) {
        const CGFloat fieldWidth = std::max<CGFloat>(80, right - left - 156);
        if (point.y >= top && point.y <= top + 35) { if (point.x <= left + fieldWidth) { _presetNameFocused = YES; [self.window makeFirstResponder:self]; } else if (point.x >= left + fieldWidth + 8) [self saveUserPreset]; [self setNeedsDisplay:YES]; return YES; }
        _presetNameFocused = NO;
        const CGFloat rowStart = top + 47;
        const NSInteger total = static_cast<NSInteger>(project::kPresets.size() + _userPresets.size());
        const NSInteger capacity = std::max<NSInteger>(1, static_cast<NSInteger>((NSMaxY(rect) - 12 - rowStart + 6) / 47));
        const NSInteger maxOffset = std::max<NSInteger>(0, total - capacity);
        _presetScrollOffset = std::clamp(_presetScrollOffset, static_cast<NSInteger>(0), maxOffset);
        const CGFloat contentRight = right - (maxOffset > 0 ? 12 : 0);
        if (point.y >= rowStart && point.x >= left && point.x <= contentRight) {
            const NSInteger slot = static_cast<NSInteger>((point.y - rowStart) / 47), absolute = _presetScrollOffset + slot;
            const CGFloat rowOffset = std::fmod(point.y - rowStart, 47.);
            if (slot >= 0 && slot < capacity && rowOffset <= 41 && absolute >= 0 && absolute < total) {
                _selectedPresetRow = absolute;
                if (absolute < static_cast<NSInteger>(project::kPresets.size())) [self applyFactoryPreset:absolute];
                else {
                    const NSInteger user = absolute - static_cast<NSInteger>(project::kPresets.size());
                    if (point.x >= contentRight - 27) {
                        _userPresets.erase(_userPresets.begin() + user);
                        _selectedPresetRow = -1;
                        [self persistUserPresets];
                    } else [self applyUserPreset:user];
                }
                [self setNeedsDisplay:YES]; return YES;
            }
        }
    } else if (equals(panel.panelType, "mixer") && panel.mixerShowDefaultControls) {
        const NSInteger group = static_cast<NSInteger>((point.x - left) / 122);
        if (group >= 0 && group < static_cast<NSInteger>(project::kGroups.size())) {
            const CGFloat localX = point.x - (left + group * 122), localY = point.y - top;
            if (localX >= 5 && localX <= 107 && localY >= 35 && localY <= 64) {
                _mixerDragGroup = group; _mixerDragSlot = 0;
                [self setParameter:groupParameterId(static_cast<int>(group), 0) value:static_cast<float>((localX - 11) / 90)];
            } else if (localX >= 5 && localX <= 107 && localY >= 80 && localY <= 109) {
                _mixerDragGroup = group; _mixerDragSlot = 1;
                [self setParameter:groupParameterId(static_cast<int>(group), 1) value:static_cast<float>((localX - 11) / 90)];
            }
            else if (localY >= 126 && localY <= 148) {
                const int slot = localX >= 58.5 ? 3 : 2; const auto parameter = groupParameterId(static_cast<int>(group), slot);
                [self setParameter:parameter value:_instrument->getParamNormalized(parameter) >= .5 ? 0 : 1];
            }
            [self setNeedsDisplay:YES]; return YES;
        }
    }
    return YES;
}

- (void)updateMidiPlayback {
    _playingMidiSequence = _instrument->groovePlayingSequence();
}

- (BOOL)importMidiPath:(NSString*)path {
    if (!path.length || _openPanel < 0 || !equals(project::kPanelControls[static_cast<std::size_t>(_openPanel)].panelType, "midi_map")) return NO;
    std::filesystem::path filePath(path.fileSystemRepresentation);
    std::string extension = filePath.extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
    if (extension != ".mid" && extension != ".midi") return NO;
    std::ifstream stream(filePath, std::ios::binary); if (!stream) return NO;
    std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(stream)), {});
    if (bytes.size() < 14 || bytes.size() > 2 * 1024 * 1024 || std::memcmp(bytes.data(), "MThd", 4)) return NO;
    auto be16 = [&](std::size_t position) { return position + 2 <= bytes.size() ? (bytes[position] << 8) | bytes[position + 1] : -1; };
    auto be32 = [&](std::size_t position) -> std::uint32_t { return position + 4 <= bytes.size() ? (static_cast<std::uint32_t>(bytes[position]) << 24) | (static_cast<std::uint32_t>(bytes[position + 1]) << 16) | (static_cast<std::uint32_t>(bytes[position + 2]) << 8) | bytes[position + 3] : 0; };
    const int tracks = be16(10), division = be16(12); if (tracks < 1 || division < 24 || (division & 0x8000)) return NO;
    RuntimeMidiSequence sequence; sequence.name = filePath.stem().string(); sequence.ppq = division; std::size_t position = 8 + be32(4);
    auto vlq = [&](std::size_t& cursor, std::size_t end, int& value) {
        value = 0; for (int byteIndex = 0; byteIndex < 4 && cursor < end; ++byteIndex) { const auto byte = bytes[cursor++]; value = (value << 7) | (byte & 0x7f); if (!(byte & 0x80)) return true; } return false;
    };
    for (int track = 0; track < tracks && position + 8 <= bytes.size(); ++track) {
        if (std::memcmp(bytes.data() + position, "MTrk", 4)) return NO;
        const auto length = be32(position + 4); std::size_t cursor = position + 8, end = std::min(bytes.size(), cursor + static_cast<std::size_t>(length)); int tick = 0, running = 0;
        while (cursor < end && sequence.events.size() < 8192) {
            int delta = 0; if (!vlq(cursor, end, delta)) return NO; tick += delta; if (cursor >= end) break;
            int status = bytes[cursor]; if (status & 0x80) { ++cursor; running = status; } else if (!running) return NO; else status = running;
            if (status == 0xff) {
                if (cursor >= end) break; const int meta = bytes[cursor++]; int size = 0; if (!vlq(cursor, end, size) || cursor + size > end) return NO;
                if (meta == 0x51 && size == 3) { const int micros = (bytes[cursor] << 16) | (bytes[cursor + 1] << 8) | bytes[cursor + 2]; if (micros > 0) sequence.tempos.push_back({tick, static_cast<float>(60000000. / micros)}); }
                cursor += size; continue;
            }
            if (status == 0xf0 || status == 0xf7) { int size = 0; if (!vlq(cursor, end, size) || cursor + size > end) return NO; cursor += size; continue; }
            const int command = status & 0xf0, channel = status & 0x0f, dataCount = (command == 0xc0 || command == 0xd0) ? 1 : 2;
            if (cursor + dataCount > end) return NO; const int data1 = bytes[cursor++], data2 = dataCount == 2 ? bytes[cursor++] : 0;
            if (command == 0x90 || command == 0x80) { const bool on = command == 0x90 && data2 > 0; sequence.events.push_back({tick, data1, on ? data2 : 0, channel, on}); sequence.durationTicks = std::max(sequence.durationTicks, tick); }
        }
        position = end;
    }
    if (sequence.events.empty()) return NO;
    std::stable_sort(sequence.events.begin(), sequence.events.end(), [](const auto& left, const auto& right) { return left.tick < right.tick; });
    std::stable_sort(sequence.tempos.begin(), sequence.tempos.end(), [](const auto& left, const auto& right) { return left.tick < right.tick; });
    if (_importedMidi.size() >= 16) return NO;
    _importedMidi.push_back(std::move(sequence));
    _selectedMidiSequence = static_cast<NSInteger>(project::kMidiSequences.size() + _importedMidi.size() - 1);
    [self setNeedsDisplay:YES]; return YES;
}

- (std::filesystem::path)exportMidiSequence:(NSInteger)index {
    const NSInteger embedded = static_cast<NSInteger>(project::kMidiSequences.size());
    if (index < 0 || index >= embedded + static_cast<NSInteger>(_importedMidi.size())) return {};
    struct Item { int tick = 0, priority = 0; std::vector<unsigned char> bytes; };
    std::vector<Item> items; std::string name; int ppq = 480, duration = 0;
    if (index < embedded) {
        const auto& sequence = project::kMidiSequences[static_cast<std::size_t>(index)]; name = sequence.name ?: "MIDI Sequence"; ppq = sequence.ppq; duration = sequence.durationTicks;
        for (int item = 0; item < sequence.tempoCount; ++item) { const auto& tempo = project::kMidiTempos[static_cast<std::size_t>(sequence.tempoOffset + item)]; const auto micros = static_cast<unsigned>(std::clamp(60000000. / std::clamp(static_cast<double>(tempo.bpm), 20., 400.), 1., 16777215.)); items.push_back({tempo.tick, 0, {0xff, 0x51, 0x03, static_cast<unsigned char>((micros >> 16) & 255), static_cast<unsigned char>((micros >> 8) & 255), static_cast<unsigned char>(micros & 255)}}); }
        for (int item = 0; item < sequence.eventCount; ++item) { const auto& event = project::kMidiEvents[static_cast<std::size_t>(sequence.eventOffset + item)]; items.push_back({event.tick, event.noteOn ? 2 : 1, {static_cast<unsigned char>((event.noteOn ? 0x90 : 0x80) | (event.channel & 15)), static_cast<unsigned char>(event.note & 127), static_cast<unsigned char>(event.noteOn ? std::max(1, event.velocity) & 127 : 0)}}); }
    } else {
        const auto& sequence = _importedMidi[static_cast<std::size_t>(index - embedded)]; name = sequence.name; ppq = sequence.ppq; duration = sequence.durationTicks;
        for (const auto& tempo : sequence.tempos) { const auto micros = static_cast<unsigned>(std::clamp(60000000. / std::clamp(static_cast<double>(tempo.bpm), 20., 400.), 1., 16777215.)); items.push_back({tempo.tick, 0, {0xff, 0x51, 0x03, static_cast<unsigned char>((micros >> 16) & 255), static_cast<unsigned char>((micros >> 8) & 255), static_cast<unsigned char>(micros & 255)}}); }
        for (const auto& event : sequence.events) items.push_back({event.tick, event.on ? 2 : 1, {static_cast<unsigned char>((event.on ? 0x90 : 0x80) | (event.channel & 15)), static_cast<unsigned char>(event.note & 127), static_cast<unsigned char>(event.on ? std::max(1, event.velocity) & 127 : 0)}});
    }
    std::stable_sort(items.begin(), items.end(), [](const auto& left, const auto& right) { return left.tick != right.tick ? left.tick < right.tick : left.priority < right.priority; });
    std::vector<unsigned char> track; auto vlq = [&](unsigned value) { unsigned char buffer[5]{}; int position = 0; buffer[position++] = value & 0x7f; while ((value >>= 7) != 0) buffer[position++] = static_cast<unsigned char>((value & 0x7f) | 0x80); while (position) track.push_back(buffer[--position]); };
    int previous = 0; for (const auto& item : items) { const int tick = std::max(previous, item.tick); vlq(static_cast<unsigned>(tick - previous)); track.insert(track.end(), item.bytes.begin(), item.bytes.end()); previous = tick; }
    vlq(static_cast<unsigned>(std::max(0, duration - previous))); track.insert(track.end(), {0xff, 0x2f, 0x00});
    std::vector<unsigned char> file; auto text = [&](const char* value) { file.insert(file.end(), value, value + 4); }; auto be16 = [&](unsigned value) { file.push_back((value >> 8) & 255); file.push_back(value & 255); }; auto be32 = [&](unsigned value) { file.push_back((value >> 24) & 255); file.push_back((value >> 16) & 255); file.push_back((value >> 8) & 255); file.push_back(value & 255); };
    text("MThd"); be32(6); be16(0); be16(1); be16(static_cast<unsigned>(std::clamp(ppq, 24, 9600))); text("MTrk"); be32(static_cast<unsigned>(track.size())); file.insert(file.end(), track.begin(), track.end());
    for (auto& character : name) if (static_cast<unsigned char>(character) < 32 || std::strchr("<>:\"/\\|?*", character)) character = '_'; if (name.empty()) name = "MIDI Sequence"; if (name.size() > 80) name.resize(80);
    std::error_code error; auto directory = std::filesystem::temp_directory_path(error) / "TripleSide Studio" / "MIDI Drag"; std::filesystem::create_directories(directory, error); if (error) return {};
    const auto outputPath = directory / (name + "-" + std::to_string(index + 1) + ".mid"); std::ofstream output(outputPath, std::ios::binary | std::ios::trunc); output.write(reinterpret_cast<const char*>(file.data()), static_cast<std::streamsize>(file.size())); output.close(); return output ? outputPath : std::filesystem::path{};
}

- (void)drawAtlas:(NSImage*)image
             file:(const project::VisualControl&)visual
            frame:(NSInteger)frame {
    if (!image || visual.w <= 0 || visual.h <= 0 || visual.frames <= 0) return;
    const NSInteger columns = std::max(1, visual.columns);
    frame = std::clamp<NSInteger>(frame, 0, visual.frames - 1);
    const NSInteger row = frame / columns;
    const NSInteger column = frame % columns;
    const CGFloat sourceY = image.size.height - (row + 1) * visual.h;
    const NSRect source = NSMakeRect(column * visual.w, sourceY, visual.w, visual.h);
    const NSRect destination = NSMakeRect(visual.x, visual.y, visual.w, visual.h);
    [image drawInRect:destination fromRect:source operation:NSCompositingOperationSourceOver
             fraction:1 respectFlipped:YES hints:@{NSImageHintInterpolation: @(NSImageInterpolationHigh)}];
}

- (void)drawWaveformInRect:(NSRect)rect color:(unsigned)color lineWidth:(CGFloat)lineWidth samplerGroup:(int)samplerGroup {
    color = color ? color : project::kAccentRgb;
    constexpr std::size_t sampleCount = 2048;
    std::array<float, sampleCount> samples{};
    if (samplerGroup >= 0) _instrument->copyGroupAnalysisSamples(samplerGroup, samples.data(), samples.size()); else _instrument->copyAnalysisSamples(samples.data(), samples.size());
    std::size_t start = 0;
    for (std::size_t index = 1; index < sampleCount / 2; ++index) if (samples[index - 1] <= 0.f && samples[index] > 0.f) { start = index; break; }
    const NSInteger points = std::clamp<NSInteger>(static_cast<NSInteger>(std::lround(NSWidth(rect))), 64, static_cast<NSInteger>(sampleCount));
    NSBezierPath* trace = [NSBezierPath bezierPath];
    for (NSInteger point = 0; point < points; ++point) {
        const std::size_t sample = std::min(sampleCount - 1, start + static_cast<std::size_t>(point) * (sampleCount - start - 1) / static_cast<std::size_t>(std::max<NSInteger>(1, points - 1)));
        const NSPoint location = NSMakePoint(NSMinX(rect) + NSWidth(rect) * point / std::max<NSInteger>(1, points - 1), NSMidY(rect) - std::clamp(samples[sample], -1.f, 1.f) * NSHeight(rect) * .43);
        if (!point) [trace moveToPoint:location]; else [trace lineToPoint:location];
    }
    [rgbColor(color, .95) setStroke]; trace.lineWidth = std::clamp<CGFloat>(lineWidth, .5, 8); trace.lineJoinStyle = NSLineJoinStyleRound; [trace stroke];
    strokeRounded(rect, 11.2, rgbColor(color, .22));
}

- (void)drawBarSpectrumInRect:(NSRect)rect color:(unsigned)color barWidthRatio:(CGFloat)barWidthRatio samplerGroup:(int)samplerGroup {
    color = color ? color : project::kAccentRgb;
    constexpr std::size_t sampleCount = BarSpectrumAnalyzer::fftSize;
    std::array<float, sampleCount> left{}, right{};
    if (samplerGroup >= 0) { _instrument->copyGroupAnalysisSamples(samplerGroup, left.data(), left.size(), 0); _instrument->copyGroupAnalysisSamples(samplerGroup, right.data(), right.size(), 1); }
    else { _instrument->copyAnalysisSamples(left.data(), left.size(), 0); _instrument->copyAnalysisSamples(right.data(), right.size(), 1); }
    const double now = [NSDate timeIntervalSinceReferenceDate];
    const float elapsed = _barSpectrumUpdatedAt > 0 ? std::clamp(static_cast<float>(now - _barSpectrumUpdatedAt), .016f, .12f) : .032f;
    _barSpectrumUpdatedAt = now;
    const auto& levels = _barSpectrumAnalyzer.process(left.data(), right.data(), sampleCount,
        static_cast<float>(_instrument->analysisSampleRate()), elapsed);
    const CGFloat slot = NSWidth(rect) / levels.size();
    const CGFloat requestedBarWidth = std::max<CGFloat>(.5, slot * std::clamp<CGFloat>(barWidthRatio, .1, 1));
    NSColor* startColor = rgbColor(color, .98);
    for (std::size_t index = 0; index < levels.size(); ++index) {
        const CGFloat barHeight = levels[index] * NSHeight(rect) * .86;
        if (barHeight < 1) continue;
        const CGFloat fraction = static_cast<CGFloat>(index) / std::max<std::size_t>(1, levels.size() - 1);
        [[startColor blendedColorWithFraction:fraction ofColor:NSColor.whiteColor] setFill];
        NSRect bar = [self convertRectToBacking:NSMakeRect(
            NSMinX(rect) + index * slot + (slot - requestedBarWidth) * .5,
            NSMidY(rect) - barHeight * .5, requestedBarWidth, barHeight)];
        const CGFloat barWidthPixels = std::max<CGFloat>(1, std::round(NSWidth(bar)));
        bar.origin.x = std::round(NSMidX(bar) - barWidthPixels * .5);
        bar.size.width = barWidthPixels;
        NSRectFill([self convertRectFromBacking:bar]);
    }
}

- (void)drawSpectrumInRect:(NSRect)rect color:(unsigned)color samplerGroup:(int)samplerGroup {
    color = color ? color : project::kAccentRgb;
    constexpr std::size_t sampleCount = BarSpectrumAnalyzer::fftSize;
    std::array<float, sampleCount> left{}, right{};
    if (samplerGroup >= 0) { _instrument->copyGroupAnalysisSamples(samplerGroup, left.data(), left.size(), 0); _instrument->copyGroupAnalysisSamples(samplerGroup, right.data(), right.size(), 1); }
    else { _instrument->copyAnalysisSamples(left.data(), left.size(), 0); _instrument->copyAnalysisSamples(right.data(), right.size(), 1); }
    const auto& levels = _barSpectrumAnalyzer.process(left.data(), right.data(), sampleCount, static_cast<float>(_instrument->analysisSampleRate()), .032f);
    NSBezierPath* fill = [NSBezierPath bezierPath]; NSBezierPath* line = [NSBezierPath bezierPath];
    [fill moveToPoint:NSMakePoint(NSMinX(rect), NSMinY(rect))];
    for (std::size_t index = 0; index < levels.size(); ++index) {
        const NSPoint point = NSMakePoint(NSMinX(rect) + NSWidth(rect) * index / std::max<std::size_t>(1, levels.size() - 1), NSMinY(rect) + levels[index] * NSHeight(rect) * .9);
        if (!index) [line moveToPoint:point]; else [line lineToPoint:point]; [fill lineToPoint:point];
    }
    [fill lineToPoint:NSMakePoint(NSMaxX(rect), NSMinY(rect))]; [fill closePath]; [rgbColor(color, .20) setFill]; [fill fill];
    [rgbColor(color, .9) setStroke]; line.lineWidth = 1.5; [line stroke]; strokeRounded(rect, 11.2, rgbColor(color, .18));
}

- (void)drawVectorscopeInRect:(NSRect)rect color:(unsigned)color samplerGroup:(int)samplerGroup showCorrelation:(BOOL)showCorrelation {
    color = color ? color : project::kAccentRgb; constexpr std::size_t sampleCount = 512;
    std::array<float, sampleCount> left{}, right{};
    if (samplerGroup >= 0) { _instrument->copyGroupAnalysisSamples(samplerGroup, left.data(), left.size(), 0); _instrument->copyGroupAnalysisSamples(samplerGroup, right.data(), right.size(), 1); }
    else { _instrument->copyAnalysisSamples(left.data(), left.size(), 0); _instrument->copyAnalysisSamples(right.data(), right.size(), 1); }
    const CGFloat meterHeight = showCorrelation ? std::clamp<CGFloat>(NSHeight(rect) * .13, 25, 36) : 0, scopeHeight = NSHeight(rect) - meterHeight;
    const NSPoint center = NSMakePoint(NSMidX(rect), NSMinY(rect) + scopeHeight * .5); const CGFloat radius = std::max<CGFloat>(8, std::min(NSWidth(rect), scopeHeight) * .43);
    [rgbColor(color, .16) setStroke]; [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(center.x-radius, center.y-radius, radius*2, radius*2)] stroke];
    NSBezierPath* trace = [NSBezierPath bezierPath]; float cross=0,leftEnergy=0,rightEnergy=0;
    for (std::size_t index=0; index<sampleCount; index+=2) { const float l=left[index],r=right[index];cross+=l*r;leftEnergy+=l*l;rightEnergy+=r*r;const NSPoint point=NSMakePoint(center.x+(r-l)*radius*.72,center.y+(l+r)*radius*.72);if(!index)[trace moveToPoint:point];else[trace lineToPoint:point]; }
    [rgbColor(color, .82) setStroke]; trace.lineWidth=1.15; [trace stroke];
    if(showCorrelation){const float denominator=std::sqrt(leftEnergy*rightEnergy),correlation=denominator>1e-8f?std::clamp(cross/denominator,-1.f,1.f):0.f;const CGFloat barLeft=NSMinX(rect)+NSWidth(rect)*.1,barRight=NSMaxX(rect)-NSWidth(rect)*.1,barY=NSMaxY(rect)-meterHeight*.55,zero=(barLeft+barRight)*.5,valueX=zero+correlation*(barRight-barLeft)*.5;NSBezierPath*axis=[NSBezierPath bezierPath];[axis moveToPoint:NSMakePoint(barLeft,barY)];[axis lineToPoint:NSMakePoint(barRight,barY)];[rgbColor(color,.25)setStroke];[axis stroke];[rgbColor(color,1)setFill];[[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(valueX-4,barY-4,8,8)]fill];}
    strokeRounded(rect,11.2,rgbColor(color,.18));
}

- (void)drawPanelControl:(NSInteger)index {
    if (index < 0 || static_cast<std::size_t>(index) >= project::kControls.size()
        || static_cast<std::size_t>(index) >= project::kVisualControls.size()) return;
    const auto& control = project::kControls[static_cast<std::size_t>(index)];
    const auto& visual = project::kVisualControls[static_cast<std::size_t>(index)];
    if (equals(control.kind, "spectrum") && equals(control.variant, "realtime-waveform")) {
        const NSRect waveform = [self panelChildRect:index];
        [NSGraphicsContext saveGraphicsState];
        CGContextSetAlpha([[NSGraphicsContext currentContext] CGContext], std::clamp<CGFloat>(control.opacity, 0, 1));
        if (std::abs(control.rotation) >= .001f) {
            const NSPoint center = NSMakePoint(NSMidX(waveform), NSMidY(waveform));
            NSAffineTransform* rotation = [NSAffineTransform transform];
            [rotation translateXBy:center.x yBy:center.y]; [rotation rotateByDegrees:control.rotation]; [rotation translateXBy:-center.x yBy:-center.y]; [rotation concat];
        }
        [self drawWaveformInRect:waveform color:control.colorRgb lineWidth:control.waveformLineWidth samplerGroup:control.samplerGroupIndex];
        [NSGraphicsContext restoreGraphicsState];
        return;
    }
    if (equals(control.kind, "spectrum") && equals(control.variant, "bar-spectrum-visualizer")) {
        const NSRect spectrum = [self panelChildRect:index];
        [NSGraphicsContext saveGraphicsState];
        CGContextSetAlpha([[NSGraphicsContext currentContext] CGContext], std::clamp<CGFloat>(control.opacity, 0, 1));
        if (std::abs(control.rotation) >= .001f) {
            const NSPoint center = NSMakePoint(NSMidX(spectrum), NSMidY(spectrum));
            NSAffineTransform* rotation = [NSAffineTransform transform];
            [rotation translateXBy:center.x yBy:center.y]; [rotation rotateByDegrees:control.rotation]; [rotation translateXBy:-center.x yBy:-center.y]; [rotation concat];
        }
        [self drawBarSpectrumInRect:spectrum color:control.colorRgb barWidthRatio:control.barWidthRatio samplerGroup:control.samplerGroupIndex];
        [NSGraphicsContext restoreGraphicsState];
        return;
    }
    if (equals(control.kind, "spectrum")) {
        const NSRect spectrum = [self panelChildRect:index];
        [NSGraphicsContext saveGraphicsState];
        CGContextSetAlpha([[NSGraphicsContext currentContext] CGContext], std::clamp<CGFloat>(control.opacity, 0, 1));
        if (equals(control.variant, "stereo-vectorscope")) [self drawVectorscopeInRect:spectrum color:control.colorRgb samplerGroup:control.samplerGroupIndex showCorrelation:control.showCorrelationMeter];
        else [self drawSpectrumInRect:spectrum color:control.colorRgb samplerGroup:control.samplerGroupIndex];
        [NSGraphicsContext restoreGraphicsState];
        return;
    }
    NSImage* image = [self imageNamed:visual.file];
    if (!image || visual.w <= 0 || visual.h <= 0 || visual.hw <= 0 || visual.hh <= 0 || visual.frames <= 0) return;
    float value = equals(control.kind, "indicator")
        ? indicatorValue(*_instrument, static_cast<std::size_t>(index), _selectedPrismBand, _openPanel, _activeNote, _playingMidiSequence)
        : [self displayedValueForControl:static_cast<std::size_t>(index)];
    if (control.midiSequenceIndex >= 0) value = _instrument->livePatternSequenceIndex() == control.midiSequenceIndex ? 1.f : 0.f;
    else if (equals(control.kind, "pad")) value = hitPadVariant(control.variant)
        ? ([self hitPadFlashActive:control.notePitch] ? 1.f : 0.f)
        : ((_instrument->isNoteActive(control.notePitch) || _activeNote == control.notePitch) ? 1.f : 0.f);
    const NSInteger frame = std::clamp<NSInteger>(static_cast<NSInteger>(std::lround(value * std::max(0, visual.frames - 1))), 0, visual.frames - 1);
    const NSInteger columns = std::max(1, visual.columns), row = frame / columns, column = frame % columns;
    const CGFloat sourceY = image.size.height - (row + 1) * visual.h;
    const NSRect hit = [self panelChildRect:index];
    const CGFloat scaleX = NSWidth(hit) / visual.hw, scaleY = NSHeight(hit) / visual.hh;
    const NSRect destination = NSMakeRect(NSMinX(hit) + (visual.x - visual.hx) * scaleX,
        NSMinY(hit) + (visual.y - visual.hy) * scaleY, visual.w * scaleX, visual.h * scaleY);
    [image drawInRect:destination fromRect:NSMakeRect(column * visual.w, sourceY, visual.w, visual.h)
             operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES
                 hints:@{NSImageHintInterpolation: @(NSImageInterpolationHigh)}];
    if (equals(control.kind, "fader") && control.faderMeterEnabled) {
        NSRect meterRect = hit; BOOL exact = NO;
        if (visual.mlw > 0 && visual.mlh > 0) { exact = YES; meterRect = NSMakeRect(NSMinX(hit) + (visual.mlx - visual.hx) * scaleX, NSMinY(hit) + (visual.mly - visual.hy) * scaleY, visual.mlw * scaleX, visual.mlh * scaleY); }
        [self drawInlineFaderMeter:static_cast<std::size_t>(index) rect:meterRect exact:exact];
    }
    if ((_hoveredControl == index || _dragControl == index) && (equals(control.kind, "knob") || equals(control.kind, "fader"))) [self drawControlValue:static_cast<std::size_t>(index) rect:hit value:value];
}

- (void)drawRect:(NSRect)dirtyRect {
    [super drawRect:dirtyRect];
    [[NSColor colorWithCalibratedWhite:.035 alpha:1] setFill];
    NSRectFill(self.bounds);

    CGFloat scale = 1, offsetX = 0, offsetY = 0;
    [self canvasScale:&scale offsetX:&offsetX offsetY:&offsetY];
    [NSGraphicsContext saveGraphicsState];
    NSAffineTransform* transform = [NSAffineTransform transform];
    [transform translateXBy:offsetX yBy:offsetY];
    [transform scaleBy:scale];
    [transform concat];

    NSImage* backdrop = [self imageNamed:project::kVisualBackdrop];
    if (!backdrop) backdrop = [self imageNamed:"visual_reference.png"];
    if (backdrop) {
        [backdrop drawInRect:NSMakeRect(0, 0, project::kCanvasWidth, project::kCanvasHeight)
                    fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1
              respectFlipped:YES hints:@{NSImageHintInterpolation: @(NSImageInterpolationHigh)}];
    }

    const auto controlCount = std::min(project::kControls.size(), project::kVisualControls.size());
    for (std::size_t index = 0; index < controlCount; ++index) {
        const auto& visual = project::kVisualControls[index];
        const auto& control = project::kControls[index];
        if (project::kPanelControls[index].parentPanelIndex >= 0) continue;
        if (!controlVisible(index) || !visual.file || !*visual.file || visual.frames <= 0) continue;
        if (equals(control.kind, "spectrum") && equals(control.variant, "realtime-waveform")) {
            const NSRect waveform = controlLayoutRect(control, visual);
            [NSGraphicsContext saveGraphicsState];
            CGContextSetAlpha([[NSGraphicsContext currentContext] CGContext], std::clamp<CGFloat>(control.opacity, 0, 1));
            if (std::abs(control.rotation) >= .001f) {
                const NSPoint center = NSMakePoint(NSMidX(waveform), NSMidY(waveform));
                NSAffineTransform* rotation = [NSAffineTransform transform];
                [rotation translateXBy:center.x yBy:center.y]; [rotation rotateByDegrees:control.rotation]; [rotation translateXBy:-center.x yBy:-center.y]; [rotation concat];
            }
            [self drawWaveformInRect:waveform color:control.colorRgb lineWidth:control.waveformLineWidth samplerGroup:control.samplerGroupIndex];
            [NSGraphicsContext restoreGraphicsState];
            continue;
        }
        if (equals(control.kind, "spectrum") && equals(control.variant, "bar-spectrum-visualizer")) {
            const NSRect spectrum = controlLayoutRect(control, visual);
            [NSGraphicsContext saveGraphicsState];
            CGContextSetAlpha([[NSGraphicsContext currentContext] CGContext], std::clamp<CGFloat>(control.opacity, 0, 1));
            if (std::abs(control.rotation) >= .001f) {
                const NSPoint center = NSMakePoint(NSMidX(spectrum), NSMidY(spectrum));
                NSAffineTransform* rotation = [NSAffineTransform transform];
                [rotation translateXBy:center.x yBy:center.y]; [rotation rotateByDegrees:control.rotation]; [rotation translateXBy:-center.x yBy:-center.y]; [rotation concat];
            }
            [self drawBarSpectrumInRect:spectrum color:control.colorRgb barWidthRatio:control.barWidthRatio samplerGroup:control.samplerGroupIndex];
            [NSGraphicsContext restoreGraphicsState];
            continue;
        }
        if (equals(control.kind, "spectrum")) {
            const NSRect spectrum = controlLayoutRect(control, visual);
            [NSGraphicsContext saveGraphicsState];
            CGContextSetAlpha([[NSGraphicsContext currentContext] CGContext], std::clamp<CGFloat>(control.opacity, 0, 1));
            if (equals(control.variant, "stereo-vectorscope")) [self drawVectorscopeInRect:spectrum color:control.colorRgb samplerGroup:control.samplerGroupIndex showCorrelation:control.showCorrelationMeter];
            else [self drawSpectrumInRect:spectrum color:control.colorRgb samplerGroup:control.samplerGroupIndex];
            [NSGraphicsContext restoreGraphicsState];
            continue;
        }
        auto value = equals(control.kind, "indicator")
            ? indicatorValue(*_instrument, index, _selectedPrismBand, _openPanel, _activeNote, _playingMidiSequence)
            : [self displayedValueForControl:index];
        if (control.midiSequenceIndex >= 0) value = _instrument->livePatternSequenceIndex() == control.midiSequenceIndex ? 1.f : 0.f;
        if (equals(control.kind, "panel_button")) value = _openPanel == static_cast<NSInteger>(index) ? 1.f : 0.f;
        const bool hitPad = equals(control.kind, "pad") && hitPadVariant(control.variant);
        if (equals(control.kind, "pad") && control.midiSequenceIndex < 0) value = hitPad ? ([self hitPadFlashActive:control.notePitch] ? 1.f : 0.f) : ((_instrument->isNoteActive(control.notePitch) || _activeNote == control.notePitch) ? 1.f : 0.f);
        const auto frame = static_cast<NSInteger>(std::lround(value * std::max(0, visual.frames - 1)));
        if (hitPad && value > .5f) {
            NSImage* image = [self imageNamed:visual.file];
            const NSInteger columns = std::max(1, visual.columns), row = frame / columns, column = frame % columns;
            const CGFloat sourceY = image.size.height - (row + 1) * visual.h, insetX = visual.w * .08, insetY = visual.h * .08;
            [image drawInRect:NSMakeRect(visual.x + insetX, visual.y + insetY, visual.w - 2 * insetX, visual.h - 2 * insetY)
                     fromRect:NSMakeRect(column * visual.w, sourceY, visual.w, visual.h)
                    operation:NSCompositingOperationSourceOver fraction:.68 respectFlipped:YES
                        hints:@{NSImageHintInterpolation: @(NSImageInterpolationHigh)}];
        } else [self drawAtlas:[self imageNamed:visual.file] file:visual frame:frame];
    }

    for (std::size_t index = 0; index < project::kControls.size(); ++index) {
        const auto& control = project::kControls[index];
        if (!equals(control.kind, "fader") || !control.faderMeterEnabled || project::kPanelControls[index].parentPanelIndex >= 0 || !controlVisible(index)) continue;
        const NSRect rect = index < project::kVisualControls.size()
            ? controlLayoutRect(control, project::kVisualControls[index])
            : NSMakeRect(project::kCanvasWidth * control.x / 100. - control.width * .5, project::kCanvasHeight * control.y / 100. - control.height * .5, control.width, control.height);
        NSRect meterRect = rect; BOOL exact = NO;
        if (index < project::kVisualControls.size()) { const auto& visual = project::kVisualControls[index]; if (visual.mlw > 0 && visual.mlh > 0) { meterRect = NSMakeRect(visual.mlx, visual.mly, visual.mlw, visual.mlh); exact = YES; } }
        [self drawInlineFaderMeter:index rect:meterRect exact:exact];
    }

    for (std::size_t index = 0; index < project::kControls.size(); ++index) {
        const auto& control = project::kControls[index];
        if ((_hoveredControl != static_cast<NSInteger>(index) && _dragControl != static_cast<NSInteger>(index)) || (!equals(control.kind, "knob") && !equals(control.kind, "fader")) || project::kPanelControls[index].parentPanelIndex >= 0 || !controlVisible(index)) continue;
        const NSRect rect = index < project::kVisualControls.size() ? controlLayoutRect(control, project::kVisualControls[index]) : NSMakeRect(project::kCanvasWidth * control.x / 100. - control.width * .5, project::kCanvasHeight * control.y / 100. - control.height * .5, control.width, control.height);
        [self drawControlValue:index rect:rect value:[self displayedValueForControl:index]];
    }

    for (std::size_t index = 0; index < project::kControls.size(); ++index) {
        const auto& control = project::kControls[index];
        if (!equals(control.kind, "output_selector") || project::kPanelControls[index].parentPanelIndex >= 0 || !controlVisible(index)) continue;
        if (index < project::kVisualControls.size()) {
            const auto& visual = project::kVisualControls[index];
            if (visual.file && *visual.file && visual.frames > 0) continue;
        }
        const NSRect rect = NSMakeRect(project::kCanvasWidth * control.x / 100. - control.width * .5, project::kCanvasHeight * control.y / 100. - control.height * .5, control.width, control.height);
        const auto value = displayedValue(*_instrument, index, _selectedPrismBand);
        const bool selected = value >= .5f;
        const CGFloat inset = std::clamp<CGFloat>(NSHeight(rect) * .07, 3, 6);
        const CGFloat header = std::clamp<CGFloat>(NSHeight(rect) * .24, 11, 22);
        const NSRect box = NSMakeRect(NSMinX(rect) + inset, NSMinY(rect) + header + inset * .35,
                                      std::max<CGFloat>(1, NSWidth(rect) - inset * 2),
                                      std::max<CGFloat>(1, NSHeight(rect) - header - inset * 1.35));
        fillRounded(box, std::clamp<CGFloat>(NSHeight(rect) * .12, 5, 9), rgbColor(control.colorRgb));
        strokeRounded(box, std::clamp<CGFloat>(NSHeight(rect) * .12, 5, 9), selected ? rgbColor(project::kAccentRgb) : [rgbColor(control.textColorRgb) colorWithAlphaComponent:.18], 1);
        NSString* outputName = @"Master";
        if (selected && control.samplerGroupIndex >= 0) {
            const auto& samplerGroup = project::kGroups[static_cast<std::size_t>(control.samplerGroupIndex)];
            outputName = [NSString stringWithUTF8String:samplerGroup.name] ?: @"Sampler";
        }
        const CGFloat fontSize = std::clamp<CGFloat>(std::min<CGFloat>(control.outputFontSize, std::min(NSHeight(rect) * .30, NSWidth(rect) * .12)), 6, 32);
        const CGFloat leftPadding = std::clamp<CGFloat>(NSWidth(rect) * .05, 5, 12);
        const CGFloat rightPadding = std::clamp<CGFloat>(NSWidth(rect) * .14, 20, 34);
        [outputName drawInRect:NSMakeRect(NSMinX(box)+leftPadding, NSMinY(box), std::max<CGFloat>(1, NSWidth(box)-leftPadding-rightPadding), NSHeight(box)) withAttributes:panelTextAttributes(fontSize, rgbColor(control.textColorRgb), NSTextAlignmentLeft, NSFontWeightSemibold)];
        [(selected ? @"›" : @"⌄") drawInRect:NSMakeRect(NSMaxX(box)-rightPadding, NSMidY(box)-10, rightPadding, 20) withAttributes:panelTextAttributes(std::min<CGFloat>(15, fontSize+4), selected ? rgbColor(project::kAccentRgb) : rgbColor(control.textColorRgb, .45), NSTextAlignmentCenter, NSFontWeightBold)];
    }

    if constexpr (project::kIsPrismEq || project::kHasPrismModule) {
        for (std::size_t index = 0; index < project::kControls.size(); ++index) {
            if (!equals(project::kControls[index].kind, "spectrum") || !equals(project::kControls[index].variant, "realtime-spectrum")) continue;
            const auto& control = project::kControls[index];
            const auto& visual = project::kVisualControls[index];
            const NSRect spectrum = controlLayoutRect(control, visual);
            [NSGraphicsContext saveGraphicsState];
            if (std::abs(control.rotation) >= .001f) {
                const NSPoint center = NSMakePoint(NSMidX(spectrum), NSMidY(spectrum));
                NSAffineTransform* rotation = [NSAffineTransform transform];
                [rotation translateXBy:center.x yBy:center.y];
                [rotation rotateByDegrees:control.rotation];
                [rotation translateXBy:-center.x yBy:-center.y];
                [rotation concat];
            }
            float frequencies[5]{}, qs[5]{}, gains[5]{};
            for (int band = 0; band < 5; ++band) {
                frequencies[band] = 10.f * std::pow(3000.f, _instrument->prismBandValue(band, 0));
                qs[band] = .025f * std::pow(1600.f, _instrument->prismBandValue(band, 2));
                gains[band] = band ? (_instrument->prismBandValue(band, 1) - .5f) * 24.f : 0.f;
            }
            NSBezierPath* response = [NSBezierPath bezierPath];
            for (int point = 0; point < 240; ++point) {
                const float frequency = 10.f * std::pow(3000.f, point / 239.f);
                const float ratio = frequency / std::max(10.f, frequencies[0]);
                float db = _instrument->prismBandEnabled(0) ? std::clamp(20.f * std::log10(std::max(1e-6f, (ratio * ratio) / std::sqrt(std::pow(1.f - ratio * ratio, 2.f) + std::pow(ratio / qs[0], 2.f)))), -72.f, 36.f) : 0.f;
                for (int band = 1; band < 5; ++band) if (_instrument->prismBandEnabled(band)) {
                    const float spread = std::clamp(.85f / std::sqrt(qs[band]), .06f, 3.5f);
                    db += gains[band] * std::exp(-.5f * std::pow(std::log(frequency / frequencies[band]) / spread, 2.f));
                }
                const NSPoint curvePoint = NSMakePoint(NSMinX(spectrum) + NSWidth(spectrum) * point / 239.f, std::clamp<CGFloat>(NSMidY(spectrum) - db * NSHeight(spectrum) / 36.f, NSMinY(spectrum) + 3, NSMaxY(spectrum) - 3));
                if (!point) [response moveToPoint:curvePoint]; else [response lineToPoint:curvePoint];
            }
            [[NSColor colorWithCalibratedRed:.13 green:.83 blue:.93 alpha:1] setStroke];
            response.lineWidth = 2.2;
            [response stroke];
            for (int band = 0; band < 5; ++band) if (_instrument->prismBandEnabled(band)) {
                const NSPoint node = NSMakePoint(NSMinX(spectrum) + NSWidth(spectrum) * _instrument->prismBandValue(band, 0), NSMidY(spectrum) - gains[band] * NSHeight(spectrum) / 36.f);
                NSBezierPath* dot = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(node.x - (band == _selectedPrismBand ? 7 : 5), node.y - (band == _selectedPrismBand ? 7 : 5), band == _selectedPrismBand ? 14 : 10, band == _selectedPrismBand ? 14 : 10)];
                [(band == _selectedPrismBand ? NSColor.whiteColor : [NSColor colorWithCalibratedRed:.13 green:.83 blue:.93 alpha:1]) setFill];
                [dot fill];
            }
            [NSGraphicsContext restoreGraphicsState];
            break;
        }
    }

    for (const auto& key : project::kVisualKeys) {
        NSImage* image = [self imageNamed:key.file];
        if (!image || key.cellWidth <= 0 || key.cellHeight <= 0 || key.sourceWidth <= 0 || key.sourceHeight <= 0) continue;
        const NSInteger columns = std::max(1, key.columns);
        const bool active = _instrument->isNoteActive(key.pitch) || _activeNote == key.pitch;
        const NSInteger frame = key.frame + (active ? 1 : 0);
        const NSInteger row = frame / columns;
        const NSInteger column = frame % columns;
        const CGFloat sourceY = image.size.height - (row + 1) * key.cellHeight;
        [image drawInRect:NSMakeRect(key.x, key.y, key.w, key.h)
                 fromRect:NSMakeRect(column * key.cellWidth, sourceY + key.cellHeight - key.sourceHeight, key.sourceWidth, key.sourceHeight)
                operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES
                    hints:@{NSImageHintInterpolation: @(NSImageInterpolationHigh)}];
    }

    [self drawOpenPanel];
    [self drawOutputMenu];

    if constexpr (project::kLicenseRequired) {
        if (!LicenseRuntime::isLicensed()) {
            [[NSColor colorWithCalibratedWhite:.025 alpha:.96] setFill];
            NSRectFill(NSMakeRect(0, 0, project::kCanvasWidth, project::kCanvasHeight));
            NSMutableParagraphStyle* centered = [[NSMutableParagraphStyle alloc] init];
            centered.alignment = NSTextAlignmentCenter;
            NSDictionary* eyebrow = @{
                NSFontAttributeName: [NSFont boldSystemFontOfSize:12],
                NSForegroundColorAttributeName: [NSColor colorWithCalibratedRed:.98 green:.75 blue:.2 alpha:1],
                NSParagraphStyleAttributeName: centered,
            };
            NSDictionary* title = @{
                NSFontAttributeName: [NSFont boldSystemFontOfSize:26],
                NSForegroundColorAttributeName: NSColor.whiteColor,
                NSParagraphStyleAttributeName: centered,
            };
            NSDictionary* detail = @{
                NSFontAttributeName: [NSFont systemFontOfSize:12],
                NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:.68 alpha:1],
                NSParagraphStyleAttributeName: centered,
            };
            [@"AKTIVASI PRODUK" drawInRect:NSMakeRect(40, project::kCanvasHeight * .5 - 92, project::kCanvasWidth - 80, 20) withAttributes:eyebrow];
            [@"Lisensi VST3 diperlukan" drawInRect:NSMakeRect(40, project::kCanvasHeight * .5 - 66, project::kCanvasWidth - 80, 36) withAttributes:title];
            auto state = LicenseRuntime::statusText();
            NSString* stateText = [[NSString alloc] initWithBytes:state.data() length:state.size() * sizeof(wchar_t) encoding:NSUTF32LittleEndianStringEncoding];
            [(stateText ?: @"Aktivasi diperlukan") drawInRect:NSMakeRect(40, project::kCanvasHeight * .5 - 22, project::kCanvasWidth - 80, 22) withAttributes:detail];
            const NSRect button = NSMakeRect(project::kCanvasWidth * .5 - 145, project::kCanvasHeight * .5 + 20, 290, 48);
            NSBezierPath* path = [NSBezierPath bezierPathWithRoundedRect:button xRadius:10 yRadius:10];
            [[NSColor colorWithCalibratedRed:.75 green:.24 blue:.08 alpha:1] setFill];
            [path fill];
            NSDictionary* action = @{
                NSFontAttributeName: [NSFont boldSystemFontOfSize:13],
                NSForegroundColorAttributeName: NSColor.whiteColor,
                NSParagraphStyleAttributeName: centered,
            };
            [@"AKTIFKAN DARI CLIPBOARD" drawInRect:NSMakeRect(button.origin.x, button.origin.y + 15, button.size.width, 20) withAttributes:action];
            [@"Salin serial dari Dashboard, lalu tekan tombol di atas." drawInRect:NSMakeRect(40, button.origin.y + 61, project::kCanvasWidth - 80, 22) withAttributes:detail];
        }
    }
    [NSGraphicsContext restoreGraphicsState];
}

- (NSInteger)controlAt:(NSPoint)point {
    for (NSInteger index = static_cast<NSInteger>(project::kControls.size()) - 1; index >= 0; --index) {
        const auto& control = project::kControls[static_cast<std::size_t>(index)];
        if (project::kPanelControls[static_cast<std::size_t>(index)].parentPanelIndex >= 0) continue;
        if (!controlVisible(static_cast<std::size_t>(index))) continue;
        if (!interactiveKind(control.kind)) continue;
        if (static_cast<std::size_t>(index) < project::kVisualControls.size()) {
            const auto& visual = project::kVisualControls[static_cast<std::size_t>(index)];
            const NSPoint localPoint = controlLocalPoint(control, point);
            const NSRect layout = controlLayoutRect(control, visual);
            if (NSPointInRect(localPoint, layout)) return index;
        }
        const CGFloat centerX = project::kCanvasWidth * control.x / 100.;
        const CGFloat centerY = project::kCanvasHeight * control.y / 100.;
        if (point.x >= centerX - control.width * .5 && point.x <= centerX + control.width * .5
            && point.y >= centerY - control.height * .5 && point.y <= centerY + control.height * .5) return index;
    }
    return -1;
}

- (NSInteger)prismBandAt:(NSPoint)point {
    if constexpr (!project::kIsPrismEq && !project::kHasPrismModule) return -1;
    for (std::size_t index = 0; index < project::kControls.size(); ++index) {
        if (!equals(project::kControls[index].kind, "spectrum") || equals(project::kControls[index].variant, "pure-spectrum")) continue;
        const auto& control = project::kControls[index];
        const auto& visual = project::kVisualControls[index];
        const NSRect spectrum = controlLayoutRect(control, visual);
        const NSPoint localPoint = controlLocalPoint(control, point);
        for (int band = 4; band >= 0; --band) if (_instrument->prismBandEnabled(band)) {
            const float gain = band ? (_instrument->prismBandValue(band, 1) - .5f) * 24.f : 0.f;
            const NSPoint node = NSMakePoint(NSMinX(spectrum) + NSWidth(spectrum) * _instrument->prismBandValue(band, 0), NSMidY(spectrum) - gain * NSHeight(spectrum) / 36.f);
            if (std::hypot(localPoint.x - node.x, localPoint.y - node.y) <= 12.) return band;
        }
    }
    return -1;
}

- (void)updatePrismBand:(NSInteger)band point:(NSPoint)point {
    for (std::size_t index = 0; index < project::kControls.size(); ++index) {
        if (!equals(project::kControls[index].kind, "spectrum") || equals(project::kControls[index].variant, "pure-spectrum")) continue;
        const auto& control = project::kControls[index];
        const auto& visual = project::kVisualControls[index];
        const NSRect spectrum = controlLayoutRect(control, visual);
        const NSPoint localPoint = controlLocalPoint(control, point);
        auto setParameter = [&](ParamID parameter, float value) { if (parameter != kNoParamId) { _instrument->beginEdit(parameter); _instrument->setParamNormalized(parameter, std::clamp(value, 0.f, 1.f)); _instrument->performEdit(parameter, std::clamp(value, 0.f, 1.f)); _instrument->endEdit(parameter); } };
        setParameter(_instrument->prismParameterFor(static_cast<int>(band), 0), static_cast<float>((localPoint.x - NSMinX(spectrum)) / std::max<CGFloat>(1, NSWidth(spectrum))));
        if (band > 0) setParameter(_instrument->prismParameterFor(static_cast<int>(band), 1), static_cast<float>(.5 + (NSMidY(spectrum) - localPoint.y) / std::max<CGFloat>(1, NSHeight(spectrum)) * 1.5));
        break;
    }
    [self setNeedsDisplay:YES];
}

- (NSInteger)keyboardPitchAt:(NSPoint)point control:(NSInteger)controlIndex {
    for (auto key = project::kVisualKeys.rbegin(); key != project::kVisualKeys.rend(); ++key) {
        if (key->control != controlIndex) continue;
        if (point.x >= key->hx && point.x <= key->hx + key->hw
            && point.y >= key->hy && point.y <= key->hy + key->hh) return key->pitch;
    }
    return -1;
}

- (void)setControl:(NSInteger)index value:(float)value {
    if (index < 0 || static_cast<std::size_t>(index) >= project::kControls.size()) return;
    const auto parameter = displayedParameter(*_instrument, static_cast<std::size_t>(index), _selectedPrismBand);
    if (parameter == kNoParamId) return;
    [self setParameter:parameter value:std::clamp(value, 0.f, 1.f)];
    [self setNeedsDisplay:YES];
}

- (void)resetCursorRects {
    [super resetCursorRects];
    if (_openPanel < 0 || !equals(project::kPanelControls[static_cast<std::size_t>(_openPanel)].panelType, "midi_map")) return;
    const NSRect panel = [self panelRect:_openPanel];
    const auto visible = [self visibleMidiSequences];
    const CGFloat left = NSMinX(panel) + 16, right = NSMaxX(panel) - 16, rowStart = NSMinY(panel) + 83;
    const NSInteger capacity = std::max<NSInteger>(1, static_cast<NSInteger>((NSMaxY(panel) - 12 - rowStart + 6) / 53));
    const BOOL scrollable = static_cast<NSInteger>(visible.size()) > capacity;
    CGFloat scale = 1, offsetX = 0, offsetY = 0; [self canvasScale:&scale offsetX:&offsetX offsetY:&offsetY];
    for (NSInteger row = 0; row < capacity && _grooveScrollOffset + row < static_cast<NSInteger>(visible.size()); ++row) {
        const NSRect designRect = NSMakeRect(left, rowStart + row * 53, right - left - (scrollable ? 12 : 0), 47);
        [self addCursorRect:NSMakeRect(offsetX + NSMinX(designRect) * scale, offsetY + NSMinY(designRect) * scale, NSWidth(designRect) * scale, NSHeight(designRect) * scale) cursor:NSCursor.pointingHandCursor];
    }
}

- (void)mouseMoved:(NSEvent*)event {
    const NSPoint point = [self designPoint:[self convertPoint:event.locationInWindow fromView:nil]];
    NSInteger nextHoveredControl = [self panelControlAt:point];
    if (nextHoveredControl < 0) { const BOOL insidePanel = _openPanel >= 0 && NSPointInRect(point, [self panelRect:_openPanel]); if (!insidePanel) nextHoveredControl = [self controlAt:point]; }
    if (nextHoveredControl >= 0) { const auto& control = project::kControls[static_cast<std::size_t>(nextHoveredControl)]; if (!equals(control.kind, "knob") && !equals(control.kind, "fader")) nextHoveredControl = -1; }
    if (nextHoveredControl != _hoveredControl) { _hoveredControl = nextHoveredControl; [self setNeedsDisplay:YES]; }
    NSInteger nextHovered = -1;
    if (_openPanel >= 0 && equals(project::kPanelControls[static_cast<std::size_t>(_openPanel)].panelType, "preset_browser")) {
        const NSRect panel = [self panelRect:_openPanel];
        const CGFloat left = NSMinX(panel) + 16, right = NSMaxX(panel) - 16, rowStart = NSMinY(panel) + 107;
        const NSInteger total = static_cast<NSInteger>(project::kPresets.size() + _userPresets.size());
        const NSInteger capacity = std::max<NSInteger>(1, static_cast<NSInteger>((NSMaxY(panel) - 12 - rowStart + 6) / 47));
        const NSInteger maxOffset = std::max<NSInteger>(0, total - capacity);
        const CGFloat contentRight = right - (maxOffset > 0 ? 12 : 0);
        if (point.x >= left && point.x <= contentRight && point.y >= rowStart && point.y <= NSMaxY(panel) - 12) {
            const NSInteger slot = static_cast<NSInteger>((point.y - rowStart) / 47), absolute = _presetScrollOffset + slot;
            const CGFloat rowOffset = std::fmod(point.y - rowStart, 47.);
            if (slot >= 0 && slot < capacity && rowOffset <= 41 && absolute < total) nextHovered = absolute;
        }
    }
    if (nextHovered != _hoveredPresetRow) { _hoveredPresetRow = nextHovered; [self setNeedsDisplay:YES]; }
}

- (void)mouseExited:(NSEvent*)event {
    (void)event;
    if (_hoveredPresetRow >= 0 || _hoveredControl >= 0) { _hoveredPresetRow = -1; _hoveredControl = -1; [self setNeedsDisplay:YES]; }
}

- (void)mouseDown:(NSEvent*)event {
    [self.window makeFirstResponder:self];
    const NSPoint point = [self designPoint:[self convertPoint:event.locationInWindow fromView:nil]];
    if constexpr (project::kLicenseRequired) {
        if (!LicenseRuntime::isLicensed()) {
            const NSRect button = NSMakeRect(project::kCanvasWidth * .5 - 145, project::kCanvasHeight * .5 + 20, 290, 48);
            if (NSPointInRect(point, button)) {
                NSString* serial = [NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString] ?: @"";
                const char* characters = serial.UTF8String ?: "";
                std::wstring value;
                while (*characters) value.push_back(static_cast<unsigned char>(*characters++));
                LicenseRuntime::activateSerial(value);
                [self setNeedsDisplay:YES];
            }
            return;
        }
    }
    if ([self handleOutputMenuMouseDown:point]) return;
    const NSInteger panelControl = [self panelControlAt:point];
    if (panelControl >= 0) {
        _dragControl = panelControl;
        const auto& control = project::kControls[static_cast<std::size_t>(_dragControl)];
        if (equals(control.kind, "output_selector")) {
            _outputMenuControl = _dragControl;
            [self setNeedsDisplay:YES];
            _dragControl = -1;
        } else if (event.clickCount >= 2 && (equals(control.kind, "knob") || equals(control.kind, "fader"))) {
            [self setControl:_dragControl value:neutralControlValue(control)];
            _dragControl = -1;
        } else if (control.midiSequenceIndex >= 0 && (equals(control.kind, "button") || equals(control.kind, "pad"))) {
            [self stopMidiSequence];
            _instrument->setLivePatternSequence(_instrument->livePatternSequenceIndex() == control.midiSequenceIndex ? -1 : control.midiSequenceIndex);
            _selectedMidiSequence = control.midiSequenceIndex;
            _dragControl = -1;
        } else if (equals(control.kind, "pad")) {
            _activeNoteSamplerGroup = control.samplerGroupIndex;
            _activeNote = control.notePitch;
            _instrument->queueEditorNote(static_cast<int>(_activeNote), 112, true, static_cast<int>(_activeNoteSamplerGroup));
            _dragControl = -1;
        } else {
            const auto parameter = displayedParameter(*_instrument, static_cast<std::size_t>(_dragControl), _selectedPrismBand);
            _dragStartValue = parameter == kNoParamId ? control.value
                                                      : static_cast<float>(_instrument->getParamNormalized(parameter));
            _dragStartY = point.y;
            if (equals(control.kind, "button") || equals(control.kind, "mute") || equals(control.kind, "solo")) {
                [self setControl:_dragControl value:_dragStartValue >= .5f ? 0.f : 1.f];
                _dragControl = -1;
            }
        }
        return;
    }
    if (event.clickCount >= 2 && _openPanel >= 0 && equals(project::kPanelControls[static_cast<std::size_t>(_openPanel)].panelType, "mixer") && project::kPanelControls[static_cast<std::size_t>(_openPanel)].mixerShowDefaultControls) {
        const NSRect panel = [self panelRect:_openPanel];
        const CGFloat left = NSMinX(panel) + 16, top = NSMinY(panel) + 60;
        const NSInteger group = static_cast<NSInteger>((point.x - left) / 122);
        if (group >= 0 && group < static_cast<NSInteger>(project::kGroups.size())) {
            const CGFloat localX = point.x - (left + group * 122), localY = point.y - top;
            if (localX >= 5 && localX <= 107 && localY >= 35 && localY <= 64) { [self setParameter:groupParameterId(static_cast<int>(group), 0) value:1.f]; return; }
            if (localX >= 5 && localX <= 107 && localY >= 80 && localY <= 109) { [self setParameter:groupParameterId(static_cast<int>(group), 1) value:.5f]; return; }
        }
    }
    if ([self panelMouseDown:point]) return;
    if (event.clickCount >= 2 && (project::kIsPrismEq || project::kHasPrismModule)) {
        for (std::size_t index = 0; index < project::kControls.size(); ++index) {
            if (!equals(project::kControls[index].kind, "spectrum") || equals(project::kControls[index].variant, "pure-spectrum")) continue;
            const auto& control = project::kControls[index];
            const auto& visual = project::kVisualControls[index];
            if (!NSPointInRect(controlLocalPoint(control, point), controlLayoutRect(control, visual))) continue;
            for (NSInteger band = 0; band < 5; ++band) if (!_instrument->prismBandEnabled(static_cast<int>(band))) {
                _selectedPrismBand = band;
                const auto enabled = kPrismEnabledBaseId + static_cast<ParamID>(band);
                _instrument->beginEdit(enabled); _instrument->setParamNormalized(enabled, 1); _instrument->performEdit(enabled, 1); _instrument->endEdit(enabled);
                [self updatePrismBand:band point:point];
                return;
            }
            return;
        }
    }
    _dragPrismBand = [self prismBandAt:point];
    if (_dragPrismBand >= 0) {
        _selectedPrismBand = _dragPrismBand;
        [self updatePrismBand:_dragPrismBand point:point];
        return;
    }
    _dragControl = [self controlAt:point];
    if (_dragControl < 0) return;
    const auto& control = project::kControls[static_cast<std::size_t>(_dragControl)];
    if (equals(control.kind, "output_selector")) {
        _outputMenuControl = _dragControl;
        [self setNeedsDisplay:YES];
        _dragControl = -1;
    } else if (event.clickCount >= 2 && (equals(control.kind, "knob") || equals(control.kind, "fader"))) {
        [self setControl:_dragControl value:neutralControlValue(control)];
        _dragControl = -1;
    } else if (equals(control.kind, "panel_button")) {
        if (_openPanel == _dragControl) [self closePanel]; else [self openPanel:_dragControl];
        _dragControl = -1;
    } else if (control.midiSequenceIndex >= 0 && (equals(control.kind, "button") || equals(control.kind, "pad"))) {
        [self stopMidiSequence];
        _instrument->setLivePatternSequence(_instrument->livePatternSequenceIndex() == control.midiSequenceIndex ? -1 : control.midiSequenceIndex);
        _selectedMidiSequence = control.midiSequenceIndex;
        _dragControl = -1;
    } else if (equals(control.kind, "keyboard")) {
        _activeNoteSamplerGroup = control.samplerGroupIndex;
        _activeNote = [self keyboardPitchAt:point control:_dragControl];
        if (_activeNote >= 0) _instrument->queueEditorNote(static_cast<int>(_activeNote), 108, true, static_cast<int>(_activeNoteSamplerGroup));
        _dragControl = -1;
    } else if (equals(control.kind, "pad")) {
        _activeNoteSamplerGroup = control.samplerGroupIndex;
        _activeNote = control.notePitch;
        _instrument->queueEditorNote(static_cast<int>(_activeNote), 112, true, static_cast<int>(_activeNoteSamplerGroup));
        _dragControl = -1;
    } else {
        const auto parameter = displayedParameter(*_instrument, static_cast<std::size_t>(_dragControl), _selectedPrismBand);
        _dragStartValue = parameter == kNoParamId ? control.value
                                                  : static_cast<float>(_instrument->getParamNormalized(parameter));
        _dragStartY = controlLocalPoint(control, point).y;
        if (equals(control.kind, "button") || equals(control.kind, "mute") || equals(control.kind, "solo")) {
            [self setControl:_dragControl value:_dragStartValue >= .5f ? 0.f : 1.f];
            _dragControl = -1;
        }
    }
}

- (void)mouseDragged:(NSEvent*)event {
    const NSPoint point = [self designPoint:[self convertPoint:event.locationInWindow fromView:nil]];
    if (_midiDragCandidate >= 0 && std::hypot(point.x - _midiDragX, point.y - _midiDragY) >= 6.) {
        const NSInteger sequence = _midiDragCandidate; _midiDragCandidate = -1;
        const auto path = [self exportMidiSequence:sequence];
        if (!path.empty()) {
            NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.string().c_str()]];
            NSDraggingItem* item = [[NSDraggingItem alloc] initWithPasteboardWriter:url];
            NSImage* image = [[NSImage alloc] initWithSize:NSMakeSize(130, 32)];
            [image lockFocus]; fillRounded(NSMakeRect(0, 0, 130, 32), 8, rgbColor(project::kAccentRgb));
            [[self midiName:sequence] drawInRect:NSMakeRect(8, 8, 114, 16) withAttributes:panelTextAttributes(9, NSColor.whiteColor, NSTextAlignmentCenter, NSFontWeightBold)]; [image unlockFocus];
            [item setDraggingFrame:NSMakeRect(event.locationInWindow.x - 65, event.locationInWindow.y - 16, 130, 32) contents:image];
            [self beginDraggingSessionWithItems:@[item] event:event source:self];
        }
        return;
    }
    if (_panelDragMode) {
        if (_panelDragMode == 1) {
            _panelX = std::clamp(_panelX + (point.x - _panelDragX) / project::kCanvasWidth * 100., _panelWidth * .5, 100. - _panelWidth * .5);
            _panelY = std::clamp(_panelY + (point.y - _panelDragY) / project::kCanvasHeight * 100., _panelHeight * .5, 100. - _panelHeight * .5);
        } else {
            _panelWidth = std::clamp(_panelWidth + (point.x - _panelDragX) / project::kCanvasWidth * 200., 35., 96.);
            _panelHeight = std::clamp(_panelHeight + (point.y - _panelDragY) / project::kCanvasHeight * 200., 30., 92.);
        }
        _panelDragX = point.x; _panelDragY = point.y; [self setNeedsDisplay:YES]; return;
    }
    if (_dragPrismBand >= 0) {
        [self updatePrismBand:_dragPrismBand point:point];
        return;
    }
    if (_mixerDragGroup >= 0 && _mixerDragSlot >= 0 && _openPanel >= 0
        && equals(project::kPanelControls[static_cast<std::size_t>(_openPanel)].panelType, "mixer")) {
        const NSRect panel = [self panelRect:_openPanel];
        const CGFloat trackLeft = NSMinX(panel) + 16 + _mixerDragGroup * 122 + 11;
        [self setParameter:groupParameterId(static_cast<int>(_mixerDragGroup), static_cast<int>(_mixerDragSlot))
                       value:static_cast<float>(std::clamp((point.x - trackLeft) / 90., 0., 1.))];
        return;
    }
    if (_dragControl < 0) return;
    const auto& control = project::kControls[static_cast<std::size_t>(_dragControl)];
    const NSPoint localPoint = controlLocalPoint(control, point);
    [self setControl:_dragControl value:_dragStartValue + static_cast<float>((_dragStartY - localPoint.y) / 150.)];
}

- (void)mouseUp:(NSEvent*)event {
    (void)event;
    if (_activeNote >= 0) {
        _instrument->queueEditorNote(static_cast<int>(_activeNote), 0, false, static_cast<int>(_activeNoteSamplerGroup));
        _activeNote = -1;
        _activeNoteSamplerGroup = -1;
    }
    _dragControl = -1;
    _dragPrismBand = -1;
    _panelDragMode = 0;
    _mixerDragGroup = -1;
    _mixerDragSlot = -1;
    _midiDragCandidate = -1;
}

- (NSDragOperation)draggingSession:(NSDraggingSession*)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
    (void)session; (void)context; return NSDragOperationCopy;
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
    (void)sender; return NSDragOperationNone;
}

- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    (void)sender; return NO;
}

- (void)keyDown:(NSEvent*)event {
    if (_presetNameFocused) {
        if (event.keyCode == 51 || event.keyCode == 117) { if (!_presetNameInput.empty()) _presetNameInput.pop_back(); }
        else if (event.keyCode == 36 || event.keyCode == 76) [self saveUserPreset];
        else if (event.keyCode == 53) _presetNameFocused = NO;
        else if (_presetNameInput.size() < 48) { NSString* characters = event.characters; if (characters.length) { const char* utf8 = characters.UTF8String; if (utf8) _presetNameInput.append(utf8, std::min<std::size_t>(std::strlen(utf8), 48 - _presetNameInput.size())); } }
        [self setNeedsDisplay:YES]; return;
    }
    if ((event.keyCode == 51 || event.keyCode == 117) && (project::kIsPrismEq || project::kHasPrismModule) && _instrument->prismBandEnabled(static_cast<int>(_selectedPrismBand))) {
        const auto enabled = kPrismEnabledBaseId + static_cast<ParamID>(_selectedPrismBand);
        _instrument->beginEdit(enabled); _instrument->setParamNormalized(enabled, 0); _instrument->performEdit(enabled, 0); _instrument->endEdit(enabled);
        for (NSInteger distance = 1; distance < 5; ++distance) {
            const NSInteger lower = _selectedPrismBand - distance, upper = _selectedPrismBand + distance;
            if (lower >= 0 && _instrument->prismBandEnabled(static_cast<int>(lower))) { _selectedPrismBand = lower; break; }
            if (upper < 5 && _instrument->prismBandEnabled(static_cast<int>(upper))) { _selectedPrismBand = upper; break; }
        }
        [self setNeedsDisplay:YES];
        return;
    }
    [super keyDown:event];
}

- (void)scrollWheel:(NSEvent*)event {
    const NSPoint point = [self designPoint:[self convertPoint:event.locationInWindow fromView:nil]];
    const NSInteger panelControl = [self panelControlAt:point];
    if (panelControl >= 0) {
        const auto& control = project::kControls[static_cast<std::size_t>(panelControl)];
        if (equals(control.kind, "knob") || equals(control.kind, "fader")) {
            const auto parameter = displayedParameter(*_instrument, static_cast<std::size_t>(panelControl), _selectedPrismBand);
            if (parameter != kNoParamId) {
                const auto current = static_cast<float>(_instrument->getParamNormalized(parameter));
                float next = current + (event.scrollingDeltaY > 0 ? .02f : -.02f);
                if (control.moduleIndex >= 0 && equals(control.parameter, "tuning")) {
                    const NSInteger semitones = std::clamp<NSInteger>(std::lround(current * 48.f) - 24 + (event.scrollingDeltaY > 0 ? 1 : -1), -24, 24);
                    next = static_cast<float>(semitones + 24) / 48.f;
                }
                [self setControl:panelControl value:next];
                return;
            }
        }
    }
    if (_openPanel >= 0) {
        const NSRect panel = [self panelRect:_openPanel];
        if (NSPointInRect(point, panel) && point.y >= NSMinY(panel) + 44) {
            const NSInteger direction = event.scrollingDeltaY > 0 ? -1 : 1;
            const auto& panelInfo = project::kPanelControls[static_cast<std::size_t>(_openPanel)];
            if (equals(panelInfo.panelType, "midi_map")) {
                const auto visible = [self visibleMidiSequences];
                const CGFloat rowStart = NSMinY(panel) + 83;
                const NSInteger capacity = std::max<NSInteger>(1, static_cast<NSInteger>((NSMaxY(panel) - 12 - rowStart + 6) / 53));
                const NSInteger maxOffset = std::max<NSInteger>(0, static_cast<NSInteger>(visible.size()) - capacity);
                _grooveScrollOffset = std::clamp(_grooveScrollOffset + direction, static_cast<NSInteger>(0), maxOffset);
                [self.window invalidateCursorRectsForView:self]; [self setNeedsDisplay:YES]; return;
            }
            if (equals(panelInfo.panelType, "preset_browser")) {
                const CGFloat rowStart = NSMinY(panel) + 107;
                const NSInteger total = static_cast<NSInteger>(project::kPresets.size() + _userPresets.size());
                const NSInteger capacity = std::max<NSInteger>(1, static_cast<NSInteger>((NSMaxY(panel) - 12 - rowStart + 6) / 47));
                const NSInteger maxOffset = std::max<NSInteger>(0, total - capacity);
                _presetScrollOffset = std::clamp(_presetScrollOffset + direction, static_cast<NSInteger>(0), maxOffset);
                [self setNeedsDisplay:YES]; return;
            }
            if (equals(panelInfo.panelType, "mixer") && panelInfo.mixerShowDefaultControls) {
                const CGFloat left = NSMinX(panel) + 16, top = NSMinY(panel) + 60;
                const NSInteger group = static_cast<NSInteger>((point.x - left) / 122);
                if (group >= 0 && group < static_cast<NSInteger>(project::kGroups.size())) {
                    const CGFloat localX = point.x - (left + group * 122), localY = point.y - top;
                    NSInteger slot = -1;
                    if (localX >= 5 && localX <= 107 && localY >= 30 && localY <= 68) slot = 0;
                    else if (localX >= 5 && localX <= 107 && localY >= 75 && localY <= 113) slot = 1;
                    if (slot >= 0) {
                        const auto parameter = groupParameterId(static_cast<int>(group), static_cast<int>(slot));
                        [self setParameter:parameter value:static_cast<float>(_instrument->getParamNormalized(parameter)) + (event.scrollingDeltaY > 0 ? .02f : -.02f)];
                        [self setNeedsDisplay:YES]; return;
                    }
                }
            }
        }
    }
    const NSInteger band = [self prismBandAt:point];
    if (band >= 0) {
        _selectedPrismBand = band;
        const auto parameter = _instrument->prismParameterFor(static_cast<int>(band), 2);
        const auto current = static_cast<float>(_instrument->getParamNormalized(parameter));
        _instrument->beginEdit(parameter); _instrument->setParamNormalized(parameter, std::clamp(current + static_cast<float>(event.scrollingDeltaY * .01), 0.f, 1.f)); _instrument->performEdit(parameter, _instrument->getParamNormalized(parameter)); _instrument->endEdit(parameter);
        [self setNeedsDisplay:YES];
        return;
    }
    const NSInteger index = [self controlAt:point];
    if (index < 0 || (!equals(project::kControls[static_cast<std::size_t>(index)].kind, "knob") && !equals(project::kControls[static_cast<std::size_t>(index)].kind, "fader"))) return;
    const auto& control = project::kControls[static_cast<std::size_t>(index)];
    const auto parameter = displayedParameter(*_instrument, static_cast<std::size_t>(index), _selectedPrismBand);
    if (parameter == kNoParamId) return;
    const auto current = static_cast<float>(_instrument->getParamNormalized(parameter));
    float next = current + static_cast<float>(event.scrollingDeltaY * .01);
    if (control.moduleIndex >= 0 && equals(control.parameter, "tuning")) {
        const NSInteger semitones = std::clamp<NSInteger>(std::lround(current * 48.f) - 24 + (event.scrollingDeltaY > 0 ? 1 : -1), -24, 24);
        next = static_cast<float>(semitones + 24) / 48.f;
    }
    [self setControl:index value:next];
}
@end

namespace tripleside::native {

NativeView::NativeView(NativeInstrument& owner) : CPluginView(nullptr), instrument(owner) {
    rect = ViewRect(0, 0, project::kCanvasWidth, project::kCanvasHeight);
}

NativeView::~NativeView() { removed(); }

tresult PLUGIN_API NativeView::isPlatformTypeSupported(FIDString type) {
    return type && std::strcmp(type, kPlatformTypeNSView) == 0 ? kResultTrue : kResultFalse;
}

tresult PLUGIN_API NativeView::attached(void* parent, FIDString type) {
    if (!parent || isPlatformTypeSupported(type) != kResultTrue) return kInvalidArgument;
    auto* parentView = (__bridge NSView*)parent;
    auto* view = [[TripleSideNativeMacView alloc]
        initWithFrame:NSMakeRect(0, 0, rect.getWidth(), rect.getHeight()) instrument:&instrument];
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [parentView addSubview:view];
    cocoaView = (__bridge void*)view;
    systemWindow = parent;
    return kResultOk;
}

tresult PLUGIN_API NativeView::removed() {
    if (cocoaView) {
        auto* view = (__bridge NSView*)cocoaView;
        [view removeFromSuperview];
        cocoaView = nullptr;
    }
    systemWindow = nullptr;
    return kResultOk;
}

tresult PLUGIN_API NativeView::onSize(ViewRect* size) {
    if (!size) return kInvalidArgument;
    rect = *size;
    if (cocoaView) {
        auto* view = (__bridge NSView*)cocoaView;
        view.frame = NSMakeRect(0, 0, rect.getWidth(), rect.getHeight());
    }
    return kResultTrue;
}

tresult PLUGIN_API NativeView::onKeyDown(char16 key, int16 keyCode, int16 modifiers) {
    return CPluginView::onKeyDown(key, keyCode, modifiers);
}
} // namespace tripleside::native
