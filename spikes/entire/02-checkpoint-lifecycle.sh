#!/bin/sh
# 02-checkpoint-lifecycle.sh — git-side checkpoint lifecycle probe (phase-03).
#
# Follows a checkpoint from a phase commit made inside a linked worktree,
# through the merge onto the base branch, to the published PR. phax commits with
# plain `git commit -m <subject> -m <body>` and no `--no-verify`
# (src/infra/git.ts), so entire's prepare-commit-msg and post-commit hooks
# should fire on every phase commit — but from a linked worktree, with
# condensation writing checkpoint refs in the shared repo. Five steps:
#
#   1. trailer injection: does every run-branch commit carry Entire-Checkpoint
#      alongside phax's Run-Id / Phase-Id / Session-Id trailers?
#   2. condensation: did post-commit write a ref under refs/entire/checkpoints/
#      for each trailer, and what does each checkpoint's tree hold?
#   3. mapping: one checkpoint per phase commit, or many-to-one / missing?
#   4. non-phase commits: are path-scoped artifact-transition commits (no
#      Phase-Id trailer) checkpointed too, and is a session-less checkpoint
#      empty or absent?
#   5. merge and publish: which trailers survive the merge commit, are the
#      checkpoint refs unaffected, and did they stay local?
#
# Plus the checkpoint namespace's repo weight (total blob size, largest blobs),
# for phase-05's residual-risk section.
#
# Read-only and human-run, from the repo root, after the observed phax run.
# It assumes the hooks ran (phase-02's question) and looks only at git-visible
# effects. It never pushes, enables, or reconfigures anything.
#
# Usage:
#   sh spikes/entire/02-checkpoint-lifecycle.sh SHORT_NAME [BASE_REF] [MERGE_REF]
#
#   SHORT_NAME   the run's short name; the run branch is phax/<SHORT_NAME>
#                (pass a full ref instead if the branch name differs)
#   BASE_REF     the branch the run merges into (default: main)
#   MERGE_REF    the merge (or squash) commit on BASE_REF, once it exists;
#                omitted -> step 5 scans BASE_REF for checkpoint trailers
set -eu

if [ $# -lt 1 ]; then
  echo "usage: sh $0 SHORT_NAME [BASE_REF] [MERGE_REF]" >&2
  exit 2
fi
short_name=$1
base=${2:-main}
merge_ref=${3:-}

# Storage model, verified against entire 0.10.0 (`checkpoints.primary.type:
# "git-refs"`): one ref PER CHECKPOINT at
#   refs/entire/checkpoints/<last-two-chars-of-ULID>/<ULID>
# with the tree at the ref root (metadata.json, 0/full.jsonl, 0/transcript.jsonl,
# 0/prompt.txt, 0/content_hash.txt). There is no `entire/checkpoints/v1` branch
# and no <first-two>/<rest> subtree: that is the model entire's published docs
# describe, and 0.10.0 does not use it. Note the shard is the ULID's LAST two
# characters (…E30AGF -> GF/), so slicing the front is wrong even against the
# right namespace. Re-verify on a version bump.
cp_ns='refs/entire/checkpoints/**'
cp_ref() { # cp_ref ULID -> its ref path, or empty
  git for-each-ref --format='%(refname)' "$cp_ns" | grep -- "/$1\$" | head -1
}
cp_all() { # every checkpoint ref, one per line
  git for-each-ref --format='%(refname)' "$cp_ns"
}
cp_total="$(cp_all | grep -c . || true)"

run_branch="phax/$short_name"
git rev-parse --verify --quiet "$run_branch" >/dev/null || run_branch=$short_name
git rev-parse --verify --quiet "$run_branch" >/dev/null || {
  echo "ERROR: neither phax/$short_name nor $short_name resolves to a ref" >&2
  exit 1
}
# Before the run's branch is merged, phax/<short-name> still sits at base and the
# phase commits live on phax/<short-name>--phase-NN. Prefer the highest-numbered
# phase branch whenever the nominal run branch carries no commits of its own,
# otherwise every step below walks base's history and reports nothing.
if [ "$(git rev-parse "$run_branch")" = "$(git rev-parse "$base" 2>/dev/null || echo -)" ]; then
  last_phase="$(git branch --list "phax/$short_name--phase-*" \
    --format='%(refname:short)' | sort | tail -1)"
  if [ -n "$last_phase" ]; then
    echo "note: $run_branch is still at $base — using $last_phase (pre-merge run)"
    run_branch=$last_phase
  fi
fi
echo "run branch: $run_branch   base: $base"

section() {
  printf '\n== %s ==\n' "$1"
}

tab="$(printf '\t')"
# Run-branch commits, oldest first. After a merge the branch is an ancestor of
# base, so $base..$run_branch would be empty — fall back to the branch's own
# first-parent history capped at the merge-base.
range_base="$(git merge-base "$base" "$run_branch" 2>/dev/null || true)"
if [ -n "$range_base" ] && [ "$range_base" != "$(git rev-parse "$run_branch")" ]; then
  run_commits="$(git rev-list --reverse --first-parent "$range_base..$run_branch")"
else
  run_commits="$(git rev-list --reverse --first-parent "$run_branch" -n 20)"
  echo "note: $run_branch is fully merged into $base (or shares its tip);"
  echo "      walking its last 20 first-parent commits instead of $base..$run_branch"
fi

trailer() { # trailer SHA KEY -> value(s), one per line
  git log -1 "$1" --format="%(trailers:key=$2,valueonly,separator=%x0a)"
}

# --- step 1: trailer injection on every run-branch commit ---------------------
section "step 1: trailer injection (prepare-commit-msg from a linked worktree)"
printf '%s\n' "sha        Phase-Id      Session-Id                            Entire-Checkpoint"
for sha in $run_commits; do
  phase_id="$(trailer "$sha" Phase-Id | head -1)"
  session_id="$(trailer "$sha" Session-Id | head -1)"
  checkpoint="$(trailer "$sha" Entire-Checkpoint | head -1)"
  printf '%s  %-12s  %-36s  %s\n' \
    "$(git rev-parse --short "$sha")" \
    "${phase_id:-—}" "${session_id:-—}" "${checkpoint:-MISSING}"
done
echo "(a MISSING Entire-Checkpoint on a commit with a Session-Id means the"
echo " prepare-commit-msg hook did not inject from the linked worktree)"

# --- step 2: condensation into the checkpoint ref namespace -------------------
section "step 2: condensation into refs/entire/checkpoints/"
if [ "$cp_total" = 0 ]; then
  echo "no refs under $cp_ns — post-commit never condensed anything"
else
  echo "checkpoint refs: $cp_total"
  echo "--- per-checkpoint lookup (trailer id -> ref -> tree) ---"
  for sha in $run_commits; do
    checkpoint="$(trailer "$sha" Entire-Checkpoint | head -1)"
    [ -n "$checkpoint" ] || continue
    ref="$(cp_ref "$checkpoint")"
    if [ -z "$ref" ]; then
      echo "  $checkpoint: NO REF — trailer points at nothing (dangling)"
      continue
    fi
    echo "  $checkpoint -> $ref"
    echo "    strategy: $(git log -1 "$ref" --format='%(trailers:key=Entire-Strategy,valueonly,separator=)')"
    echo "    agent:    $(git log -1 "$ref" --format='%(trailers:key=Entire-Agent,valueonly,separator=)')"
    for f in metadata.json 0/metadata.json 0/full.jsonl 0/transcript.jsonl 0/prompt.txt; do
      if git cat-file -e "$ref:$f" 2>/dev/null; then
        echo "    $f: present, $(git cat-file -s "$ref:$f") bytes"
      else
        echo "    $f: ABSENT"
      fi
    done
  done
fi

# --- step 3: one checkpoint per phase commit? ---------------------------------
section "step 3: phase-commit-to-checkpoint mapping"
phase_commits=0
with_checkpoint=0
checkpoint_ids=""
for sha in $run_commits; do
  [ -n "$(trailer "$sha" Phase-Id | head -1)" ] || continue
  phase_commits=$((phase_commits + 1))
  cp="$(trailer "$sha" Entire-Checkpoint | head -1)"
  if [ -n "$cp" ]; then
    with_checkpoint=$((with_checkpoint + 1))
    checkpoint_ids="$checkpoint_ids$cp\n"
  fi
done
unique_ids=$(printf '%b' "$checkpoint_ids" | sort -u | grep -c . || true)
echo "phase commits (Phase-Id trailer):        $phase_commits"
echo "  of which carry Entire-Checkpoint:      $with_checkpoint"
echo "  distinct checkpoint ids among them:    $unique_ids"
echo "checkpoint refs in the repo:             $cp_total"
echo "  (cp_total counts every checkpoint in the repo, including ones from"
echo "   sessions unrelated to this run — compare it to unique_ids, not to"
echo "   phase_commits)"
echo "(flag in the findings any many-to-one — two phase commits sharing an id,"
echo " e.g. a fix-loop resume — or missing case)"

# --- step 4: non-phase commits (artifact transitions, smoke commits) ----------
section "step 4: non-phase commits through the same commit port"
found_nonphase=0
for sha in $run_commits; do
  [ -z "$(trailer "$sha" Phase-Id | head -1)" ] || continue
  found_nonphase=1
  cp="$(trailer "$sha" Entire-Checkpoint | head -1)"
  echo "  $(git rev-parse --short "$sha")  $(git log -1 --format=%s "$sha")"
  echo "    Entire-Checkpoint: ${cp:-absent}"
done
[ "$found_nonphase" = 1 ] || echo "  (no non-phase commit on the walked range)"
echo "Expected from the smoke test (README step 3): a commit with no agent"
echo "session behind it gets no trailer and no checkpoint — absent, not empty."
echo "Record whether artifact-transition commits (src/infra/git.ts path-scoped"
echo "variant) behave the same."

# --- step 5: merge and publish ------------------------------------------------
section "step 5: merge and publish"
if [ -n "$merge_ref" ]; then
  merge_commits="$(git rev-parse "$merge_ref")"
else
  echo "no MERGE_REF given — scanning the last 30 commits of $base for"
  echo "Entire-Checkpoint trailers (squash merges carry the branch's trailers):"
  merge_commits="$(git rev-list "$base" -n 30)"
fi
found_merge=0
for sha in $merge_commits; do
  cps="$(trailer "$sha" Entire-Checkpoint)"
  [ -n "$cps" ] || continue
  # skip commits already counted on the run branch itself
  case "$run_commits" in *"$sha"*) [ -n "$merge_ref" ] || continue ;; esac
  found_merge=1
  n=$(printf '%s\n' "$cps" | grep -c .)
  echo "  $(git rev-parse --short "$sha")  $(git log -1 --format=%s "$sha")"
  echo "    Entire-Checkpoint trailers: $n"
  printf '%s\n' "$cps" | sed 's/^/      /'
  echo "    phax trailers surviving:"
  for key in Run-Id Short-Name Phase-Id Session-Id; do
    v="$(trailer "$sha" "$key" | head -1)"
    [ -n "$v" ] && echo "      $key: $v"
  done
done
[ "$found_merge" = 1 ] || echo "  (no commit on $base carries an Entire-Checkpoint trailer yet)"
echo "--- checkpoint refs unaffected by the merge? ---"
echo "  checkpoint refs now: $cp_total (record this before and after the merge;"
echo "  a merge must not add, move or drop any — checkpoints attach to the"
echo "  original commits, not to the merge)"
cp_all | tail -3 | sed 's/^/    /'
echo "--- did the checkpoints stay local? (safety protocol) ---"
git for-each-ref --format='  local:  %(refname)' 'refs/heads/entire/*' "$cp_ns" \
  | head -5
# refs/entire/* is outside refs/heads/*, so --heads would not see it: ask the
# remote for the full namespace or this check silently passes.
if remote_refs="$(git ls-remote origin 'refs/entire/*' 'refs/heads/entire/*' 2>/dev/null)"; then
  if [ -n "$remote_refs" ]; then
    echo "  REMOTE HAS ENTIRE REFS — safety protocol violated:"
    printf '%s\n' "$remote_refs" | sed 's/^/    /'
  else
    echo "  remote origin: no entire/* refs (good)"
  fi
else
  echo "  ls-remote failed (offline?) — check for remote entire/* refs by hand"
fi

# --- repo weight of the checkpoint namespace ----------------------------------
section "repo weight of $cp_ns"
if [ "$cp_total" != 0 ]; then
  cp_all | git cat-file --batch-check='%(objectname)' >/dev/null 2>&1 || true
  cp_all | while IFS= read -r ref; do git rev-list --objects "$ref"; done \
    | sort -u \
    | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' \
    | awk '$1 == "blob" { total += $2; n += 1 }
           END { printf "  blobs: %d, total uncompressed bytes: %d\n", n, total }'
  echo "  five largest blobs (bytes, path):"
  cp_all | while IFS= read -r ref; do git rev-list --objects "$ref"; done \
    | sort -u \
    | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' \
    | awk '$1 == "blob" { $1 = ""; print }' \
    | sort -n | tail -5 | sed 's/^/   /'
else
  echo "  no checkpoint refs — nothing to weigh"
fi

printf '\nprobe complete (read-only; nothing was modified)\n'
