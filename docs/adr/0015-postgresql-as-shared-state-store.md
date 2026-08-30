# PostgreSQL as the Shared State Store

The OpenBao integration mentioned below is superseded by ADR 0017. PostgreSQL
remains the shared state store.

Status: accepted

Redis is removed from the deployment before the first production release.
PostgreSQL owns durable domain state, login sessions with an `expires_at`
timestamp, workflow and job progress, and the job queue shared by backend and
Judge Pods. Expired session rows may be deleted asynchronously; authorization
must reject them based on `expires_at` even before physical deletion.

Judge discovers claimable work from PostgreSQL. Polling is the baseline delivery
mechanism. PostgreSQL `LISTEN`/`NOTIFY` may later be added only as a wake-up hint;
the durable table remains the source of truth and polling remains the recovery
path. Object storage is reserved for artifacts and other large immutable blobs,
not sessions, mutable progress, job claims, or notifications.

## Considered Options

- Keep Redis for sessions, progress caches, and job notifications. Rejected
  because these features have not been implemented yet, the expected deployment
  is about 100 users, and a second datastore adds deployment, secret, monitoring,
  failure, and consistency concerns before measured load requires it.
- Store transient shared state in object storage. Rejected because object stores
  are a poor fit for expiration checks, frequent small updates, conditional job
  claims, and transactional coordination with durable job state.
- Use only PostgreSQL. Chosen because the database already owns the durable job
  queue and state, allowing state transitions and progress to share one
  transactional source of truth.

## Consequences

- Redis deployments, services, client dependencies, configuration, credentials,
  and OpenBao access are removed.
- Session expiry requires query-time checks, an index on `expires_at`, and an
  eventual cleanup process when sessions are implemented.
- Progress updates must be rate-limited or coalesced if measurements show
  excessive write amplification.
- Job pickup may have polling latency. `LISTEN`/`NOTIFY` can reduce that latency
  without becoming a second source of truth.
- Redis or another specialized store may be introduced later for a narrow,
  measured bottleneck; callers should not gain a speculative datastore seam now.
