#!/bin/sh
# 00-preflight.sh — read-only preflight for the entire.io checkpoint spike.
#
# Reports whether `entire` is installed and whether this repo is already
# enabled, plus the push-safety context and the phax ground facts the later
# probes depend on. It observes state only: it never runs `entire enable`,
# never installs hooks, never writes config, never creates a commit.
#
# Run from anywhere inside the repo (main checkout or a worktree). Human-run;
# not wired into any phax gate.
set -eu

# Every check below is relative to the repo root, so root the script rather than
# trusting the caller's cwd: from a subdirectory the relative probes would all
# report "absent" and exit 0, which reads as "entire is not enabled".
cd "$(git rev-parse --show-toplevel)"

section() {
  printf '\n== %s ==\n' "$1"
}

# --- 1. entire binary ---------------------------------------------------------
section "entire binary"
if ! command -v entire >/dev/null 2>&1; then
  echo "ERROR: 'entire' is not on PATH. Install it before running this spike" >&2
  echo "       (https://docs.entire.io/overview), then re-run this preflight." >&2
  exit 1
fi
entire --version

# --- 2. enablement state (observed, not queried via entire) ------------------
section "enablement state"
if [ -d .entire ]; then
  echo ".entire/ directory: present"
  ls .entire
  if [ -f .entire/settings.json ]; then
    echo "--- .entire/settings.json ---"
    cat .entire/settings.json
  fi
else
  echo ".entire/ directory: absent"
fi

# Storage model, verified against entire 0.10.0 (`checkpoints.primary.type:
# "git-refs"` in .entire/settings.json): each checkpoint is its OWN ref under
# refs/entire/checkpoints/<last-two-chars-of-ULID>/<ULID>, with the tree at the
# ref root (metadata.json, 0/full.jsonl, 0/transcript.jsonl, 0/prompt.txt).
# There is no `entire/checkpoints/v1` branch — that is the model entire's
# published docs describe, and it does not match what 0.10.0 writes. Re-check
# this on a version bump before trusting any path below.
cp_count="$(git for-each-ref --format='x' 'refs/entire/checkpoints/**' | grep -c . || true)"
if [ "$cp_count" -gt 0 ]; then
  echo "checkpoint refs (refs/entire/checkpoints/**): $cp_count"
  git for-each-ref --format='  %(refname) %(objectname:short)' \
    'refs/entire/checkpoints/**' | head -10
  [ "$cp_count" -le 10 ] || echo "  … $((cp_count - 10)) more"
else
  echo "checkpoint refs (refs/entire/checkpoints/**): none"
fi
if git rev-parse --verify --quiet entire/checkpoints/v1 >/dev/null; then
  echo "legacy entire/checkpoints/v1 branch: present — this repo predates the"
  echo "  git-refs storage model; every probe path needs revisiting"
fi

for f in .claude/settings.json .claude/settings.local.json; do
  if [ -f "$f" ]; then
    if grep -q entire "$f"; then
      echo "$f: present, mentions entire"
    else
      echo "$f: present, no mention of entire"
    fi
  else
    echo "$f: absent"
  fi
done

section "git hooks"
hooks_dir="$(git rev-parse --git-common-dir)/hooks"
echo "hooks dir: $hooks_dir"
for h in "$hooks_dir"/*; do
  [ -f "$h" ] || continue
  case "$h" in
    *.sample) continue ;;
  esac
  if grep -q entire "$h" 2>/dev/null; then
    echo "$(basename "$h"): present, mentions entire"
  else
    echo "$(basename "$h"): present, no mention of entire"
  fi
done

# --- 3. push safety -----------------------------------------------------------
section "push safety"
echo "push.default: $(git config --get push.default || echo '(unset)')"
echo "remote.origin.push: $(git config --get remote.origin.push || echo '(unset)')"
echo "local refs matching entire/* (both namespaces):"
git for-each-ref 'refs/heads/entire/*' 'refs/entire/*' \
  --format='  %(refname) %(objectname:short)' | head -10
any_refs="$(git for-each-ref --format='x' 'refs/heads/entire/*' 'refs/entire/*' \
  | grep -c . || true)"
[ "$any_refs" -gt 0 ] || echo "  (none)"
# refs/entire/* sits outside refs/heads/*, so an ordinary `git push` does not
# carry it and a clone does not fetch it. That is a smaller exposure surface
# than a shadow *branch* would be — but `--mirror` still copies everything.
echo "note: refs/entire/* is not pushed by a plain 'git push'; --all/--mirror would"
echo "      still copy it. Verify the remote directly:"
echo "      git ls-remote origin 'refs/entire/*'"

# --- 4. phax ground facts -----------------------------------------------------
section "phax ground facts"
echo "worktree cwd: $(pwd)"
echo "git common dir: $(git rev-parse --git-common-dir)"
if ignore_line="$(git check-ignore -v .claude/settings.local.json 2>/dev/null)"; then
  echo ".claude/settings.local.json gitignored: yes ($ignore_line)"
else
  echo ".claude/settings.local.json gitignored: no"
fi
if git ls-files --error-unmatch .claude/settings.json >/dev/null 2>&1; then
  echo ".claude/settings.json tracked: yes"
else
  echo ".claude/settings.json tracked: no (invisible in a fresh worktree checkout)"
fi

printf '\npreflight complete (read-only; nothing was modified)\n'
