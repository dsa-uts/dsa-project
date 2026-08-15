# OpenBao による Secret 管理

- 対象: `deploy/overlays/production/kustomization.yaml` の `secretGenerator.literals`
- 前提: self-hosted k3s。現行 manifest との互換性や段階移行は要件にしない

## 構成

OpenBao、OpenBao CSI Provider、Secrets Store CSI Driver を使用する。Secret の正本は OpenBao の versioned KV にだけ置き、Pod は専用 ServiceAccount で認証し、CSI ephemeral volume にマウントされたファイルとして読む（[OpenBao CSI documentation](https://openbao.org/docs/2.5.x/platform/k8s/csi/)）。Kubernetes Secret への同期は行わない。

OpenBao server は Integrated Storage (Raft) を使う。永続 volume、TLS、定期 snapshot、unseal key のクラスタ外保管を必須とする（[OpenBao Kubernetes Helm](https://openbao.org/docs/platform/k8s/helm/run/)、[Integrated Storage](https://openbao.org/docs/internals/integrated-storage/)）。

## Workload からの利用

1. workload ごとに専用 ServiceAccount を作る。
2. ServiceAccount に対応する OpenBao role と、必要な versioned KV の読み取りだけを許可する最小権限 policy を作る。
3. OpenBao の secret path を指定した `SecretProviderClass` を作る。
4. `SecretProviderClass` を参照する CSI volume を Pod に追加し、アプリケーションから読み取り専用ファイルとして参照する。

OpenBao CSI Provider は、要求元 Pod の ServiceAccount を使って OpenBao に認証する。通信には TLS を使用し、server/chart/provider/driver の version は固定する（[OpenBao CSI documentation](https://openbao.org/docs/2.5.x/platform/k8s/csi/)、[OpenBao CSI Provider](https://github.com/openbao/openbao-csi-provider)）。

アプリケーションと PostgreSQL/Redis は、起動時にマウントされたファイルから値を読む。既存の Kubernetes Secret 名や環境変数 interface は維持しない。

## Secret の更新

CSI Driver による自動更新は有効化せず、アプリケーションは起動時にファイルを一度だけ読む。versioned KV の値を更新するときは、利用先の credential と OpenBao の値を一致させたうえで Pod を明示的に rollout する。

## 運用上の注意

- CSI mount は Pod 起動時に OpenBao へ到達できないと失敗する。OpenBao、DNS/network、storage、unseal の状態をアプリケーションの可用性依存として監視する。
- production workload は `secretKeyRef` ではなく CSI volume file を読む。Kubernetes Secret への同期は有効化しない。
- OpenBao の snapshot を定期的に取得し、復元手順を検証する。
- k3s の Kubernetes version と OpenBao CSI Provider の対応 version を照合し、更新前に staging で Pod の起動と node drain を検証する。

## Production manifest の方針

production overlay の平文 `secretGenerator.literals` は廃止し、OpenBao の secret path だけを持つ `SecretProviderClass` と CSI volume に置き換える。
