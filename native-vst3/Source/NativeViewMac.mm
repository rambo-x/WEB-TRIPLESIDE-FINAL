#include "NativeView.h"
#include "NativeInstrument.h"
#include "LicenseRuntime.h"
#include "NativeProject.h"
#include "pluginterfaces/gui/iplugview.h"

#import <Cocoa/Cocoa.h>

#include <algorithm>
#include <cmath>
#include <cstring>

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
        || equals(kind, "keyboard");
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
using tripleside::native::kPrismEnabledBaseId;
using Steinberg::Vst::kNoParamId;
using Steinberg::Vst::ParamID;
namespace project = tripleside::project;

@interface TripleSideNativeMacView : NSView {
@private
    NativeInstrument* _instrument;
    NSMutableDictionary<NSString*, NSImage*>* _images;
    NSTimer* _timer;
    NSInteger _dragControl;
    CGFloat _dragStartY;
    float _dragStartValue;
    NSInteger _activeNote;
    NSInteger _selectedPrismBand;
    NSInteger _dragPrismBand;
    std::array<unsigned, 128> _padTriggerGenerations;
    std::array<double, 128> _padFlashUntil;
}
- (instancetype)initWithFrame:(NSRect)frame instrument:(NativeInstrument*)instrument;
- (BOOL)hitPadFlashActive:(int)pitch;
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
        _padTriggerGenerations.fill(0);
        _padFlashUntil.fill(0);
        __weak TripleSideNativeMacView* weakSelf = self;
        _timer = [NSTimer scheduledTimerWithTimeInterval:(1.0 / 30.0) repeats:YES block:^(NSTimer*) {
            [weakSelf setNeedsDisplay:YES];
        }];
    }
    return self;
}

- (void)dealloc {
    [_timer invalidate];
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
        if (!controlVisible(index) || !visual.file || !*visual.file || visual.frames <= 0) continue;
        auto value = displayedValue(*_instrument, index, _selectedPrismBand);
        const auto& control = project::kControls[index];
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
            const auto& visual = project::kVisualControls[index];
            const NSRect spectrum = NSMakeRect(visual.hx, visual.hy, visual.hw, visual.hh);
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
        if (!controlVisible(static_cast<std::size_t>(index))) continue;
        if (!interactiveKind(control.kind)) continue;
        if (static_cast<std::size_t>(index) < project::kVisualControls.size()) {
            const auto& visual = project::kVisualControls[static_cast<std::size_t>(index)];
            if (point.x >= visual.hx && point.x <= visual.hx + visual.hw
                && point.y >= visual.hy && point.y <= visual.hy + visual.hh) return index;
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
        const auto& visual = project::kVisualControls[index];
        const NSRect spectrum = NSMakeRect(visual.hx, visual.hy, visual.hw, visual.hh);
        for (int band = 4; band >= 0; --band) if (_instrument->prismBandEnabled(band)) {
            const float gain = band ? (_instrument->prismBandValue(band, 1) - .5f) * 24.f : 0.f;
            const NSPoint node = NSMakePoint(NSMinX(spectrum) + NSWidth(spectrum) * _instrument->prismBandValue(band, 0), NSMidY(spectrum) - gain * NSHeight(spectrum) / 36.f);
            if (std::hypot(point.x - node.x, point.y - node.y) <= 12.) return band;
        }
    }
    return -1;
}

- (void)updatePrismBand:(NSInteger)band point:(NSPoint)point {
    for (std::size_t index = 0; index < project::kControls.size(); ++index) {
        if (!equals(project::kControls[index].kind, "spectrum") || equals(project::kControls[index].variant, "pure-spectrum")) continue;
        const auto& visual = project::kVisualControls[index];
        const NSRect spectrum = NSMakeRect(visual.hx, visual.hy, visual.hw, visual.hh);
        auto setParameter = [&](ParamID parameter, float value) { if (parameter != kNoParamId) { _instrument->beginEdit(parameter); _instrument->setParamNormalized(parameter, std::clamp(value, 0.f, 1.f)); _instrument->performEdit(parameter, std::clamp(value, 0.f, 1.f)); _instrument->endEdit(parameter); } };
        setParameter(_instrument->prismParameterFor(static_cast<int>(band), 0), static_cast<float>((point.x - NSMinX(spectrum)) / std::max<CGFloat>(1, NSWidth(spectrum))));
        if (band > 0) setParameter(_instrument->prismParameterFor(static_cast<int>(band), 1), static_cast<float>(.5 + (NSMidY(spectrum) - point.y) / std::max<CGFloat>(1, NSHeight(spectrum)) * 1.5));
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
    if (event.clickCount >= 2 && (project::kIsPrismEq || project::kHasPrismModule)) {
        for (std::size_t index = 0; index < project::kControls.size(); ++index) {
            if (!equals(project::kControls[index].kind, "spectrum") || equals(project::kControls[index].variant, "pure-spectrum")) continue;
            const auto& visual = project::kVisualControls[index];
            if (!NSPointInRect(point, NSMakeRect(visual.hx, visual.hy, visual.hw, visual.hh))) continue;
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
    if (equals(control.kind, "keyboard")) {
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
        _dragStartY = point.y;
        if (equals(control.kind, "button") || equals(control.kind, "mute") || equals(control.kind, "solo")) {
            [self setControl:_dragControl value:_dragStartValue >= .5f ? 0.f : 1.f];
            _dragControl = -1;
        }
    }
}

- (void)mouseDragged:(NSEvent*)event {
    if (_dragPrismBand >= 0) {
        [self updatePrismBand:_dragPrismBand point:[self designPoint:[self convertPoint:event.locationInWindow fromView:nil]]];
        return;
    }
    if (_dragControl < 0) return;
    const NSPoint point = [self designPoint:[self convertPoint:event.locationInWindow fromView:nil]];
    [self setControl:_dragControl value:_dragStartValue + static_cast<float>((_dragStartY - point.y) / 150.)];
}

- (void)mouseUp:(NSEvent*)event {
    (void)event;
    if (_activeNote >= 0) {
        _instrument->queueEditorNote(static_cast<int>(_activeNote), 0, false);
        _activeNote = -1;
    }
    _dragControl = -1;
    _dragPrismBand = -1;
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
