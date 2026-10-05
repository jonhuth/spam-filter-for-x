#!/usr/bin/env bash
# Preflight for hands-off Safari Web Extension builds (macOS only).
# Usage: ./safari/doctor.sh
set -euo pipefail

ok=0
warn=0
fail=0

pass() { echo "  ✓ $*"; ok=$((ok + 1)); }
note() { echo "  · $*"; warn=$((warn + 1)); }
bad()  { echo "  ✗ $*"; fail=$((fail + 1)); }

echo "Safari extension doctor"
echo "======================="

if [[ "$(uname -s)" != "Darwin" ]]; then
  bad "Not macOS ($(uname -s)). Convert/build must run on a Mac."
  exit 1
fi
pass "Darwin host"

DEVELOPER_DIR="$(xcode-select -p 2>/dev/null || true)"
XCODE_APP="/Applications/Xcode.app"
XCODE_DEV="${XCODE_APP}/Contents/Developer"
HAS_FULL_XCODE=false
[[ -d "$XCODE_DEV" ]] && HAS_FULL_XCODE=true

if [[ -z "$DEVELOPER_DIR" ]]; then
  bad "xcode-select path unset"
elif [[ "$DEVELOPER_DIR" == *"CommandLineTools"* ]]; then
  bad "xcode-select points at Command Line Tools only:"
  echo "      $DEVELOPER_DIR"
  echo "      safari-web-extension-converter and Simulator need full Xcode.app"
  if $HAS_FULL_XCODE; then
    echo "      Xcode.app is installed. Point tools at it:"
    echo "        sudo xcode-select -s ${XCODE_DEV}"
    echo "        sudo xcodebuild -license accept   # once, if prompted"
  else
    echo "      Install full Xcode, then point tools at it:"
    if command -v xcodes >/dev/null 2>&1; then
      echo "        xcodes install --latest   # or: xcodes install 16.4"
      echo "        xcodes select             # pick the installed app"
    else
      echo "        # App Store → Xcode, or: brew install xcodesorg/made/xcodes && xcodes install --latest"
    fi
    echo "        sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  fi
else
  pass "xcode-select → $DEVELOPER_DIR"
fi

if $HAS_FULL_XCODE; then
  pass "Xcode.app present at $XCODE_APP"
else
  bad "Full Xcode.app not found at $XCODE_APP"
fi

if ! command -v xcrun >/dev/null 2>&1; then
  bad "xcrun missing"
else
  pass "xcrun present"
fi

# Converter only exists under full Xcode
if xcrun --find safari-web-extension-converter >/dev/null 2>&1 \
  || [[ -x "${DEVELOPER_DIR}/usr/bin/safari-web-extension-converter" ]] \
  || [[ -x "${XCODE_DEV}/usr/bin/safari-web-extension-converter" ]]; then
  pass "safari-web-extension-converter available"
else
  bad "safari-web-extension-converter missing"
  if $HAS_FULL_XCODE && [[ "$DEVELOPER_DIR" == *"CommandLineTools"* ]]; then
    echo "      Fix: sudo xcode-select -s ${XCODE_DEV}"
  elif ! $HAS_FULL_XCODE; then
    echo "      Fix: install full Xcode (not only CLT), then xcode-select -s it"
  fi
fi

if command -v xcodebuild >/dev/null 2>&1; then
  ver=$(DEVELOPER_DIR="${DEVELOPER_DIR:-}" xcodebuild -version 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//')
  if [[ -z "$ver" || "$ver" == "unknown" ]]; then
    # CLT often reports empty/unknown for -version in some setups
    if [[ "$DEVELOPER_DIR" == *"CommandLineTools"* ]]; then
      note "xcodebuild present but CLT-only (no real Xcode version string)"
    else
      note "xcodebuild present (version string empty)"
    fi
  else
    pass "xcodebuild ($ver)"
  fi
else
  bad "xcodebuild missing"
fi

if xcrun simctl help >/dev/null 2>&1; then
  pass "simctl available"
  # Runtimes: "iOS 26.5 (26.5 - ...)" lines — need at least one iOS runtime
  runtimes=$(xcrun simctl list runtimes 2>/dev/null | grep -cE 'iOS [0-9]' || true)
  # Available iPhone devices that are not "unavailable"
  sims=$(xcrun simctl list devices available 2>/dev/null | grep -E 'iPhone' | grep -vc unavailable || true)
  if [[ "${runtimes:-0}" -eq 0 ]]; then
    bad "no iOS Simulator runtime installed"
    echo "      This is why xcodebuild says 'iOS X.Y is not installed'."
    echo "      Fix (pick one):"
    echo "        xcodebuild -downloadPlatform iOS"
    echo "        # or Xcode → Settings → Platforms → iOS → Get"
  elif [[ "${sims:-0}" -eq 0 ]]; then
    bad "iOS runtime present but no available iPhone simulators"
    echo "      Open Simulator once, or: xcrun simctl create 'iPhone 16' ..."
  else
    pass "iOS Simulator ready (~${runtimes} runtime(s), ~${sims} iPhone device(s))"
    # Show a sample device line for copy-paste into IOS_SIM_NAME
    sample=$(xcrun simctl list devices available 2>/dev/null | grep -E 'iPhone' | head -1 | sed -E 's/^[[:space:]]+//;s/ \([A-F0-9-]{36}\).*//')
    [[ -n "$sample" ]] && note "example sim: ${sample}"
  fi
else
  bad "simctl unavailable — install full Xcode (includes Simulator)"
fi

if command -v xcodes >/dev/null 2>&1; then
  pass "xcodes CLI present"
  # Show installed Xcodes if any
  if xcodes installed 2>/dev/null | grep -q .; then
    note "xcodes installed: $(xcodes installed 2>/dev/null | tr '\n' '; ' | sed 's/; $//')"
  else
    note "xcodes: no full Xcode installed via xcodes yet — run: xcodes install --latest"
  fi
else
  note "xcodes not installed (optional helper): brew install xcodesorg/made/xcodes"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT}/static/manifest.json" ]]; then
  pass "static/manifest.json present (run bun run build → dist/)"
else
  bad "missing ${ROOT}/static/manifest.json"
fi

if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  pass "DEVELOPMENT_TEAM=${DEVELOPMENT_TEAM}"
else
  note "DEVELOPMENT_TEAM unset — set 10-char Team ID for non-interactive signing"
  note "  export DEVELOPMENT_TEAM=XXXXXXXXXX  # Xcode → Settings → Accounts → Team"
fi

if [[ -n "${BUNDLE_ID:-}" ]]; then
  pass "BUNDLE_ID=${BUNDLE_ID}"
else
  note "BUNDLE_ID unset — convert.sh defaults to com.aevum.spamfilter"
fi

if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development\|Apple Distribution"; then
  pass "codesigning identity found in keychain"
else
  note "no Apple Development identity visible — open full Xcode once, add Apple ID"
fi

echo
echo "Summary: ${ok} ok, ${warn} notes, ${fail} failures"
echo

if [[ "$fail" -gt 0 ]]; then
  echo "Blocked until full Xcode is active. Quick path:"
  if ! $HAS_FULL_XCODE; then
    if command -v xcodes >/dev/null 2>&1; then
      echo "  1. xcodes install --latest"
      echo "  2. xcodes select"
    else
      echo "  1. Install Xcode from App Store (or brew install xcodesorg/made/xcodes && xcodes install --latest)"
    fi
    echo "  3. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    echo "  4. sudo xcodebuild -license accept"
    echo "  5. open -a Simulator   # first launch downloads runtimes if needed"
  elif [[ "$DEVELOPER_DIR" == *"CommandLineTools"* ]]; then
    echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    echo "  sudo xcodebuild -license accept"
  fi
  echo "  ./safari/doctor.sh   # re-check"
  echo
  echo "Then: ./safari/build.sh ios-sim && ./safari/run-sim.sh"
  echo "Docs: safari/CLI.md"
  exit 1
fi

echo "Automatable: convert → xcodebuild → simctl install/launch"
echo "Human once:  Team/signing, Safari enable extension, x.com login + site allow"
echo "See: safari/CLI.md"
exit 0
