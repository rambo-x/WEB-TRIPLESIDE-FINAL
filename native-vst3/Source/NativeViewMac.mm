#include "NativeView.h"
#include "NativeInstrument.h"
#include "LicenseRuntime.h"
#include "NativeProject.h"
#include "pluginterfaces/gui/iplugview.h"

#import <Cocoa/Cocoa.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cctype>
#include <cmath>
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

bool interactiveKind(const char* kind) {
    return equals(kind, "knob") || equals(kind, "fader") || equals(kind, "button")
        || equals(kind, "mute") || equals(kind, "solo") || equals(kind, "pad")
        || equals(kind, "keyboard") || equals(kind, "panel_button");
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
};

NSColor* rgbColor(unsigned rgb, CGFloat alpha = 1) {
    return [NSColor colorWithCalibratedRed:((rgb >> 16) & 255) / 255.
                                     green:((rgb >> 8) & 255) / 255.
                                      blue:(rgb & 255) / 255.
                                     alpha:alpha];
}

NSDictionary* panelTextAttributes(CGFloat size, NSColor* color, NSTextAlignment alignment = NSTextAlignmentLeft, NSFontWeight weight = NSFontWeightRegular) {
    NSMutableParagraphStyle* paragraph = [[NSMutableParagraphStyle alloc] init];
    paragraph.alignment = alignment;
    paragraph.lineBreakMode = NSLineBreakByTruncatingTail;
    return @{
        NSFontAttributeName: [NSFont systemFontOfSize:size weight:weight],
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
        return std::clamp(std::max(instrument.outputPeak(0), instrument.outputPeak(1)) * 1.5f, 0.f, 1.f);
    }
    const auto parameter = displayedParameter(instrument, index, selectedPrismBand);
    return parameter == kNoParamId ? std::clamp(control.value, 0.f, 1.f)
                                   : static_cast<float>(instrument.getParamNormalized(parameter));
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
using tripleside::native::displayedValue;
using tripleside::native::displayedParameter;
using tripleside::native::controlVisible;
using tripleside::native::equals;
using tripleside::native::interactiveKind;
using tripleside::native::hitPadVariant;
using tripleside::native::loadResourceImage;
using tripleside::native::controlLocalPoint;
using tripleside::native::controlLayoutRect;
using tripleside::native::fillRounded;
using tripleside::native::panelTextAttributes;
using tripleside::native::rgbColor;
using tripleside::native::RuntimeMidiEvent;
using tripleside::native::RuntimeMidiSequence;
using tripleside::native::RuntimeMidiTempo;
using tripleside::native::RuntimeUserPreset;
using tripleside::native::strokeRounded;
using tripleside::native::kPrismEnabledBaseId;
using Steinberg::Vst::kNoParamId;
using Steinberg::Vst::ParamID;
namespace project = tripleside::project;

@interface TripleSideNativeMacView : NSView <NSDraggingSource> {
@private
    NativeInstrument* _instrument;
    NSMutableDictionary<NSString*, NSImage*>* _images;
    NSTimer* _timer;
    NSTimer* _midiTimer;
    NSInteger _dragControl;
    CGFloat _dragStartY;
    float _dragStartValue;
    NSInteger _activeNote;
    NSInteger _selectedPrismBand;
    NSInteger _dragPrismBand;
    std::array<unsigned, 128> _padTriggerGenerations;
    std::array<double, 128> _padFlashUntil;
    NSInteger _openPanel;
    NSInteger _panelDragMode;
    NSInteger _selectedMidiSequence;
    NSInteger _playingMidiSequence;
    NSInteger _midiDragCandidate;
    CGFloat _panelX, _panelY, _panelWidth, _panelHeight;
    CGFloat _panelDragX, _panelDragY, _midiDragX, _midiDragY;
    std::map<int, std::array<CGFloat, 4>> _panelRuntimeBounds;
    std::vector<RuntimeMidiSequence> _importedMidi;
    std::map<int, bool> _midiLoopOverrides;
    std::set<int> _hiddenMidiSequences;
    std::vector<std::pair<int, int>> _midiPlayingNotes;
    std::vector<RuntimeUserPreset> _userPresets;
    std::size_t _midiEventCursor;
    double _midiStartedAt;
}
- (instancetype)initWithFrame:(NSRect)frame instrument:(NativeInstrument*)instrument;
- (BOOL)hitPadFlashActive:(int)pitch;
- (void)drawOpenPanel;
- (void)updateMidiPlayback;
- (NSRect)panelRect:(NSInteger)index;
- (BOOL)panelMouseDown:(NSPoint)point;
- (BOOL)importMidiPath:(NSString*)path;
- (std::filesystem::path)exportMidiSequence:(NSInteger)index;
- (std::vector<int>)visibleMidiSequences;
- (BOOL)midiSequenceLoopEnabled:(NSInteger)index;
- (NSString*)midiName:(NSInteger)index;
- (RuntimeUserPreset)captureUserPreset:(const std::string&)name;
@end

@implementation TripleSideNativeMacView

- (instancetype)initWithFrame:(NSRect)frame instrument:(NativeInstrument*)instrument {
    self = [super initWithFrame:frame];
    if (self) {
        _instrument = instrument;
        _images = [NSMutableDictionary dictionary];
        _dragControl = -1;
        _activeNote = -1;
        _selectedPrismBand = 0;
        while (_selectedPrismBand < 5 && !_instrument->prismBandEnabled(static_cast<int>(_selectedPrismBand))) ++_selectedPrismBand;
        if (_selectedPrismBand >= 5) _selectedPrismBand = 0;
        _dragPrismBand = -1;
        _openPanel = -1;
        _panelDragMode = 0;
        _selectedMidiSequence = project::kMidiSequences.empty() ? -1 : 0;
        _playingMidiSequence = -1;
        _midiDragCandidate = -1;
        _panelX = 50;
        _panelY = 52;
        _panelWidth = 88;
        _panelHeight = 78;
        _midiEventCursor = 0;
        _midiStartedAt = 0;
        _padTriggerGenerations.fill(0);
        _padFlashUntil.fill(0);
        __weak TripleSideNativeMacView* weakSelf = self;
        _timer = [NSTimer scheduledTimerWithTimeInterval:(1.0 / 30.0) repeats:YES block:^(NSTimer*) {
            [weakSelf setNeedsDisplay:YES];
        }];
        _midiTimer = [NSTimer scheduledTimerWithTimeInterval:.01 repeats:YES block:^(NSTimer*) {
            [weakSelf updateMidiPlayback];
        }];
        [self registerForDraggedTypes:@[NSPasteboardTypeFileURL]];
    }
    return self;
}

- (void)dealloc {
    [_timer invalidate];
    [_midiTimer invalidate];
    for (const auto& note : _midiPlayingNotes) if (_instrument) _instrument->queueEditorNote(note.first, 0, false);
    if (_activeNote >= 0 && _instrument) _instrument->queueEditorNote(static_cast<int>(_activeNote), 0, false);
}

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstResponder { return YES; }

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

- (void)setParameter:(ParamID)parameter value:(float)value {
    if (parameter == kNoParamId) return;
    value = std::clamp(value, 0.f, 1.f);
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
    [self setNeedsDisplay:YES];
}

- (void)closePanel {
    if (_openPanel >= 0) _panelRuntimeBounds[static_cast<int>(_openPanel)] = {_panelX, _panelY, _panelWidth, _panelHeight};
    _openPanel = -1;
    _panelDragMode = 0;
    _midiDragCandidate = -1;
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
    for (const auto& note : _midiPlayingNotes) _instrument->queueEditorNote(note.first, 0, false);
    _midiPlayingNotes.clear();
    _playingMidiSequence = -1;
    _midiEventCursor = 0;
}

- (void)startMidiSequence:(NSInteger)index {
    [self stopMidiSequence];
    const NSInteger count = static_cast<NSInteger>(project::kMidiSequences.size() + _importedMidi.size());
    if (index < 0 || index >= count || _hiddenMidiSequences.contains(static_cast<int>(index))) return;
    _selectedMidiSequence = index;
    _playingMidiSequence = index;
    _midiStartedAt = NSProcessInfo.processInfo.systemUptime;
    _midiEventCursor = 0;
}

- (void)drawOpenPanel {
    if (_openPanel < 0 || static_cast<std::size_t>(_openPanel) >= project::kControls.size()) return;
    const NSRect panelRect = [self panelRect:_openPanel];
    const auto& control = project::kControls[static_cast<std::size_t>(_openPanel)];
    const auto& panel = project::kPanelControls[static_cast<std::size_t>(_openPanel)];
    NSColor* accent = rgbColor(project::kAccentRgb);
    fillRounded(panelRect, 18, rgbColor(0x09090b, .99));
    strokeRounded(NSInsetRect(panelRect, .5, .5), 18, rgbColor(project::kAccentRgb, .48));

    const NSRect header = NSMakeRect(NSMinX(panelRect), NSMinY(panelRect), NSWidth(panelRect), 44);
    [[NSColor colorWithCalibratedWhite:1 alpha:.035] setFill];
    [[NSBezierPath bezierPathWithRoundedRect:header xRadius:18 yRadius:18] fill];
    [rgbColor(0xffffff, .08) setFill];
    NSRectFill(NSMakeRect(NSMinX(panelRect), NSMaxY(header) - 1, NSWidth(panelRect), 1));
    NSString* title = [NSString stringWithUTF8String:control.label ?: "Panel"];
    [title drawInRect:NSMakeRect(NSMinX(panelRect) + 16, NSMinY(panelRect) + 13, std::max<CGFloat>(80, NSWidth(panelRect) * .45), 18)
       withAttributes:panelTextAttributes(12, rgbColor(0xfafafa), NSTextAlignmentLeft, NSFontWeightBold)];
    NSString* type = equals(panel.panelType, "preset_browser") ? @"PRESET BROWSER" : equals(panel.panelType, "mixer") ? @"MIXER" : @"GROOVE BROWSER";
    [type drawInRect:NSMakeRect(NSMinX(panelRect) + std::min<CGFloat>(220, NSWidth(panelRect) * .5), NSMinY(panelRect) + 15, std::max<CGFloat>(80, NSWidth(panelRect) * .3), 15)
      withAttributes:panelTextAttributes(8, rgbColor(project::kAccentRgb), NSTextAlignmentLeft, NSFontWeightBold)];
    const NSRect close = NSMakeRect(NSMaxX(panelRect) - 39, NSMinY(panelRect) + 8, 27, 27);
    fillRounded(close, 14, rgbColor(0xffffff, .05));
    [@"×" drawInRect:NSMakeRect(NSMinX(close), NSMinY(close) + 4, NSWidth(close), 18)
       withAttributes:panelTextAttributes(15, rgbColor(0xa1a1aa), NSTextAlignmentCenter, NSFontWeightMedium)];

    const CGFloat left = NSMinX(panelRect) + 16;
    const CGFloat right = NSMaxX(panelRect) - 16;
    const CGFloat top = NSMinY(panelRect) + 60;
    if (equals(panel.panelType, "midi_map")) {
        const NSRect drop = NSMakeRect(left, top, right - left, 74);
        fillRounded(drop, 12, rgbColor(project::kAccentRgb, .07));
        strokeRounded(NSInsetRect(drop, .5, .5), 12, rgbColor(project::kAccentRgb, .60));
        [@"⇧  Tambahkan groove MIDI" drawInRect:NSMakeRect(left + 8, top + 29, right - left - 16, 18)
           withAttributes:panelTextAttributes(10, rgbColor(0xd4d4d8), NSTextAlignmentCenter, NSFontWeightMedium)];
        [@"GROOVE LIBRARY" drawInRect:NSMakeRect(left, top + 86, 180, 14)
            withAttributes:panelTextAttributes(8, rgbColor(0xa1a1aa), NSTextAlignmentLeft, NSFontWeightBold)];
        const auto visible = [self visibleMidiSequences];
        NSString* count = [NSString stringWithFormat:@"%lu pola", static_cast<unsigned long>(visible.size())];
        [count drawInRect:NSMakeRect(right - 90, top + 86, 90, 14)
           withAttributes:panelTextAttributes(8, rgbColor(0xa1a1aa), NSTextAlignmentRight, NSFontWeightMedium)];
        CGFloat rowTop = top + 108;
        for (const int sourceIndex : visible) {
            if (rowTop + 47 > NSMaxY(panelRect) - 12) break;
            const BOOL selected = sourceIndex == _selectedMidiSequence;
            const BOOL playing = sourceIndex == _playingMidiSequence;
            const NSRect row = NSMakeRect(left, rowTop, right - left, 47);
            fillRounded(row, 10, selected ? rgbColor(project::kAccentRgb, .11) : rgbColor(0xffffff, .025));
            strokeRounded(NSInsetRect(row, .5, .5), 10, selected ? rgbColor(project::kAccentRgb, .58) : rgbColor(0xffffff, .07));
            [@"♫" drawInRect:NSMakeRect(left + 9, rowTop + 14, 18, 18)
              withAttributes:panelTextAttributes(14, selected ? accent : rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightMedium)];
            NSString* name = [self midiName:sourceIndex];
            [name drawInRect:NSMakeRect(left + 34, rowTop + 8, std::max<CGFloat>(40, NSWidth(row) - 192), 15)
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
            [meta drawInRect:NSMakeRect(left + 34, rowTop + 25, std::max<CGFloat>(40, NSWidth(row) - 192), 13)
              withAttributes:panelTextAttributes(8, rgbColor(0x71717a), NSTextAlignmentLeft, NSFontWeightMedium)];
            [@"⇩ DRAG" drawInRect:NSMakeRect(right - 150, rowTop + 17, 48, 13)
              withAttributes:panelTextAttributes(7, rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightBold)];
            const NSRect loop = NSMakeRect(right - 98, rowTop + 9, 30, 28);
            fillRounded(loop, 9, [self midiSequenceLoopEnabled:sourceIndex] ? rgbColor(project::kAccentRgb, .26) : rgbColor(0xffffff, .05));
            [@"↻" drawInRect:NSMakeRect(NSMinX(loop), NSMinY(loop) + 6, 30, 15)
              withAttributes:panelTextAttributes(12, [self midiSequenceLoopEnabled:sourceIndex] ? accent : rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightBold)];
            const NSRect play = NSMakeRect(right - 62, rowTop + 9, 30, 28);
            fillRounded(play, 9, accent);
            [(playing ? @"■" : @"▶") drawInRect:NSMakeRect(NSMinX(play), NSMinY(play) + 7, 30, 14)
              withAttributes:panelTextAttributes(10, NSColor.whiteColor, NSTextAlignmentCenter, NSFontWeightBold)];
            const NSRect remove = NSMakeRect(right - 26, rowTop + 9, 26, 28);
            fillRounded(remove, 9, rgbColor(0xffffff, .05));
            [@"×" drawInRect:NSMakeRect(NSMinX(remove), NSMinY(remove) + 5, 26, 16)
              withAttributes:panelTextAttributes(13, rgbColor(0xa1a1aa), NSTextAlignmentCenter, NSFontWeightMedium)];
            rowTop += 53;
        }
        if (visible.empty()) [@"Belum ada groove. Tambahkan file .mid atau .midi." drawInRect:NSMakeRect(left, top + 122, right - left, 80)
            withAttributes:panelTextAttributes(10, rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightMedium)];
    } else if (equals(panel.panelType, "preset_browser")) {
        const NSRect field = NSMakeRect(left, top, std::max<CGFloat>(80, right - left - 156), 35);
        fillRounded(field, 9, rgbColor(0x09090b)); strokeRounded(NSInsetRect(field, .5, .5), 9, rgbColor(0xffffff, .10));
        [@"Nama preset baru" drawInRect:NSInsetRect(field, 10, 10)
           withAttributes:panelTextAttributes(10, rgbColor(0x71717a), NSTextAlignmentLeft, NSFontWeightRegular)];
        const NSRect save = NSMakeRect(NSMaxX(field) + 8, top, right - NSMaxX(field) - 8, 35);
        fillRounded(save, 9, accent);
        [@"▣  Simpan kondisi" drawInRect:NSMakeRect(NSMinX(save) + 6, NSMinY(save) + 10, NSWidth(save) - 12, 15)
          withAttributes:panelTextAttributes(9, NSColor.whiteColor, NSTextAlignmentCenter, NSFontWeightBold)];
        CGFloat y = top + 47;
        auto drawPreset = [&](NSString* name, NSString* category, BOOL user, NSInteger userIndex) {
            if (y + 41 > NSMaxY(panelRect) - 12) return;
            const NSRect row = NSMakeRect(left, y, right - left, 41);
            fillRounded(row, 10, rgbColor(0xffffff, .025)); strokeRounded(NSInsetRect(row, .5, .5), 10, rgbColor(0xffffff, .08));
            [name drawInRect:NSMakeRect(left + 14, y + 7, NSWidth(row) - (user ? 104 : 76), 16)
              withAttributes:panelTextAttributes(10, rgbColor(0xe4e4e7), NSTextAlignmentLeft, NSFontWeightBold)];
            [category drawInRect:NSMakeRect(user ? right - 95 : right - 68, y + 9, 58, 14)
              withAttributes:panelTextAttributes(7, rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightBold)];
            if (user) {
                fillRounded(NSMakeRect(right - 66, y + 7, 34, 27), 7, rgbColor(project::kAccentRgb, .22));
                [@"OVR" drawInRect:NSMakeRect(right - 66, y + 14, 34, 12) withAttributes:panelTextAttributes(7, accent, NSTextAlignmentCenter, NSFontWeightBold)];
                fillRounded(NSMakeRect(right - 27, y + 7, 27, 27), 7, rgbColor(0xffffff, .05));
                [@"×" drawInRect:NSMakeRect(right - 27, y + 12, 27, 15) withAttributes:panelTextAttributes(12, rgbColor(0xfb7185), NSTextAlignmentCenter, NSFontWeightMedium)];
            }
            (void)userIndex; y += 47;
        };
        for (const auto& preset : project::kPresets) drawPreset([NSString stringWithUTF8String:preset.name ?: "Preset"], @"FACTORY", NO, -1);
        for (std::size_t index = 0; index < _userPresets.size(); ++index) drawPreset([NSString stringWithUTF8String:_userPresets[index].name.c_str()], @"USER", YES, static_cast<NSInteger>(index));
        if (project::kPresets.empty() && _userPresets.empty()) [@"Belum ada preset. Atur suara lalu simpan kondisi saat ini." drawInRect:NSMakeRect(left, top + 50, right - left, 100)
            withAttributes:panelTextAttributes(10, rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightMedium)];
    } else if (equals(panel.panelType, "mixer")) {
        CGFloat x = left;
        for (std::size_t index = 0; index < project::kGroups.size() && x + 112 <= right; ++index, x += 122) {
            const NSRect channel = NSMakeRect(x, top, 112, std::max<CGFloat>(120, NSMaxY(panelRect) - top - 16));
            fillRounded(channel, 12, rgbColor(0xffffff, .025)); strokeRounded(NSInsetRect(channel, .5, .5), 12, rgbColor(0xffffff, .08));
            NSString* name = [NSString stringWithUTF8String:project::kGroups[index].name ?: "Group"];
            [name drawInRect:NSMakeRect(x + 10, top + 10, 92, 15) withAttributes:panelTextAttributes(9, rgbColor(0xe4e4e7), NSTextAlignmentLeft, NSFontWeightBold)];
            const float volume = _instrument->getParamNormalized(groupParameterId(static_cast<int>(index), 0));
            const float pan = _instrument->getParamNormalized(groupParameterId(static_cast<int>(index), 1));
            [@"VOL" drawInRect:NSMakeRect(x + 10, top + 38, 92, 12) withAttributes:panelTextAttributes(7, rgbColor(0x71717a), NSTextAlignmentLeft, NSFontWeightMedium)];
            fillRounded(NSMakeRect(x + 10, top + 53, 92, 5), 3, rgbColor(0xffffff, .10));
            fillRounded(NSMakeRect(x + 10, top + 53, 92 * volume, 5), 3, accent);
            [@"PAN" drawInRect:NSMakeRect(x + 10, top + 71, 92, 12) withAttributes:panelTextAttributes(7, rgbColor(0x71717a), NSTextAlignmentLeft, NSFontWeightMedium)];
            fillRounded(NSMakeRect(x + 10, top + 86, 92, 5), 3, rgbColor(0xffffff, .10));
            fillRounded(NSMakeRect(x + 10, top + 86, 92 * pan, 5), 3, accent);
            for (int slot = 2; slot <= 3; ++slot) {
                const NSRect button = NSMakeRect(x + 10 + (slot - 2) * 48, top + 105, 44, 28);
                fillRounded(button, 6, _instrument->getParamNormalized(groupParameterId(static_cast<int>(index), slot)) >= .5 ? accent : rgbColor(0xffffff, .10));
                [(slot == 2 ? @"M" : @"S") drawInRect:NSMakeRect(NSMinX(button), NSMinY(button) + 7, NSWidth(button), 14)
                  withAttributes:panelTextAttributes(8, NSColor.whiteColor, NSTextAlignmentCenter, NSFontWeightBold)];
            }
        }
        if (project::kGroups.empty()) [@"Belum ada sampler group untuk ditampilkan." drawInRect:NSMakeRect(left, top + 20, right - left, 100)
            withAttributes:panelTextAttributes(10, rgbColor(0x71717a), NSTextAlignmentCenter, NSFontWeightMedium)];
    }
    const NSRect resize = NSMakeRect(NSMaxX(panelRect) - 22, NSMaxY(panelRect) - 22, 20, 20);
    [accent setStroke];
    NSBezierPath* grip = [NSBezierPath bezierPath]; grip.lineWidth = 1.5;
    [grip moveToPoint:NSMakePoint(NSMinX(resize) + 7, NSMaxY(resize) - 2)]; [grip lineToPoint:NSMakePoint(NSMaxX(resize) - 2, NSMinY(resize) + 7)];
    [grip moveToPoint:NSMakePoint(NSMinX(resize) + 13, NSMaxY(resize) - 2)]; [grip lineToPoint:NSMakePoint(NSMaxX(resize) - 2, NSMinY(resize) + 13)]; [grip stroke];
}

- (RuntimeUserPreset)captureUserPreset:(const std::string&)name {
    RuntimeUserPreset preset; preset.name = name;
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
        [self setParameter:groupParameterId(group.groupIndex, 1) value:(group.pan + 1.f) * .5f];
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
}

- (void)saveUserPreset {
    int suffix = 1; std::string name;
    do {
        name = "User Preset " + std::to_string(suffix++);
    } while (std::any_of(_userPresets.begin(), _userPresets.end(), [&](const auto& preset) { return preset.name == name; }));
    if (_userPresets.size() >= 128) _userPresets.erase(_userPresets.begin());
    _userPresets.push_back([self captureUserPreset:name]);
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
        if (point.y >= top && point.y <= top + 74) {
            NSOpenPanel* picker = [NSOpenPanel openPanel]; picker.allowsMultipleSelection = NO; picker.canChooseDirectories = NO;
            picker.allowedFileTypes = @[@"mid", @"midi"];
            if ([picker runModal] == NSModalResponseOK) [self importMidiPath:picker.URL.path];
            return YES;
        }
        const auto visible = [self visibleMidiSequences];
        if (point.y >= top + 108) {
            const NSInteger row = static_cast<NSInteger>((point.y - (top + 108)) / 53);
            const CGFloat rowOffset = std::fmod(point.y - (top + 108), 53.);
            if (row >= 0 && row < static_cast<NSInteger>(visible.size()) && rowOffset <= 47) {
                const int source = visible[static_cast<std::size_t>(row)]; _selectedMidiSequence = source;
                if (point.x >= right - 98 && point.x <= right - 68) _midiLoopOverrides[source] = ![self midiSequenceLoopEnabled:source];
                else if (point.x >= right - 62 && point.x <= right - 32) {
                    if (_playingMidiSequence == source) [self stopMidiSequence]; else [self startMidiSequence:source];
                } else if (point.x >= right - 26) {
                    if (_playingMidiSequence == source) [self stopMidiSequence];
                    _hiddenMidiSequences.insert(source);
                    const auto next = [self visibleMidiSequences]; _selectedMidiSequence = next.empty() ? -1 : next.front();
                } else if (point.x >= right - 150 && point.x <= right - 102) {
                    _midiDragCandidate = source; _midiDragX = point.x; _midiDragY = point.y;
                }
                [self setNeedsDisplay:YES]; return YES;
            }
        }
    } else if (equals(panel.panelType, "preset_browser")) {
        const CGFloat fieldWidth = std::max<CGFloat>(80, right - left - 156);
        if (point.y >= top && point.y <= top + 35 && point.x >= left + fieldWidth + 8) { [self saveUserPreset]; [self setNeedsDisplay:YES]; return YES; }
        if (point.y >= top + 47) {
            const NSInteger row = static_cast<NSInteger>((point.y - (top + 47)) / 47);
            if (row >= 0 && row < static_cast<NSInteger>(project::kPresets.size())) { [self applyFactoryPreset:row]; return YES; }
            const NSInteger user = row - static_cast<NSInteger>(project::kPresets.size());
            if (user >= 0 && user < static_cast<NSInteger>(_userPresets.size())) {
                if (point.x >= right - 27) _userPresets.erase(_userPresets.begin() + user);
                else if (point.x >= right - 66) { const auto name = _userPresets[static_cast<std::size_t>(user)].name; _userPresets[static_cast<std::size_t>(user)] = [self captureUserPreset:name]; }
                else [self applyUserPreset:user];
                [self setNeedsDisplay:YES]; return YES;
            }
        }
    } else if (equals(panel.panelType, "mixer")) {
        const NSInteger group = static_cast<NSInteger>((point.x - left) / 122);
        if (group >= 0 && group < static_cast<NSInteger>(project::kGroups.size())) {
            const CGFloat localX = point.x - (left + group * 122), localY = point.y - top;
            if (localX >= 10 && localX <= 102 && localY >= 46 && localY <= 64)
                [self setParameter:groupParameterId(static_cast<int>(group), 0) value:static_cast<float>((localX - 10) / 92)];
            else if (localX >= 10 && localX <= 102 && localY >= 79 && localY <= 97)
                [self setParameter:groupParameterId(static_cast<int>(group), 1) value:static_cast<float>((localX - 10) / 92)];
            else if (localY >= 105 && localY <= 133) {
                const int slot = localX >= 58 ? 3 : 2; const auto parameter = groupParameterId(static_cast<int>(group), slot);
                [self setParameter:parameter value:_instrument->getParamNormalized(parameter) >= .5 ? 0 : 1];
            }
            [self setNeedsDisplay:YES]; return YES;
        }
    }
    return YES;
}

- (void)updateMidiPlayback {
    if (_playingMidiSequence < 0) return;
    const double elapsed = (NSProcessInfo.processInfo.systemUptime - _midiStartedAt) * 1000.;
    auto tickMilliseconds = [](int tick, int ppq, const auto& tempos, int offset, int count) {
        double milliseconds = 0, bpm = 120; int previousTick = 0;
        for (int index = 0; index < count; ++index) {
            const auto& tempo = tempos[static_cast<std::size_t>(offset + index)];
            const int tempoTick = std::clamp(tempo.tick, previousTick, tick);
            milliseconds += (tempoTick - previousTick) * 60000. / (std::max(1, ppq) * bpm);
            previousTick = tempoTick; bpm = std::clamp(static_cast<double>(tempo.bpm), 20., 400.);
            if (tempo.tick >= tick) break;
        }
        if (previousTick < tick) milliseconds += (tick - previousTick) * 60000. / (std::max(1, ppq) * bpm);
        return milliseconds;
    };
    auto dispatch = [&](int note, int velocity, int channel, bool on, double due) {
        if (due > elapsed) return false;
        if (on) { _instrument->queueEditorNote(note, std::max(1, velocity), true); _midiPlayingNotes.emplace_back(note, channel); }
        else {
            _instrument->queueEditorNote(note, 0, false);
            const auto found = std::find(_midiPlayingNotes.begin(), _midiPlayingNotes.end(), std::pair<int, int>{note, channel});
            if (found != _midiPlayingNotes.end()) _midiPlayingNotes.erase(found);
        }
        return true;
    };
    auto finish = [&](double end) {
        if (elapsed <= end + 5) return;
        if ([self midiSequenceLoopEnabled:_playingMidiSequence]) {
            for (const auto& note : _midiPlayingNotes) _instrument->queueEditorNote(note.first, 0, false);
            _midiPlayingNotes.clear(); _midiStartedAt = NSProcessInfo.processInfo.systemUptime; _midiEventCursor = 0;
        } else [self stopMidiSequence];
    };
    if (_playingMidiSequence < static_cast<NSInteger>(project::kMidiSequences.size())) {
        const auto& sequence = project::kMidiSequences[static_cast<std::size_t>(_playingMidiSequence)];
        while (_midiEventCursor < static_cast<std::size_t>(sequence.eventCount)) {
            const auto& event = project::kMidiEvents[static_cast<std::size_t>(sequence.eventOffset) + _midiEventCursor];
            if (!dispatch(event.note, event.velocity, event.channel, event.noteOn,
                          tickMilliseconds(event.tick, sequence.ppq, project::kMidiTempos, sequence.tempoOffset, sequence.tempoCount))) break;
            ++_midiEventCursor;
        }
        if (_midiEventCursor >= static_cast<std::size_t>(sequence.eventCount))
            finish(tickMilliseconds(sequence.durationTicks, sequence.ppq, project::kMidiTempos, sequence.tempoOffset, sequence.tempoCount));
    } else {
        const auto runtime = static_cast<std::size_t>(_playingMidiSequence - static_cast<NSInteger>(project::kMidiSequences.size()));
        if (runtime >= _importedMidi.size()) { [self stopMidiSequence]; return; }
        const auto& sequence = _importedMidi[runtime];
        while (_midiEventCursor < sequence.events.size()) {
            const auto& event = sequence.events[_midiEventCursor];
            if (!dispatch(event.note, event.velocity, event.channel, event.on,
                          tickMilliseconds(event.tick, sequence.ppq, sequence.tempos, 0, static_cast<int>(sequence.tempos.size())))) break;
            ++_midiEventCursor;
        }
        if (_midiEventCursor >= sequence.events.size())
            finish(tickMilliseconds(sequence.durationTicks, sequence.ppq, sequence.tempos, 0, static_cast<int>(sequence.tempos.size())));
    }
    [self setNeedsDisplay:YES];
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
        if (project::kPanelControls[index].parentPanelIndex >= 0) continue;
        if (!controlVisible(index) || !visual.file || !*visual.file || visual.frames <= 0) continue;
        auto value = displayedValue(*_instrument, index, _selectedPrismBand);
        const auto& control = project::kControls[index];
        if (equals(control.kind, "panel_button")) value = _openPanel == static_cast<NSInteger>(index) ? 1.f : 0.f;
        const bool hitPad = equals(control.kind, "pad") && hitPadVariant(control.variant);
        if (equals(control.kind, "pad")) value = hitPad ? ([self hitPadFlashActive:control.notePitch] ? 1.f : 0.f) : ((_instrument->isNoteActive(control.notePitch) || _activeNote == control.notePitch) ? 1.f : 0.f);
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

    if constexpr (project::kIsPrismEq || project::kHasPrismModule) {
        for (std::size_t index = 0; index < project::kControls.size(); ++index) {
            if (!equals(project::kControls[index].kind, "spectrum") || equals(project::kControls[index].variant, "pure-spectrum")) continue;
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
        if (!_instrument->isNoteActive(key.pitch) && _activeNote != key.pitch) continue;
        NSImage* image = [self imageNamed:key.file];
        if (!image || key.cellWidth <= 0 || key.cellHeight <= 0) continue;
        const NSInteger columns = std::max(1, key.columns);
        const NSInteger row = key.frame / columns;
        const NSInteger column = key.frame % columns;
        const CGFloat sourceY = image.size.height - (row + 1) * key.cellHeight;
        [image drawInRect:NSMakeRect(key.x, key.y, key.w, key.h)
                 fromRect:NSMakeRect(column * key.cellWidth, sourceY, key.cellWidth, key.cellHeight)
                operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES
                    hints:@{NSImageHintInterpolation: @(NSImageInterpolationHigh)}];
    }

    [self drawOpenPanel];

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
    for (const auto& key : project::kVisualKeys) {
        if (key.control != controlIndex) continue;
        if (point.x >= key.hx && point.x <= key.hx + key.hw
            && point.y >= key.hy && point.y <= key.hy + key.hh) return key.pitch;
    }
    return -1;
}

- (void)setControl:(NSInteger)index value:(float)value {
    if (index < 0 || static_cast<std::size_t>(index) >= project::kControls.size()) return;
    const auto parameter = displayedParameter(*_instrument, static_cast<std::size_t>(index), _selectedPrismBand);
    if (parameter == kNoParamId) return;
    value = std::clamp(value, 0.f, 1.f);
    _instrument->beginEdit(parameter);
    _instrument->setParamNormalized(parameter, value);
    _instrument->performEdit(parameter, value);
    _instrument->endEdit(parameter);
    [self setNeedsDisplay:YES];
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
    if (equals(control.kind, "panel_button")) {
        if (_openPanel == _dragControl) [self closePanel]; else [self openPanel:_dragControl];
        _dragControl = -1;
    } else if (equals(control.kind, "keyboard")) {
        _activeNote = [self keyboardPitchAt:point control:_dragControl];
        if (_activeNote >= 0) _instrument->queueEditorNote(static_cast<int>(_activeNote), 108, true);
        _dragControl = -1;
    } else if (equals(control.kind, "pad")) {
        _activeNote = control.notePitch;
        _instrument->queueEditorNote(static_cast<int>(_activeNote), 112, true);
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
    if (_dragControl < 0) return;
    const auto& control = project::kControls[static_cast<std::size_t>(_dragControl)];
    const NSPoint localPoint = controlLocalPoint(control, point);
    [self setControl:_dragControl value:_dragStartValue + static_cast<float>((_dragStartY - localPoint.y) / 150.)];
}

- (void)mouseUp:(NSEvent*)event {
    (void)event;
    if (_activeNote >= 0) {
        _instrument->queueEditorNote(static_cast<int>(_activeNote), 0, false);
        _activeNote = -1;
    }
    _dragControl = -1;
    _dragPrismBand = -1;
    _panelDragMode = 0;
    _midiDragCandidate = -1;
}

- (NSDragOperation)draggingSession:(NSDraggingSession*)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
    (void)session; (void)context; return NSDragOperationCopy;
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
    if (_openPanel < 0 || !equals(project::kPanelControls[static_cast<std::size_t>(_openPanel)].panelType, "midi_map")) return NSDragOperationNone;
    const NSPoint point = [self designPoint:[self convertPoint:sender.draggingLocation fromView:nil]];
    const NSRect panel = [self panelRect:_openPanel];
    return NSPointInRect(point, panel) ? NSDragOperationCopy : NSDragOperationNone;
}

- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSPasteboard* board = sender.draggingPasteboard;
    NSArray<NSURL*>* urls = [board readObjectsForClasses:@[[NSURL class]] options:@{NSPasteboardURLReadingFileURLsOnlyKey: @YES}];
    return urls.count > 0 && [self importMidiPath:urls.firstObject.path];
}

- (void)keyDown:(NSEvent*)event {
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
    if (index < 0 || !equals(project::kControls[static_cast<std::size_t>(index)].kind, "knob")) return;
    const auto parameter = displayedParameter(*_instrument, static_cast<std::size_t>(index), _selectedPrismBand);
    if (parameter == kNoParamId) return;
    const auto current = static_cast<float>(_instrument->getParamNormalized(parameter));
    [self setControl:index value:current + static_cast<float>(event.scrollingDeltaY * .01)];
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
