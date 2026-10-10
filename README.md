# Spam Filter for X

Hide bots, AI slop, spam countries, and clutter on X. All on this device.

- **Safari (iOS + macOS)** — product (App Store / TestFlight)
- **Chrome** — `bun run build`, load unpacked `dist/` (R&D)

x.com only. Not Desloppify (all-web slop).

## What it does

- Flag every account with the country or region X says it is based in (🇺🇸 🇮🇳 🌏)
- Hide farm accounts and collapse low-quality replies: AI-style, generic, copy-paste, and off-region accounts piling into another region's politics. Each one shows why.
- Reply threads fold every low-quality reply into one bar: "18 low-quality replies hidden · 🇳🇬 6 · 🇮🇳 5 · Show all".
- Tap any flag or badge to vote 👍/👎, mute, block, trust, hide a country, or mute a word in one tap. Undo is in the toast.
- Country lookups are cached on-device for 30 days and shared across tabs, paced by X's own rate limits.
- 20+ one-tap distraction toggles (Calm preset): For you, ads, Who to follow, “Discover more”, reposts, video autoplay, like/view counts, Grok buttons, floating Grok/Chat bubbles, sidebar modules, nav extras, notification counts — plus a daily time nudge.
- Mutes & blocks manager on the page (⌥M or the post menu) and in the popup: paste lists, search, one-tap remove, stays in two-way sync with your X account's muted words, mutes and blocks.
- Everything runs and is stored on your device. People you follow are never scored.

## Chrome

`bun run build` → `chrome://extensions` → Load unpacked → `dist/`

## Safari

```bash
APP_NAME="Spam Filter for X" BUNDLE_ID=com.aevum.spamfilter ./safari/convert.sh   # builds dist/ first
```

Use Safari → x.com, not the X app. [safari/TESTING.md](./safari/TESTING.md) · [docs/agent/app-store-ship.md](./docs/agent/app-store-ship.md)

## Develop

```bash
bun install && bun run check && bun run e2e
```

## Privacy

[docs/privacy.md](./docs/privacy.md)

## License

MIT
