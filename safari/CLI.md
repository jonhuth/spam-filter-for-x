# Safari extension — hands-off / agent CLI path

**Goal:** agents on a Mac do convert + build + sim install without clicking Xcode.  
**Reality:** Apple still requires a few human steps once (signing, enable extension, site allow, X login).

## Split: automated vs human

| Step | Agent / CLI | GUI / human |
|------|-------------|-------------|
| `git pull` sources | yes | |
| `./safari/doctor.sh` | yes | |
| `./safari/convert.sh` (`safari-web-extension-converter`) | yes | |
| `./safari/build.sh` (`xcodebuild`) | yes, after Team ID known | first-time cert/Team |
| `./safari/run-sim.sh` (`simctl` install/launch) | yes | |
| Enable extension in Safari Settings | **no stable public CLI** | **yes, once per install** |
| Allow x.com for extension | no | **yes** |
| Log into x.com in Safari | browser automation possible but flaky | **usually yes** |
| Physical device Trust / dev mode | partial (`devicectl`) | **yes first plug-in** |
| TestFlight upload | `xcrun notarytool` / Transporter / ASC API | ASC web for metadata |
| App Store listing / review | no | yes |

Chrome remains the fully hands-off loop: `bun run build`, then load unpacked `dist/` on any machine.

## Full Xcode required (not Command Line Tools)

If doctor says converter missing and `xcode-select -p` contains `CommandLineTools`, you only
have CLT. Safari packaging needs **Xcode.app**.

```bash
# Xcode.app already installed:
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
open -a Simulator

# Or install via xcodes (you already have the CLI):
xcodes install --latest
xcodes select
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

./safari/doctor.sh   # must report 0 failures before build
```

## Agent recipe (Mac host)

```bash
cd ~/dev/spam-filter-for-x
git pull

# One-time env (shell profile or direnv on Mac)
export DEVELOPMENT_TEAM=XXXXXXXXXX   # 10-char Team ID
export BUNDLE_ID=com.aevum.spamfilter
export APP_NAME="Spam Filter for X"

./safari/doctor.sh                   # fails closed on CLT-only
./safari/build.sh ios-sim            # convert + build
./safari/run-sim.sh                  # boot sim, install app
```

Then **you** (or an accessibility script you accept maintaining):

1. Simulator → **Settings → Safari → Extensions** → enable app  
2. Safari → x.com → allow extension  
3. Log in  

macOS desktop:

```bash
./safari/build.sh macos
# open DerivedData app or: open safari/Xcode/*.xcodeproj && xcodebuild … run is GUI-ish
# Prefer: open the built .app from DerivedData/…/Debug/
```

JS-only iteration after project exists (typical day-to-day):

```bash
# After editing src/ only (bun run build) — skip convert, rebuild, reinstall sim
git pull   # or rsync/scp your branch onto the Mac
SKIP_CONVERT=1 ./safari/build.sh ios-sim
SKIP_CONVERT=1 ./safari/run-sim.sh
# Then in Simulator Safari: hard-refresh x.com (or kill Safari + reopen)
```

**Do you re-enable the extension every rebuild?** Usually **no** if the bundle id stays the same. Re-enable only after:
- first install on that sim/device
- full uninstall of the containing app
- re-convert that changes extension bundle id / app identity

Re-run **convert** when `manifest.json` or the file set in the extension changes.

## Signing without babysitting Xcode every time

1. Once: open Xcode → Settings → Accounts → Apple ID → note **Team ID**.  
2. Export `DEVELOPMENT_TEAM` in `~/.zshrc.local` or direnv.  
3. `xcodebuild -allowProvisioningUpdates` (wired in `build.sh`) refreshes profiles non-interactively when keychain already has the cert.

If doctor says no codesigning identity: open Xcode once and let it create “Apple Development”.

## Physical iPhone (mostly CLI after trust)

```bash
# list devices
xcrun xctrace list devices
# or
xcrun devicectl list devices

./safari/build.sh convert
# then device destination (adjust name/UDID):
xcodebuild -project safari/Xcode/**/*.xcodeproj \
  -scheme "$APP_NAME" \
  -destination 'platform=iOS,id=<UDID>' \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  -allowProvisioningUpdates \
  build
```

First cable: Trust Computer + enable Developer Mode on device (GUI). After that, agents can rebuild/install.

## What agents on **Linux (homebox)** should do

| Do | Don’t |
|----|--------|
| Edit `src/`, commit, push | Run convert/xcodebuild |
| Keep `safari/*.sh` + CLI.md current | Invent unsigned App Store shortcuts |
| SSH/Tailscale to Mac and run scripts there | Assume Simulator exists on Linux |

```bash
# from homebox agent
ssh mac "cd ~/dev/spam-filter-for-x && git pull && ./safari/doctor.sh && ./safari/build.sh ios-sim"
```

(Host alias `mac` is yours to define on Tailscale MagicDNS.)

## Dotfiles tooling

See `~/dev/dotfiles/macos/safari-web-extensions.md` and `safari-ext` helper for cross-project glue (Team ID, doctor, brew deps).

## Why extension enable isn’t scripted

Apple does not expose a supported CLI to toggle Safari Web Extensions or per-site permission. Private `defaults` keys break across OS versions. Treat **enable + allow x.com** as a 15-second human gate after each clean install; rebuilds with the same bundle id usually stay enabled.
