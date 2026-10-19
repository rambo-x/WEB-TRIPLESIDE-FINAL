// Internal GUI smoke host. Loads the actual built VST3 and captures its HWND.
#include <windows.h>
#include <cmath>
#include <fstream>
#include <cstring>
#include <iostream>
#include <vector>
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivsthostapplication.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "public.sdk/source/vst/hosting/eventlist.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
struct Host final : IHostApplication {
    tresult PLUGIN_API queryInterface(const TUID iid, void** object) override {
        if (!std::memcmp(iid,IHostApplication::iid,16)||!std::memcmp(iid,FUnknown::iid,16)) { *object=this; return kResultOk; }
        *object=nullptr;return kNoInterface;
    }
    uint32 PLUGIN_API addRef() override { return 1; }
    uint32 PLUGIN_API release() override { return 1; }
    tresult PLUGIN_API getName(String128 name) override { name[0]='T';name[1]='S';name[2]=0;return kResultOk; }
    tresult PLUGIN_API createInstance(TUID,TUID,void** obj) override { *obj=nullptr;return kNoInterface; }
};

int wmain(int argc,wchar_t**argv) {
    if(argc!=3&&argc!=4)return 2;
    const bool interactionSmoke=argc==4&&!std::wcscmp(argv[3],L"--interaction-smoke");
    SetProcessDPIAware();CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    auto module=LoadLibraryW(argv[1]);if(!module)return 3;
    auto init=reinterpret_cast<bool(*)()>(GetProcAddress(module,"InitDll"));if(init&&!init())return 4;
    auto factoryFn=reinterpret_cast<IPluginFactory*(*)()>(GetProcAddress(module,"GetPluginFactory"));if(!factoryFn)return 5;
    auto factory=factoryFn();PClassInfo info{};if(factory->getClassInfo(0,&info)!=kResultOk)return 6;
    IComponent*component=nullptr;if(factory->createInstance(info.cid,IComponent::iid,reinterpret_cast<void**>(&component))!=kResultOk)return 7;
    Host host;if(component->initialize(&host)!=kResultOk)return 8;
    IEditController*controller=nullptr;if(component->queryInterface(IEditController::iid,reinterpret_cast<void**>(&controller))!=kResultOk)return 9;
    auto view=controller->createView(ViewType::kEditor);if(!view)return 10;
    ViewRect size{};view->getSize(&size);
    WNDCLASSW wc{};wc.lpfnWndProc=DefWindowProcW;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"TSVisualSmokeHost";RegisterClassW(&wc);
    RECT outer{0,0,size.getWidth(),size.getHeight()};AdjustWindowRect(&outer,WS_OVERLAPPEDWINDOW,FALSE);
    auto parent=CreateWindowW(wc.lpszClassName,L"TripleSide visual verification",WS_OVERLAPPEDWINDOW|WS_VISIBLE,0,0,outer.right-outer.left,outer.bottom-outer.top,nullptr,nullptr,wc.hInstance,nullptr);
    if(view->attached(parent,kPlatformTypeHWND)!=kResultOk)return 11;
    view->onSize(&size);ShowWindow(parent,SW_SHOW);UpdateWindow(parent);
    const auto start=GetTickCount64();MSG msg{};
    while(GetTickCount64()-start<3000){while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageW(&msg);}Sleep(10);}
    auto child=GetWindow(parent,GW_CHILD);if(!child)return 12;
    if(interactionSmoke){
        // MixForge fixture: Input is parameter 109 and the first knob is at
        // 13%/43%. Verify native double-click neutral reset and one wheel step.
        controller->setParamNormalized(109,.2);
        RECT client{};GetClientRect(child,&client);const int x=static_cast<int>(client.right*.13),y=static_cast<int>(client.bottom*.43);
        SendMessageW(child,WM_LBUTTONDBLCLK,MK_LBUTTON,MAKELPARAM(x,y));
        if(std::abs(controller->getParamNormalized(109)-.5)>.0001)return 18;
        POINT screen{x,y};ClientToScreen(child,&screen);
        SendMessageW(child,WM_MOUSEWHEEL,MAKEWPARAM(0,WHEEL_DELTA),MAKELPARAM(screen.x,screen.y));
        if(std::abs(controller->getParamNormalized(109)-.51)>.0001)return 19;
        std::cout<<"Native knob double-click reset and 1% wheel step passed\n";
    }
    // The test-only module can use WIC/Direct2D on a headless worker. This calls
    // exactly the same drawVisualCanvas/drawVisualSprite code as the HWND path.
    const bool offscreen=SendMessageW(child,WM_APP+73,0,reinterpret_cast<LPARAM>(argv[2]))==1;
    if(offscreen){
        IAudioProcessor*processor=nullptr;
        if(component->queryInterface(IAudioProcessor::iid,reinterpret_cast<void**>(&processor))!=kResultOk)return 14;
        ProcessSetup setup{kRealtime,kSample32,128,48000.0};
        if(processor->setupProcessing(setup)!=kResultOk||component->setActive(true)!=kResultOk)return 15;
        processor->setProcessing(true);controller->setParamNormalized(100,1.0);
        auto*events=new EventList;
        for(int pitch:{48,52,55,61}){Event e{};e.type=Event::kNoteOnEvent;e.noteOn.pitch=static_cast<int16>(pitch);e.noteOn.velocity=.8f;e.noteOn.noteId=pitch;events->addEvent(e);}
        float left[128]{},right[128]{};float*channels[]={left,right};AudioBusBuffers bus{};bus.numChannels=2;bus.channelBuffers32=channels;
        ProcessData data{};data.processMode=kRealtime;data.symbolicSampleSize=kSample32;data.numSamples=128;data.numOutputs=1;data.outputs=&bus;data.inputEvents=events;
        if(processor->process(data)!=kResultOk)return 16;
        const std::wstring activePath=std::wstring(argv[2])+L".active.png";
        if(SendMessageW(child,WM_APP+73,0,reinterpret_cast<LPARAM>(activePath.c_str()))!=1)return 17;
        events->release();processor->setProcessing(false);component->setActive(false);processor->release();
        view->removed();view->release();controller->release();component->terminate();component->release();factory->release();DestroyWindow(parent);
        auto shutdown=reinterpret_cast<bool(*)()>(GetProcAddress(module,"ExitDll"));if(shutdown)shutdown();FreeLibrary(module);CoUninitialize();
        std::cout<<"Captured native idle and MIDI chord/parameter Direct2D output at "<<size.getWidth()<<"x"<<size.getHeight()<<"\n";return 0;
    }
    RECT client{};GetClientRect(child,&client);const int width=client.right,height=client.bottom;
    auto dc=GetDC(child),memory=CreateCompatibleDC(dc);BITMAPINFO bitmap{};bitmap.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);bitmap.bmiHeader.biWidth=width;bitmap.bmiHeader.biHeight=-height;bitmap.bmiHeader.biPlanes=1;bitmap.bmiHeader.biBitCount=32;bitmap.bmiHeader.biCompression=BI_RGB;
    void*pixels=nullptr;auto dib=CreateDIBSection(dc,&bitmap,DIB_RGB_COLORS,&pixels,nullptr,0);auto previous=SelectObject(memory,dib);
    const bool printed=PrintWindow(child,memory,2)!=0;
    BITMAPFILEHEADER header{};header.bfType=0x4D42;header.bfOffBits=sizeof(header)+sizeof(BITMAPINFOHEADER);header.bfSize=header.bfOffBits+width*height*4;
    std::ofstream out(argv[2],std::ios::binary);out.write(reinterpret_cast<char*>(&header),sizeof(header));out.write(reinterpret_cast<char*>(&bitmap.bmiHeader),sizeof(BITMAPINFOHEADER));out.write(static_cast<char*>(pixels),width*height*4);out.close();
    SelectObject(memory,previous);DeleteObject(dib);DeleteDC(memory);ReleaseDC(child,dc);
    view->removed();view->release();controller->release();component->terminate();component->release();factory->release();DestroyWindow(parent);
    auto shutdown=reinterpret_cast<bool(*)()>(GetProcAddress(module,"ExitDll"));if(shutdown)shutdown();FreeLibrary(module);CoUninitialize();
    std::cout<<"Captured "<<width<<"x"<<height<<", PrintWindow="<<printed<<"\n";return printed?0:13;
}
