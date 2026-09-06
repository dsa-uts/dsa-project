# Externally Managed k3s

Status: accepted

The repository assumes an available, long-running k3s cluster whose lifecycle
is owned elsewhere. Development currently runs the repository and k3s on the
same VM, but this repository neither installs nor starts, stops, resets,
upgrades, backs up, or recovers the cluster. Deployment uses the current
`kubectl` context; it builds images with Nix, imports them into the
same VM's k3s containerd, and applies application manifests.

## Considered Options

- Continue creating a transient k3s server from this repository. Rejected
  because the development environment provides a persistent cluster and assigns
  its lifecycle to another repository.
- Push images through a registry or transfer them to another host. Rejected for
  development because image builds and k3s run on the same VM, so direct
  containerd import is simpler and requires no additional registry credential.
- Treat image import as cluster management and remove it. Rejected because
  delivering application images is part of deployment, not ownership of the
  cluster lifecycle.

## Consequences

- Application commands may deploy, inspect, log, test, and remove only the
  namespaces owned by this repository. They must not attempt to repair or start
  an unavailable cluster.
- The development environment is named `dev`, not `local`, because it denotes
  an environment rather than the physical location of the cluster.
- Deployed public-interface tests use an isolated namespace on the provided
  cluster. ADR 0018 supersedes automatic per-run deletion: local environments
  persist until explicitly deleted, and CI saves diagnostics before cleanup.
- k3s server runtime dependencies are removed from the development shell. The
  `k3s` CLI remains available for image import, alongside `kubectl` and
  `kustomize`.
