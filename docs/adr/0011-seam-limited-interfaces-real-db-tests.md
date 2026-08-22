# Seam-Limited Interfaces, Real-Database Tests

Status: accepted

The Redis notifier portion of this decision is superseded by ADR 0015. The
database job queue and seam-limited interface decisions remain accepted.

ADR 0012 supersedes the test strategy described below: tests that require PostgreSQL or a running backend now exercise a deployment in an isolated k3s namespace through its public HTTP interface. The seam-limited interface decision, including the deliberate absence of repository interfaces, remains accepted. ADR 0013 records the Kustomize and Kubernetes Job deployment mechanism.

Go interfaces are introduced only where substitution actually happens: `judge.Executor` (fake worker during the stub-first milestones, sandbox executor later, and the future `cmd/judge` binary) and the clock. Store types stay concrete and are tested against a real PostgreSQL (testcontainers or equivalent); handler tests go through httptest with a real store. There is deliberately no repository-interface layer and no mock-based unit isolation between layers.

## Considered Options

- Interface + mock for every layer (handler → service interface → repository interface). Rejected: most of this API is authorization-guarded reads and writes, so the bugs live in the SQL and the authorization conditions — exactly what layer mocks cannot exercise. The pattern earns its cost when teams parallelize across an unfinished layer, which does not apply to solo vertical-slice development.

## Consequences

- A future reader should not "fix" the concrete stores by adding repository interfaces; the omission is deliberate.
- Tests require Docker (or a running PostgreSQL) in every development and CI environment.
- The database job queue is the contract between backend and judge, so the seam survives the fake-to-real executor swap and a later split into a separate judge binary without repackaging.
