# Native macOS Development with Externally Managed Kubernetes

Development commands, editing, and host Playwright run on Apple Silicon macOS so browsers can access the application directly. Applications and PostgreSQL run on externally managed OrbStack Kubernetes; Linux CI uses k3d. The repository owns application deployment and image delivery, while OrbStack and the Linux builder lifecycle, upgrades, backup, and recovery remain external. Application commands inspect or modify only repository-owned namespaces and stop if the expected cluster is unavailable; they do not start or repair it. The environment is named dev because it denotes an environment rather than cluster location.

## Images and Ingress

Nix exposes native macOS packages/devShell and Linux-only image outputs. The dotfiles-managed Linux builder produces complete image tar archives, loaded through the OrbStack Docker context. OrbStack shares Docker images with Kubernetes, so direct import avoids a development registry and credentials. CI uses Docker/k3d import. Hash-derived tags trigger rollouts through temporary Kustomize overlays ([ADR 0013](0013-kustomize-deployment-manifests.md)). Daily deployment builds, loads, applies, and waits for readiness; databases persist across deployment.

The repository installs the official Traefik Helm chart with a pinned version and shared values. CI disables k3d's bundled Traefik and installs the same chart. Helm serves third-party ingress infrastructure; application manifests use Kustomize. Development and E2E have separate namespaces and databases, use the cluster's default StorageClass, and are selected by Ingress hostname.

## Host Browser and TLS

OrbStack development domains use HTTPS because Secure `__Host-` session cookies require it on custom domains. OrbStack manages certificates; Chromium uses its trusted CA in the macOS Keychain. The pinned Nix Node build does not discover that user CA through its system-CA option, so the devShell exports only the public CA to the OS cache for `NODE_EXTRA_CA_CERTS`; certificate verification remains enabled. CI overrides the E2E Ingress host and TLS annotation to use HTTP on localhost port 8080.

macOS installs Chromium through the locked Playwright npm package into its standard OS cache. Linux uses Nix-provided browsers and Linux-only browser/font settings. Tests read the working directory directly; environment/data lifecycles and the public HTTP test boundary are defined in [ADR 0012](0012-deployed-interface-tests.md).

Production publication, GHCR delivery, GitOps, and credential management remain deferred ([ADR 0017](0017-development-kubernetes-secret.md)).
