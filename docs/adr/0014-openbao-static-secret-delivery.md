# OpenBao Static Secret Delivery

OpenBao is the source of truth for application secrets. Workloads authenticate
with dedicated Kubernetes ServiceAccounts and receive only their permitted KV v2
values through OpenBao CSI Provider files. Kubernetes Secret synchronization is
disabled. The application reads these files once during startup; automatic
rotation and in-process reload are deferred.

Development runs a disposable OpenBao dev server. `k3s-deploy` installs the
pinned Secrets Store CSI Driver and OpenBao chart, configures Kubernetes auth,
policies and roles idempotently, and seeds known non-sensitive development
passwords. Production runs a separate three-member Integrated Storage (Raft)
OpenBao installation with persistent data and audit volumes and TLS. Its initial
Shamir seal uses three key shares with a threshold of two. Unseal keys and the
initial root token are stored outside Kubernetes and OpenBao.

## Considered Options

- Keep generating Kubernetes Secrets in Kustomize overlays. Rejected because
  production values would still pass through CD and be stored in Kubernetes
  etcd, creating a second source of truth.
- Use environment variables populated from synchronized Kubernetes Secrets.
  Rejected because values remain in Kubernetes Secrets and the process
  environment. CSI files provide the required startup-only interface directly.
- Give all datastore workloads one OpenBao role. Rejected because PostgreSQL and
  Redis do not need each other's password. Each workload has its own
  ServiceAccount, policy and role; backend alone can read both.
- Enable automatic CSI rotation immediately. Deferred because PostgreSQL and
  Redis credential changes require coordinated source-side updates, and the
  application does not yet reload credentials while running.
- Use auto-unseal without an existing independent KMS or HSM. Rejected because
  placing the unseal root inside the same cluster creates a circular recovery
  dependency. Production uses an explicit operator unseal ceremony instead.

## Consequences

- The OpenBao server, CSI Driver and provider must be ready before a new workload
  Pod can mount secrets. Existing Pods continue with values read at startup.
- A secret change is an explicit operation: change the target datastore
  credential, update OpenBao, start and verify a new Pod, then roll out the
  remaining Pods. Updating KV alone does not rotate a running application.
- PostgreSQL's initialization password is only applied to an empty data
  directory. Operators must keep the PostgreSQL role password and OpenBao KV
  value consistent; changing one without the other is an outage.
- The Redis password is restricted to `A-Z`, `a-z`, `0-9`, `_`, and `-`. This
  allows an init container to render an ACL file without exposing the password
  in the Redis server command line.
- TLS material for OpenBao itself is a trust-bootstrap input and cannot come
  from OpenBao. Production operators provide `openbao-server-tls` before
  installing OpenBao and protect its private key independently.
