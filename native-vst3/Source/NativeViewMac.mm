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

float displayedValue(NativeInstrument& instrument, std::size_t index) {
    const auto& control = project::kControls[index];
    if (equals(control.kind, "gain_meter") || equals(control.kind, "vu_meter")) {
        if (control.meterMode && std::strcmp(control.meterMode, "gain_reduction") == 0)
            return std::clamp(instrument.gainReduction(control.moduleIndex), 0.f, 1.f);
        return std::clamp(std::max(instrument.outputPeak(0), instrument.outputPeak(1)) * 1.5f, 0.f, 1.f);
    }
    const auto parameter = instrument.parameterForControl(index);
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
using tripleside::native::equals;
using tripleside::native::interactiveKind;
using tripleside::native::loadResourceImage;
using Steinberg::Vst::kNoParamId;
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
}
- (instancetype)initWithFrame:(NSRect)frame instrument:(NativeInstrument*)instrument;
@end

@implementation TripleSideNativeMacView

- (instancetype)initWithFrame:(NSRect)frame instrument:(NativeInstrument*)instrument {
    self = [super initWithFrame:frame];
    if (self) {
        _instrument = instrument;
        _images = [NSMutableDictionary dictionary];
        _dragControl = -1;
        _activeNote = -1;
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
        if (!visual.file || !*visual.file || visual.frames <= 0) continue;
        const auto value = displayedValue(*_instrument, index);
        const auto frame = static_cast<NSInteger>(std::lround(value * std::max(0, visual.frames - 1)));
        [self drawAtlas:[self imageNamed:visual.file] file:visual frame:frame];
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
    const auto parameter = _instrument->parameterForControl(static_cast<std::size_t>(index));
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
        const auto parameter = _instrument->parameterForControl(static_cast<std::size_t>(_dragControl));
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
}

- (void)scrollWheel:(NSEvent*)event {
    const NSPoint point = [self designPoint:[self convertPoint:event.locationInWindow fromView:nil]];
    const NSInteger index = [self controlAt:point];
    if (index < 0 || !equals(project::kControls[static_cast<std::size_t>(index)].kind, "knob")) return;
    const auto parameter = _instrument->parameterForControl(static_cast<std::size_t>(index));
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
