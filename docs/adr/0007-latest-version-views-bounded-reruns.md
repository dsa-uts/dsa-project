# Latest-Version Result Views with Bounded Queued Reruns

Requests pin a Resource Version at creation (Single-Version Request), so after a fix-forward push the "latest result" of a Submission can silently describe an outdated grading logic. We resolve this by pinning every default result view to the latest Resource Version and converging it via Queued Reruns (Converge-to-Latest): registering a new Version auto-creates System Account Requests for the most recent non-archived validation Submissions per Project × user (bounded by an operational config, default 5) and the single latest non-archived evaluation Submission per Project × Subject User. Submissions without a Request on the displayed Version render as "not run" — their old-Version results do not appear in list views; only Manager/Admin can see them by explicitly selecting an older Version.

## Considered Options

- Show each Submission's latest Request regardless of its Version, with a staleness badge when it predates `latest`. Rejected: it leaks the Version axis into the student UI, and mixes rows whose Workflow sets (and therefore denominators like "2/3 AC") differ across Versions in one table.
- Rerun every non-archived Submission on registration. Rejected: a student may have dozens of validation attempts; rerunning all of them buys nothing pedagogically and scales the queue with attempt count instead of class size.
- No automatic reruns (manual rerun only). Rejected: after a grading fix, a stale "all green" on a student's dashboard is a lie precisely when correctness matters most.

## Consequences

- Student views never expose Resource Versions; results converge to `latest` without user action.
- Validation Submissions older than the rerun depth show "not run" after a Version bump; a student can manually re-request any of their non-archived Submissions (latest Version only) to fill the row back in.
- Registering a Version enqueues work proportional to class size (× rerun depth), not to total attempt count.
- A rerun burst follows every push; this is accepted at class scale and bounded by the depth config.
