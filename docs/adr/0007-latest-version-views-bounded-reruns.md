# Request-Based Result History with Manual Reruns

This decision replaces latest-Version-only result views and automatic queued reruns. Validation and evaluation result lists contain one row per Request, with the executed Version visible. Updating a Resource does not change historical result rows or create new Requests; operators and students rerun explicitly within their existing permissions.

## Considered Options

- Filtering results to the latest Version and automatically rerunning submissions. Rejected: it hides useful history and couples resource import to potentially large amounts of execution work.
- Showing only one latest Request per Submission. Rejected: rerunning would replace the visible row and hide earlier attempts from the history.

## Consequences

- Students can view their own validation results from older Versions. Existing ownership, publication, Job visibility, and Submission archive rules still apply.
- Result details use the Request's pinned Version, including its Workflow definitions. Each row has its own Workflow set; counts cannot be taken from the current Project Version.
- A Version update does not produce synthetic “not run” result rows. A Request that has not completed uses its normal execution state.
- Project detail always uses the latest imported Version. New Requests and manual reruns pin that Version at creation, while existing Requests retain their original target.
