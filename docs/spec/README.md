# オンラインジャッジWebアプリ 仕様書

このドキュメントは要件とシステム構成の概観を所有する。詳細は各仕様ファイルが所有し、ここでは繰り返さない。

## 仕様ファイル

- [Resource 仕様](./resource.md) — Resource リポジトリ契約、Resource YAML スキーマ、sandbox hardening
- [REST API 仕様](../../api/openapi.yaml) — クライアント向け REST API の形(single source of truth、ADR 0010)。[api.md](./api.md) は Conventions と未実装エンドポイントの草稿
- DB スキーマは [backend/internal/store/migrations/](../../backend/internal/store/migrations/) の SQL ファイルが正(Markdown の複製は持たない)

用語と Principles は [../../CONTEXT.md](../../CONTEXT.md) を正とする。

## 概要
プログラミング演習課題のオンラインジャッジWebアプリケーション

| 項目 | 内容 |
| -- | -- |
| プロジェクト名 | dsa-project |
| 目的 | 提出された Submission に対して、あらかじめ設定された Workflow を実行し、採点補助に役立てる |

## 対象ユーザー

| Role | 人数 | 権限 |
| -- | -- | -- |
| Admin | 1 | ManagerおよびUserの作成・削除、課題の作成・更新・削除 |
| Manager | 4~5 (想定) | 全ユーザーの提出物をまとめて Request する |
| * (全員) | 90~100 (想定) | 自身の提出物をリクエストする |

## システム要件

### 機能要件
- ユーザー認証・認可
- Request
  - 提出
  - 結果の表示
- Admin 機能
  - ユーザーの作成・削除
    - 作成: シングルユーザーの作成、およびスプレッドシートから複数ユーザーの一括作成
  - Resource の作成・更新・削除
    - Resource は GitHub org の private repository で管理する
    - main ブランチ更新時に GitHub Actions が sandbox 用コンテナイメージを build / push し、Backend の Admin API に新しい Resource を登録する
- Manager 機能
  - 複数のユーザーが提出した Submission を全て一つにまとめたzipファイルをアップロードし、まとめて Request する。
  - フォーマットが微妙に異なることで Request が失敗する提出に対して、その場で修正して再 Request することができる
  - ユーザーの並び替え(Manaba 等の外部ツールの並び順に合わせる。Admin も可)
- Resource Version 管理
  - Resource を更新しても古い Resource Version を参照できる
  - 複数の Resource Version に対して Request することができる
    - 差分を確認するため
  - Resource Version には、GitHub の commit SHA、GitHub Actions の Actions run ID、GHCR の image digest を紐づける
  - Request 実行時は Resource Version に固定された image digest を参照する

### 非機能要件
- セキュリティ
  - ログイン認証時に、ロール毎に異なる権限を設定
  - GitHub Actions から Backend への Resource Version 登録は Registration-only API で行う([resource.md](./resource.md) 参照)
  - sandbox 上での任意のコード実行は resource limit と platform 固定 hardening で隔離する([resource.md](./resource.md) 参照)
- 可用性
  - 24時間稼働
- 可搬性
  - 簡単にデプロイできる
    - 環境共通の設定はKustomize base、開発環境差はdev overlayにまとまっている。
    - 外部管理のk3sへ環境overlayをデプロイコマンド一つで適用できる。
    - 初回起動時にのみ初期設定用 Web UI が表示され、Admin アカウントのパスワード等を指定できる。

## システム構成

### アーキテクチャ

```mermaid
flowchart LR
  client[Client]

  subgraph github["GitHub"]
    repo["Private repository (main)"]
    gha["GitHub Actions<br/>GitHub-hosted runner + buildx"]
    ghcr["GHCR<br/>Container registry"]
  end

  subgraph host["Deployment target (既定: シングルノード)"]
    subgraph k3s["k3s cluster (containerd + gVisor RuntimeClass)"]
      api["kube-apiserver<br/>RBAC + ValidatingAdmissionPolicy"]

      subgraph nsServices["Namespace: services"]
        IG[Traefik Ingress]
        FE[Frontend]
        BE[Backend]
        DB[(PostgreSQL)]
        JD[Judge]
      end

      subgraph nsSandbox["Namespace: sandbox"]
        sandbox["Sandbox Pod (temporary, runtimeClassName: gvisor)"]
      end
    end
  end

  repo -->|push to main| gha
  gha -->|buildx build / push image| ghcr
  gha -->|Admin API: Resource Version + image digest| IG

  client -->|HTTPS :443| IG
  IG -->|SPA / static files| FE
  IG -->|/api/...| BE

  BE -->|CRUD / auth users / durable job state| DB

  JD -->|poll / claim jobs / update results| DB
  JD -->|resolve Resource Version image digest| DB
  JD -->|create / delete sandbox Pod| api
  api -->|schedule with gVisor RuntimeClass| sandbox
  k3s -->|pull image by digest| ghcr
  JD -->|"execute Step (pods/exec)"| sandbox
  sandbox -->|stdout / stderr / status| JD
```

* PostgreSQL: データの永続化 (User, Resource, Request, etc)
  - セッション情報、Workflow の進捗、ジョブキューを保存する
* GitHub private repository: Resource の管理
  - main ブランチ更新を Resource 更新の入口とする
* GitHub Actions: sandbox 用コンテナイメージの build / push と Resource Version 登録
  - GitHub-hosted runner 上で buildx / BuildKit を用いる
  - Backend の Registration-only API に Resource Version や image digest 等の情報を登録する
* GHCR: sandbox 用コンテナイメージの registry
  - Digest Pinning に従い、k3s 内蔵 containerd は digest 指定で pull する
* k3s: コンテナ基盤
  - 全サービスと sandbox を同一クラスタに載せ、Namespace (services / sandbox) で分離する
  - manifest は Topology-Agnostic Manifests に従う。デプロイの既定はシングルノード (ADR 0008)
  - Traefik Ingress が TLS 終端と Frontend / Backend への振り分けを担う
  - デプロイはKustomize baseと環境overlayから行い、環境差をoverlayに集約する
* sandbox: gVisor(runsc) RuntimeClass を指定した一時 Pod
  - Judge が sandbox Namespace に Pod を直接作成し (`restartPolicy: Never`)、Step を pods/exec で逐次実行して stdout / stderr / exit code を回収する
  - Judge の ServiceAccount には sandbox Namespace 限定の Role のみを与える (pods の create/get/list/watch/delete、pods/exec、pods/log)。Judge 自身の Namespace への権限は持たないため、自身や他サービスの Pod は操作できない
  - ValidatingAdmissionPolicy で sandbox Pod の image を GHCR の特定 org 配下かつ digest 指定必須に制限し (Digest Pinning の強制層)、hostPath volume を禁止する
  - Sandbox Workspace / Preset Directory の受け渡しと Artifact 回収は pods/exec loader 方式。詳細は ADR 0009 が所有する
  - Isolated Job Workspace / Explicit Artifact Handoff / Private-by-Default に従う
  - resource limit と platform 固定 hardening(network deny、capabilities drop 等)の詳細は [resource.md](./resource.md) が所有する

### 技術選定
- コンテナ基盤: k3s (containerd 内蔵、gVisor RuntimeClass)
- デプロイ: Kubernetes manifest + Kustomize (共通設定はbase、環境差はoverlay)
- Ingress: k3s 内蔵 Traefik (TLS 終端、Frontend / Backend への振り分け)
- フロントエンド: React (Vite) + TypeScript + TailwindCSS
- バックエンド: Go
  - バックエンドフレームワーク: [Echo](https://github.com/labstack/echo)
  - ORM: [Bun](https://github.com/uptrace/bun)
  - Validator: [GoPlayground/validator](https://github.com/go-playground/validator)
- 認証: Backend-managed session cookie
- データベース: PostgreSQL
- セッション・進捗・ジョブキュー: PostgreSQL
- Secret 管理: 環境が `dsa-datastore` Kubernetes Secret を提供する。production方式は未定
- オブジェクトストレージ: Seaweedfs
- Resource 管理:
  - GitHub org private repository
  - GitHub Actions (GitHub-hosted runner + buildx / BuildKit)
  - GHCR (Container registry)
- ジャッジサーバー: Go
  - ORM: [Bun](https://github.com/uptrace/bun)
  - Sandbox: gVisor(runsc) RuntimeClass を指定した k8s Pod (sandbox 専用 Namespace)
