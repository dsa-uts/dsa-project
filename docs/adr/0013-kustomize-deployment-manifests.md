# Kustomize Application Manifests

The application uses a shared Kustomize base and environment overlays. An internal Helm chart added a second template language while its values mostly passed directly into a few Kubernetes resources; overlays express those differences without that extra layer. The official Traefik chart remains appropriate for third-party ingress infrastructure ([ADR 0019](0019-orbstack-development.md)).

`deploy/base` owns workload structure. Overlays own namespaces and infrastructure bindings, including image references, pull behavior, Secret delivery, and storage. `task deploy` renders Nix hash-derived image tags into a temporary overlay, leaving tracked manifests unchanged. Immutable tags change the Pod template and trigger rollouts; a mutable `latest` tag would not.

Image delivery is defined in [ADR 0019](0019-orbstack-development.md), the environment-owned Secret contract in [ADR 0017](0017-development-kubernetes-secret.md), and tests in [ADR 0012](0012-deployed-interface-tests.md). Production deployment and publication remain deferred.
