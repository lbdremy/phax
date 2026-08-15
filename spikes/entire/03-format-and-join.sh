#!/bin/sh
# 03-format-and-join.sh — checkpoint format readability and the phax join (phase-04).
#
# Judges whether the checkpoint format can back phax desktop's "inspect a run"
# screen, and whether a phase can be joined to its transcript deterministically.
# Five steps:
#
#   1. readability without the entire binary: read one checkpoint tree straight
#      out of git (`git show refs/entire/checkpoints/<xx>/<ULID>:<path>`) — the
#      decisive case for desktop. A screen that must shell out to a third-party
#      binary per run is a dependency; one that reads git is not.
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

# Storage model, verified against entire 0.10.0 (`checkpoints.primary.type:
# "git-refs"`): one ref PER CHECKPOINT at
#   refs/entire/checkpoints/<last-two-chars-of-ULID>/<ULID>
# with the tree at the ref root. There is no `entire/checkpoints/v1` branch and
# no <first-two>/<rest> subtree — that is the model entire's published docs
# describe and 0.10.0 does not use. The shard is the ULID's LAST two characters
# (…E30AGF -> GF/). That the shipped model and the documented model disagree at
# 0.10.0 is itself a step-3 stability finding: record it there.
cp_ns='refs/entire/checkpoints/**'
cp_ref() { # cp_ref ULID -> its ref path, or empty
  git for-each-ref --format='%(refname)' "$cp_ns" | grep -- "/$1\$" | head -1
}
cp_all() { # every checkpoint ref, one per line
  git for-each-ref --format='%(refname)' "$cp_ns"
}
[ "$(cp_all | grep -c . || true)" != 0 ] || {
  echo "ERROR: no refs under $cp_ns — nothing to read (run probe 02 first)" >&2
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
ref="$(cp_ref "$checkpoint")"
[ -n "$ref" ] || {
  echo "ERROR: checkpoint $checkpoint has no ref under $cp_ns" >&2
  exit 1
}

# --- step 1: readability without the entire binary ----------------------------
section "step 1: raw-git read of checkpoint $checkpoint"
echo "ref: $ref (shape confirmed by probe 02, cited not re-derived)"
for f in metadata.json 0/metadata.json 0/full.jsonl 0/transcript.jsonl 0/prompt.txt; do
  if git cat-file -e "$ref:$f" 2>/dev/null; then
    size="$(git cat-file -s "$ref:$f")"
    echo "  $f: present, $size bytes"
  else
    echo "  $f: ABSENT"
  fi
done
echo "--- checkpoint commit trailers (the join anchors) ---"
git log -1 "$ref" --format='  %(trailers)' | sed '/^\s*$/d'
echo "--- metadata.json (whole file — REDACT VALUES before pasting) ---"
git show "$ref:metadata.json" 2>/dev/null | sed 's/^/  /' \
  || echo "  (unreadable)"
echo "--- prompt.txt: first line's length only (content not printed) ---"
git show "$ref:0/prompt.txt" 2>/dev/null | head -1 | wc -c \
  | awk '{ printf "  first line: %d bytes\n", $1 }'
echo "(readable-from-git verdict: everything above came from git alone; the"
echo " entire binary was never invoked)"

# --- step 2: field inventory --------------------------------------------------
section "step 2: field inventory"
if [ "$have_jq" = 1 ]; then
  echo "--- metadata.json: keys (recursive paths) ---"
  git show "$ref:metadata.json" \
    | jq -r 'paths(scalars) | join(".")' | sort | sed 's/^/  /'
  echo "--- transcript.jsonl: first record's top-level keys (values not printed) ---"
  git show "$ref:0/transcript.jsonl" | head -1 \
    | jq -r 'keys[]' | sed 's/^/  /'
  echo "--- transcript.jsonl: distinct record 'type' values and counts ---"
  git show "$ref:0/transcript.jsonl" \
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
echo "  ref namespace carries no version marker: $cp_ns"
echo "  DOCUMENTED-VS-SHIPPED MISMATCH: entire's published docs describe a"
echo "  versioned 'entire/checkpoints/v1' branch; 0.10.0 writes an UNVERSIONED"
echo "  ref namespace instead. The layout moved without the layout's own version"
echo "  marker moving with it — so versioning lives in the payload (below), not"
echo "  in the storage path. A reader must open a checkpoint to learn how to"
echo "  read it. Weigh that in the format-stability verdict."
echo "--- version/schema fields inside metadata.json ---"
# Match the substring, not a key that *starts* with it: the field is
# "cli_version", which an anchored '"(version|…)' pattern silently misses and
# then reports as "no version field" — inverting the stability finding.
git show "$ref:metadata.json" \
  | grep -iE '"[^"]*(version|schema|format)[^"]*"' | sed 's/^/  /' \
  || echo "  (no field named *version*/*schema*/*format* in metadata.json)"
echo "--- per-record version marker in transcript.jsonl ---"
git show "$ref:0/transcript.jsonl" | head -1 \
  | grep -oE '"(v|cli_version)":[^,}]*' | sed 's/^/  /' \
  || echo "  (first record carries no per-record version marker)"
echo "--- transcript.jsonl: line-wise JSON validity (append-only JSONL signal) ---"
lines="$(git show "$ref:0/transcript.jsonl" | grep -c . || true)"
if [ "$have_jq" = 1 ]; then
  valid="$(git show "$ref:0/transcript.jsonl" \
    | jq -c . 2>/dev/null | grep -c . || true)"
  echo "  $valid of $lines non-empty lines parse as standalone JSON"
else
  echo "  $lines non-empty lines (jq absent — validity not checked)"
fi
echo "--- one commit per checkpoint ref? (immutability signal) ---"
echo "  (each ref should be a single commit; a ref with history means"
echo "   checkpoints get rewritten in place)"
echo "  $ref: $(git rev-list --count "$ref") commit(s)"

# --- step 4: the join, both directions ----------------------------------------
section "step 4: phase <-> transcript join"
run_branch="phax/$short_name"
git rev-parse --verify --quiet "$run_branch" >/dev/null || run_branch=$short_name
# Same pre-merge fallback as probe 02: until the run merges, phax/<short-name>
# still sits at base and the phase commits live on phax/<short-name>--phase-NN.
if git rev-parse --verify --quiet "$run_branch" >/dev/null \
  && [ "$(git rev-parse "$run_branch")" = "$(git rev-parse "$base" 2>/dev/null || echo -)" ]; then
  last_phase="$(git branch --list "phax/$short_name--phase-*" \
    --format='%(refname:short)' | sort | tail -1)"
  [ -z "$last_phase" ] || run_branch=$last_phase
fi
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
  # Entire-Session lives on the CHECKPOINT commit, never on the phax commit:
  # reading it off "$sha" yields an always-blank column and silently destroys the
  # very evidence this table exists to show. Resolve trailer -> ref -> session.
  printf '%s\n' "  sha        Phase-Id      Session-Id                            Entire-Checkpoint           join"
  for sha in $run_commits; do
    phase_id="$(trailer "$sha" Phase-Id | head -1)"
    sid="$(trailer "$sha" Session-Id | head -1)"
    cpid="$(trailer "$sha" Entire-Checkpoint | head -1)"
    verdict="—"
    if [ -n "$cpid" ]; then
      cref="$(cp_ref "$cpid")"
      if [ -z "$cref" ]; then
        verdict="DANGLING (no ref)"
      else
        esid="$(git log -1 "$cref" \
          --format='%(trailers:key=Entire-Session,valueonly,separator=)')"
        if [ "$esid" = "$sid" ]; then
          verdict="OK"
        else
          verdict="MISMATCH ($esid)"
        fi
      fi
    fi
    printf '  %s  %-12s  %-36s  %-26s  %s\n' \
      "$(git rev-parse --short "$sha")" \
      "${phase_id:-—}" "${sid:-—}" "${cpid:-—}" "$verdict"
  done
  echo "  (forward join is deterministic iff every Phase-Id row has exactly one"
  echo "   Entire-Checkpoint whose ref's Entire-Session equals its Session-Id)"

  echo "--- reverse: checkpoint -> phase commit (one row per checkpoint ref) ---"
  cp_all | while IFS= read -r cref; do
    id="${cref##*/}"
    cp_session="$(git log -1 "$cref" \
      --format='%(trailers:key=Entire-Session,valueonly,separator=)')"
    matches="$(git log "$run_branch" --format='%h' \
      --grep="Entire-Checkpoint: $id" 2>/dev/null | tr '\n' ' ')"
    echo "  $id  session:${cp_session:-—}  run-branch commit(s): ${matches:-NONE}"
  done
  echo "  (NONE is expected for checkpoints from sessions outside this run —"
  echo "   the namespace is repo-wide, not run-scoped)"
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
cp_all | while IFS= read -r cref; do
  bytes="$(git ls-tree -r -l "$cref" \
    | awk '{ total += $4 } END { printf "%d", total }')"
  echo "  ${cref##*/}: $bytes bytes"
done
cp_all | while IFS= read -r cref; do git ls-tree -r -l "$cref"; done \
  | awk '{ total += $4; n += 1 }
         END { printf "  all checkpoints: %d files, %d uncompressed bytes\n", n, total }'
echo "  (per-phase cost is what a desktop run screen pays; multiply by phase"
echo "   count for the run, and remember these are compressible JSONL)"

printf '\nprobe complete (read-only; nothing was modified, no entire invocation)\n'
