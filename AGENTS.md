# Spam Filter for X - AGENTS.md

Local-first Safari/Chrome extension for x.com: country/region flags, farm and
low-quality reply filtering, one-tap mute/block/hide, and X chrome declutter.

**Surface strategy:** Safari on iOS is the paid product. Chrome is the load-unpacked R&D loop.
Keep X in Safari, not the native X app.

## Architecture (v4)

One pipeline; every feature is a signal or a list, not a separate system:

```text
X's own GraphQL traffic ─▶ page/main.ts (page world: fetch+XHR hook, AboutAccountQuery, mute/block on X)
        │ postMessage (nonce-tagged, shared/bridge.ts)
        ▼
content/main.ts ─▶ Store (accounts, posts, 30d about cache) ─▶ core/decide ─▶ render + menu
                              ▲                                   │
                     AboutQueue (rate-limited)          core/score (named weighted signals)
```

```text
src/core/      pure, tested: xparse (all X layouts), country (flags, blocs), context (thread region,
               politics), text (slop features, duplicate clusters), score, decide
src/shared/    settings (one typed object, v3 migration, lists), bridge (message types),
               listsUI (mutes/blocks manager used by popup AND the on-page modal), feedback
src/page/      page-world script (built to dist/page.js)
src/content/   orchestrator, store, aboutQueue, dom (post selectors), render, menu,
               declutter (toggle registry + ALL layout selectors), focus (runtime), manager (⌥M modal)
src/popup/     Filter / Lists / Layout
static/        manifest, popup.html, icons → copied into dist/
test/          bun tests + fixtures of real X response shapes
e2e/           Chromium + mock x.com: loads dist/, asserts behavior, screenshots to e2e/out/
backend/       PARKED; not used by the extension. Slated for retirement (nas container).
```

## Rules

- **Local-first.** No extension-owned server. `bun run check:no-backend` fails the build if dist/
  references any host but x.com/twitter.com/twimg.com. Any future server (Cloudflare) is opt-in,
  carries no per-user data, and must update docs/privacy.md first.
- **Scoring bias:** missing a bot beats flagging a person. People you follow and your trusted list
  are never scored. `farm` requires a `strong` signal. Country alone never produces `slop`.
  Every signal has a human-readable reason shown in the menu and collapsed bar.
- **Lists beat scores.** Order in `decide`: blocked > muted account > muted word > trusted/follow >
  hidden country > score action. The focal post on a status page is never hidden.
- **X schema drift:** parse via `core/xparse.ts` only. It reads current (`core`, `avatar`,
  `relationship_counts`, no `legacy`), hybrid, and pre-2025 layouts; see
  `docs/agent/x-graphql-schema.md`. Add a fixture before changing the parser.
- **DOM drift:** selectors live only in `content/dom.ts`.
- **Query ids:** learned from live traffic, then X's main bundle, then fallback constants.
- **Threads:** on a status page, score-based hides fold into ONE summary bar on the first folded
  reply in the DOM (X virtualizes the list — never insert rows). List-based hides never fold.
- **Lookups at feed scale:** About lookups are paced by X's `x-rate-limit-*` headers, riskiest
  first (`AboutQueue` priority), cached 30d in `about_v4:<char>` buckets that every tab merges
  live via `storage.onChanged` — one lookup per account across all tabs.
- **Declutter:** add a distraction by adding one entry to `TOGGLES` in `content/declutter.ts`
  (key, label, group, css gated by `html.sfx-t-<key>`). X's unlabeled parts get `data-sfx-*` tags
  from the throttled labeler; labels are recomputed every pass (X recycles cells).
- **X sync:** muted words / muted accounts / blocks sync both ways with the user's X account
  (`core/sync.ts` three-way merge vs the last snapshot; `content/xsync.ts` runner). Invariants: a
  failed or all-empty read never deletes; pushes capped per run; one tab syncs at a time; refused
  pushes retry next run. Countries / trusted / watched stay local.
- **Feedback:** 👍/👎 is a ±4 signal applied immediately and stored in `feedback_v4` for
  `bun run calibrate`.
- **Safari:** prefer `chrome.*`; wrap storage in try/catch; no persistent background worker;
  don't commit generated Xcode projects.

## Development

```bash
bun install
bun run check        # typecheck, biome, unit tests, build, no-backend scan
bun run e2e          # real Chromium + mock x.com; screenshots in e2e/out/
bun run watch        # rebuild dist/ on change
```

Chrome: `chrome://extensions` → Developer mode → Load unpacked → `dist/`.

Safari (Mac only; `convert.sh` builds dist/ first):

```bash
export DEVELOPMENT_TEAM=XXXXXXXXXX
./safari/doctor.sh
./safari/build.sh ios-sim
./safari/run-sim.sh
```

Human setup remains: enable the extension in Safari settings and allow x.com.
See `safari/TESTING.md` and `docs/agent/app-store-ship.md`.
