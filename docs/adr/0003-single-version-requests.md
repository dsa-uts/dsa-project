# Single Version Requests

Each Request targets exactly one Resource Version. Comparing a Submission across Resource Versions is represented by creating multiple Requests that reuse the same Submission, which keeps CI Results, Status aggregation, queueing, and retries tied to one immutable execution target.

## Consequences

Manager diffing is an application view over multiple Requests, not a multi-version Request. When a Project receives a new latest Resource Version, queued rerun work creates new Requests for latest validation and evaluation Submissions rather than mutating or extending old Requests.
