# TripleSide Native VST3

Windows-first VST3 runtime for TripleSide VST Maker. It uses the official Steinberg VST3 SDK and Windows APIs directly.

The runtime also has an initial native macOS/Cocoa build path. It produces a
Universal VST3 (`arm64` + `x86_64`) without JUCE, packages project resources in
the VST3 bundle, renders the browser-captured control atlases in an `NSView`,
and supports basic knob, fader, button, pad, and keyboard interaction. The
macOS path currently uses ad-hoc signing for internal validation; Developer ID
signing and notarization remain required before customer distribution. Packaging
produces a system-wide `.pkg` plus a scoped uninstaller `.app`. The uninstaller
removes only that product's VST3 bundle and installer receipt, leaving presets
and DAW projects intact.

Implemented runtime:

- VST3 instrument factory and stereo output bus
- sample-accurate MIDI note input and editor audition queue
- PCM/float WAV loading from resources embedded in the VST3 module
- pitch/velocity mapping, round robin, trim, loop, fades, tuning, gain, and pan
- fixed-size polyphony with voice stealing and linear interpolation
- multiple sampler groups with volume, pan, mute, solo, articulation, and mic selection
- Volume, Tone, Attack, Release, Space, group mixer, mute, and solo automation
- zero reported/additional latency audio path, output/group metering, and lightweight reverb
- native Direct2D/DirectWrite editor with custom background, branding, knobs, faders, meters, pads, and piano keyboard
- interactive UI controls and pad/keyboard hit feedback
- full component/editor state persistence
- isolated Windows build, official Steinberg validation, and a repository-owned native WinAPI installer EXE with a registered native uninstaller

Tempo-synced sampler zones use Signalsmith Stretch 1.4.0 and Signalsmith
Linear 0.6.4 under the MIT License. Their notices are retained under
`ThirdParty/` and included beside the VST3 bundle in every ZIP artifact.

The VST Maker web flow accepts WAV as its single sample source format. This keeps the build contract deterministic and lets every Windows build use the native runtime without format-specific fallback behavior.

## Custom cabinet impulse responses

A `cabinet_ir` rack node can optionally own one project-private custom WAV IR. Accepted files are RIFF/WAVE, mono or stereo, up to 32 MB; the native decoder supports PCM16, PCM24, PCM32, and float32. Stereo IRs are folded to mono. Manual trim is applied first, optional auto-trim removes leading/trailing content below 0.1% of the selected peak, phase alignment shifts by -2 to +2 ms, optional polarity inversion is applied, and optional peak normalization follows.

The response is resampled to the active audio context/host sample rate, limited to 2048 samples, then compacted deterministically: the first 128 samples remain exact and the tail is summed in groups of eight. Browser AudioWorklet and native VST3 use the same tap layout and zero-latency time-domain convolution. Cabinet low/high cut, resonance, level, module mix, and bypass remain active; procedural cabinet/mic/distance modelling is used as a safe fallback whenever no valid custom IR is attached or loaded.

## Shared preview artwork

The Windows worker selects browser-derived artwork through the build spec's capability contract, not a template allowlist. New projects always use `shared_preview`: static artwork and controls come from the browser preview, while Spectrum Analyzer and Stereo Vectorscope remain live native overlays positioned by the browser-measured rectangles. An analyzer therefore no longer forces the rest of the interface back to the approximate procedural renderer. Older build snapshots without the contract retain their historical DSP-profile inference.

`/vst-visual-render` renders the same `InterfaceWorkspace`, CSS, fonts, and controls as the designer, without editing handles or selection outlines. It does not fetch projects or expose stored user data. The build injects its immutable specification into an isolated browser page; the downloaded background is supplied in memory. No browser or network dependency is needed by the finished VST3.

`tools/render_visual_assets.py` captures a static background/branding layer, 101-state control atlases, two-state buttons/pads, independent off/on piano keys, and measured analyzer rectangles. It records measured DOM control and key rectangles in `visual_manifest.json`. `compile_manifest.py` embeds both this geometry and the PNG artwork. Native MIDI, parameter automation and pointer interaction select the corresponding sprite; live analyzers draw into their measured rectangle, and measured rectangles also drive hit testing, including black-key priority. The previous hand-tuned knob offset is bypassed on this path.

Install worker dependencies with `python -m pip install -r tools/requirements-visual.txt` and `python -m playwright install chromium`. Pass `-VisualRenderUrl https://triplesidestudio.com/vst-visual-render` to `build-windows.ps1` to enable capture. A capture or composition-check failure stops the build rather than silently reverting to approximated visuals.

The export check recomposes the atlases using their native coordinates, then compares against independent idle and active browser references. Both require at least 99.9% of pixels within 8/255 and a mean absolute channel error no greater than 0.5/255. This tolerance accounts for separate-layer alpha compositing; it is not a claim of bit-for-bit equality or a substitute for testing Cubase/DPI behavior. Diagnostic images/reports remain in the generated assets during internal verification.

For native renderer verification, configure `-DTRIPLESIDE_BUILD_VISUAL_HOST=ON`, build `TripleSideVisualHost`, and invoke it with the built module path and a PNG output path. The host loads the real module, opens its editor, and uses a test-only message to render the same `drawVisualCanvas` code to a WIC/Direct2D target (headless Windows cannot reliably capture HWNDs with PrintWindow). It also exercises a parameter change and a MIDI chord, saving an `.active.png` capture. `tools/compare_native_capture.py` compares these captures with their browser references. This proves the native drawing path at 1:1, not Cubase's host scaling. The host and capture hook are explicitly disabled by `build-windows.ps1` for customer builds.

All project WAV files, the normalized project metadata, backgrounds, and control artwork are compiled into the module's Windows `RCDATA` section. The outer `.vst3` package is retained because Cubase and other modern hosts expect the standard VST3 bundle layout, but the module no longer depends on loose PNG or WAV files in `Contents/Resources`.

```powershell
.\build-windows.ps1 `
  -Spec C:\path\project.json `
  -SamplesDir C:\path\samples `
  -OutputDir C:\path\output `
  -Vst3SdkDir C:\path\vst3sdk `
  -PythonPath C:\Python312\python.exe `
  -CMakePath C:\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe `
  -ValidatorPath C:\path\validator.exe
```

The Windows deliverable is a single native, double-clickable setup EXE. The
repository builds small C++/WinAPI setup and uninstall programs with Visual
Studio, then `tools/package_windows_installer.py` appends the VST3 bundle as a
streamable payload with a bounded binary manifest and SHA-256 checksums. Setup
requests UAC elevation, extracts into a staging directory, replaces only
`%ProgramFiles%\Common Files\VST3\<Product>.vst3`, and registers the dedicated
uninstaller under Windows Settings > Apps. Updates use the same exact product
paths. Uninstall removes only that bundle, its registration, and its product
directory under `%ProgramData%\TripleSide Studio\Uninstall`.

The distributed setup and uninstaller require neither Python nor a third-party
installer runtime. Python is used only while assembling the build artifact.
Code signing remains a separate release requirement: an unsigned native EXE
can still trigger Microsoft Defender SmartScreen.

For an internal macOS build:

```bash
./build-macos.sh \
  --spec /path/project.json \
  --samples-dir /path/samples \
  --output-dir /path/output \
  --vst3-sdk-dir /path/vst3sdk \
  --visual-render-url https://triplesidestudio.com/vst-visual-render
```

The manual GitHub Actions workflows `.github/workflows/native-vst3-macos.yml`
and `.github/workflows/native-vst3-windows.yml` run the builders against an
effect fixture. The macOS workflow verifies both Universal Binary slices,
creates the PKG and uninstaller app, applies ad-hoc signatures, and uploads the
distribution ZIP. The Windows workflow produces the native setup EXE and its
ZIP, performs a real silent install/uninstall, and verifies removal of the VST3
bundle, Apps registration, and dedicated uninstaller directory. Neither
workflow polls or mutates the customer build queue.
