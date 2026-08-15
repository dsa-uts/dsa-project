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
        "kind: Secret" \
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
    done

    grep -q "image: dsa-backend:local" local.yaml
    grep -q "image: dsa-frontend:local" local.yaml
    grep -q "imagePullPolicy: Never" local.yaml
    grep -q "image: postgres:17.6" local.yaml
    grep -q "image: redis:8.2.1" local.yaml
    grep -q "storageClassName: local-path" local.yaml
    grep -q "app.kubernetes.io/instance: dsa" local.yaml
    grep -q "image: ghcr.io/dsa-uts/dsa-backend@sha256:" production.yaml
    grep -q "image: ghcr.io/dsa-uts/dsa-frontend@sha256:" production.yaml

    render-local-manifests backend-check frontend-check > generated-local.yaml
    grep -q "image: dsa-backend:backend-check" generated-local.yaml
    grep -q "image: dsa-frontend:frontend-check" generated-local.yaml
    grep -q "imagePullPolicy: Never" generated-local.yaml

    touch $out
  ''
