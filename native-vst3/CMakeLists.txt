cmake_minimum_required(VERSION 3.25)

project(TripleSideNativeVST3 VERSION 0.1.0 LANGUAGES C CXX)

if(APPLE)
    enable_language(OBJCXX)
endif()

set(TRIPLESIDE_GENERATED_DIR "" CACHE PATH "Generated TripleSide project directory")
set(TRIPLESIDE_VST3_SDK_DIR "" CACHE PATH "Steinberg VST3 SDK root")

if(NOT EXISTS "${TRIPLESIDE_GENERATED_DIR}/ProjectConfig.cmake")
    message(FATAL_ERROR "Missing generated ProjectConfig.cmake")
endif()
if(NOT EXISTS "${TRIPLESIDE_GENERATED_DIR}/NativeProject.h")
    message(FATAL_ERROR "Missing generated NativeProject.h")
endif()
if(WIN32 AND NOT EXISTS "${TRIPLESIDE_GENERATED_DIR}/NativeAssets.rc")
    message(FATAL_ERROR "Missing generated NativeAssets.rc")
endif()
if(NOT EXISTS "${TRIPLESIDE_VST3_SDK_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "TRIPLESIDE_VST3_SDK_DIR must point to the Steinberg VST3 SDK")
endif()

include("${TRIPLESIDE_GENERATED_DIR}/ProjectConfig.cmake")

set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_BUNDLE_FOR_WINDOWS ON CACHE BOOL "" FORCE)
set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
add_subdirectory("${TRIPLESIDE_VST3_SDK_DIR}" "${CMAKE_BINARY_DIR}/vst3sdk" EXCLUDE_FROM_ALL)

set(TRIPLESIDE_NATIVE_SOURCES
    Source/DspModules.cpp
    Source/DspModules.h
    Source/EmbeddedResource.cpp
    Source/EmbeddedResource.h
    Source/LicenseRuntime.cpp
    Source/LicenseRuntime.h
    Source/NativeInstrument.cpp
    Source/NativeInstrument.h
    Source/NativeView.h
    Source/WavFile.cpp
    Source/WavFile.h
    "${TRIPLESIDE_VST3_SDK_DIR}/public.sdk/source/common/pluginview.cpp"
    "${TRIPLESIDE_VST3_SDK_DIR}/public.sdk/source/common/pluginview.h"
    "${TRIPLESIDE_VST3_SDK_DIR}/public.sdk/source/vst/vstsinglecomponenteffect.cpp"
    "${TRIPLESIDE_VST3_SDK_DIR}/public.sdk/source/vst/vstsinglecomponenteffect.h"
)

if(WIN32)
    list(APPEND TRIPLESIDE_NATIVE_SOURCES
        Source/NativeView.cpp
        "${TRIPLESIDE_GENERATED_DIR}/NativeAssets.rc")
elseif(APPLE)
    list(APPEND TRIPLESIDE_NATIVE_SOURCES Source/NativeViewMac.mm)
else()
    message(FATAL_ERROR "TripleSide native VST3 currently supports Windows and macOS")
endif()

string(REGEX REPLACE "[^A-Za-z0-9_-]" "_" TS_NATIVE_PACKAGE_NAME "${TS_PRODUCT_NAME}")
smtg_add_vst3plugin(TripleSideNativeInstrument
    PACKAGE_NAME "${TS_NATIVE_PACKAGE_NAME}"
    SOURCES_LIST ${TRIPLESIDE_NATIVE_SOURCES})

target_compile_features(TripleSideNativeInstrument PRIVATE cxx_std_20)
target_include_directories(TripleSideNativeInstrument PRIVATE
    Source
    ThirdParty
    ThirdParty/signalsmith-stretch
    "${TRIPLESIDE_GENERATED_DIR}")
target_compile_definitions(TripleSideNativeInstrument PRIVATE TRIPLESIDE_NATIVE_VST3=1)

if(WIN32)
    target_compile_definitions(TripleSideNativeInstrument PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
    target_link_libraries(TripleSideNativeInstrument PRIVATE sdk d2d1 dwrite windowscodecs ole32 shell32 winhttp bcrypt crypt32 advapi32)
elseif(APPLE)
    target_compile_options(TripleSideNativeInstrument PRIVATE
        $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>)
    target_link_libraries(TripleSideNativeInstrument PRIVATE
        sdk
        "-framework Cocoa"
        "-framework CoreGraphics"
        "-framework Foundation")

    file(GLOB TRIPLESIDE_GENERATED_RESOURCES CONFIGURE_DEPENDS
        "${TRIPLESIDE_GENERATED_DIR}/assets/*")
    add_custom_command(TARGET TripleSideNativeInstrument POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E make_directory
            "$<TARGET_BUNDLE_CONTENT_DIR:TripleSideNativeInstrument>/Resources"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${TRIPLESIDE_GENERATED_DIR}/project.json"
            "$<TARGET_BUNDLE_CONTENT_DIR:TripleSideNativeInstrument>/Resources/project.json"
        VERBATIM)
    if(TRIPLESIDE_GENERATED_RESOURCES)
        add_custom_command(TARGET TripleSideNativeInstrument POST_BUILD
            COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                ${TRIPLESIDE_GENERATED_RESOURCES}
                "$<TARGET_BUNDLE_CONTENT_DIR:TripleSideNativeInstrument>/Resources"
            VERBATIM)
    endif()
endif()

option(TRIPLESIDE_BUILD_VISUAL_HOST "Build the internal HWND visual verification host" OFF)
if(TRIPLESIDE_BUILD_VISUAL_HOST AND WIN32)
    target_compile_definitions(TripleSideNativeInstrument PRIVATE TRIPLESIDE_VISUAL_SMOKE_CAPTURE=1)
    add_executable(TripleSideVisualHost tests/visual_host.cpp)
    target_compile_features(TripleSideVisualHost PRIVATE cxx_std_20)
    target_include_directories(TripleSideVisualHost PRIVATE "${TRIPLESIDE_VST3_SDK_DIR}")
    target_link_libraries(TripleSideVisualHost PRIVATE sdk sdk_hosting user32 gdi32 ole32)
endif()

if(MSVC)
    target_compile_options(TripleSideNativeInstrument PRIVATE /W4 /permissive- /EHsc /utf-8)
endif()
