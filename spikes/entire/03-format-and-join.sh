#!/bin/sh
# 03-format-and-join.sh — checkpoint format readability and the phax join (phase-04).
#
# Judges whether the entire/checkpoints/v1 format can back phax desktop's
# "inspect a run" screen, and whether a phase can be joined to its transcript
# deterministically. Five steps:
#
#   1. readability without the entire binary: read one checkpoint tree straight
#      out of git (`git show entire/checkpoints/v1:<path>`) — the decisive case
#      for desktop. A screen that must shell out to a third-party binary per run
#      is a dependency; one that reads git is not.
#   2. field inventory: the fields present in metadata.json and in one
#      transcript.jsonl record, to mark against what desktop needs (prompt text,
#      tool name, file paths touched, timestamps, token counts, model id).
#   3. format stability signals: the v1 in the branch name, any schema/version
#      field inside metadata.json, and whether records are append-only JSONL.
#   4. the join, both directions: phax's Run-Id / Phase-Id / Session-Id trailers
#      against entire's Entire-Checkpoint / Entire-Session for every commit in
#      the run, plus the reverse walk from the shadow branch back to commits.
#   5. size per run, so the desktop screen's cost is known.
#
# Read-only and human-run, from the repo root, after the observed phax run.
# It assumes checkpoints exist (phase-03's question) and only reads git state.
# It never pushes, enables, or reconfigures anything. It never prints raw
# transcript record content — field names, shapes and sizes only; metadata.json
# is printed whole, so redact its values before pasting into the findings doc.
#
# jq is optional: with it the field inventories are exact; without it the
# script falls back to sizes and a manual-inspection note.
#
# Usage:
#   sh spikes/entire/03-format-and-join.sh CHECKPOINT [SHORT_NAME] [BASE_REF]
#
#   CHECKPOINT   a checkpoint id (from an Entire-Checkpoint trailer), or a
#                commit ref whose Entire-Checkpoint trailer supplies the id;
#                used for the deep read in steps 1-3
#   SHORT_NAME   the run's short name for the join table
#                (default: entire-checkpoint-spike); run branch phax/<SHORT_NAME>
#   BASE_REF     the branch the run merged into (default: main); scanned for
#                squash-merge commits that collapse several trailers onto one
set -eu

if [ $# -lt 1 ]; then
  echo "usage: sh $0 CHECKPOINT [SHORT_NAME] [BASE_REF]" >&2
  exit 2
fi
arg=$1
short_name=${2:-entire-checkpoint-spike}
base=${3:-main}
shadow=entire/checkpoints/v1

git rev-parse --verify --quiet "$shadow" >/dev/null || {
  echo "ERROR: $shadow does not exist — nothing to read (run probe 02 first)" >&2
  exit 1
}

section() {
  printf '\n== %s ==\n' "$1"
}

trailer() { # trailer SHA KEY -> value(s), one per line
  git log -1 "$1" --format="%(trailers:key=$2,valueonly,separator=%x0a)"
}

have_jq=0
command -v jq >/dev/null 2>&1 && have_jq=1
[ "$have_jq" = 1 ] || echo "note: jq not found — field inventories degrade to sizes only"

# Resolve CHECKPOINT: accept a raw id, or a commit ref carrying the trailer.
if git rev-parse --verify --quiet "$arg^{commit}" >/dev/null; then
  checkpoint="$(trailer "$arg" Entire-Checkpoint | head -1)"
  [ -n "$checkpoint" ] || {
    echo "ERROR: commit $arg carries no Entire-Checkpoint trailer" >&2
    exit 1
  }
  echo "resolved commit $arg -> checkpoint $checkpoint"
else
  checkpoint=$arg
fi
prefix="$(printf '%s' "$checkpoint" | cut -c1-2)"
rest="$(printf '%s' "$checkpoint" | cut -c3-)"
cp_dir="$prefix/$rest"

# --- step 1: readability without the entire binary ----------------------------
section "step 1: raw-git read of checkpoint $checkpoint"
echo "tree path: $shadow:$cp_dir/ (shape confirmed by probe 02, cited not re-derived)"
for f in metadata.json 0/full.jsonl 0/transcript.jsonl 0/prompt.txt; do
  path="$cp_dir/$f"
  if git cat-file -e "$shadow:$path" 2>/dev/null; then
    size="$(git cat-file -s "$shadow:$path")"
    echo "  $path: present, $size bytes"
  else
    echo "  $path: ABSENT"
  fi
done
echo "--- metadata.json (whole file — REDACT VALUES before pasting) ---"
git show "$shadow:$cp_dir/metadata.json" 2>/dev/null | sed 's/^/  /' \
  || echo "  (unreadable)"
echo "--- prompt.txt: first line's length only (content not printed) ---"
git show "$shadow:$cp_dir/0/prompt.txt" 2>/dev/null | head -1 | wc -c \
  | awk '{ printf "  first line: %d bytes\n", $1 }'
echo "(readable-from-git verdict: everything above came from git alone; the"
echo " entire binary was never invoked)"

# --- step 2: field inventory --------------------------------------------------
section "step 2: field inventory"
if [ "$have_jq" = 1 ]; then
  echo "--- metadata.json: keys (recursive paths) ---"
  git show "$shadow:$cp_dir/metadata.json" \
    | jq -r 'paths(scalars) | join(".")' | sort | sed 's/^/  /'
  echo "--- transcript.jsonl: first record's top-level keys (values not printed) ---"
  git show "$shadow:$cp_dir/0/transcript.jsonl" | head -1 \
    | jq -r 'keys[]' | sed 's/^/  /'
  echo "--- transcript.jsonl: distinct record 'type' values and counts ---"
  git show "$shadow:$cp_dir/0/transcript.jsonl" \
    | jq -r '.type // "«no type field»"' | sort | uniq -c | sed 's/^/  /'
else
  echo "  jq absent — inspect metadata.json and the first transcript.jsonl"
  echo "  record by hand and list their field names in the findings doc"
fi
echo "Desktop needs (mark each present/absent in the findings inventory table):"
echo "  prompt text, tool name per call, file paths touched, timestamps,"
echo "  token counts, model id"

# --- step 3: format stability signals -----------------------------------------
section "step 3: format stability signals"
echo "  branch name carries a version: $shadow (the v1)"
echo "--- version/schema fields inside metadata.json ---"
git show "$shadow:$cp_dir/metadata.json" \
  | grep -iE '"(version|schema|format)[^"]*"' | sed 's/^/  /' \
  || echo "  (no field named *version*/*schema*/*format* in metadata.json)"
echo "--- transcript.jsonl: line-wise JSON validity (append-only JSONL signal) ---"
lines="$(git show "$shadow:$cp_dir/0/transcript.jsonl" | grep -c . || true)"
if [ "$have_jq" = 1 ]; then
  valid="$(git show "$shadow:$cp_dir/0/transcript.jsonl" \
    | jq -c . 2>/dev/null | grep -c . || true)"
  echo "  $valid of $lines non-empty lines parse as standalone JSON"
else
  echo "  $lines non-empty lines (jq absent — validity not checked)"
fi
echo "--- shadow branch history: append-only across the run? ---"
echo "  (a rewritten shadow branch would show non-linear history or force moves)"
git log "$shadow" --format='  %h %s' | head -10

# --- step 4: the join, both directions ----------------------------------------
section "step 4: phase <-> transcript join"
run_branch="phax/$short_name"
git rev-parse --verify --quiet "$run_branch" >/dev/null || run_branch=$short_name
if ! git rev-parse --verify --quiet "$run_branch" >/dev/null; then
  echo "  neither phax/$short_name nor $short_name resolves — skipping the join"
else
  # Same fully-merged fallback as probe 02: after the merge, base..branch is empty.
  range_base="$(git merge-base "$base" "$run_branch" 2>/dev/null || true)"
  if [ -n "$range_base" ] && [ "$range_base" != "$(git rev-parse "$run_branch")" ]; then
    run_commits="$(git rev-list --reverse --first-parent "$range_base..$run_branch")"
  else
    run_commits="$(git rev-list --reverse --first-parent "$run_branch" -n 20)"
    echo "  note: $run_branch fully merged — walking its last 20 first-parent commits"
  fi
  echo "--- forward: phase commit -> checkpoint (one row per run-branch commit) ---"
  printf '%s\n' "  sha        Phase-Id      Session-Id                            Entire-Checkpoint       Entire-Session"
  for sha in $run_commits; do
    printf '  %s  %-12s  %-36s  %-22s  %s\n' \
      "$(git rev-parse --short "$sha")" \
      "$(trailer "$sha" Phase-Id | head -1)" \
      "$(trailer "$sha" Session-Id | head -1)" \
      "$(trailer "$sha" Entire-Checkpoint | head -1)" \
      "$(trailer "$sha" Entire-Session | head -1)"
  done
  echo "  (forward join is deterministic iff every Phase-Id row has exactly one"
  echo "   Entire-Checkpoint; blank cells break it)"

  echo "--- reverse: checkpoint -> phase commit (one row per shadow-branch tree) ---"
  # Checkpoint dirs are the two-level <xx>/<rest> prefixes holding a metadata.json.
  git ls-tree -r --name-only "$shadow" | grep '/metadata.json$' \
    | sed 's|/metadata.json$||' | sort -u | while IFS= read -r dir; do
    id="$(printf '%s' "$dir" | tr -d '/')"
    if [ "$have_jq" = 1 ]; then
      cp_session="$(git show "$shadow:$dir/metadata.json" \
        | jq -r '.. | objects | to_entries[] | select(.key | test("session"; "i")) | .value' \
        2>/dev/null | head -1)"
    else
      cp_session="«jq absent — read $dir/metadata.json by hand»"
    fi
    matches="$(git log "$run_branch" --format='%h' \
      --grep="Entire-Checkpoint: $id" 2>/dev/null | tr '\n' ' ')"
    echo "  $id  session:${cp_session:-—}  run-branch commit(s): ${matches:-NONE}"
  done
  echo "  (reverse join is deterministic iff every checkpoint maps back to exactly"
  echo "   one commit; NONE or multiple shas break it)"

  echo "--- known join-breakers to check ---"
  echo "  squash merge collapsing several checkpoints onto one $base commit:"
  found_multi=0
  for sha in $(git rev-list "$base" -n 30); do
    n="$(trailer "$sha" Entire-Checkpoint | grep -c . || true)"
    [ "$n" -gt 1 ] || continue
    found_multi=1
    echo "    $(git rev-parse --short "$sha") carries $n Entire-Checkpoint trailers"
  done
  [ "$found_multi" = 1 ] || echo "    (no multi-trailer commit in $base's last 30)"
  echo "  phase Session-Id with no matching Entire-Session, and a resumed session"
  echo "  spanning two phases (fix loop): read them off the forward table above"
fi

# --- step 5: size per run -----------------------------------------------------
section "step 5: size per run (desktop screen cost)"
git ls-tree -r --name-only "$shadow" | grep '/metadata.json$' \
  | sed 's|/metadata.json$||' | sort -u | while IFS= read -r dir; do
  bytes="$(git ls-tree -r -l "$shadow" -- "$dir" \
    | awk '{ total += $4 } END { printf "%d", total }')"
  echo "  $(printf '%s' "$dir" | tr -d '/'): $bytes bytes"
done
git ls-tree -r -l "$shadow" \
  | awk '{ total += $4; n += 1 }
         END { printf "  all checkpoints: %d files, %d uncompressed bytes\n", n, total }'

printf '\nprobe complete (read-only; nothing was modified, no entire invocation)\n'
