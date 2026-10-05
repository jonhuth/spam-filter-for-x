# X web GraphQL fixtures: notes

Researched 2026-10-04. All ids, names and text in the fixtures are fake. The shapes are copied
key for key from real captured responses in `vladkens/twscrape` `tests/mocked-data/`
(git history gives dated snapshots) and checked against the `fa0311/twitter-openapi` schemas.

## Files

| File | What it is |
|---|---|
| `user-timeline-entry.json` | `HomeTimeline` response (`data.home.home_timeline_urt`) with **hybrid** user layout (mid-2025 → ~Jul 2026). Entries: (1) normal tweet by `@priya_codes`; (2) `promoted-tweet-…` with `promotedMetadata`; (3) `home-conversation-…` `TimelineTimelineModule` (`VerticalConversation`) holding the root plus a reply wrapped in `TweetWithVisibilityResults`, with `in_reply_to_*`, `note_tweet` and a truncated `legacy.full_text`; plus top and bottom cursors. |
| `user-timeline-entry-v3-no-legacy.json` | The same timeline with the **current (Aug 2026+) user layout**: the user `legacy` key is gone and counts live in `relationship_counts` / `tweet_counts` / `action_counts`. **Test against this one first.** |
| `legacy-user.json` | `UserByScreenName` (`data.user.result`) in the **old layout** (≤ Mar 2025): everything lives under `legacy`. |
| `about-account.json` | `AboutAccountQuery`: `account_based_in: "India"`, `source: "India Android App"`, 4 username changes, blue-verified. |
| `about-account-region-web.json` | `AboutAccountQuery`: region-level `account_based_in: "South Asia"`, `location_accurate: false`, `source: "Web"`, `username_changes` with no `last_changed_at_msec`. |
| `about-account-affiliate.json` | `AboutAccountQuery`: `affiliate_username` plus `affiliates_highlighted_label` / `identity_profile_labels_highlighted_label`, `source: "United States App Store"`. |
| `src/gen.py` | Generator script. Rerun it to change values. `src/mock/` holds the real upstream captures used as reference. |

## Layout timeline (User object)

| Era | Evidence | Shape |
|---|---|---|
| **v1** (≤ 2025-03) | twscrape mock @`3e30c37499` (2025-03-07) | Everything is in `legacy` (`screen_name`, `name`, `created_at`, `location`, `profile_image_url_https`, `following`, `can_dm`, `verified`, counts). The top level holds only `__typename, id, rest_id, is_blue_verified, profile_image_shape, affiliates_highlighted_label, professional, tipjar_settings, …`. |
| **v2 hybrid** (by 2025-H2 → 2026-07-21) | mocks @`b22da800cb` (2026-05-21) … @`8ce44e44e0` (2026-07-21) | `core{name,screen_name,created_at}`, `avatar.image_url`, `location.location`, `privacy.protected`, `verification{verified,verified_type}`, `relationship_perspectives{following,followed_by,blocking,blocked_by,muting}`, `dm_permissions.can_dm`, `media_permissions.can_media_tag`, `profile_bio.description`. `legacy` still holds the counts, `description`, `entities`, `url`, `profile_banner_url` and `pinned_tweet_ids_str`, but **no** `screen_name`, `name`, `created_at`, `location`, `profile_image_url_https` or `following`. The exact date this started is unconfirmed: twscrape had no mock between 2025-03 and 2026-05, and the community reported it around mid-2025. |
| **v3 no-legacy** (2026-08-06 →) | mock @`b71007c912` (2026-08-06, current HEAD) | The User `legacy` key is **absent** (twscrape also handles `legacy: null`). The new objects are `relationship_counts{followers,following}`, `tweet_counts{tweets,media_tweets}`, `action_counts{favorites_count}`, `banner.image_url`, `website.url`, `pinned_items.tweet_ids_str`, `profile_bio{description,entities}`, `profile_metadata.profile_interstitial_type`, `profile_translation.translator_type`, `notifications_settings.notifications_enabled`, `relationship_perspectives.live_following`, and top-level `possibly_sensitive` and `follow_request_sent`. |

**Tweet objects still have `legacy`** in every capture up to the current one (2026-08-06), with
`full_text`, `lang`, `conversation_id_str`, `in_reply_to_*`, `user_id_str` and counts. twscrape's
code comment says "Since 2026-05 X serves Tweet/User with legacy=null. Tweet fields moved to the
top level", and its `_flatten_tweet_v2` reads `full_text` and the other fields from the top level when
`legacy` is null. A robust parser should read `tweet.legacy?.X ?? tweet.X`.

### Edge cases seen in the wild
- **User stub** (twscrape #342, 2026-10-03): `{"__typename":"User","rest_id":…,"id":…,"action_counts":{…},"affiliates_highlighted_label":{},"profile_image_shape":"Circle",…}` with **no `core` and no `legacy`**. It shows up as the author of a retweeted or quoted tweet and is temporary. Skip it, or fall back to `entities.user_mentions` / `quoted_status_permalink`.
- `UserUnavailable` (`{"__typename":"UserUnavailable","reason":…,"message":…}`) and `TweetTombstone` / `TweetUnavailable` results.
- `TweetWithVisibilityResults`: the real tweet is at `.tweet` and siblings are `limitedActionResults`, `tweetInterstitial` and `mediaVisibilityResults`. Always unwrap it before reading `core` or `legacy`.
- A `location` that is not a dict (old) vs `{location: "…"}` (new). twscrape handles both.
- Empty-string defaults: do not treat `""` as present when falling back from legacy to the new paths (twscrape #309).

## Field map (old path → new path), relative to `user_results.result`

| Meaning | v1 (legacy) | v2 hybrid | v3 (current) |
|---|---|---|---|
| handle | `legacy.screen_name` | `core.screen_name` | `core.screen_name` |
| display name | `legacy.name` | `core.name` | `core.name` |
| created | `legacy.created_at` | `core.created_at` | `core.created_at` |
| avatar | `legacy.profile_image_url_https` | `avatar.image_url` | `avatar.image_url` |
| banner | `legacy.profile_banner_url` | `legacy.profile_banner_url` | `banner.image_url` |
| location | `legacy.location` (string) | `location.location` | `location.location` |
| bio | `legacy.description` | `legacy.description` / `profile_bio.description` | `profile_bio.description` |
| bio/url entities | `legacy.entities` | `legacy.entities` | `profile_bio.entities` |
| website | `legacy.url` | `legacy.url` | `website.url` |
| I follow them | `legacy.following` | `relationship_perspectives.following` | same |
| follows me | `legacy.followed_by` | `relationship_perspectives.followed_by` | same |
| blocking / blocked_by / muting | `legacy.blocking` / `legacy.blocked_by` / `legacy.muting` | `relationship_perspectives.*` | same |
| protected | `legacy.protected` | `privacy.protected` | `privacy.protected` |
| legacy verified | `legacy.verified` | `verification.verified` | same |
| verified_type (Business/Government) | `legacy.verified_type` | `verification.verified_type` | same |
| blue check | `is_blue_verified` (top) | same | same |
| can DM | `legacy.can_dm` | `dm_permissions.can_dm` | same |
| can media tag | `legacy.can_media_tag` | `media_permissions.can_media_tag` | same |
| followers | `legacy.followers_count` | `legacy.followers_count` | `relationship_counts.followers` |
| following count | `legacy.friends_count` | `legacy.friends_count` | `relationship_counts.following` |
| tweets | `legacy.statuses_count` | `legacy.statuses_count` | `tweet_counts.tweets` |
| media | `legacy.media_count` | `legacy.media_count` | `tweet_counts.media_tweets` |
| likes | `legacy.favourites_count` | `legacy.favourites_count` | `action_counts.favorites_count` (note the US spelling) |
| listed | `legacy.listed_count` | `legacy.listed_count` | **not seen in v3 captures** |
| pinned | `legacy.pinned_tweet_ids_str` | `legacy.pinned_tweet_ids_str` | `pinned_items.tweet_ids_str` |
| default avatar flag | `legacy.default_profile_image` | `legacy.default_profile_image` | **not seen in v3** (infer it from `avatar.image_url` containing `default_profile_images`) |
| interstitial | `legacy.profile_interstitial_type` | same | `profile_metadata.profile_interstitial_type` |
| translator_type | `legacy.translator_type` | same | `profile_translation.translator_type` |

Tweet: `tweet_results.result` (unwrap `TweetWithVisibilityResults.tweet`) → `legacy.{full_text, lang,
conversation_id_str, in_reply_to_status_id_str, in_reply_to_user_id_str, in_reply_to_screen_name,
user_id_str, created_at, display_text_range, entities, *_count}`. `source` (an HTML `<a>`) and `views{count,state}`
are top-level. The long text is in `note_tweet.note_tweet_results.result.text`, and `legacy.full_text` is then
truncated to about 275 characters plus `…`. The author is at `core.user_results.result`.

AboutAccountQuery: `data.user_result_by_screen_name.result` → `about_profile.{account_based_in, location_accurate,
created_country_accurate, source, affiliate_username, learn_more_url, username_changes{count,last_changed_at_msec}}`,
`verification_info.{is_identity_verified, reason.verified_since_msec}`, plus `core`, `avatar`, `privacy`,
`verification`, `is_blue_verified` and `profile_image_shape`. Variables: `{"screenName":"<handle>"}`. twscrape sends
features `{"responsive_web_graphql_timeline_navigation_enabled": true}`. The call is GET and requires a logged-in session.

## Confidence

**Confident** (seen verbatim in a 2026 real capture):
- User (v2/v3): `__typename, id, rest_id, core{created_at,name,screen_name}, avatar.image_url, location.location, privacy.protected, verification{verified,verified_type}, relationship_perspectives{following,followed_by,blocking,blocked_by,muting,live_following}, dm_permissions.can_dm, media_permissions.can_media_tag, is_blue_verified, profile_image_shape, profile_bio{description,entities}, relationship_counts{followers,following}, tweet_counts{tweets,media_tweets}, action_counts.favorites_count, banner.image_url, website.url, pinned_items.tweet_ids_str, profile_metadata, profile_translation, notifications_settings, affiliates_highlighted_label.label{badge.url,description,url{url,urlType},userLabelDisplayType,userLabelType}, professional{rest_id,professional_type,category[]}, verification_info.reason{verified_since_msec, description{text,entities}}`.
- about_profile: `account_based_in, affiliate_username, created_country_accurate, learn_more_url, location_accurate, source, username_changes{count,last_changed_at_msec}`. `count` and `*_msec` are **strings**. `verification_info{id,is_identity_verified,reason.verified_since_msec}` and `identity_profile_labels_highlighted_label` are also confirmed.
- Tweet: `legacy{bookmark_count,bookmarked,conversation_id_str,created_at,display_text_range,entities,favorite_count,favorited,full_text,id_str,in_reply_to_screen_name,in_reply_to_status_id_str,in_reply_to_user_id_str,is_quote_status,lang,quote_count,reply_count,retweet_count,retweeted,user_id_str}`, top-level `source, views{count,state}, edit_control, is_translatable, has_birdwatch_notes, grok_translated_post_with_availability, quick_promote_eligibility, unmention_data`.
- Timeline: `TimelineAddEntries.entries[].{entryId,sortIndex,content{entryType,__typename,itemContent|items|value}}`, `TimelineTimelineModule{displayType:"VerticalConversation",items[].{entryId,item{itemContent,clientEventInfo}},metadata.conversationMetadata{allTweetIds,enableDeduplication}}`, `TimelineTweet{itemType,tweetDisplayType,tweet_results.result}`, cursor `{cursorType:"Top"|"Bottom",value}`.

**Schema-documented, not seen in a 2026 capture** (twitter-openapi): `TweetWithVisibilityResults{tweet,limitedActionResults.limited_actions[].action,tweetInterstitial,mediaVisibilityResults}`, `note_tweet{is_expandable,note_tweet_results.result{id,text,entity_set,richtext,media}}`, `promotedMetadata` (typed only as `object`), `parody_commentary_fan_label`.

**Unsure or reconstructed from memory**:
- `promotedMetadata` inner keys (`advertiser_results, adMetadataContainer, disclosureType, experimentValues, impressionId, impressionString, clickTrackingInfo`) and the `promoted-tweet-<id>-<hex>` entryId format. The safe signals are an entryId starting with `promoted-` or the presence of `itemContent.promotedMetadata`.
- The `limited_actions[].prompt` inner shape (`CtaLimitedActionPrompt`, `cta_type`, `headline`, `subtext`).
- The HomeTimeline module entryId prefix `home-conversation-<id>` and its item ids (`…-tweet-<id>`). TweetDetail uses `conversationthread-<id>` (confirmed), and its root is `data.threaded_conversation_with_injections_v2.instructions`.
- `clientEventInfo.component` values (`following_in_network`, `suggest_ranked_organic_tweet`, `promoted`).
- The `source` string vocabulary. The confirmed real value is `"Web"`. The `"<Country> Android App"` / `"<Country> App Store"` format (e.g. `"Russian Federation Android App"`) comes from parsing code in `xaitax/x-account-location-device`. Older plain values such as `"Twitter for iPhone"` may also appear.
- Region values for `account_based_in` (from `xaitax` REGION_DATA): `Africa, Asia, Australasia, Caribbean, Central Asia, East Asia, East Asia & Pacific, Eastern Europe (Non-EU), Europe, North Africa, North America, Oceania, South America, South Asia, Southeast Asia, West Asia`. Pairing a region with `location_accurate:false` is my inference.
- Whether `username_changes` omits `last_changed_at_msec` when `count` is `"0"`.
- Whether Tweet `legacy` is really null in production yet (see above).

## Current queryIds (they rotate, so discover them at runtime)

| Operation | fa0311/TwitterInternalAPIDocument `docs/json/API.json` (file last commit 2026-09-24) | vladkens/twscrape `twscrape/api.py` (2026-09-22) | Other |
|---|---|---|---|
| HomeTimeline | `og4a4SdSF3WiQkkwaPCdPg` (GET) | – | twitter-openapi placeholder (2026-05-20): `7zlnp2TxC044W4C1ZUJMHw` |
| HomeLatestTimeline | `OQPHTgwczzp9RMAPt6BH9A` (GET) | – | twitter-openapi: `0dateTVgvXjpkf7kyBZy0g` |
| TweetDetail | `zoF7_t363wZyzylk-BLfZQ` (GET) | `XMOz5h24KAZ86qKffKTLdQ` | twitter-openapi: `oCon7R-cgWRFy6EfZjaKfg` |
| UserByScreenName | `KybxDj9RrADIITXlGG8kpw` (GET) | `Gb-d6r0vxPOADdG62OEBpQ` | twitter-openapi: `IGgvgiOx4QZndDHuD3x9TQ` |
| AboutAccountQuery | **not present** in API.json or twitter-openapi | `TzOG2twZEfhr9KmClvVVqA` | xaitax ext (2026-10-03): `XRqGa7EeokUU5kppkh13EA`; FxEmbed (2026-04-27, may be iOS): `zs_jFPFT78rBpXv9Z3U2YQ`; twitter-web-exporter comment (old): `zUnx-DLN9dkwOkNhTLySjg` |
| Following | `-Mn4uN7C-vxXBwUKtSwS6A` (GET) | `qGZZDF3mp91q7X22s3HxpA` | twitter-openapi: `F42cDX8PDFxkbjjq6JrM2w` |

Sources:
- https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/docs/json/API.json
- https://github.com/vladkens/twscrape/blob/main/twscrape/api.py
- https://github.com/fa0311/twitter-openapi/blob/main/src/config/placeholder.json
- https://github.com/xaitax/x-account-location-device/blob/main/extension/src/shared/constants.js

The two current sources disagree, probably because they scraped different bundles (legacy webpack
`/responsive-web/client-web/` vs the newer Vite `/x-web/` build) or different points in a rollout.
Either id may still be accepted, but nothing guarantees it. API.json also lists per-operation
`features` (HomeTimeline has about 40 flags).

## Discovering queryIds at runtime

Logged-in pages still load the webpack build: `https://abs.twimg.com/responsive-web/client-web/main.<hash>a.js`.
Since 2026-08-24 the chunk hash is **16 hex** characters instead of 7 (twscrape #327). Logged-out pages may get a Vite
build under `/x-web/` (`entry-client-logged-out`). Most operations are defined in `main.*.js`. Others sit in lazy
chunks (`bundle.<Name>.<hash>a.js`, `<n>.<hash>a.js`), whose hashes come from a `{<id>:"<hex>"}` map in the page or runtime.

The regexes twscrape uses (`scripts/update-gql-ops.py`):

```js
// webpack build
/queryId:["`]([^"`]+)["`],operationName:["`]([^"`]+)["`]/g
//   (twscrape uses the looser /queryId:[`"](.+?)[`"].+?operationName:[`"](.+?)[`"]/)
// Vite / relay-style build
/params:\{id:["`]([^"`]+)["`].+?name:["`]([^"`]+)["`].+?operationKind:["`]/g
// chunk hash map in the HTML / runtime chunk (7 or 16 hex chars)
/(\d+):"([0-9a-f]{16}|[0-9a-f]{7})"/g
```

The full module looks like `e.exports={queryId:"og4a4SdSF3WiQkkwaPCdPg",operationName:"HomeTimeline",operationType:"query",metadata:{featureSwitches:[…],fieldToggles:[…]}}`.
The `featureSwitches` array gives the names for the `features` param, and their values come from
`window.__INITIAL_STATE__.featureSwitch`.

The simpler option for an extension is to skip the bundle and **observe its own requests**: hook `fetch`/XHR in the
page world and match `/\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/([A-Za-z]+)/`. That gives both the live queryId and the live
response shape (twitter-web-exporter does this).
