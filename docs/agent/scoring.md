# Scoring

Status: active (v4). Source of truth: `src/core/score.ts` and `src/core/decide.ts`.

A post's score is the sum of named signals. Each has a weight and a reason that the
UI shows. Labels: `trusted`, `ok`, `slop`, `farm`.

| Strictness | slop ≥ | farm ≥ (needs a strong signal) |
|---|---|---|
| Relaxed | 3.5 | 5.5 |
| Balanced | 2.5 | 4.5 |
| Strict | 1.8 | 3.5 |

`slop` applies only to replies, unless a strong signal fired.

## Signals

| Group | Signal | Weight |
|---|---|---|
| Account | farm ratio: following ≥ 2500, followers < 120, ratio ≥ 30 (strong) | +3 |
| Account | new shell: ≤ 45 days old, mass-following (strong) | +3 |
| Account | age < 30d / < 120d | +1.2 / +0.6 |
| Account | default avatar · auto-generated handle (6+ trailing digits) | +0.6 · +0.5 |
| Account | paid checkmark with < 150 followers · renamed 3+ times | +0.8 · +0.8 |
| Account | established (5y+, 300+ followers) · large organic following (20k+, no paid check) | −1.5 · −1 |
| Account | follows you | −2 |
| Geo | off-region in a political thread of another region | +2 |
| Geo | off-region in a non-political regional thread | +0.5 |
| Geo | X flags the location as possibly inaccurate (VPN) | +0.7 |
| Geo | based-in ≠ app-store country (e.g. US-based via "Nigeria Android App") | +1.2 |
| Geo | country is on your watch list | +1.5 |
| Text | spam bait: DM me, t.me, airdrop, wallet address, adult bait (strong) | +3 |
| Text | generic praise (short) · AI-style phrasing · restates the parent post | +1 each |
| Text | emoji-only · 3+ hashtags | +0.5 · +0.6 |
| Thread | near-duplicate of replies by 2+ other accounts (strong) | +2.5 |

Thread region comes from the root post's topic (US or EU politics lexicon), and failing
that from its author's country. The **My regions** setting exempts blocs from
off-region weight.

## Tuning

Add a unit test in `test/score.test.ts` for any false positive before changing weights.
Prefer adding a negative (trust) signal over raising thresholds.
