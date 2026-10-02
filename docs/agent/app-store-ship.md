# Spam Filter for X App Store ship checklist

This is Jon's Mac checklist for the Monday iOS Safari release. It is not an automated code path.

## Build and sign

- [ ] Pull the reviewed Spam Filter for X source onto a Mac with full Xcode.
- [ ] Run `./safari/convert.sh` with the default app name `Spam Filter for X` and bundle ID `com.aevum.spamfilter`.
- [ ] Open the generated project and select the Aevum team for the containing app and Safari Web Extension targets.
- [ ] Confirm marketing version `3.0.0` and set a valid build number.
- [ ] Keep the containing app a thin shell: Spam Filter for X title, three enablement steps, and a link to Safari settings if the current iOS API permits it.
- [ ] Do not add accounts, analytics, a backend, subscriptions, or in-app purchase to v1.

The three containing-app steps:

1. Open Settings → Safari → Extensions and enable Spam Filter for X.
2. Open Safari → x.com, not the X app.
3. Allow it for x.com. Farm posts hide. Tap a flag to hide that country.

## Price and privacy

- [ ] Choose paid upfront at **$4.99**. The acceptable launch range is **$3–15**.
- [ ] Use no IAP in v1.
- [ ] Privacy answers: no tracking and no extension-owned backend.
- [ ] Explain that location uses X's `AboutAccountQuery` through the user's current X session in page context.
- [ ] Confirm the manifest permits only x.com/twitter.com plus local `storage` and `tabs` capabilities.
- [ ] Repo visibility: keep public (see docs/agent/repo-visibility.md) to preserve App Store Privacy Policy and Support URLs.

## Human device acceptance

- [ ] Enable Spam Filter for X on a physical iPhone or iPad.
- [ ] Allow Spam Filter for X for x.com.
- [ ] Open x.com in Safari. Farm/bot tweets hide. Flags appear within ~3s.
- [ ] Tap an India flag and verify India tweet articles hide.
- [ ] Remove India in the popup and verify its posts return.
- [ ] Enable Calm home and verify Following plus the reduced home chrome.
- [ ] Confirm profile headers and people lists never disappear.
- [ ] Inspect network traffic and confirm there is no Spam Filter for X backend request.

## TestFlight, then App Store

- [ ] Archive and upload the signed build to App Store Connect.
- [ ] Install an internal TestFlight build and repeat the physical-device acceptance checklist.
- [ ] Display name **Spam Filter for X** (30-char limit; this is 17)
- [ ] Subtitle **Hide bots, countries, clutter** (29 chars; do not repeat spam/filter/X)
- [ ] Keywords (100 chars, comma, no words already in name/subtitle): `twitter,mute,farm,timeline,safari,following,ads,promoted,explore,location,flag,bot`
- [ ] Add screenshots and the no-tracking privacy details.
- [ ] Submit to App Review only after the TestFlight checklist passes.

## Known human-only blockers

- Safari conversion and Xcode signing require macOS with full Xcode.
- Aevum signing credentials and App Store Connect access require Jon.
- Safari extension enablement and per-site x.com permission require a device user.
- TestFlight upload, pricing, legal metadata, and App Store submission cannot be completed by Linux agents.
