# Continue unfinished Setup on a verified renumbered volume

## Why

Rebooting can give a btrfs subvolume a different device number. An unfinished Setup then refuses to continue on the original Store. The completed-Setup fix is not a solution for writes: a writable snapshot can have the same paths, inode numbers, birth times, Store ID, source and file contents as the original.

## What changes

- For new operations on verifiable, directly mounted Linux btrfs storage, bind the reviewed target to both its backing volume and its subvolume. On an explicit Continue or Resume, freshly establish that identity rather than treating a changed device number alone as a conflict.
- Apply this to fresh creation/reconnection, manifest-based migration and retained removal evidence. A mismatch or loss of recorded proof stops work; confirmation cannot override it. Explain what to preserve and how to retry when the original storage becomes verifiable again.

## Capabilities

- **Modified:** `windows-setup-responsiveness` — despite its historical name, this is the existing all-platform contract for fresh and migration steps. Distinguish same-target mutation proof from the completed-status exception.
- **New:** none.

## Scope and non-goals

No retrofit of an already stranded journal, automatic continuation, general volume discovery service, snapshot adoption, new UI action or caller-supplied identity. No change to Windows volume-serial checks, macOS checks, completed read-only status, SQLite schema, HTTP wire versions, request deadlines or writer fences. No subprocess, native module, privilege request or probing of raw block-device contents. Other Linux filesystems and unprovable btrfs layouts get no renumbering exception.

## Impact

The private journal readers, Setup inspection/effect owners, lifecycle removal/receipt checks, regression fixtures and Setup guides change. The service and guest continue using the existing step requests. No dependency, tracked development bundle or release-version change is required.
