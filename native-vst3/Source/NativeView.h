#pragma once
#include "public.sdk/source/common/pluginview.h"
#if defined(_WIN32)
#include <windows.h>
#include <d2d1.h>
#include <dwrite_3.h>
#include <wincodec.h>
#include <wrl/client.h>
#endif
#include <vector>
#include <map>
#include <set>
#include <array>
#include <string>
#include <cstdint>
#include <filesystem>

namespace tripleside::native {
class NativeInstrument;
class NativeView final : public Steinberg::CPluginView {
public:
    explicit NativeView(NativeInstrument&);
    ~NativeView() override;
    Steinberg::tresult PLUGIN_API isPlatformTypeSupported(Steinberg::FIDString) override;
    Steinberg::tresult PLUGIN_API attached(void*, Steinberg::FIDString) override;
    Steinberg::tresult PLUGIN_API removed() override;
    Steinberg::tresult PLUGIN_API onSize(Steinberg::ViewRect*) override;
    Steinberg::tresult PLUGIN_API onKeyDown(Steinberg::char16, Steinberg::int16, Steinberg::int16) override;
private:
#if defined(_WIN32)
    static LRESULT CALLBACK windowProc(HWND,UINT,WPARAM,LPARAM); LRESULT handleMessage(UINT,WPARAM,LPARAM);
    bool createResources(); bool loadBitmap(const wchar_t*,Microsoft::WRL::ComPtr<ID2D1Bitmap>&); void discardResources(); void paint(); void paintFallback(HDC,const RECT&); void drawBranding(); void drawControl(size_t); void drawLicenseOverlay(); bool licenseButtonHit(float,float) const; bool licenseInputHit(float,float) const;
    void drawKnob(const D2D1_RECT_F&,float,const wchar_t*,bool); void drawMeter(const D2D1_RECT_F&,float,float,bool,bool,const wchar_t*,bool=false); void drawSpectrum(const D2D1_RECT_F&); void drawVectorscope(const D2D1_RECT_F&);
    void drawButton(const D2D1_RECT_F&,bool,const wchar_t*); void drawFilmstrip(ID2D1Bitmap*,const D2D1_RECT_F&,int,int,int,int);
    void drawKeyboard(const D2D1_RECT_F&,int); void drawPad(const D2D1_RECT_F&,bool,const wchar_t*);
    int hitControl(float,float) const; int hitPanelChild(float,float) const; int keyboardNote(const D2D1_RECT_F&,float,float,int) const; D2D1_RECT_F designRect() const; D2D1_RECT_F controlRect(size_t) const; D2D1_POINT_2F controlPoint(size_t,float,float) const; D2D1_RECT_F labelRect(const D2D1_RECT_F&) const;
    D2D1_MATRIX_3X2_F designTransform() const; D2D1_POINT_2F designPoint(float,float) const;
    void drawVisualControl(size_t); int visualKeyboardNote(int,float,float) const;
    void drawVisualSprite(const char*,int,int,float,float,float,float,float,float,float opacity=1.f);
    void drawVisualSpriteRegion(const char*,int,int,float,float,const D2D1_RECT_F&,const D2D1_RECT_F&);
    std::map<std::wstring,Microsoft::WRL::ComPtr<ID2D1Bitmap>> visualBitmaps;
    void mouseDown(float,float); void mouseMove(float,float); void mouseUp();
    void mouseDoubleClick(float,float); void mouseWheel(float,float,int); float neutralControlValue(int) const;
    void setParameter(Steinberg::uint32,float);
    Steinberg::uint32 displayedParameter(size_t) const; int prismContextSlot(size_t) const; int hitPrismBand(float,float) const; void updatePrismBandFromPoint(int,float,float);
    struct UserPreset;
    HWND hwnd=nullptr; Microsoft::WRL::ComPtr<ID2D1Factory> factory; Microsoft::WRL::ComPtr<ID2D1RenderTarget> target;
    void drawVisualCanvas();
    D2D1_RECT_F panelRect(int) const; bool controlVisible(size_t) const; void drawOpenPanel(); bool panelMouseDown(float,float);
    void openPanel(int); void closePanel(); void applyFactoryPreset(int); void saveUserPreset(); void applyUserPreset(int); void overwriteUserPreset(int); void deleteUserPreset(int);
    UserPreset captureUserPreset(const std::wstring&) const; std::wstring userPresetPath() const; void loadUserPresets(); void persistUserPresets() const;
    void startMidiSequence(int); void stopMidiSequence(); void updateMidiPlayback(); bool midiSequenceLoopEnabled(int) const; void toggleMidiSequenceLoop(int); bool importMidiFile(const wchar_t*);
    std::vector<int> visibleMidiSequences() const; void drawGroovePanel(const D2D1_RECT_F&); bool groovePanelMouseDown(const D2D1_RECT_F&,float,float); bool chooseMidiFile();
    std::filesystem::path exportMidiSequence(int) const; bool dragMidiSequence(int);
#if defined(TRIPLESIDE_VISUAL_SMOKE_CAPTURE)
    bool captureVisual(const wchar_t*);
#endif
    Microsoft::WRL::ComPtr<IDWriteFactory> writeFactory; Microsoft::WRL::ComPtr<IDWriteTextFormat> textFormat,brandFormat,brandMetaFormat,brandTagFormat,smallFormat,meterFormat,meterLabelFormat;
    Microsoft::WRL::ComPtr<IDWriteInMemoryFontFileLoader> brandFontLoader; std::vector<Microsoft::WRL::ComPtr<IDWriteFontFile>> embeddedFontFiles; Microsoft::WRL::ComPtr<IDWriteFontCollection1> brandFontCollection;
    Microsoft::WRL::ComPtr<IWICImagingFactory> wicFactory; Microsoft::WRL::ComPtr<ID2D1Bitmap> background,knobFilmstrip,pultecKnobFilmstrip,modernSpectrumKnob,studioScallopKnob,blackPrecisionKnob,crimsonWingKnob,blackCrimsonWingKnob,regentWhiteWingKnob,graphiteRidgeKnob,buttonFilmstrip,faderFilmstrip,meterFilmstrip,mechanicalToggleOff,mechanicalToggleOn;
    int activeControl=-1,activeNote=-1,wheelControl=-1,wheelRemainder=0,selectedPrismBand=0,dragPrismBand=-1; float dragStartY=0,dragStartValue=0; D2D1_RECT_F currentLabelControlRect{};
    int openPanelIndex=-1, panelDragMode=0, selectedMidiSequence=0, playingMidiSequence=-1, midiDragCandidate=-1; float panelRuntimeX=50,panelRuntimeY=52,panelRuntimeWidth=88,panelRuntimeHeight=78,panelDragX=0,panelDragY=0,midiDragX=0,midiDragY=0;
    std::map<int,std::array<float,4>> panelRuntimeBounds;
    struct UserPreset { std::wstring name; std::vector<float> values,groups,moduleValues; }; std::vector<UserPreset> userPresets; bool userPresetsLoaded=false;
    struct RuntimeMidiEvent { int tick=0,note=60,velocity=0,channel=0; bool on=false; };
    struct RuntimeMidiTempo { int tick=0; float bpm=120; };
    struct RuntimeMidiSequence { std::wstring name; int ppq=480,durationTicks=0; bool loopEnabled=false; std::vector<RuntimeMidiEvent> events; std::vector<RuntimeMidiTempo> tempos; }; std::vector<RuntimeMidiSequence> importedMidi;
    std::map<int,bool> midiLoopOverrides;
    std::set<int> hiddenMidiSequences;
    bool midiPlaying=false; std::uint64_t midiStartedMs=0; size_t midiEventCursor=0; std::vector<std::pair<int,int>> midiPlayingNotes;
    bool currentControlUsesFilmstrip=true,currentControlShowCorrelationMeter=true;
    bool licenseInputFocused=false; std::wstring licenseInput; wchar_t licenseForwardedKey=0; std::uint64_t licenseForwardedAt=0;
    std::map<size_t,std::array<float,2>> visualMeterLevels;
    std::map<size_t,std::uint64_t> visualMeterUpdatedMs;
    std::array<float,128> spectrumLevels{}; std::uint64_t spectrumUpdatedMs=0; float vectorscopeCorrelation=0;
    std::array<unsigned,128> padTriggerGenerations{}; std::array<std::uint64_t,128> padFlashUntil{};
    bool hitPadFlashActive(int pitch);
    bool comInitialized=false;
    const char* currentControlVariant="classic"; const char* currentLabelPosition="top-left"; int currentLabelGap=12; unsigned int currentControlColor=0;
#elif defined(__APPLE__)
    void* cocoaView=nullptr;
#endif
    NativeInstrument& instrument;
};
} // namespace tripleside::native
