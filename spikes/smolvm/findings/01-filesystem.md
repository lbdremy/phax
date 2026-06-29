# Findings: Filesystem isolation probe

## Environment

- smolvm version:
- Host OS / arch:
- Guest arch: arm64 Linux (Alpine, via libkrun on Apple Silicon)
- Date of run:
- Operator:

## Procedure

Run `sh spikes/smolvm/01-filesystem.sh` from the repo root on a host with `smolvm`
installed and the `alpine` image available. The script uses `smolvm machine run` (ephemeral
mode — VM is created, command runs, everything is torn down) and exercises five checks:

**A. Workspace mount** (`-v HOST:/workspace`)

A throwaway directory is created on the host with a `sentinel.txt` file. The guest reads
the sentinel from `/workspace/sentinel.txt` (confirms mount is active) and writes
`writeback.txt`. After the VM exits, the script checks whether `writeback.txt` appeared on
the host side — confirming bidirectional file propagation.

Flag syntax: `smolvm machine run --image alpine -v "$WORK_DIR:/workspace" -- /bin/sh -c "..."`

**B. Host `$HOME` invisible**

A unique marker file is written to `$HOME` immediately before the VM boots. Inside the
guest, the script probes the full host `$HOME` path (e.g., `/Users/remyloubradou`) and
the marker file directly. Both are expected to be absent — the guest's directory tree is
its own Linux rootfs, and macOS-specific paths like `/Users/` do not exist in Alpine.

**C. Host repo root invisible**

Same approach as B: a unique marker is written to `$PWD` (the repo root) on the host;
the guest probes the exact path. Expected to be absent.

**D. Host `/etc` not leaking**

The guest's `hostname`, `/etc/passwd` (first 3 lines), `/etc/hosts`, and whether
`/Users/` exists are captured. These are compared against the host hostname (printed
before the VM boots). A Linux Alpine guest will have its own `/etc` populated by the
image; it should not reflect host macOS content.

**E. Read-only mount** (`-v HOST:/workspace:ro`)

The mount is repeated with the `:ro` suffix (supported per smolvm `-v` flag documentation:
`-v HOST:CONTAINER[:ro]`). Inside the guest, the script attempts to write a file to
`/workspace/ro-test.txt`. Expected outcome: the write is rejected (EROFS or permission
denied). The host side is also checked: if the file does not appear, the `:ro` is
enforced at the kernel/hypervisor level.

### Crux question for this probe

> Can a host directory be mounted **read-only** into the guest, preventing the agent from
> writing back to the host? This is relevant to `isolated` mode: a read-only mount of the
> shared worktree would let an agent read context (specs, existing code) without the risk
> of writing back changes that were not explicitly staged.

If `:ro` is not supported or not enforced, record that as a finding — it constrains what
`isolated` mode can safely offer.

## Results

<!-- Paste the raw output of `sh spikes/smolvm/01-filesystem.sh` here. Leave empty until run. -->

## Verdict

<!-- Fill in after results are captured. Format: PASS / FAIL / PARTIAL + one-line conclusion. -->

**Status:** (not yet run)

**Conclusion:**

## Open questions

- If `:ro` is not enforced at the guest level, is there another smolvm mechanism (e.g.
  a Smolfile volume option) that provides read-only semantics?
- Does `/workspace` in the guest reflect the storage-disk default workspace when no
  `-v` flag is present? (smolvm docs note: `-v host:/workspace` replaces the default;
  no `-v` means the storage-disk workspace is used — no host content exposed.)
- Are there guest paths other than `/workspace` that could reflect host state (e.g.
  `/dev/`, `/proc/`, `/sys/` bind-mounts from the host)?
- What is the performance delta of a workspace mount vs in-guest storage for large
  codebases? (Relevant to phax phase execution time.)
