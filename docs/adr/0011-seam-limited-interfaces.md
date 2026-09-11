# Seam-Limited Interfaces

Go interfaces are introduced only where substitution actually happens: the Judge executor and the clock. Store types stay concrete; repository interfaces and mock-based isolation between handler, service, and store are deliberately absent.

Most API behavior consists of authorization-guarded reads and writes. Layer mocks miss failures in SQL and authorization conditions while adding interfaces to maintain. Deployed public-interface tests cover those integrations ([ADR 0012](0012-deployed-interface-tests.md)).

The PostgreSQL job queue is the contract between backend and Judge, preserving the executor seam through a fake-to-real executor swap or a later separate Judge binary. Shared state ownership is defined in [ADR 0015](0015-postgresql-as-shared-state-store.md).
