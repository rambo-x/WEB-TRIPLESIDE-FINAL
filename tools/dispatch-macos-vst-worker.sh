#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gh_bin="${GH_BIN:-/home/triplesidestudio/.local/bin/gh}"
lock_file="${XDG_RUNTIME_DIR:-/tmp}/tripleside-macos-worker-dispatch.lock"

exec 9>"$lock_file"
flock -n 9 || exit 0

[[ -x "$gh_bin" ]] || { echo "GitHub CLI tidak tersedia" >&2; exit 2; }

active="$($gh_bin run list \
  --repo rambo-x/WEB-TRIPLESIDE-FINAL \
  --workflow vst-macos-worker.yml \
  --limit 10 \
  --json status \
  --jq 'any(.[]; .status == "queued" or .status == "in_progress" or .status == "waiting" or .status == "pending")')"
[[ "$active" == "true" ]] && exit 0

pending="$(cd "$repo_root" && PYTHONPATH=backend backend/venv/bin/python3 - <<'PY'
import asyncio
from datetime import datetime, timezone

from core import db, mongo_client


async def main() -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    pending_job = await db.vst_maker_build_jobs.find_one(
        {
            "target_platform": "macos",
            "$or": [
                {
                    "status": {"$in": ["queued", "retrying"]},
                    "next_attempt_at": {"$lte": timestamp},
                },
                {
                    "status": {"$in": ["preparing", "building", "validating"]},
                    "$or": [
                        {"lease_expires_at": {"$lte": timestamp}},
                        {"lease_expires_at": {"$exists": False}},
                    ],
                },
            ],
        },
        {"_id": 0, "id": 1},
    )
    print("true" if pending_job else "false")


try:
    asyncio.run(main())
finally:
    mongo_client.close()
PY
)"

[[ "$pending" == "true" ]] || exit 0

$gh_bin workflow run vst-macos-worker.yml \
  --repo rambo-x/WEB-TRIPLESIDE-FINAL \
  --ref main
