# Findings: Filesystem isolation probe

## Environment

- smolvm version: 1.3.2
- Host OS / arch: Darwin 25.5.0 / arm64 (Apple Silicon)
- Guest arch: arm64 Linux (Alpine, via libkrun on Apple Silicon)
- Date of run: 2026-06-30
- Operator: Claude Code (interactive review session, automated run)

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

> **Methodology note — script could not be run verbatim.** `01-filesystem.sh` boots
> `smolvm machine run --image alpine` **without `--net`**. On smolvm 1.3.2, an ephemeral
> `machine run` re-pulls the image at every boot, and the pull requires network — so
> without `--net` the very first boot fails at `pull image … network is unreachable`.
> To get a real result the image was pre-baked once into a self-contained artifact
> (`smolvm pack create -I alpine -o alpine.smolmachine`, which pulls under plain `--net`)
> and every check below was run with `smolvm machine run --from alpine.smolmachine -v …`.
> The filesystem boundary is identical to a live `--image alpine` boot (same Alpine
> rootfs, same libkrun virtio-fs mount layer); only the image-acquisition path differs.
> **Fix for the script:** add `--net` to the boots (needed only so the pull can run), or
> document a pre-bake/pre-pull step. See also the network-probe finding — live pull is
> impossible once an egress allowlist is applied, so a pre-baked image is mandatory.

Raw output (one boot per check, `--from` artifact, `-v` mounts):

```
CHECK A: workspace round-trip + write-back
  --- guest /workspace ---
  -rw-r--r-- 1 root root 21 Jun 30 11:23 sentinel.txt
  --- sentinel ---            spike-sentinel-73398
  guest wrote writeback.txt
  HOST-CHECK A: PASS write-back visible          → workspace mount round-trips both ways

CHECK B: host HOME invisible
  ls: /Users/remyloubradou: No such file or directory     → HOME-NOT-VISIBLE
  cat: can't open '/Users/remyloubradou/.smolvm-probe-…'  → MARKER-NOT-VISIBLE

CHECK C: host repo root invisible
  ls: /Users/remyloubradou/.phax/.../phase-05: No such file or directory   → NOT-VISIBLE
  cat: can't open '…/.smolvm-probe-…': No such file or directory           → NOT-VISIBLE

CHECK D: /etc isolation, no macOS /Users
  guest hostname: container
  /etc/passwd: root:x:0:0:root:/root:/bin/sh   (Alpine default, not host)
  ls /Users: No such file or directory          → no macOS path leak

CHECK E: read-only mount (-v …:/workspace:ro)
  /bin/sh: can't create /workspace/ro-test.txt: Read-only file system   → WRITE-REJECTED
  HOST-CHECK E: PASS no write-through            → :ro enforced at hypervisor layer
```

## Verdict

**Status:** PASS (all five checks) — run via pre-baked `--from` artifact, not live `--image` pull.

| Check | Result |
| ----- | ------ |
| A. Workspace mount round-trip + write-back | PASS — guest reads sentinel, host sees `writeback.txt` |
| B. Host `$HOME` invisible | PASS — path and marker absent in guest |
| C. Host repo root invisible | PASS — path and marker absent in guest |
| D. Host `/etc` not leaking | PASS — Alpine `/etc`, hostname `container`, no `/Users` |
| E. Read-only `:ro` mount enforced | PASS — guest write rejected with EROFS, no host write-through |

**Conclusion:** smolvm gives a clean Linux-guest filesystem boundary. The host `$HOME`,
the repo root, and macOS paths are simply absent from the guest rootfs — nothing leaks
except the explicit `-v` mount. Crucially for `isolated` mode, **`:ro` is enforced at the
hypervisor layer** (`Read-only file system`), so the worktree can be mounted read-only and
`allowRead` can be distinguished from `allowWrite` at the VM boundary (this resolves
residual risk 3 in the synthesis in the favourable direction). The one caveat is
operational, not security: an ephemeral `--image` boot always re-pulls and the pull needs
network, so a pre-baked image / `--from` artifact is required to boot offline.

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
