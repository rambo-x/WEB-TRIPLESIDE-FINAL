#!/usr/bin/env bash
set -euo pipefail

api_base="${VST_BUILD_API_BASE:-https://triplesidestudio.com/api}"
worker_token="${VST_BUILD_WORKER_TOKEN:-}"
worker_id="${VST_BUILD_WORKER_ID:-github-macos-${GITHUB_RUN_ID:-local}}"
native_root="${VST_NATIVE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../native-vst3" && pwd)}"
sdk_dir="${VST3_SDK_DIR:-}"
work_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tripleside-vst-worker"

[[ -n "$worker_token" ]] || { echo "VST_BUILD_WORKER_TOKEN belum diatur" >&2; exit 2; }
[[ -f "$native_root/build-macos.sh" ]] || { echo "Native root macOS tidak valid" >&2; exit 2; }
[[ -f "$sdk_dir/CMakeLists.txt" ]] || { echo "VST3_SDK_DIR tidak valid" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq diperlukan" >&2; exit 2; }

auth=(-H "Authorization: Bearer $worker_token")
job_json="$(curl --fail --silent --show-error \
  "${auth[@]}" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg worker_id "$worker_id" '{worker_id:$worker_id,target_platform:"macos"}')" \
  "$api_base/vst-worker/claim")"
[[ -n "$job_json" ]] || exit 0

job_id="$(jq -r '.job_id' <<<"$job_json")"
lease_token="$(jq -r '.lease_token' <<<"$job_json")"
spec_sha256="$(jq -r '.spec_sha256 // empty' <<<"$job_json")"
[[ "$job_id" =~ ^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$ && -n "$lease_token" && "$lease_token" != "null" ]] || {
  echo "Respons claim macOS tidak memiliki job_id atau lease_token" >&2
  exit 2
}
job_root="$work_root/$job_id"
samples_dir="$job_root/samples"
output_dir="$job_root/output"
spec_path="$job_root/project.json"
background_path="$job_root/plugin-background"
rm -rf "$job_root"
mkdir -p "$samples_dir" "$output_dir"
jq '.spec' <<<"$job_json" >"$spec_path"

status() {
  local state="$1" progress="$2" message="$3" error="${4:-}"
  curl --fail --silent --show-error "${auth[@]}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg lease_token "$lease_token" --arg status "$state" \
      --argjson progress "$progress" --arg message "$message" --arg error "$error" \
      '{lease_token:$lease_token,status:$status,progress:$progress,message:$message,error:$error}')" \
    "$api_base/vst-worker/jobs/$job_id/status" >/dev/null
}

fail_job() {
  local exit_code=$? message
  message="$(tail -c 12000 "$job_root/build.log" 2>/dev/null || true)"
  status failed 0 "Build VST3 macOS gagal" "$message" || true
  rm -rf "$job_root"
  exit "$exit_code"
}
trap fail_job ERR

log_failure() {
  printf '%s\n' "$1" >>"$job_root/build.log"
  false
}

[[ "$spec_sha256" =~ ^[a-fA-F0-9]{64}$ ]] || log_failure "Spec build macOS tidak memiliki checksum yang valid"

sample_count="$(jq '.samples | length' <<<"$job_json")"
for ((index=0; index<sample_count; index++)); do
  filename="$(jq -r ".samples[$index].filename" <<<"$job_json")"
  filename_lower="$(printf '%s' "$filename" | tr '[:upper:]' '[:lower:]')"
  [[ "$filename_lower" == *.wav ]] || log_failure "Runtime native Steinberg hanya menerima sample WAV: $filename"
  destination="$samples_dir/$(basename "$filename")"
  status preparing "$((3 + index))" "Mengunduh sample $((index + 1))/$sample_count"
  curl --fail --location --proto '=https' --proto-redir '=https' --max-redirs 3 --silent --show-error \
    "$(jq -r ".samples[$index].download_url" <<<"$job_json")" -o "$destination"
  expected_size="$(jq -r ".samples[$index].size_bytes" <<<"$job_json")"
  expected_hash="$(jq -r ".samples[$index].sha256" <<<"$job_json")"
  [[ "$(stat -f %z "$destination")" == "$expected_size" ]]
  expected_hash="$(printf '%s' "$expected_hash" | tr '[:upper:]' '[:lower:]')"
  [[ "$(shasum -a 256 "$destination" | awk '{print $1}')" == "$expected_hash" ]]
done

background_url="$(jq -r '.background.download_url // empty' <<<"$job_json")"
if [[ -n "$background_url" ]]; then
  status preparing 20 "Mengunduh background interface"
  if [[ "$background_url" == /* ]]; then background_url="${api_base%/api}$background_url"; fi
  [[ "$background_url" == https://* ]] || log_failure "URL background build harus menggunakan HTTPS"
  curl --fail --location --proto '=https' --proto-redir '=https' --max-redirs 3 --silent --show-error "$background_url" -o "$background_path"
  background_size="$(stat -f %z "$background_path")"
  (( background_size > 0 && background_size <= 10 * 1024 * 1024 )) || log_failure "Ukuran background build tidak valid: $background_size byte"
fi

build_args=(
  --spec "$spec_path"
  --samples-dir "$samples_dir"
  --output-dir "$output_dir"
  --vst3-sdk-dir "$sdk_dir"
  --architectures 'arm64;x86_64'
  --build-jobs "$(sysctl -n hw.ncpu)"
)
if [[ -f "$background_path" ]]; then build_args+=(--background-image "$background_path"); fi
visual_mode="$(jq -r '.spec.visual_contract.mode // empty' <<<"$job_json")"
if [[ -z "$visual_mode" ]]; then
  dsp_profile="$(jq -r '.spec.dsp_profile // empty' <<<"$job_json")"
  if [[ "$dsp_profile" == "prism_eq" ]]; then visual_mode="native_live"; else visual_mode="shared_preview"; fi
fi
if [[ "$visual_mode" == "shared_preview" ]]; then
  site_root="${api_base%/api}"
  build_args+=(--visual-render-url "$site_root/vst-visual-render")
elif [[ -n "$visual_mode" && "$visual_mode" != "native_live" ]]; then
  echo "Mode visual tidak dikenal: $visual_mode" >"$job_root/build.log"
  false
fi

status building 25 "Mengompilasi Universal VST3 macOS (Apple Silicon + Intel)"
"$native_root/build-macos.sh" "${build_args[@]}" >"$job_root/build.log" 2>&1 &
build_pid=$!
progress=25
compilation_started_at="$(date +%s)"
while kill -0 "$build_pid" 2>/dev/null; do
  sleep 15
  progress=$((progress < 88 ? progress + 2 : 88))
  elapsed_seconds=$(( $(date +%s) - compilation_started_at ))
  if (( elapsed_seconds >= 60 )); then
    elapsed_text="$((elapsed_seconds / 60)) menit $((elapsed_seconds % 60)) detik"
  else
    elapsed_text="$((elapsed_seconds > 0 ? elapsed_seconds : 1)) detik"
  fi
  status building "$progress" "Compiler macOS aktif · berjalan $elapsed_text"
done
wait "$build_pid"

zip_path="$(tail -n 1 "$job_root/build.log")"
[[ -f "$zip_path" ]] || { echo "Artifact ZIP macOS tidak ditemukan" >>"$job_root/build.log"; false; }
status validating 92 "Memvalidasi entry point, resource, dan paket Universal VST3 macOS"
artifact_hash="$(shasum -a 256 "$zip_path" | awk '{print $1}')"
curl --fail --silent --show-error "${auth[@]}" \
  -H "X-Lease-Token: $lease_token" \
  -H "X-Artifact-SHA256: $artifact_hash" \
  -H 'X-Validator-Name: Universal Mach-O + codesign + resources + GetPluginFactory + pkgbuild' \
  -F "file=@$zip_path;type=application/zip" \
  "$api_base/vst-worker/jobs/$job_id/artifact" >/dev/null

trap - ERR
rm -rf "$job_root"
echo "READY $job_id"
