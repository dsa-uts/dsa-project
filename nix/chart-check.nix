# Helm chart の静的検証 (nix flake check で走る)。
# クラスタ不要のオフライン検証: helm lint --strict と helm template で
# render し、期待する manifest が揃っているかを確認する。
# image tag は required (values.yaml 参照) なのでダミー値を渡す。
{ pkgs }:
let
  setFlags = "--set backend.image.tag=check --set frontend.image.tag=check --set postgresql.auth.username=check --set postgresql.auth.password=check --set postgresql.auth.database=check --set redis.auth.password=check";
in
pkgs.runCommand "chart-check"
  {
    nativeBuildInputs = [
      pkgs.kubernetes-helm
      pkgs.jq
      pkgs.yq-go
    ];
  }
  ''
    export HOME="$TMPDIR" # helm はキャッシュ dir を書く
    helm lint --strict ${setFlags} --values ${../chart}/values-development.yaml ${../chart}
    helm template dsa ${../chart} ${setFlags} --values ${../chart}/values-development.yaml > rendered.yaml
    yq eval --output-format=json rendered.yaml | jq --slurp . > rendered.json

    check_resource() {
      kind="$1"
      name="$2"
      expression="$3"
      jq --exit-status \
        ".[] | select(.kind == \"$kind\" and .metadata.name == \"$name\") | $expression" \
        rendered.json >/dev/null || {
          echo "chart-check: $kind/$name failed: $expression" >&2
          exit 1
        }
    }

    check_resource Deployment dsa-backend \
      '.spec.template.spec.containers[0].image == "dsa-backend:check" and ([.spec.template.spec.containers[0].env[].name] == ["DATABASE_URL", "REDIS_URL"])'
    check_resource Deployment dsa-frontend \
      '.spec.template.spec.containers[0].image == "dsa-frontend:check"'
    check_resource StatefulSet dsa-postgresql \
      '.spec.template.spec.containers[0].image == "postgres:17.6" and .spec.template.spec.volumes[0].persistentVolumeClaim.claimName == "dsa-postgresql"'
    check_resource Deployment dsa-redis \
      '.spec.template.spec.containers[0].image == "redis:8.2.1" and .spec.template.spec.volumes[0].emptyDir == {}'
    check_resource Secret dsa-datastore \
      '.stringData | has("database-url") and has("redis-url") and has("postgres-password") and has("redis-password")'
    check_resource PersistentVolumeClaim dsa-postgresql \
      '.spec.storageClassName == "local-path"'
    check_resource Service dsa-backend \
      '.spec.selector."app.kubernetes.io/component" == "backend"'
    check_resource Service dsa-frontend \
      '.spec.selector."app.kubernetes.io/component" == "frontend"'
    check_resource Service dsa-postgresql \
      '.spec.selector."app.kubernetes.io/component" == "postgresql"'
    check_resource Service dsa-redis \
      '.spec.selector."app.kubernetes.io/component" == "redis"'
    check_resource Ingress dsa \
      '[.spec.rules[0].http.paths[] | {"path": .path, "service": .backend.service.name}] == [{"path":"/health","service":"dsa-backend"},{"path":"/api","service":"dsa-backend"},{"path":"/","service":"dsa-frontend"}]'

    # 通常 defaults に usable な固定 credential を置かず、development 専用
    # values だけで release を render できること。
    if helm template dsa ${../chart} ${setFlags} | grep -q "development-password"; then
      echo "chart-check: development credential leaked into chart defaults" >&2
      exit 1
    fi
    helm lint --strict \
      --set backend.image.tag=check \
      --set frontend.image.tag=check \
      --values ${../chart}/values-development.yaml \
      ${../chart}
    helm template dsa ${../chart} \
      --set backend.image.tag=check \
      --set frontend.image.tag=check \
      --values ${../chart}/values-development.yaml \
      | grep -q "development-password"

    # URL reserved characters in supplied credentials must be escaped in DSNs.
    helm template dsa ${../chart} ${setFlags} \
      --set-string postgresql.auth.password='p@ss/word' \
      --set-string redis.auth.password='p@ss/word' \
      | grep -q 'p%40ss%2Fword'

    touch $out
  ''
