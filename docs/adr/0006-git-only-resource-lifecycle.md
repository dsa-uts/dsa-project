# Git-Only Resource Content with Console-Managed Operations

Workflow definitions and the project title come from immutable Resource Versions published in GitHub. Admin imports one resource ID and stable SemVer at a time; only a newer Version can replace `latest`. The first import creates the Project, and later imports update its title while preserving publish time, deadline, and display order (Git-for-Logic, Console-for-Operations).

## Considered Options

- Rolling back to an older Version or retracting a Version. Rejected: corrections are published under a newer Version and imported explicitly, keeping the content lifecycle fix-forward.
- Retiring Projects automatically when removed from the repository. Rejected: individual imports do not synchronize the full catalog. Projects remain stored; operators stop publication through the console.
- Editing resource content or titles in the console. Rejected: Git remains the single content authoring path.

## Consequences

- `latest` is the highest imported Version, not necessarily the newest Version available in the repository.
- Reimporting the current Version is a no-op; importing an older Version is rejected even if it was previously imported.
- Project records and past results survive repository changes. There is no Project archive operation or automatic retirement.
