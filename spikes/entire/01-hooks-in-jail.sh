#!/bin/sh
# 01-hooks-in-jail.sh — agent-side hook survival probe (phase-02).
#
# Determines whether entire's Claude Code hooks are loaded and permitted to run
# inside a phax phase agent: a headless `claude --print` session spawned in a
# linked worktree under a frozen `--allowedTools Bash(...)` allowlist
# (src/infra/providers/claudeCode.ts). Five cases, two decisive:
#
#   1. where `entire enable` wrote its settings (diff vs pre-enable snapshot)
#   2. whether that settings file is visible INSIDE a phase worktree  [decisive]
#   3. which hook events entire registered, and whether each fires in --print
#   4. whether the hook command is reachable under the frozen allowlist [decisive]
#   5. whether a session was captured at all for a phase's Session-Id
#
# Read-only and human-run, from the repo root. It never enables, disables, or
# reconfigures anything; it observes state and diffs against an
# operator-supplied pre-enable snapshot (procedure step 0 in the README).
#
# Usage:
#   sh spikes/entire/01-hooks-in-jail.sh SNAPSHOT_DIR WORKTREE SECURITY_JSON [RUN_BRANCH]
#
#   SNAPSHOT_DIR   directory outside the repo holding the pre-enable copies:
#                    settings.json          (copy of .claude/settings.json, if it existed)
#                    settings.local.json    (copy of .claude/settings.local.json, if it existed)
#                    hooks-listing.txt      (ls of .git/hooks/ before enabling)
#   WORKTREE       path of a live (or kept) phax phase worktree, e.g.
#                    ~/.phax/worktrees/<repo>.<shortName>/<phase-id>
#   SECURITY_JSON  the run's security.json carrying the frozen agentCommands
#   RUN_BRANCH     branch whose commits carry Session-Id trailers
#                    (default: HEAD)
set -eu

if [ $# -lt 3 ]; then
  echo "usage: sh $0 SNAPSHOT_DIR WORKTREE SECURITY_JSON [RUN_BRANCH]" >&2
  exit 2
fi
snapshot_dir=$1
worktree=$2
security_json=$3
run_branch=${4:-HEAD}

section() {
  printf '\n== %s ==\n' "$1"
}

have_jq=0
command -v jq >/dev/null 2>&1 && have_jq=1
[ "$have_jq" = 1 ] || echo "note: jq not found — JSON is printed raw for manual inspection"

# --- case 1: where the settings landed ---------------------------------------
section "case 1: where entire enable wrote its settings"
[ -d "$snapshot_dir" ] || {
  echo "ERROR: snapshot dir '$snapshot_dir' not found." >&2
  echo "       Step 0 of the README procedure must run BEFORE enabling;" >&2
  echo "       this script refuses to guess the pre-enable state." >&2
  exit 1
}
for pair in "settings.json:.claude/settings.json" "settings.local.json:.claude/settings.local.json"; do
  snap="$snapshot_dir/${pair%%:*}"
  live="${pair#*:}"
  if [ ! -f "$snap" ] && [ ! -f "$live" ]; then
    echo "$live: absent before and after enable"
  elif [ ! -f "$snap" ] && [ -f "$live" ]; then
    echo "$live: CREATED by enable (no pre-enable copy exists)"
  elif [ -f "$snap" ] && [ ! -f "$live" ]; then
    echo "$live: existed before enable, now ABSENT"
  elif diff -u "$snap" "$live"; then
    echo "$live: unchanged by enable"
  else
    echo "$live: MODIFIED by enable (diff above)"
  fi
done
echo "--- git hooks vs pre-enable listing ---"
hooks_dir="$(git rev-parse --git-common-dir)/hooks"
if [ -f "$snapshot_dir/hooks-listing.txt" ]; then
  ls "$hooks_dir" | diff -u "$snapshot_dir/hooks-listing.txt" - \
    && echo "hooks listing: unchanged" \
    || echo "hooks listing: CHANGED (diff above)"
else
  echo "WARNING: $snapshot_dir/hooks-listing.txt missing — hook diff skipped"
fi

# --- case 2: is the settings file visible inside the phase worktree? [decisive]
section "case 2: worktree visibility (decisive)"
[ -d "$worktree" ] || {
  echo "ERROR: worktree '$worktree' not found (pass a live or kept phase worktree)" >&2
  exit 1
}
echo "worktree: $worktree"
for f in .claude/settings.json .claude/settings.local.json .entire/settings.json; do
  if [ -f "$worktree/$f" ]; then
    echo "$f: present in worktree"
  else
    echo "$f: ABSENT in worktree (invisible to the phase agent and its git hooks)"
  fi
  if ignore_line="$(git check-ignore -v "$f" 2>/dev/null)"; then
    echo "  gitignored at repo root: yes ($ignore_line)"
  else
    echo "  gitignored at repo root: no"
  fi
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "  tracked: yes (a fresh worktree checkout contains it)"
  else
    echo "  tracked: no (a fresh worktree checkout omits it)"
  fi
done

# --- case 3: which hook events entire registered ------------------------------
section "case 3: registered hook events"
settings_file=""
for f in .claude/settings.json .claude/settings.local.json; do
  [ -f "$f" ] && grep -q entire "$f" && settings_file=$f && break
done
if [ -z "$settings_file" ]; then
  echo "no settings file mentioning entire found — hooks are NOT registered"
else
  echo "settings file: $settings_file"
  if [ "$have_jq" = 1 ]; then
    echo "hook events:"
    jq -r '.hooks // {} | keys[]' "$settings_file" | sed 's/^/  /'
  else
    cat "$settings_file"
  fi
  echo "whether each event fires in a headless --print session is an observed"
  echo "fact, not a static one: evidence is case 5 (captured session material)"
  echo "plus any per-event traces under .entire/logs/. Record per event in the"
  echo "findings table."
fi

# --- case 4: is the hook command reachable under the jail? [decisive] ---------
section "case 4: hook command vs frozen agentCommands (decisive)"
[ -f "$security_json" ] || {
  echo "ERROR: security.json '$security_json' not found" >&2
  exit 1
}
if [ -z "$settings_file" ]; then
  echo "skipped: no entire hooks registered (case 3)"
elif [ "$have_jq" = 1 ]; then
  echo "frozen agentCommands:"
  jq -r '.. | .agentCommands? // empty | .[]' "$security_json" | sed 's/^/  /'
  echo "hook commands registered by entire:"
  jq -r '[.hooks // {} | .[][]?.hooks[]?.command] | unique | .[]' "$settings_file" \
    | while IFS= read -r cmd; do
        echo "  $cmd"
        word=${cmd%% *}
        if jq -r '.. | .agentCommands? // empty | .[]' "$security_json" \
          | grep -Fq -- "$word"; then
          echo "    leading word '$word' appears in agentCommands"
        else
          echo "    leading word '$word' NOT in agentCommands — reachable only if"
          echo "    Claude Code runs hook commands OUTSIDE the --allowedTools gate"
        fi
      done
else
  echo "jq unavailable — compare by hand:"
  echo "--- $security_json ---"; cat "$security_json"
  echo "--- $settings_file ---"; cat "$settings_file"
fi
echo "State plainly in the findings which the observation showed: hook commands"
echo "gated by --allowedTools, or executed outside it."

# --- case 5: was a session captured at all? -----------------------------------
section "case 5: captured session material per phase Session-Id"
# Capture is proven by the DURABLE record, not by .entire/metadata/. That
# directory is live staging: entire condenses a session into a checkpoint ref at
# commit time and clears the staging entry, so a completed phase legitimately has
# no .entire/metadata/<session-id>/ at all. Testing it there reports "NOT
# captured" for every finished phase — a false negative on this probe's whole
# question. Verified 2026-08-15: all five phases of the observed run were
# captured while .entire/metadata/ held only the one still-open session.
#
# The durable chain is:
#   phax commit --Entire-Checkpoint--> refs/entire/checkpoints/<last2>/<ULID>
#   checkpoint  --Entire-Session-----> must equal the commit's Session-Id
cp_ref() { # cp_ref ULID -> its ref path, or empty
  git for-each-ref --format='%(refname)' 'refs/entire/checkpoints/**' \
    | grep -- "/$1\$" | head -1
}
echo "Session-Id / Entire-Checkpoint trailers on $run_branch (phax commits):"
git log "$run_branch" \
  --format='%H%x09%(trailers:key=Session-Id,valueonly,separator=)%x09%(trailers:key=Entire-Checkpoint,valueonly,separator=)' \
  | while IFS="$(printf '\t')" read -r sha sid cpid; do
      [ -n "$sid" ] || continue
      short="$(git rev-parse --short "$sha")"
      if [ -z "$cpid" ]; then
        echo "  $short  $sid  -> no Entire-Checkpoint trailer (session NOT captured)"
        continue
      fi
      ref="$(cp_ref "$cpid")"
      if [ -z "$ref" ]; then
        echo "  $short  $sid  -> trailer $cpid but NO ref (DANGLING checkpoint)"
        continue
      fi
      esid="$(git log -1 "$ref" --format='%(trailers:key=Entire-Session,valueonly,separator=)')"
      if [ "$esid" = "$sid" ]; then
        echo "  $short  $sid  -> CAPTURED ($ref, Entire-Session matches)"
      else
        echo "  $short  $sid  -> captured but JOIN MISMATCH (checkpoint session $esid)"
      fi
    done
# Staging is reported only as a live-session curiosity, never as the verdict.
if [ -d .entire/metadata ]; then
  echo "live staging in .entire/metadata/ (open sessions only, not evidence):"
  ls .entire/metadata | sed 's/^/  /'
else
  echo "live staging .entire/metadata/: absent (expected once sessions condense)"
fi

printf '\nprobe complete (read-only; nothing was modified)\n'
