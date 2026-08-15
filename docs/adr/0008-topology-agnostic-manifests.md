# Topology-Agnostic Manifests, Single-Node Default Deployment

ADR 0013 replaces the Helm packaging described below with Kustomize overlays. The topology-agnostic manifest decision remains accepted.

We considered splitting the cluster into a control-plane node plus worker node(s), then retracted it. Deployment targets provide a single Linux machine, so the default deployment is one single-node k3s cluster running directly on that host. Separately from how we deploy, the application manifests must not assume any cluster topology: the platform must run unchanged on a multi-node cluster, and no mechanism may depend on two Pods sharing a node. This retires hostPath-based Sandbox Workspace injection even on single-node deployments.

## Considered Options

- Separate control plane and worker nodes on the single machine. Enables a dedicated, tainted sandbox node as a stronger separation path, but adds management overhead without adding a physical isolation boundary.
- Single-node deployment with manifests that assume node co-location (status quo per ADR 0005). Simplest, but couples the manifests to one cluster shape; it would break on any multi-node cluster.
- Single-node default deployment with topology-agnostic manifests (chosen). Deployment stays one command while the manifests remain portable to multi-node clusters.

## Consequences

- Supersedes the ADR 0005 consequence that workspace injection via hostPath may assume the Judge and sandboxes share one node. Sandbox Pods use no hostPath volumes; the ValidatingAdmissionPolicy forbids hostPath in the sandbox namespace instead of allowlisting a fixed prefix.
- A replacement Sandbox Workspace handoff mechanism must be selected before `judge/` template work starts. Candidates are compared in ADR 0009, which selects pods/exec streaming via a platform loader container.
- A dedicated sandbox node is not required by this ADR: sandbox isolation continues to rest on gVisor, namespace boundaries, RBAC, NetworkPolicy, and admission policy, as accepted in ADR 0005. A multi-node operator may still add taints for scheduling, but the manifests must not depend on it.
- Recorded as the Principle "Topology-Agnostic Manifests" in CONTEXT.md.
