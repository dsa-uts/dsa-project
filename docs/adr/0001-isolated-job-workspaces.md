# Isolated Job Workspaces

Each Job starts from a fresh sandbox workspace assembled from the Submission, Preset files, and explicitly declared input Artifact files. Jobs in one Workflow are ordered by explicit `depends` edges, the workspace is deleted after each Job, and only CI Results plus declared output Artifact files survive. This avoids implicit cross-job filesystem state while still supporting build-once, test-later workflows through named Artifact handoff.

## Considered Options

- Copy the full workspace from one Job to the next. This is close to a local laptop workflow, but it creates hidden dependencies, grows the attack surface, and makes cleanup semantics unclear.
- Make every submitted file immutable. This adds little security because submitted code can copy itself, and it breaks common build tools that write next to source files.
- Keep submitted files as writable workspace copies, and mount trusted Preset files under read-only `/preset`. This keeps ordinary builds working while protecting trusted test scripts and Makefiles from replacement.

## Consequences

Preset immutability is enforced by mounting Preset files under read-only `/preset`, not by copying them into `/workspace`. Changing ownership or mode on a file inside a writable directory is not enough, because the sandbox user may be able to unlink or replace that path.
