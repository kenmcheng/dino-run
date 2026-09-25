#!/usr/bin/env bash
# Ship a merge to main: sync the board project's wiki from README.md at the
# merged commit, then close every ticket this push landed. Replaces the PM
# cron's JOB B (which synced wikis, built/pushed images, and closed tickets
# from its own possibly-stale local working tree) -- see
# board task 1009. Images are already published by each
# repo's own `build` job; this script never touches docker.
#
# The ship signal is the `ship:done` / `ship:pending` LABEL, never a comment
# marker. A comment is free prose, and a consumer that greps ticket text for
# a magic string will eventually match its own (or another agent's) prose
# about that string -- see board task 1173, where the PM's
# own "still absent" correction comments re-triggered the retired HTML-comment
# marker this script used to embed, and looped a ticket between closed and
# reopened six times. This script posts human-readable "Shipped"/"pending"
# comments for people to read, but never reads them back, and no comment body
# carries a control marker of any kind.
#
# A rejected board write must be visible, not swallowed as a silent
# ::warning:: with exit 0 -- that is the exact regression of ticket #976
# board task 976.
#
# Usage: ship.sh (no args, entirely env-driven so ship_test.sh can drive it)
# Required env: TASKSMITH_KEY, SHIP_REPO, SHIP_SHA, TASKSMITH_URL
#   (TASKSMITH_URL is board-instance-specific, so CI passes it from the
#    Actions variable rather than this script guessing a default)
# Optional env: SHIP_BEFORE, SHIP_LOOKBACK (default 100),
#   SHIP_RUN_URL, SHIP_RUN_NUMBER, SHIP_PROJECT_ID, SHIP_POLL_TRIES (default 10),
#   SHIP_POLL_SLEEP (default 15, seconds)
set -uo pipefail

TASKSMITH_URL="${TASKSMITH_URL:?required - CI passes it from the TASKSMITH_URL Actions variable}"
AUTH="Authorization: Bearer $TASKSMITH_KEY"
API="$TASKSMITH_URL/api"

SHIP_REPO="${SHIP_REPO:?set SHIP_REPO}"
SHIP_SHA="${SHIP_SHA:?set SHIP_SHA}"
SHIP_BEFORE="${SHIP_BEFORE:-}"
SHIP_LOOKBACK="${SHIP_LOOKBACK:-100}"
SHIP_RUN_URL="${SHIP_RUN_URL:-}"
# CI passes this explicitly; GITHUB_RUN_NUMBER is the runner's own copy and keeps the
# "#N" label working even if a repo's ci.yml has not been updated yet.
SHIP_RUN_NUMBER="${SHIP_RUN_NUMBER:-${GITHUB_RUN_NUMBER:-}}"
SHIP_PROJECT_ID="${SHIP_PROJECT_ID:-}"
SHIP_POLL_TRIES="${SHIP_POLL_TRIES:-10}"
SHIP_POLL_SLEEP="${SHIP_POLL_SLEEP:-15}"

FAILED=0

trailer_nums() { grep -oE '^Task: .*/tasks/[0-9]+' | grep -oE '[0-9]+$' | sort -un; }

# The run link shared by every board comment below. The verdict comments in ci.yml render
# "[run #N]"; match them when the number is known, and emit nothing at all when the script
# runs outside CI (no URL) rather than a dead "[run]()".
if [ -z "$SHIP_RUN_URL" ]; then
  RUN_LINK=""
elif [ -n "$SHIP_RUN_NUMBER" ]; then
  RUN_LINK="[run #$SHIP_RUN_NUMBER]($SHIP_RUN_URL)"
else
  RUN_LINK="[run]($SHIP_RUN_URL)"
fi

slugify() {
  # lower-case, every run of non-alphanumerics -> '-', trimmed
  printf %s "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

json_field() {
  # json_field <field> reads a JSON object from stdin, prints string field $1 (or "")
  node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      let v; try { v = JSON.parse(s)[process.argv[1]]; } catch (e) { v = ""; }
      process.stdout.write(v || "");
    });
  ' "$1"
}

json_labels() {
  # json_labels reads a JSON task object from stdin, prints its "labels"
  # array newline-separated (nothing if absent/not an array).
  node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      let v; try { v = JSON.parse(s).labels; } catch (e) { v = []; }
      if (!Array.isArray(v)) v = [];
      for (const l of v) process.stdout.write(l + "\n");
    });
  '
}

bulk_label() {
  # bulk_label <task> <add-or-""> <remove-or-""> -> echoes "" on success
  # (including a no-op "changed":false) or an error string on rejection.
  # Modeled line-for-line on report-ci-verdict.sh's bulk-envelope parsing:
  # read the body on every HTTP status (a rejected single-id batch answers
  # 422/500 with the same envelope, per board task 1061), prefer
  # results[0].error then the top-level error, and treat a non-2xx status
  # with no error detail in the body as a rejection too.
  local n="$1" add="$2" remove="$3"
  local payload raw http_code resp err
  payload=$(node -e '
    const [n, add, remove] = process.argv.slice(1);
    const o = {ids: [n]};
    if (add) o.add_label = add;
    if (remove) o.remove_label = remove;
    console.log(JSON.stringify(o));
  ' "$n" "$add" "$remove")
  if ! raw=$(curl -s -w '\n%{http_code}' -X POST -H "$AUTH" -H "Content-Type: application/json" -d "$payload" "$API/tasks/bulk"); then
    echo "network failure"
    return
  fi
  http_code=$(printf %s "$raw" | tail -n1)
  resp=$(printf %s "$raw" | sed '$d')
  err=$(printf %s "$resp" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      let err="unparseable bulk response";
      try {
        const r = JSON.parse(s);
        const item = (r.results||[])[0];
        err = item ? (item.error||"") : (r.error||"empty bulk results");
      } catch (e) {}
      process.stdout.write(err);
    })')
  if [ -n "$err" ]; then
    echo "$err"
  elif [[ "$http_code" =~ ^2 ]]; then
    echo ""
  else
    echo "HTTP $http_code, no error detail in body"
  fi
}

# --- step 1: resolve the board project -------------------------------------
PROJECT_ID="$SHIP_PROJECT_ID"
if [ -z "$PROJECT_ID" ]; then
  PROJECTS_JSON=$(curl -sf -H "$AUTH" "$API/projects") || { echo "::error::board write rejected: GET $API/projects failed"; FAILED=1; }
  if [ "$FAILED" -eq 0 ]; then
    WANT_SLUG=$(slugify "$SHIP_REPO")
    PROJECT_ID=$(printf %s "$PROJECTS_JSON" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        const want=process.argv[1];
        const slug=n=>n.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
        const list=(JSON.parse(s).projects||[]);
        const hit=list.find(p=>slug(p.name)===want);
        if (hit) process.stdout.write(hit.id);
      });
    ' "$WANT_SLUG")
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  echo "::error::wiki sync failed; skipping ticket closure entirely"
  exit 1
fi

if [ -z "$PROJECT_ID" ]; then
  echo "::warning::no board project matches $SHIP_REPO; wiki not synced"
else
  # --- step 2: sync the wiki -------------------------------------------------
  if [ ! -f README.md ]; then
    echo "no README.md in $SHIP_REPO; wiki sync skipped"
  else
    PROJ_JSON=$(curl -sf -H "$AUTH" "$API/projects/$PROJECT_ID") || { echo "::error::board write rejected: GET $API/projects/$PROJECT_ID failed"; FAILED=1; }
    if [ "$FAILED" -eq 0 ]; then
      CURRENT_DOC_FILE=$(mktemp)
      printf %s "$PROJ_JSON" | node -e '
        let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
          process.stdout.write(JSON.parse(s).doc || "");
        });
      ' > "$CURRENT_DOC_FILE"
      if cmp -s README.md "$CURRENT_DOC_FILE"; then
        echo "project doc already matches README.md; skipping write"
      else
        PATCH_PAYLOAD=$(node -e '
          const fs = require("fs");
          console.log(JSON.stringify({doc: fs.readFileSync("README.md", "utf8")}));
        ')
        if curl -sf -X PATCH -H "$AUTH" -H "Content-Type: application/json" -d "$PATCH_PAYLOAD" "$API/projects/$PROJECT_ID" >/dev/null; then
          echo "board: synced wiki for $SHIP_REPO"
        else
          echo "::error::board write rejected: could not PATCH project $PROJECT_ID doc"
          FAILED=1
        fi
      fi
      rm -f "$CURRENT_DOC_FILE"
    fi
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  echo "::error::wiki sync failed; skipping ticket closure entirely"
  exit 1
fi

# --- step 3: find every ticket recent main history landed -------------------
# `github.event.before..github.sha` is not a safe window. Forgejo cancels an
# in-flight run when a newer push lands on the same ref (board task 1200:
# bellwether runs 90 and 92, 2026-08-01), and it skips `ship` outright when an
# upstream job fails (tasksmith runs 76 and 87). Either way that push's ship
# never executes -- and the NEXT push's `before` is the *lost* push's head, not
# the last shipped one, so nothing ever covers those commits again. Walk a
# bounded window of main instead: an already-`closed` ticket costs one GET and
# is skipped, so the overlap is free.

# tasks landed by THIS push -- the only ones worth waiting on (see below)
if [ -n "$SHIP_BEFORE" ] && [ "$SHIP_BEFORE" != "0000000000000000000000000000000000000000" ] \
   && git cat-file -e "${SHIP_BEFORE}^{commit}" 2>/dev/null; then
  OWN_TASKS=$(git log --format=%B "$SHIP_BEFORE..$SHIP_SHA" | trailer_nums)
else
  OWN_TASKS=$(git log --format=%B -1 "$SHIP_SHA" | trailer_nums)
fi

# every task in the recovery window -> the newest commit that landed it.
# rev-list is newest-first, so awk's first-seen wins.
TASK_MAP=$(
  for C in $(git rev-list -n "$SHIP_LOOKBACK" "$SHIP_SHA"); do
    git log -1 --format=%B "$C" | trailer_nums | sed "s|\$| $C|"
  done | awk '!seen[$1]++' | sort -n
)

if [ -z "$TASK_MAP" ]; then
  echo "no Task: trailers in the last $SHIP_LOOKBACK commits; nothing to close"
  exit 0
fi

# --- step 4: close each ticket ----------------------------------------------
while read -r N C; do
  [ -z "$N" ] && continue
  SHA12="${C:0:12}"          # the commit that landed THIS ticket, not the push head
  # Only wait on tickets this push actually landed. A ticket recovered from an
  # older, lost push has had its chance to reach `done`; polling it would add
  # SHIP_POLL_TRIES*SHIP_POLL_SLEEP (150s by default) to EVERY ship run, forever.
  if printf '%s\n' "$OWN_TASKS" | grep -qxF "$N"; then
    TRIES_LIMIT="$SHIP_POLL_TRIES"
  else
    TRIES_LIMIT=0
  fi

  RAW=$(curl -s -w '\n%{http_code}' -H "$AUTH" "$API/tasks/$N")
  CODE=$(printf %s "$RAW" | tail -1)
  BODY=$(printf %s "$RAW" | sed '$d')

  if [ "$CODE" = "404" ]; then
    echo "::error::Task: trailer points at nonexistent task $N"
    FAILED=1
    continue
  fi
  if ! [[ "$CODE" =~ ^2 ]]; then
    echo "::error::board write rejected: GET $API/tasks/$N -> $CODE"
    FAILED=1
    continue
  fi

  STATUS=$(printf %s "$BODY" | json_field status)

  if [ "$STATUS" = "closed" ]; then
    echo "task $N already closed; nothing to do"
    continue
  fi

  TRIES=0
  RETRY_FAILED=0
  while [ "$STATUS" != "done" ] && [ "$TRIES" -lt "$TRIES_LIMIT" ]; do
    TRIES=$((TRIES + 1))
    sleep "$SHIP_POLL_SLEEP"
    BODY=$(curl -sf -H "$AUTH" "$API/tasks/$N") || { echo "::error::board write rejected: GET $API/tasks/$N failed on retry"; FAILED=1; RETRY_FAILED=1; break; }
    STATUS=$(printf %s "$BODY" | json_field status)
  done
  [ "$RETRY_FAILED" -eq 1 ] && continue

  if [ "$STATUS" != "done" ]; then
    # Idempotency comes from the task's own labels (the last-fetched $BODY
    # above), never from grepping /comments -- see the header comment.
    LABELS=$(printf %s "$BODY" | json_labels)
    if printf '%s\n' "$LABELS" | grep -qxF "ship:pending"; then
      echo "task $N: already labelled ship:pending; not duplicating"
    else
      ERR=$(bulk_label "$N" "ship:pending" "")
      if [ -n "$ERR" ]; then
        echo "::error::board write rejected: could not set ship:pending on task $N: $ERR"
        FAILED=1
      else
        MSG="**Merged and shipped, not closed** — \`$SHA12\` is on \`main\` but this ticket is still at status \`$STATUS\`, not \`done\`, so Forgejo CI did not close it.${RUN_LINK:+ $RUN_LINK}"
        CBODY=$(node -e 'console.log(JSON.stringify({body:process.argv[1]}))' "$MSG")
        curl -sf -X POST -H "$AUTH" -H "Content-Type: application/json" -d "$CBODY" "$API/tasks/$N/comments" >/dev/null \
          || echo "::warning::could not post pending-ship comment on task $N"
      fi
    fi
    echo "::warning::task $N merged but not yet done (status=$STATUS); leaving open for the PM safety net"
    continue
  fi

  ERR=$(bulk_label "$N" "ship:done" "ship:pending")
  if [ -n "$ERR" ]; then
    echo "::error::board write rejected: could not set ship:done on task $N: $ERR"
    FAILED=1
    continue
  fi

  MSG="**Shipped** — \`$SHA12\` on \`main\` of \`$SHIP_REPO\`. Wiki synced from README.md · images published by the \`build\` job${RUN_LINK:+ · $RUN_LINK}. Closed automatically by Forgejo CI."
  CBODY=$(node -e 'console.log(JSON.stringify({body:process.argv[1]}))' "$MSG")
  if ! curl -sf -X POST -H "$AUTH" -H "Content-Type: application/json" -d "$CBODY" "$API/tasks/$N/comments" >/dev/null; then
    echo "::error::board write rejected: could not comment shipped on task $N"
    FAILED=1
    continue
  fi
  if curl -sf -X PATCH -H "$AUTH" -H "Content-Type: application/json" -d '{"status":"closed"}' "$API/tasks/$N" >/dev/null; then
    echo "board: closed task $N"
  else
    echo "::error::board write rejected: could not close task $N"
    FAILED=1
  fi
done <<<"$TASK_MAP"

exit "$FAILED"
