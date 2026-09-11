# Deployed Public Interface Tests with Host Playwright

Tests requiring PostgreSQL, a running backend, Ingress, or frontend observe the deployed public HTTP interface in an isolated Kubernetes namespace. Host Playwright reads test sources directly from the working directory, so test-only edits require no image build. Local development uses OrbStack and CI uses k3d with the same Kustomize base and application image definitions ([ADR 0019](0019-orbstack-development.md)).

Primary successful screen flows belong in browser E2E; API contracts difficult to reach through the UI use direct public HTTP requests from the same runner. Test data is created through public interfaces, not database assertions. Dependency-free logic and frontend-specific failures such as duplicate submission prevention and retry remain in unit tests. Stores stay concrete ([ADR 0011](0011-seam-limited-interfaces.md)).

## Considered Options

- Testcontainers or in-process HTTP tests alongside deployment tests. Rejected because a second application assembly can pass while manifests, migrations, or routing are broken.
- Test only the deployed backend and test frontend separately. Rejected because this misses browser execution and same-origin routing failures.
- A Kubernetes test Job/image. Rejected because host Playwright supports direct browser debugging and test edits without rebuilding a runner image.

## Consequences

Environment setup, database reset, normal tests, outage tests, diagnostics, and deletion remain independent commands. Local environments and data persist after success or failure until explicitly reset or deleted, allowing inspection. CI saves traces and workload diagnostics before cleanup.

Reset stops the backend, recreates the schema, and restarts the backend through the normal migration/seed path. Normal tests create unique User Accounts through HTTP; one worker and sequential commands avoid shared-state races. Outage tests restore PostgreSQL after success, failure, or catchable termination and report recovery errors separately.
