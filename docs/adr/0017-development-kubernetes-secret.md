# Development Kubernetes Secret

Status: accepted

OpenBao is removed because its operational cost is not justified during the
current development stage. The `dev` overlay provides a Git-tracked, explicitly
non-production Kubernetes Secret with the fixed development PostgreSQL
password. Production deployment and credential management are intentionally
left undefined until their requirements are designed; the unused production
overlay is removed rather than retaining a broken or misleading configuration.

The base manifests consume a Secret named `dsa-datastore` with a
`postgres-password` key through the existing password-file interface. An
environment owns how that Secret is produced, allowing a future production
credential system to satisfy the same workload contract without coupling the
base manifests to a particular product.

## Considered Options

- Keep OpenBao for development and a possible future production deployment.
  Rejected because maintaining the server, CSI integration, policies, bootstrap
  procedure, and recovery material costs more than it currently provides.
- Commit an encoded value instead of a plaintext development value. Rejected
  because base64 encoding does not protect a Kubernetes Secret and would obscure
  that the value is intentionally non-sensitive and development-only.
- Select a production secret manager now. Deferred because production is not
  deployed and its credential-management and authentication requirements have
  not been decided.

## Consequences

- OpenBao, Helm, the Secrets Store CSI integration, and their scripts,
  manifests, dependencies, runbooks, and research notes are removed.
- The tracked development Secret must never be reused for production.
- E2E and development provide environment-specific values under the same
  `dsa-datastore` Secret contract.
- The API does not prescribe OpenBao or a registration authentication mechanism;
  authentication remains undecided until that feature is designed.
