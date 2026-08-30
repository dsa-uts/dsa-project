# Kubernetes (k3s) over Docker Compose

The Helm-specific deployment consequence below is superseded by ADR 0013. The
decision to run the platform on k3s remains accepted. ADR 0016 supersedes the
repository-managed k3s lifecycle described below.

The platform runs all services and sandboxes on one k3s cluster, replacing the previous two-layer design of docker compose plus a sandbox-only containerd daemon. The Judge creates sandbox Pods directly (`restartPolicy: Never`, gVisor RuntimeClass) in a dedicated namespace and executes each Step via pods/exec. Its ServiceAccount holds a Role scoped to the sandbox namespace only, so it cannot delete itself or touch service Pods. A built-in ValidatingAdmissionPolicy (CEL) restricts sandbox images to the project's GHCR org with mandatory `@sha256:` digests — the enforcement layer for Digest Pinning. This buys declarative resource control, namespace-scoped RBAC, and admission-time image policy that compose cannot express.

## Considered Options

- Keep docker compose + sandbox-only containerd. Resource limits and hardening stay imperative code in the Judge, and there is no policy layer to constrain what the Judge may create or which registries sandbox images may come from.
- Move only the sandbox layer to k8s. This doubles the operational surface (compose and k8s side by side), and the Judge would sit outside the cluster where ServiceAccount-based, namespace-scoped RBAC is unnatural — the main motivation for k8s would not apply to the component that needs it most.
- Run sandboxes as k8s Job resources. The name collides with the domain term Job, and Job retry/backoff semantics conflict with Isolated Job Workspace (an implicit re-run would duplicate results); durable job state is already owned by the DB with the Judge polling and claiming.
- Use Kyverno or OPA Gatekeeper for admission. Resident policy engines are oversized for a registry allowlist plus a digest requirement at this deployment's scale; the built-in ValidatingAdmissionPolicy covers both with zero extra components.
- Add Istio for mTLS and L7 control. Too heavy for a ~100-user deployment; NetworkPolicy (default egress deny for the sandbox namespace) covers the actual requirement.

## Consequences

- The daemon-level separation of the sandbox-only containerd is gone: every workload shares the k3s-embedded containerd. Isolation now rests on gVisor's kernel isolation (RuntimeClass), with namespace boundaries, RBAC, NetworkPolicy, and admission policy covering the management plane.
- This ADR originally injected Sandbox Workspaces via hostPath, which assumed the Judge and sandboxes share one node. That consequence is superseded by ADR 0008 (Topology-Agnostic Manifests): sandbox Pods use no hostPath, and the handoff mechanism is selected in ADR 0009.
- Superseded by ADR 0013: "one-command deploy" meant starting k3s and applying
  the environment's Kustomize overlay through the deployment command. ADR 0016
  later moves the k3s lifecycle outside this repository; deployment now assumes
  an available cluster.
