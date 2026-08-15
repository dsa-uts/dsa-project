# Kubernetes manifest の静的検証 (nix flake check で走る)。
{ pkgs }:
let
  manifests = ../deploy;
  renderLocalManifests = import ./render-local-manifests.nix { inherit pkgs manifests; };
in
pkgs.runCommand "manifest-check"
  {
    nativeBuildInputs = [
      pkgs.kubectl
      renderLocalManifests
    ];
  }
  ''
    kubectl kustomize ${manifests}/overlays/local > local.yaml
    kubectl kustomize ${manifests}/overlays/production > production.yaml

    for rendered in local.yaml production.yaml; do
      for want in \
        "kind: Deployment" \
        "kind: StatefulSet" \
        "kind: PersistentVolumeClaim" \
        "kind: SecretProviderClass" \
        "kind: ServiceAccount" \
        "kind: Service" \
        "kind: Ingress" \
        "name: dsa-backend" \
        "name: dsa-frontend" \
        "name: dsa-postgresql" \
        "name: dsa-redis"; do
        grep -q "$want" "$rendered" || {
          echo "manifest-check: '$want' not found in $rendered" >&2
          exit 1
        }
      done

      if grep -qE "kind: Secret$|secretKeyRef:" "$rendered"; then
        echo "manifest-check: Kubernetes Secret material found in $rendered" >&2
        exit 1
      fi
      test "$(grep -c "driver: secrets-store.csi.k8s.io" "$rendered")" -eq 3
      for workload in backend postgresql redis; do
        grep -q "name: dsa-$workload-secrets" "$rendered"
        grep -q "serviceAccountName: dsa-$workload" "$rendered"
      done
    done

    grep -q "image: dsa-backend:local" local.yaml
    grep -q "image: dsa-frontend:local" local.yaml
    grep -q "imagePullPolicy: Never" local.yaml
    grep -q "image: postgres:17.6" local.yaml
    grep -q "image: redis:8.2.1" local.yaml
    grep -q "storageClassName: local-path" local.yaml
    grep -q "app.kubernetes.io/instance: dsa" local.yaml
    grep -q "secretPath: kv/data/dsa/dev/postgresql" local.yaml
    grep -q "secretPath: kv/data/dsa/dev/redis" local.yaml
    grep -q "image: ghcr.io/dsa-uts/dsa-backend@sha256:" production.yaml
    grep -q "image: ghcr.io/dsa-uts/dsa-frontend@sha256:" production.yaml
    grep -q "secretPath: kv/data/dsa/prod/postgresql" production.yaml
    grep -q "secretPath: kv/data/dsa/prod/redis" production.yaml
    grep -q "baoAddress: https://openbao.openbao.svc:8200" production.yaml

    render-local-manifests backend-check frontend-check > generated-local.yaml
    grep -q "image: dsa-backend:backend-check" generated-local.yaml
    grep -q "image: dsa-frontend:frontend-check" generated-local.yaml
    grep -q "imagePullPolicy: Never" generated-local.yaml

    touch $out
  ''
