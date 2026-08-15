#!/bin/sh
# 02-checkpoint-lifecycle.sh — git-side checkpoint lifecycle probe (phase-03).
#
# Follows a checkpoint from a phase commit made inside a linked worktree,
# through the merge onto the base branch, to the published PR. phax commits with
# plain `git commit -m <subject> -m <body>` and no `--no-verify`
# (src/infra/git.ts), so entire's prepare-commit-msg and post-commit hooks
# should fire on every phase commit — but from a linked worktree, with
# condensation writing the shadow branch in the shared repo. Five steps:
#
#   1. trailer injection: does every run-branch commit carry Entire-Checkpoint
#      alongside phax's Run-Id / Phase-Id / Session-Id trailers?
#   2. condensation: did post-commit advance entire/checkpoints/v1, and what
#      tree path does each checkpoint occupy?
#   3. mapping: one checkpoint per phase commit, or many-to-one / missing?
#   4. non-phase commits: are path-scoped artifact-transition commits (no
#      Phase-Id trailer) checkpointed too, and is a session-less checkpoint
#      empty or absent?
#   5. merge and publish: which trailers survive the merge commit, is the
#      shadow branch unaffected, and did the shadow branch stay local?
#
# Plus the shadow branch's repo weight (total blob size, largest blobs), for
# phase-05's residual-risk section.
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
shadow=entire/checkpoints/v1

run_branch="phax/$short_name"
git rev-parse --verify --quiet "$run_branch" >/dev/null || run_branch=$short_name
git rev-parse --verify --quiet "$run_branch" >/dev/null || {
  echo "ERROR: neither phax/$short_name nor $short_name resolves to a ref" >&2
  exit 1
}
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

# --- step 2: condensation onto the shadow branch ------------------------------
section "step 2: condensation onto $shadow"
if ! git rev-parse --verify --quiet "$shadow" >/dev/null; then
  echo "$shadow: ABSENT — post-commit never condensed anything"
else
  echo "$shadow: present, $(git rev-list --count "$shadow") commit(s)"
  echo "--- shadow branch log (subjects only) ---"
  git log "$shadow" --format='  %h %s'
  echo "--- tree path shape at the tip (first 20 paths) ---"
  git ls-tree -r --name-only "$shadow" | head -20 | sed 's/^/  /'
  echo "--- per-checkpoint tree lookup (id -> <xx>/<rest>/...) ---"
  for sha in $run_commits; do
    checkpoint="$(trailer "$sha" Entire-Checkpoint | head -1)"
    [ -n "$checkpoint" ] || continue
    prefix="$(printf '%s' "$checkpoint" | cut -c1-2)"
    rest="$(printf '%s' "$checkpoint" | cut -c3-)"
    for f in metadata.json 0/full.jsonl 0/transcript.jsonl 0/prompt.txt; do
      path="$prefix/$rest/$f"
      if git cat-file -e "$shadow:$path" 2>/dev/null; then
        echo "  $checkpoint: $path present"
      else
        echo "  $checkpoint: $path ABSENT"
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
shadow_commits=0
git rev-parse --verify --quiet "$shadow" >/dev/null \
  && shadow_commits=$(git rev-list --count "$shadow")
echo "phase commits (Phase-Id trailer):        $phase_commits"
echo "  of which carry Entire-Checkpoint:      $with_checkpoint"
echo "  distinct checkpoint ids among them:    $unique_ids"
echo "commits on $shadow:  $shadow_commits"
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
echo "--- shadow branch unaffected by the merge? ---"
if git rev-parse --verify --quiet "$shadow" >/dev/null; then
  echo "  $shadow tip: $(git log -1 --format='%h %ci' "$shadow")"
  echo "  (compare this tip before and after the merge; it must not move)"
fi
echo "--- did the shadow branch stay local? (safety protocol) ---"
git for-each-ref --format='  local:  %(refname)' "refs/heads/entire/*"
if remote_refs="$(git ls-remote --heads origin 'entire/*' 2>/dev/null)"; then
  if [ -n "$remote_refs" ]; then
    echo "  REMOTE HAS ENTIRE REFS — safety protocol violated:"
    printf '%s\n' "$remote_refs" | sed 's/^/    /'
  else
    echo "  remote origin: no entire/* refs (good)"
  fi
else
  echo "  ls-remote failed (offline?) — check for remote entire/* refs by hand"
fi

# --- repo weight of the shadow branch -----------------------------------------
section "repo weight of $shadow"
if git rev-parse --verify --quiet "$shadow" >/dev/null; then
  git rev-list --objects "$shadow" \
    | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' \
    | awk '$1 == "blob" { total += $2; n += 1 }
           END { printf "  blobs: %d, total uncompressed bytes: %d\n", n, total }'
  echo "  five largest blobs (bytes, path):"
  git rev-list --objects "$shadow" \
    | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' \
    | awk '$1 == "blob" { $1 = ""; print }' \
    | sort -n | tail -5 | sed 's/^/   /'
else
  echo "  $shadow absent — nothing to weigh"
fi

printf '\nprobe complete (read-only; nothing was modified)\n'
