# 調査ノート: self-hosted k3s の外部 Secret 管理

- 対象: `deploy/overlays/production/kustomization.yaml` の `secretGenerator.literals`
- 前提: self-hosted k3s。現行 manifest との互換性や段階移行は要件にしない
- 調査日: 2026-08-15

## 結論

**OpenBao + OpenBao CSI Provider + Secrets Store CSI Driver を採用する。** Secret の正本は OpenBao にだけ置き、Pod は専用 ServiceAccount で認証し、CSI ephemeral volume のファイルとして読む。OpenBao server は Integrated Storage (Raft) の 3 node HA を最小構成とし、永続 volume、TLS、定期 snapshot、unseal / recovery key のクラスタ外保管を必須にする。OpenBao の Helm 文書は 3 server の HA 構成を示し、Integrated Storage は第三者のストレージを必要とせず HA と backup/restore を提供する（[OpenBao Kubernetes Helm](https://openbao.org/docs/platform/k8s/helm/run/)、[Integrated Storage](https://openbao.org/docs/internals/integrated-storage/)）。

この選択理由は、OpenBao 本体と CSI provider がともに **MPL-2.0** で、ベンダーの競合サービス条項を持たず、self-hosted k3s に必要な Kubernetes 認証、Helm 配布、CSI file mount を一つの系統で提供できるためである（[OpenBao LICENSE](https://github.com/openbao/openbao/blob/main/LICENSE)、[OpenBao CSI Provider](https://github.com/openbao/openbao-csi-provider)）。

HashiCorp Vault Community を組織内部で運用する通常の使い方は、現在の BSL 1.1 の Additional Use Grant で明示的に許可されている。一方で Vault 1.15.0 以降は OSI open-source license ではなく、IBM の有償版と競合する製品を第三者へ有償で hosted / embedded 提供する用途は許諾外になり得る。各リリースは公開から4年後に MPL-2.0 へ移行する（[Vault LICENSE](https://github.com/hashicorp/vault/blob/main/LICENSE)）。したがって、このプロジェクトを単に自組織で運用する限り直ちにライセンス問題になるわけではないが、将来の提供形態の判定とライセンス変更リスクを持ち込まない OpenBao を優先する。これは法的助言ではなく、外部提供や再配布を行う場合は法務確認が必要である。

## Vault のライセンスをコンポーネント別に見る

「Vault を Helm で入れるもの全体が同じライセンス」ではない。

| コンポーネント | 現在のライセンス | 判断への影響 |
|---|---|---|
| Vault server 1.15.0+ | BSL 1.1 + Additional Use Grant。内部利用は競合 offering ではないと明記 | 内部利用は可能だが OSI open source ではなく、競合 offering 条項がある（[server LICENSE](https://github.com/hashicorp/vault/blob/main/LICENSE)） |
| Vault CSI Provider | BSL 1.1 | server を OpenBao に替えても HashiCorp provider を残せば BSL component が残る（[provider repository](https://github.com/hashicorp/vault-csi-provider)、[license metadata](https://github.com/hashicorp/vault-csi-provider/blob/main/.copywrite.hcl)） |
| HashiCorp Vault Helm chart | MPL-2.0 | chart 自体が MPL でも、既定で配置する server/provider image のライセンスまで MPL になるわけではない（[vault-helm repository](https://github.com/hashicorp/vault-helm)） |
| Secrets Store CSI Driver | Apache-2.0 | Kubernetes SIG Auth の vendor-neutral driver で、provider とは別 component（[driver repository](https://github.com/kubernetes-sigs/secrets-store-csi-driver)） |

Vault Community は静的 secret、dynamic database credential、暗号化、lease/revocation 等を備えるが、Enterprise の DR replication や namespaces は Community に含まれない（[Vault editions](https://developer.hashicorp.com/vault/tutorials/get-started/available-editions)）。機能面では有力な選択肢だが、本件では OpenBao に対する決定的な利点が確認できない。

## OpenBao の governance と成熟度

OpenBao は Vault の MPL-2.0 世代から派生し、Linux Foundation の technical charter と公開 TSC による open governance を採る（[technical charter](https://openbao.org/assets/OpenBao-Technical-Charter-Final-2024-05-08.pdf)、[project repository](https://github.com/openbao/openbao)）。本体には KV、dynamic secrets、lease/renewal、revocation、audit、および Integrated Storage が実装されている（[project repository](https://github.com/openbao/openbao)、[Integrated Storage](https://openbao.org/docs/internals/integrated-storage/)）。

CSI provider は 2025-06 の v1.5.0 が OpenBao fork 後の最初の release で、v2.0.0 は provider 名を `openbao` に変更し Kubernetes 1.32–1.34 でテストされた。つまり、本体には長い実装系譜がある一方、独立した OpenBao CSI provider のリリース履歴は比較的新しい（[provider changelog](https://github.com/openbao/openbao-csi-provider/blob/main/CHANGELOG.md)）。採用時は k3s が内包する Kubernetes version と provider の tested range を照合し、server/chart/provider/driver の version を固定して staging で rotation と node drain を試験する。

## 「定期更新」の正確な意味

### 1. CSI の mounted-file refresh

Secrets Store CSI Driver v1.6.0 以降は CSI `RequiresRepublish` を使い、`enableSecretRotation: true` のとき kubelet の `NodePublishVolume` 再呼出しで provider から値を再取得する。`rotationPollInterval`（既定 2 分）は再取得間隔の下限であり、厳密な更新時刻は kubelet の republish cadence に依存する。この機能は現在も alpha で既定無効である（[CSI auto rotation](https://secrets-store-csi-driver.sigs.k8s.io/topics/secret-auto-rotation)、[command reference](https://secrets-store-csi-driver.sigs.k8s.io/topics/command-reference)）。

OpenBao CSI Provider は Kubernetes ServiceAccount 認証、TLS/mTLS、全 secret engine、file rendering、Helm 導入をサポートする gRPC provider である（[OpenBao CSI documentation](https://openbao.org/docs/2.5.x/platform/k8s/csi/)、[provider repository](https://github.com/openbao/openbao-csi-provider)）。したがって OpenBao 上の **静的値を別 version に更新した後**、CSI の poll により既存 Pod の mount file を再取得できる。アプリケーションはファイル変更を監視し、値を再読込して接続を張り直さなければならない。環境変数は既存 process 内では変化しない（[CSI auto rotation](https://secrets-store-csi-driver.sigs.k8s.io/topics/secret-auto-rotation)）。

### 2. source-of-truth rotation

CSI refresh は password や certificate を生成・変更する機構ではない。OpenBao の KV 値を書き替える、database secrets engine が期限付き credential を発行する、PKI engine が証明書を発行する、といった **正本側の rotation** が先にあり、CSI はその結果を配送するだけである。OpenBao は dynamic secrets に lease を付け、期限到来時の revoke と client による renewal を提供する（[OpenBao repository](https://github.com/openbao/openbao)）。

特に dynamic database credential では「CSI poll のたびに新資格情報を取得すること」と「現在 mount 中の lease を継続して renewal すること」は同義ではない。OpenBao CSI の Agent cache は dynamic lease の caching / renewal をサポートし、Agent template は renewable secret を lease の約 2/3 で renew、non-renewable secret を規則に従って再取得する（[OpenBao CSI documentation](https://openbao.org/docs/2.5.x/platform/k8s/csi/)、[Agent template renewal](https://openbao.org/docs/agent-and-proxy/agent/template/)）。dynamic secret を短期 lease で常用する場合は、CSI の mount refresh だけを lease manager と見なさず、Agent を含めた lease lifecycle、またはアプリの API 直接取得を設計する。今回の CSI 要件には、まず versioned KV の更新または十分な重複有効期間を持つ credential rotation が安全である。

## 他の self-hosted 候補

| 候補 | CSI 定期 refresh | 評価 |
|---|---|---|
| HashiCorp Vault Community | 可能。vendor-neutral CSI Driver + Vault provider | 技術的には適合し内部利用も許諾されるが、server/provider が BSL 1.1。OpenBao より優先しない |
| Infisical self-hosted | 可能。公式 CSI provider は Kubernetes ServiceAccount 認証と auto-sync を提供 | 有力な次点。ただし CSI provider は現在 static secrets のみ。core は MIT だが `ee/` と一部 self-hosted features は商用 license で、production chart は PostgreSQL と Redis も運用対象にする（[CSI docs](https://infisical.com/docs/integrations/platforms/kubernetes-csi)、[LICENSE](https://github.com/Infisical/infisical/blob/main/LICENSE)、[self-hosted Helm](https://infisical.com/docs/self-hosting/deployment-options/kubernetes-helm)） |
| External Secrets Operator | CSI ではなく Kubernetes Secret への定期 reconcile | file-only / etcd 非保存という今回の到達形に合わない。通常の `Secret` を必要とする workload なら候補 |
| SOPS / Sealed Secrets | Git 内の暗号文を controller/CD が復号 | secret store の lease、発行、source rotation、CSI refresh を提供しないため本件の代替ではない |

Infisical は UI と開発者向け workflow を重視する場合には再評価価値があるが、static CSI secrets に限定され、自己ホスト時に追加の PostgreSQL/Redis と edition 境界を管理する。本件では、単一 purpose の secrets infrastructure、MPL-2.0、dynamic engine への将来性を重視して OpenBao とする。

## 採用時の非交渉事項

1. production workload は `secretKeyRef` ではなく CSI volume file を読む。Kubernetes Secret への同期は有効化しない。
2. workload ごとに専用 ServiceAccount、OpenBao role、最小権限 policy を作る。OpenBao CSI は requesting Pod の ServiceAccount で認証する設計である（[OpenBao CSI documentation](https://openbao.org/docs/2.5.x/platform/k8s/csi/)）。
3. 初期導入では CSI Driver の `enableSecretRotation` を無効にし、アプリは起動時に file を一度だけ読む。静的値を変更するときはデータストア側の credential と OpenBao KV を一致させ、Pod を明示的に rollout する。将来rotationを有効にする場合は、poll interval、atomicなfile replacementの監視、再読込、接続張り直し、失敗時のold connection維持をまとめて設計する。
4. OpenBao は application と同じ単一 node に閉じない。少なくとも 3 voter の Raft HA とし、1/2 node は quorum / failure tolerance がないことを認識する（[Integrated Storage deployment table](https://openbao.org/docs/internals/integrated-storage/)）。
5. CSI mount は Pod 起動時に OpenBao へ到達できないと secret を取得できないため、OpenBao、DNS/network、storage、unseal を application の可用性依存として監視する（[OpenBao CSI documentation](https://openbao.org/docs/2.5.x/platform/k8s/csi/)）。
6. 将来rotationを導入するときの受入試験は「OpenBao値更新 → mount file更新 → application reload → 新credentialで接続成功 → old credential無効化」まで行う。file timestampの変化だけをrotation成功としない。

## 今回の方針

production overlay の平文 `secretGenerator.literals` は廃止し、OpenBao の識別子だけを持つ `SecretProviderClass` と CSI volume に置き換える。アプリケーションおよび PostgreSQL/Redis は起動時のfile consumptionへ変更し、現行のKubernetes Secret名や環境変数interfaceは維持しない。dynamic rotationと実行中の再読込は初期導入の対象外とする。
