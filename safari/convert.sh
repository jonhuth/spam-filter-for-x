#!/usr/bin/env bash
# Convert the shared WebExtension into a Safari Web Extension Xcode app.
# Must run on macOS with Xcode (Command Line Tools + full Xcode.app) installed.
#
# Usage:
#   ./safari/convert.sh
#   BUNDLE_ID=com.aevum.spamfilter APP_NAME="Spam Filter for X" ./safari/convert.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="${ROOT}/dist"
OUT_DIR="${ROOT}/safari/Xcode"
APP_NAME="${APP_NAME:-Spam Filter for X}"
BUNDLE_ID="${BUNDLE_ID:-com.aevum.spamfilter}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: safari-web-extension-converter only runs on macOS (this host is $(uname -s))." >&2
  echo "Copy the repo to a Mac (or SSH to one with Xcode), then re-run." >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found — install full Xcode, then:" >&2
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

DEVDIR="$(xcode-select -p 2>/dev/null || true)"
if [[ "$DEVDIR" == *"CommandLineTools"* ]]; then
  echo "error: xcode-select points at Command Line Tools only:" >&2
  echo "  $DEVDIR" >&2
  echo "safari-web-extension-converter needs full Xcode.app." >&2
  if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
    echo "Xcode.app is installed. Run:" >&2
    echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  else
    echo "Install full Xcode, then:" >&2
    echo "  xcodes install --latest    # if xcodes is installed" >&2
    echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  fi
  echo "Re-check: ./safari/doctor.sh" >&2
  exit 1
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "error: safari-web-extension-converter not found under current developer dir." >&2
  echo "  xcode-select -p → ${DEVDIR:-unset}" >&2
  echo "Install/select full Xcode, then: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

(cd "${ROOT}" && bun install --frozen-lockfile >/dev/null && bun run build) || { echo "error: build failed" >&2; exit 1; }

if [[ ! -f "${EXT_DIR}/manifest.json" ]]; then
  echo "error: missing ${EXT_DIR}/manifest.json" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

echo "Converting ${EXT_DIR} → ${OUT_DIR}"
echo "  app-name: ${APP_NAME}"
echo "  bundle-id: ${BUNDLE_ID}"
echo

# --no-open: do not open Xcode/Cursor after convert (default handler for .xcodeproj).
# --force overwrites a previous conversion; multiplatform (iOS + macOS) by default.
xcrun safari-web-extension-converter "${EXT_DIR}" \
  --project-location "${OUT_DIR}" \
  --app-name "${APP_NAME}" \
  --bundle-identifier "${BUNDLE_ID}" \
  --swift \
  --force \
  --no-prompt \
  --no-open

echo
echo "Done. Hands-off next (Mac):"
echo "  export DEVELOPMENT_TEAM=XXXXXXXXXX   # once in shell profile"
echo "  ./safari/doctor.sh"
echo "  ./safari/build.sh ios-sim            # or: macos | all"
echo "  ./safari/run-sim.sh                  # sim install/launch"
echo "Still human once: Safari Settings → Extensions → enable + allow x.com"
echo "Docs: safari/CLI.md · safari/TESTING.md"
