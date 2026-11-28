## 1. Private evidence contract

- [ ] 1.1 Define the bounded, versioned evidence and its association with already derived target paths in the format-2/3 review, digest, parser and transition owners. Preserve old-shaped digests, exact immutable/intent comparisons and refusal by older readers. Exercise old, enriched, altered, unknown and oversized records.
- [ ] 1.2 Define the historical-object comparison with the mount-reader interface: positive per-target proof, different, or unavailable. Cover matching, mismatch despite a reused device, missing proof and strict unanchored objects. No change to live-to-live or terminal status semantics.

## 2. Linux observation

- [ ] 2.1 Implement bounded, unprivileged Node-only identification for directly mounted btrfs on an identifiable single backing device, including the target-to-subvolume and subvolume-to-device checks in the design. Keep observations scoped to one validation batch; no hidden process, descriptor leak, raw device read or host identifier in output.
- [ ] 2.2 Exercise metadata parsing and correlation, including escaped/ambiguous mounts, a nested snapshot with its parent's mount ID, a different disk/partition with copied filesystem identity, missing evidence and limits. Verify enrollment on the real directly mounted SCSI-backed original and non-enrollment on plain loop, ext4 and another non-btrfs filesystem.

## 3. Setup owners

- [ ] 3.1 Freeze eligible fresh and migration facts in the existing read-only inspection and confirm paths. Apply them to unfinished fresh review, creation checkpoints, retained objects, publication intent reconciliation and effect validation. Cover before/after creation, retained capture, stale consent, old records and completed-status isolation.
- [ ] 3.2 Apply the contract in the manifest/removal and retained-receipt owners, including `record-removal` before and after rmdir, later exact-event checks, and reviewed format-1 upgrade. Exercise different mounts for discovery, Store and history, no duplicate unlink/append, and refusal without mutation on lost or mismatched evidence.

## 4. Integration and guides

- [ ] 4.1 Exercise cold authenticated Setup status, Resume/Continue, advance and replay. On real mounts, assert the original **actually changed** `st_dev` and can finish the paused operation; at the same path, a writable snapshot and an offline block copy with preserved object and filesystem metadata both refuse without writes. Keep ext4 and other non-btrfs controls strict, plus the focused destructive-boundary, diagnostic, deadline and no-spawn regressions. Report the measured remount, not a reboot.
- [ ] 4.2 Update `docs/setup.md`, `docs/backend.md`, `docs/contracts.md` and `setup/managed-steps.md`: identify eligible storage, retain the completed-status distinction and explain explicit recovery and rollback when proof is missing. Keep the UI and public DTOs unchanged.
- [ ] 4.3 Validate the change strictly; build outputs locally for standalone tests, run the focused suites and the required portable checks. Do not commit generated outputs on the development branch. Record any unavailable platform evidence rather than claiming a pass.
- [ ] 4.4 Add `.github/workflows/setup-btrfs-identity.yml` with a stable `Native btrfs Setup identity` check on `ubuntu-latest`. Select relevant PRs inside the job, including changes to Setup, shared managed code or the harness itself; no duplicate push or weekly run. Provision fresh images and local WWN-bearing SCSI presentations as described in the design, isolate privileged staging/cleanup from unprivileged Node tests, and fail the selected job on missing prerequisites, no renumber or any skipped required case. Require an executed green run on the landing PR before merge. Reuse the disposable fixture script for optional local reproduction with sudo, never as a separate acceptance gate.
