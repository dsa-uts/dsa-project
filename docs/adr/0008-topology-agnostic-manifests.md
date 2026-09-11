# Topology-Agnostic Manifests

Application manifests must run unchanged on single-node and multi-node clusters. No mechanism may depend on the Judge and sandbox Pods sharing a node: hostPath-based Sandbox Workspace injection would couple the application to one cluster shape. Admission policy forbids hostPath in the sandbox namespace; [ADR 0009](0009-sandbox-workspace-handoff.md) selects pods/exec streaming instead.

A dedicated sandbox node is optional. Splitting a single physical host into control-plane and worker nodes adds management overhead without a physical isolation boundary. Isolation rests on gVisor, namespaces, RBAC, NetworkPolicy, and admission policy ([ADR 0005](0005-kubernetes-over-compose.md)); multi-node operators may add scheduling taints, but manifests must not depend on them.

This decision defines the Topology-Agnostic Manifests principle in [CONTEXT.md](../../CONTEXT.md). Cluster provisioning is external ([ADR 0019](0019-orbstack-development.md)).
