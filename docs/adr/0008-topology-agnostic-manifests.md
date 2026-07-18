# Topology-agnostic manifests, single-node default deployment

We considered splitting the cluster into a control-plane VM plus worker VM(s), then retracted it. Deployment targets provide a single machine or VM, so the default deployment is one single-node k3s cluster: on Linux the k3s server runs directly on the host (running extra VMs on one machine adds overhead for little isolation gain, and when the host is itself a VM it forces nested virtualization); on macOS development machines the k3s server runs inside one microvm.nix + vfkit VM. Separately from how we deploy, the application manifests (Helm chart) must not assume any cluster topology: the platform must run unchanged on a multi-node cluster, and no mechanism may depend on two Pods sharing a node. This retires hostPath-based Sandbox Workspace injection even on single-node deployments.

## Considered Options

- Control plane VM + worker VM(s) on the single machine. Enables a dedicated, tainted sandbox node as a stronger separation path, but on one machine the VM boundary buys little isolation for the added VM management overhead, and inside a VM-based deployment it means nested virtualization.
- Single-node deployment with manifests that assume node co-location (status quo per ADR 0005). Simplest, but couples the chart to one cluster shape; it would break on any multi-node cluster.
- Single-node default deployment with topology-agnostic manifests (chosen). Deployment stays "install k3s, install one Helm chart" while the chart stays portable to multi-node clusters.

## Consequences

- Supersedes the ADR 0005 consequence that workspace injection via hostPath may assume the Judge and sandboxes share one node. Sandbox Pods use no hostPath volumes; the ValidatingAdmissionPolicy forbids hostPath in the sandbox namespace instead of allowlisting a fixed prefix.
- A replacement Sandbox Workspace handoff mechanism must be selected before `judge/` template work starts. Candidates are compared in ADR 0009; the selection is pending there.
- A dedicated sandbox node is not required by this ADR: sandbox isolation continues to rest on gVisor, namespace boundaries, RBAC, NetworkPolicy, and admission policy, as accepted in ADR 0005. A multi-node operator may still add taints for scheduling, but the manifests must not depend on it.
- Recorded as the Principle "Topology-Agnostic Manifests" in CONTEXT.md.
