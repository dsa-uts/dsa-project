# Deployed Public Interface Tests

ADR 0013 replaces the Helm release and Helm Test mechanism described below with an isolated namespace and an ordinary Kubernetes test Job. ADR 0018 supersedes that Job runner with host Playwright and independently managed environment/data lifecycles. The deployed public-interface test seam remains accepted.

Tests that need PostgreSQL or a running backend execute in an isolated namespace on k3s and observe only the deployed public HTTP interface, including browser-visible behavior. Pure logic keeps dependency-free unit tests, but testcontainers and tests that assemble the server in-process are retired so local development and CI exercise the same manifests, images, migrations, routing, and datastore integration.

This ADR supersedes only the real-database and in-process HTTP test strategy from ADR 0011. ADR 0011's seam-limited interface decision remains in effect: store types stay concrete, and repository interfaces are not introduced solely for testing.

## Considered Options

- Keep testcontainers-based HTTP-seam tests alongside deployment tests. Rejected because it preserves a second application assembly and dependency-provisioning path that can pass while the deployed system is broken.
- Test the deployed backend directly while testing the frontend separately. Rejected because it misses failures in browser execution, same-origin API calls, and ingress routing.

## Consequences

- Local tests use host k3s and CI uses k3d, but both run the same Kustomize base and Kubernetes test Job image; only the overlay, cluster provisioning, and image delivery differ.
- Each run uses an isolated test namespace. PostgreSQL is test infrastructure, not a mock, and test state is created through the public interface.
- Tests that require the deployed system are slower than in-process tests, so only pure dependency-free behavior remains in the fast unit-test suite.
