#!/usr/bin/env bash
# Deploy merged master's backend/ to its production home: the x-account-backend container on nas.
#
#   scripts/deploy-backend.sh           fast-forward the nas checkout to origin/master, build, swap, verify
#   scripts/deploy-backend.sh --status  print the checkout SHA and the SHA /api/health reports
#
# Contract (dotfiles shipping.md "Production deploy contract"):
#   1. refuse (tracked edits, off master, HEAD not an ancestor of origin/master) before touching anything;
#      never reset/stash/clean to force a deploy through
#   2. fast-forward only, to the exact SHA that was checked
#   3. build the new image (tagged with the SHA, GIT_SHA baked in) BEFORE stopping the old container,
#      then swap and require /api/health to report that SHA (HTTP 200 alone is not proof)
#   4. on failure: one Telegram alert, and the previous image is put back
set -euo pipefail

# Braced so bash parses the whole script before the fast-forward below can rewrite this file.
{

SERVICE=x-account-backend
HEALTH_URL="${SFX_HEALTH_URL:-http://127.0.0.1:3004/api/health}"
NOTIFY="$HOME/dev/dotfiles/lib/telegram-notify.sh"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-}"

die() { echo "deploy-backend: $*" >&2; exit 1; }

[[ "$(hostname -s)" == nas ]] || die "deploys only on nas (production home)"

health_sha() { curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -o '"sha":"[^"]*"' | cut -d'"' -f4; }

cd "$REPO"
if [[ "$mode" == --status ]]; then
	echo "checkout: $(git rev-parse HEAD)"
	echo "health:   $(health_sha || true)"
	exit 0
fi
[[ -z "$mode" ]] || die "unknown argument: $mode"

# 1. Refuse before any fetch-dependent work, build, stop or restart.
[[ "$(git branch --show-current)" == master ]] || die "$REPO is not on master"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "$REPO has tracked edits; move them to a branch"
git fetch --quiet origin master
target="$(git rev-parse origin/master)"
git merge-base --is-ancestor HEAD "$target" || die "HEAD $(git rev-parse --short HEAD) is not an ancestor of origin/master"

short="${target:0:12}"
swapped=0
prev_image=""
fail() {
	local msg="spam-filter-for-x backend deploy of $short failed on nas: $1"
	echo "deploy-backend: $msg" >&2
	if [[ "$swapped" == 1 && -n "$prev_image" ]]; then
		echo "deploy-backend: restoring previous image $prev_image" >&2
		IMAGE_TAG=rollback docker compose -f backend/docker-compose.yml up -d --no-build --force-recreate "$SERVICE" >&2 ||
			msg="$msg; ROLLBACK FAILED"
	fi
	"$NOTIFY" --dedupe "spam-filter-deploy-$target" "$msg" >/dev/null 2>&1 || echo "deploy-backend: telegram alert failed" >&2
	exit 1
}

# 2. Fast-forward to exactly the SHA that was checked.
git merge --quiet --ff-only "$target" || fail "fast-forward to $short refused"

# 3. Build first; the running container keeps serving until the new image exists.
export IMAGE_TAG="$target" GIT_SHA="$target"
docker compose -f backend/docker-compose.yml build "$SERVICE" || fail "image build failed (old container untouched)"

prev_image="$(docker inspect -f '{{.Image}}' "$SERVICE" 2>/dev/null || true)"
[[ -z "$prev_image" ]] || docker tag "$prev_image" "$SERVICE:rollback" || fail "could not tag previous image"

swapped=1
docker compose -f backend/docker-compose.yml up -d --no-build --force-recreate "$SERVICE" || fail "container swap failed"

got=""
for _ in $(seq 1 30); do
	got="$(health_sha || true)"
	[[ "$got" == "$target" ]] && break
	sleep 1
done
[[ "$got" == "$target" ]] || fail "/api/health reports sha '${got:-none}', expected $target"

echo "deploy-backend: $SERVICE running $target (health verified)"
exit 0
}
