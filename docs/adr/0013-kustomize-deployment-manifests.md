# Kustomize Deployment Manifests Without Helm

The local/production environment split and repository-managed cluster lifecycle
described below are superseded by ADR 0016. The secret delivery assumed by
those overlays is superseded by ADR 0017. The shared Kustomize base and ordinary
Kubernetes Job decisions remain accepted.

The application is deployed from a shared Kustomize base with local and production overlays, replacing the internal Helm chart. The chart was not distributed and its values mostly passed directly into five Kubernetes resources, so Helm added a second template language without hiding meaningful deployment complexity. Local deployment imports Nix-built images into the single-node k3s containerd and renders immutable Nix hash tags into a temporary local overlay; production deployment uses GHCR images pinned by digest.

## Considered Options

- Keep Helm for centralized values and Helm Test. Rejected because Kustomize overlays centralize the actual environment differences, while ordinary Kubernetes Jobs provide the deployed public-interface test seam.
- Use a mutable `latest` tag locally. Rejected because pushing the tag does not change the Deployment Pod template and therefore does not trigger a rollout; immutable tags make the deployed version observable and rollbackable.
- Run a local container registry. Deferred until local development becomes multi-node or needs to exercise registry pull behavior; direct import is the smaller adapter for the current single-node cluster.

## Consequences

- `deploy/base` owns shared workload structure. Overlays contain environment-specific namespace and infrastructure bindings, including image references, pull behavior, secret delivery, and storage class selection.
- No Helm release compatibility is retained because the application has not been deployed; Helm release metadata is not used.
- `task deploy` is the development deployment interface and generates no tracked manifest changes.
- Production CD must replace the sentinel production digests with digests returned by GHCR before applying the overlay.
- Deployed interface tests use an isolated namespace and an ordinary Kubernetes test Job rather than a Helm release and Helm Test hook.
- This supersedes only the Helm-specific deployment and test-runner consequences in ADR 0005, ADR 0008, and ADR 0012; their Kubernetes, topology, and public-interface decisions remain accepted.
