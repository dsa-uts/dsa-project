# Helm chart の静的検証 (nix flake check で走る)。
# クラスタ不要のオフライン検証: helm lint --strict と helm template で
# render し、期待する manifest が揃っているかを確認する。
# image tag は required (values.yaml 参照) なのでダミー値を渡す。
{ pkgs }:
let
  setFlags = "--set backend.image.tag=check --set frontend.image.tag=check";
in
pkgs.runCommand "chart-check"
  {
    nativeBuildInputs = [ pkgs.kubernetes-helm ];
  }
  ''
    export HOME="$TMPDIR" # helm はキャッシュ dir を書く
    helm lint --strict ${setFlags} ${../chart}
    helm template dsa ${../chart} ${setFlags} > rendered.yaml

    # 期待する manifest が一通り render されていること
    for want in \
      "kind: Deployment" \
      "kind: Service" \
      "kind: Ingress" \
      "name: dsa-backend" \
      "name: dsa-frontend" \
      "image: dsa-backend:check" \
      "image: dsa-frontend:check"; do
      grep -q "$want" rendered.yaml || {
        echo "chart-check: '$want' not found in rendered manifests" >&2
        exit 1
      }
    done

    touch $out
  ''
