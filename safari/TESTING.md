# Testing Spam Filter for X on Safari

Product surface is iOS Safari. Test on `https://x.com` in Safari, not in the native X app.

## Prerequisites

- Mac with full Xcode 15 or newer
- Apple Developer team for signing
- iPhone or iPad on iOS 16 or newer, or an iOS Simulator
- Logged-in x.com session in Safari

Linux agents can edit and verify `src/` (bun run check), but cannot run the Safari converter, sign builds, upload TestFlight builds, or submit to the App Store.

## Convert and build

```bash
./safari/convert.sh
open safari/Xcode/*.xcodeproj
```

Defaults:

- App name: `Spam Filter for X`
- Bundle ID: `com.aevum.spamfilter`
- Version: `3.0.0`

Choose the Aevum development team for both the containing app and Safari Web Extension targets. Do not commit generated files under `safari/Xcode/`.

For CLI-driven Simulator testing:

```bash
export DEVELOPMENT_TEAM=XXXXXXXXXX
./safari/doctor.sh
./safari/build.sh ios-sim
./safari/run-sim.sh
```

## First-run onboarding

The popup must tell the user:

1. Open Safari → x.com, not the X app.
2. Allow Spam Filter for X for this site.
3. Flags appear. Tap a flag to hide that country.

On the device, open **Settings → Apps → Safari → Extensions**, enable Spam Filter for X, and allow x.com. The exact Settings path varies by iOS release.

## Monday MVP success checklist

- [ ] Spam Filter for X appears with the correct name and version.
- [ ] The popup opens on the selected **Location** panel.
- [ ] First-run Safari, x.com, and site-permission instructions are visible.
- [ ] At least one known location flag appears within 3 seconds after timeline content settles.
- [ ] The flag has a tap target and an accessible “Tap to hide” label.
- [ ] Tapping an India flag hides only India tweet articles.
- [ ] Profile headers and `UserCell` rows remain visible.
- [ ] India appears under Hidden countries in the popup.
- [ ] Removing India restores its posts without revealing separately muted posts.
- [ ] A country can be added from a seen-location chip.
- [ ] A country or region can be added by name.
- [ ] The popup shows unique-profile and hidden-country counts.
- [ ] Turning Location flags off removes flags; turning them on restores them.
- [ ] The Calm home preset is off until tapped.
- [ ] Calm home switches to Following and hides the listed noisy sections.
- [ ] Hidden countries and the location cache survive a tab reload.
- [ ] No request goes to an extension-owned backend.

## No-backend proof

Before conversion, run:

```bash
bun run build && bun run check:no-backend
```

Expect no matches. In Safari Web Inspector, confirm Spam Filter for X traffic stays on x.com/twitter.com. Location comes from X's `AboutAccountQuery` through the user's current page session.

## Device test

1. Run the iOS scheme on a physical device.
2. Enable Spam Filter for X in Safari settings.
3. Open Safari, sign in to x.com, and allow Spam Filter for X for the site.
4. Open the extension popup and confirm Location is selected.
5. Scroll a timeline until flags appear.
6. Tap a flag for India and confirm India posts disappear.
7. Open the popup, remove India, and confirm those posts return.
8. Enable Calm home and confirm Following is selected with the noisy sections hidden.
9. Reload x.com and repeat the flag and country-hide checks.

## macOS Safari smoke test

Build and run the macOS containing app. Enable Spam Filter for X in **Safari → Settings → Extensions**, allow x.com, then run the same popup and timeline checklist. macOS is a fast smoke test; the iOS device result is authoritative.

## TestFlight

Archive in Xcode and upload to App Store Connect. Install the internal TestFlight build, re-enable the extension, allow x.com, and repeat the full checklist. New installs can reset Safari extension permission.

## Troubleshooting

| Symptom | Check |
|---|---|
| No flags | Spam Filter for X enabled, x.com allowed, logged in, Safari not X app |
| Popup works but timeline does not | Hard-refresh x.com after reinstall |
| `pageScript.js` fails | Manifest web-accessible resource and converted resources |
| Settings do not persist | Safari storage path; missing `getBytesInUse` must not block writes |
| Converter missing | Select full Xcode with `xcode-select`, not Command Line Tools only |

App Store release steps and human-only gates are in [`../docs/agent/app-store-ship.md`](../docs/agent/app-store-ship.md).
