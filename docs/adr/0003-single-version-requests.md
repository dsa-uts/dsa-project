# Single Version Requests

Each Request targets exactly one Resource Version. Comparing a Submission across Resource Versions is represented by creating multiple Requests that reuse the same Submission, which keeps CI Results, Status aggregation, queueing, and retries tied to one immutable execution target.

## Consequences

Manager diffing is an application view over multiple Requests, not a multi-version Request. New Requests, including manual reruns, always pin the latest imported Resource Version at creation. Clients cannot select a Version, and a Version update never changes pending or existing Requests. Registering a Version does not create Requests automatically.
