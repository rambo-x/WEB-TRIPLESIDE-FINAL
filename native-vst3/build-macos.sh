#!/usr/bin/env bash
set -euo pipefail

runtime_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
spec=""
samples_dir=""
output_dir=""
vst3_sdk_dir=""
background_image=""
visual_render_url=""
visual_browser=""
validator_path=""
installer_sign_identity=""
architectures="arm64;x86_64"
build_jobs="$(sysctl -n hw.ncpu 2>/dev/null || echo 3)"

usage() {
    echo "Usage: $0 --spec FILE --samples-dir DIR --output-dir DIR --vst3-sdk-dir DIR [options]" >&2
    echo "Options: --background-image FILE --visual-render-url URL --visual-browser FILE" >&2
    echo "         --architectures arm64\;x86_64 --build-jobs N --validator FILE" >&2
    echo "         --installer-sign-identity 'Developer ID Installer: ...'" >&2
}

while (($#)); do
    case "$1" in
        --spec) spec="$2"; shift 2 ;;
        --samples-dir) samples_dir="$2"; shift 2 ;;
        --output-dir) output_dir="$2"; shift 2 ;;
        --vst3-sdk-dir) vst3_sdk_dir="$2"; shift 2 ;;
        --background-image) background_image="$2"; shift 2 ;;
        --visual-render-url) visual_render_url="$2"; shift 2 ;;
        --visual-browser) visual_browser="$2"; shift 2 ;;
        --architectures) architectures="$2"; shift 2 ;;
        --build-jobs) build_jobs="$2"; shift 2 ;;
        --validator) validator_path="$2"; shift 2 ;;
        --installer-sign-identity) installer_sign_identity="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
    esac
done

for value_name in spec samples_dir output_dir vst3_sdk_dir; do
    value="${!value_name}"
    if [[ -z "$value" ]]; then echo "Missing required argument: --${value_name//_/-}" >&2; usage; exit 2; fi
done
[[ -f "$spec" ]] || { echo "Spec not found: $spec" >&2; exit 2; }
[[ -d "$samples_dir" ]] || { echo "Samples directory not found: $samples_dir" >&2; exit 2; }
[[ -f "$vst3_sdk_dir/CMakeLists.txt" ]] || { echo "Invalid VST3 SDK directory: $vst3_sdk_dir" >&2; exit 2; }
[[ "$build_jobs" =~ ^[1-9][0-9]*$ ]] || { echo "--build-jobs must be a positive integer" >&2; exit 2; }

mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
generated_dir="$output_dir/generated"
build_dir="$output_dir/cmake-build"

export_args=("$runtime_root/tools/export_project.py" "$spec" --samples-dir "$samples_dir" --output "$output_dir")
if [[ -n "$background_image" ]]; then export_args+=(--background-image "$background_image"); fi
python3 "${export_args[@]}"

if [[ -n "$visual_render_url" ]]; then
    visual_args=("$runtime_root/tools/render_visual_assets.py" "$generated_dir/project.json" --url "$visual_render_url")
    if [[ -n "$visual_browser" ]]; then visual_args+=(--browser "$visual_browser"); fi
    set +e
    python3 "${visual_args[@]}"
    visual_status=$?
    if [[ $visual_status -eq 75 ]]; then
        echo "Visual capture failed transiently; retrying once." >&2
        python3 "${visual_args[@]}"
        visual_status=$?
    fi
    set -e
    [[ $visual_status -eq 0 ]] || exit "$visual_status"
    python3 "$runtime_root/tools/verify_visual_assets.py" "$generated_dir/project.json"
fi

python3 "$runtime_root/tools/compile_manifest.py" \
    "$generated_dir/project.json" --output "$generated_dir/NativeProject.h"

cmake_args=(
    -S "$runtime_root"
    -B "$build_dir"
    -G Ninja
    -DCMAKE_BUILD_TYPE=Release
    "-DCMAKE_OSX_ARCHITECTURES=$architectures"
    "-DTRIPLESIDE_GENERATED_DIR=$generated_dir"
    "-DTRIPLESIDE_VST3_SDK_DIR=$vst3_sdk_dir"
    -DTRIPLESIDE_BUILD_VISUAL_HOST=OFF
    -DSMTG_RUN_VST_VALIDATOR=OFF
)
if command -v ccache >/dev/null 2>&1; then
    cmake_args+=(
        "-DCMAKE_C_COMPILER_LAUNCHER=ccache"
        "-DCMAKE_CXX_COMPILER_LAUNCHER=ccache"
        "-DCMAKE_OBJCXX_COMPILER_LAUNCHER=ccache"
    )
fi
cmake "${cmake_args[@]}"
cmake --build "$build_dir" --target TripleSideNativeInstrument --parallel "$build_jobs"

bundle="$(find "$build_dir" -type d -name '*.vst3' -print | head -n 1)"
[[ -n "$bundle" && -d "$bundle" ]] || { echo "Native macOS VST3 bundle was not produced" >&2; exit 1; }
module=""
for candidate in "$bundle"/Contents/MacOS/*; do
    if [[ -f "$candidate" ]]; then module="$candidate"; break; fi
done
[[ -n "$module" && -f "$module" ]] || { echo "VST3 Mach-O module was not produced" >&2; exit 1; }

for architecture in ${architectures//;/ }; do
    lipo "$module" -verify_arch "$architecture"
done

codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
if [[ -n "$validator_path" ]]; then "$validator_path" "$bundle"; fi

artifact_dir="$output_dir/artifacts"
package_dir="$output_dir/package"
bundle_name="$(basename "$bundle" .vst3)"
package_slug="$(printf '%s' "$bundle_name" | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-')"
[[ -n "$package_slug" ]] || package_slug="plugin"
package_id="com.triplesidestudio.vst3.${package_slug}"
package_version="$(python3 - "$generated_dir/project.json" <<'PY'
import json, re, sys
value = str((json.load(open(sys.argv[1], encoding="utf-8")).get("build") or {}).get("version") or "1.0.0")
print(value if re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,3}", value) else "1.0.0")
PY
)"

rm -rf "$package_dir"
mkdir -p "$artifact_dir" "$package_dir/pkg-root/Library/Audio/Plug-Ins/VST3"
cp -R "$bundle" "$package_dir/pkg-root/Library/Audio/Plug-Ins/VST3/"

pkg_path="$artifact_dir/${bundle_name}-macos-installer.pkg"
pkg_args=(
    --root "$package_dir/pkg-root"
    --identifier "$package_id"
    --version "$package_version"
    --ownership recommended
    --install-location /
)
if [[ -n "$installer_sign_identity" ]]; then pkg_args+=(--sign "$installer_sign_identity"); fi
rm -f "$pkg_path"
pkgbuild "${pkg_args[@]}" "$pkg_path"
pkgutil --check-signature "$pkg_path" || [[ -z "$installer_sign_identity" ]]

uninstaller="$package_dir/Uninstall ${bundle_name}.app"
mkdir -p "$uninstaller/Contents/MacOS" "$uninstaller/Contents/Resources"
cp "$runtime_root/packaging/macos/uninstall.applescript" "$uninstaller/Contents/Resources/uninstall.applescript"
cat > "$uninstaller/Contents/MacOS/uninstall" <<LAUNCHER
#!/bin/sh
exec /usr/bin/osascript "\$(dirname "\$0")/../Resources/uninstall.applescript" "/Library/Audio/Plug-Ins/VST3/${bundle_name}.vst3" "${package_id}" "${bundle_name}"
LAUNCHER
chmod 755 "$uninstaller/Contents/MacOS/uninstall"
cat > "$uninstaller/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>uninstall</string>
<key>CFBundleIdentifier</key><string>${package_id}.uninstaller</string>
<key>CFBundleName</key><string>Uninstall ${bundle_name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${package_version}</string>
</dict></plist>
PLIST
plutil -lint "$uninstaller/Contents/Info.plist"
codesign --force --deep --sign - "$uninstaller"
codesign --verify --deep --strict "$uninstaller"

distribution_dir="$package_dir/distribution"
mkdir -p "$distribution_dir"
cp "$pkg_path" "$distribution_dir/"
cp -R "$uninstaller" "$distribution_dir/"
cp "$runtime_root/ThirdParty/signalsmith-stretch/LICENSE.txt" "$distribution_dir/Signalsmith-Stretch-LICENSE.txt"
cp "$runtime_root/ThirdParty/signalsmith-linear/LICENSE.txt" "$distribution_dir/Signalsmith-Linear-LICENSE.txt"
zip_path="$artifact_dir/${bundle_name}-macos-installer-and-uninstaller.zip"
rm -f "$zip_path"
ditto -c -k --sequesterRsrc "$distribution_dir/" "$zip_path"
shasum -a 256 "$zip_path"
printf '%s\n' "$zip_path"
