# 調査ノート: Nix dockerTools vs Dockerfile によるコンテナイメージビルド

- 対象: Go + Echo backend の walking skeleton([dsa-uts/dsa-project#80](https://github.com/dsa-uts/dsa-project/issues/80))
- 前提: デプロイ先はシングルノード k3s。macOS 開発機では microvm.nix + vfkit の VM 内で k3s server、Linux 本番はホスト直接。依存管理は nix flake に一本化(devShell は導入済み)。
- 調査日: 2026-07-19

## 結論(推奨)

1. **`dockerTools.streamLayeredImage` + `pkgs.buildGoModule`(`CGO_ENABLED=0` で静的リンク)を採用する。** Dockerfile は使わない。イメージ定義が flake に一本化され、Go toolchain・依存・イメージ内容がすべて Nix store 由来になり、ビルドが決定的になる。
2. **タグは固定タグではなく内容由来にする。** `tag = null`(既定)なら derivation の nix hash がタグになるので、内容が変われば必ずタグが変わる。`created` は既定の `1970-01-01T00:00:01Z` のままにして reproducibility を維持する。
3. **macOS からの Linux イメージビルドは Linux remote builder(`darwin.linux-builder` / nix-darwin の `nix.linux-builder`)を基本線にする。** flake は `packages.{x86_64,aarch64}-linux.backend-image` を定義し、darwin 側の package からは同じ Linux derivation を参照する(darwin 上では remote builder 経由でビルドされる)。
4. **k3s への取り込みは registry 不要の `k3s ctr -n k8s.io images import` を使う。** streamLayeredImage のスクリプト出力をそのままパイプできる。固定タグ + `imagePullPolicy: IfNotPresent` は「Deployment の Pod template が変わらないと rollout が起きない」罠があるため、タグを毎回変えて manifest の `image:` も更新する運用にする。
5. **CI は `nix flake check` に集約する。** イメージ derivation を `checks` に含めれば、GitHub Actions の Linux runner 上でビルド検証まで一気通貫になる。Dockerfile 方式は reproducibility が opt-in(`SOURCE_DATE_EPOCH`)で、依存の pin が flake の外に二重化するため、本プロジェクトの「flake 一本化」方針と両立しない。

---

## 論点 1: dockerTools の実用性

### buildImage / buildLayeredImage / streamLayeredImage の違い

nixpkgs マニュアル([dockerTools 節](https://nixos.org/manual/nixpkgs/unstable/#sec-pkgs-dockerTools)、ソースは [doc/build-helpers/images/dockertools.section.md](https://github.com/NixOS/nixpkgs/blob/master/doc/build-helpers/images/dockertools.section.md))より:

| 関数 | レイヤー | 出力 |
|---|---|---|
| `buildImage` | 単一レイヤー("This function will create a single layer for all files (and dependencies) that are specified in its argument.") | `docker image load` 可能な圧縮 tarball(`compressor` 既定は `gz`、`none`/`zstd` も可) |
| `buildLayeredImage` | Nix store のオブジェクトごとに 1 レイヤーを試みる("attempt to create one layer per object in the Nix store")。内部的に streamLayeredImage を使用 | 圧縮 tarball(`docker image load` 可能) |
| `streamLayeredImage` | 同上 | **tarball を stdout にストリームする実行スクリプト**。イメージ tarball 自体は Nix store に置かれないため store 消費を抑えられる |

- `maxLayers` の既定は 100。超過時は「最も『人気の高い』オブジェクトを個別レイヤーに置き、残りを 1 レイヤーにまとめる」("the function will put the most 'popular' objects in their own layers, and group all remaining objects into a single layer")。
- `fromImage` を指定するとベースイメージのレイヤーに追記される。`null` は `FROM scratch` 相当。静的 Go バイナリならベースイメージ不要(`FROM scratch` 相当)で成立する。
- マニュアルの例のとおり、`$(nix build .#image --print-out-paths) | docker load` のようにスクリプトをパイプしてロードする。

**本件への適用**: 単一の静的 Go バイナリならレイヤー分割の恩恵は小さいが、streamLayeredImage は「tarball を store に置かない」だけで損はなく、後述の k3s import ともパイプで直結できるため、streamLayeredImage を第一候補、CI 等で tarball 実体が欲しい場面があれば buildLayeredImage を併用、とするのが素直。

### buildGoModule との組み合わせ

nixpkgs マニュアル([Go 節](https://nixos.org/manual/nixpkgs/unstable/#sec-language-go)、ソースは [doc/languages-frameworks/go.section.md](https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/go.section.md))より:

- `vendorHash` は「Go modules の依存を fetch する中間 derivation の出力ハッシュ」。`null` にするとリポジトリ内の `vendor/` を使う。依存更新時はハッシュ更新が必要(TOFU 方式)。
- `CGO_ENABLED` は既定 1。0 にすると「C ライブラリにリンクできなくなり、結果のバイナリは静的リンクになる」("the resulting binary is statically linked")。`net` や `os/user` は Go native 実装が使われる。→ `FROM scratch` 相当のイメージに単体で置ける。
- `ldflags` で `-X main.Version=...` のようにバージョン埋め込みが可能。
- 「`buildGoModule` runs tests by default」— checkPhase で `go test` が走るため、**イメージをビルドするだけで単体テストも通っている**ことが保証される(`doCheck = false` で無効化可能)。

構成イメージ:

```nix
backend = pkgs.buildGoModule {
  pname = "backend";
  src = ./backend;
  vendorHash = "sha256-...";
  env.CGO_ENABLED = 0;
};
backend-image = pkgs.dockerTools.streamLayeredImage {
  name = "dsa-backend";
  # tag = null (既定) → nix hash がタグになる
  config.Entrypoint = [ "${backend}/bin/backend" ];
};
```

### タグと created(reproducibility)

nixpkgs マニュアル(同上)より:

- `tag` の既定は `null` で、「If null, the hash of the nix derivation will be used as the tag.」。決定されたタグは passthru 属性 `imageTag` で取得できる(manifest 生成やデプロイスクリプトから参照可能)。
- `created` の既定は `"1970-01-01T00:00:01Z"`。`"now"` を指定できるが、「Using 'now' means that the generated image will not be reproducible anymore (because the date will always change whenever it's built)」と明記されている。

**推奨**: `tag` は既定(null = nix hash)のままにする。内容が同じなら同じタグ、変われば必ず別タグになるため、後述の kubelet キャッシュ問題を構造的に回避できる。人間可読なタグが欲しければ `self.rev`(git commit)をタグにする手もあるが、dirty working tree では `rev` が存在しない(`dirtyRev` になる)点に注意([nix flake リファレンス](https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-flake))。`created` は既定値のまま(`docker images` の表示が 1970 年になるのは仕様上の trade-off)。

### 制約

- dockerTools が生成するのは Docker save 形式(docker.v1.2 相当)の tarball / ストリームであり、レジストリ push には `docker load` 後の push か skopeo 等を使う(本件は registry を立てないので影響なし)。
- Linux 用イメージなので、中身(Go バイナリ)は Linux 向けにビルドされる必要がある → 論点 2。

## 論点 2: macOS ホストから Linux イメージをビルドする方法

### 前提: イメージビルドには Linux ビルド環境が要る

nix.dev の公式チュートリアル([Building and running Docker images](https://nix.dev/tutorials/nixos/building-and-running-docker-images.html))は、macOS 等の非 Linux プラットフォームでは「(a) Linux でビルドする remote build machine を用意する、(b) Linux へクロスコンパイルする」のいずれかが必要と明記している。

### 方式比較

| 方式 | 仕組み | 評価 |
|---|---|---|
| **darwin.linux-builder(推奨)** | macOS 上で Linux VM を remote builder として起動。`nix run nixpkgs#darwin.linux-builder` で bootstrap([nixpkgs マニュアル darwin-builder 節](https://nixos.org/manual/nixpkgs/unstable/#sec-darwin-builder))。nix-darwin なら [`nix.linux-builder.enable`](https://github.com/nix-darwin/nix-darwin/blob/master/modules/nix/linux-builder.nix) で宣言的に常駐化できる | flake 側は「Linux 用 derivation を普通に書くだけ」で済み、Linux CI と完全に同一の derivation を darwin から透過的にビルドできる。要 trusted-user 設定。既知の SSH host 鍵を使うためローカル専用(マニュアルに警告あり) |
| **pkgsCross(クロスコンパイル)** | `pkgs.pkgsCross.<target>` で Linux 向けパッケージセットを使う([nixpkgs cross-compilation 節](https://nixos.org/manual/nixpkgs/unstable/#chap-cross))。Go はコンパイラ自体がクロス対応なので相性は良い | バイナリ単体のクロスは容易だが、イメージ derivation 全体(tar 生成等の buildInputs)を darwin 上で完結させる構成は nixpkgs 的に主流でなく、キャッシュヒットも悪い(クロス版 derivation は cache.nixos.org にほぼ無い)。「Linux/darwin どちらでも同じ derivation」にならず CI との同一性が崩れる |
| **remote builder(実 Linux 機)** | `nix.conf` の `builders` に SSH で Linux 機を登録(darwin.linux-builder と同じ仕組みの一般形) | Linux 機が別途あるなら最も単純。開発機単体で完結しない |

### flake 構成パターン

Acceptance criteria「`nix build` で backend のコンテナイメージが作れる(Linux / macOS どちらのホストからでも)」を満たすパターン:

```nix
# packages.<linux-system>.backend-image を正として定義し、
# darwin からは対応する Linux system の derivation を参照する
packages = eachSystem (pkgs: {
  backend = ...;                      # 全 system でネイティブビルド
} // lib.optionalAttrs pkgs.stdenv.isLinux {
  backend-image = mkImage pkgs;       # Linux でのみ定義
});
# darwin 向けエイリアス(remote builder 前提):
packages.aarch64-darwin.backend-image =
  self.packages.aarch64-linux.backend-image;
```

nix.dev チュートリアルも同型のパターン(darwin 上で `pkgsLinux = import nixpkgs { system = "x86_64-linux"; }` を参照し、remote builder でビルド)を提示している。この方式なら **derivation は 1 つ**で、macOS ではlinux-builder 経由、Linux ではネイティブにビルドされる。darwin ホストに builder が無い場合は `nix build .#backend-image` が「builder が無い」旨のエラーで落ちるだけで、flake の評価自体は壊れない。

**Go だからといってクロスコンパイル方式を選ぶ必要はない**: linux-builder 方式なら Go 以外(将来の frontend イメージ等)にもそのまま適用でき、キャッシュも Linux ネイティブ derivation として CI / 本番と共有できる。

## 論点 3: k3s へのイメージ取り込み(registry なし)

### 取り込み方法は 2 系統

k3s 公式ドキュメント([Import Images](https://docs.k3s.io/add-ons/import-images)、[Air-Gap Install](https://docs.k3s.io/installation/airgap))より:

1. **`ctr` による直接 import**: k3s は containerd と ctr を同梱しており、`sudo k3s ctr images import <tar>` で embedded containerd に直接ロードできる。containerd の `ctr images import` は引数 `-` で **stdin から読める**([import.go](https://github.com/containerd/containerd/blob/main/cmd/ctr/commands/images/import.go): `if in == "-" { r = os.Stdin }`)。対応形式は `oci.v1` / `docker.v1.1` / `docker.v1.2`(同ファイルの usage に明記)なので、**dockerTools の docker save 形式出力はそのまま受け付けられる**。
   - **注意(namespace)**: ctr は既定で `default` namespace を使う([containerd namespaces.md](https://github.com/containerd/containerd/blob/main/docs/namespaces.md))が、kubelet(CRI plugin)は `k8s.io` namespace を使う([containerd CRI constants: `K8sContainerdNamespace = "k8s.io"`](https://github.com/containerd/containerd/blob/main/internal/cri/constants/constants.go))。したがって **`k3s ctr -n k8s.io images import` のように namespace 指定が必要**(k3s ctr は既定で k8s.io を向く設定になっているが、明示するのが安全。参考: [k3s discussion #7018](https://github.com/k3s-io/k3s/discussions/7018))。
2. **images ディレクトリへの配置(airgap 方式)**: tarball(zstd/gzip 圧縮可)を `/var/lib/rancher/k3s/agent/images/` に置くと k3s が自動で containerd にロードする。「The tarball can be placed before K3s is started, or created/modified while K3s is running.」とあり、**起動時だけでなく稼働中の配置でも取り込まれる**。「Image archives are imported every time k3s starts.」(毎起動時に再 import)であり、差分 import にしたい場合は conditional import 機能もある([airgap docs](https://docs.k3s.io/installation/airgap))。

### streamLayeredImage との接続

streamLayeredImage の出力スクリプトは tarball を stdout に流すので、そのまま接続できる:

```sh
# Linux 本番(ホスト直 k3s):
$(nix build .#backend-image --print-out-paths) | sudo k3s ctr -n k8s.io images import -

# macOS 開発機(vfkit VM 内の k3s):
$(nix build .#backend-image --print-out-paths) | ssh vm sudo k3s ctr -n k8s.io images import -
```

**vfkit の制約**: microvm.nix のドキュメントは「vfkit (macOS) only supports user-mode networking. TAP and bridge networking are not available.」と明記している([interfaces.md](https://github.com/microvm-nix/microvm.nix/blob/main/doc/src/interfaces.md))。user-mode networking は VM からの outgoing 接続用であり、ホスト→VM の到達性は別途確保が必要。ホストから VM へ SSH できない構成の場合は、(a) virtiofs 共有ディレクトリ([shares.md](https://microvm-nix.github.io/microvm.nix/shares.html): vfkit は virtiofs をビルトインサポート)経由で tarball を `/var/lib/rancher/k3s/agent/images/` に見せる、(b) vfkit の port forward 設定で SSH を通す、のいずれかを選ぶ。(a) は「稼働中の配置でも取り込まれる」仕様(上記)により、ホスト側で tarball を書くだけで済むので registry なし運用と相性が良い。

### タグと imagePullPolicy の運用

Kubernetes 公式([Images](https://kubernetes.io/docs/concepts/containers/images/))より:

- `imagePullPolicy` 省略時の既定: タグが `:latest`・タグ無しなら `Always`、**特定タグ・digest 指定なら `IfNotPresent`**。
- `Never`: 「the kubelet does not try fetching the image. If the image is somehow already present locally, the kubelet attempts to start the container; otherwise, startup fails.」
- pre-pulled(= import 済み)イメージを使うには `IfNotPresent` か `Never` が必要。
- 公式は mutable タグを明確に非推奨: 「if the image registry were to change the code that the tag on that image represents, you might end up with a mix of Pods running the old and new code.」

**固定タグの落とし穴**は 2 段ある:

1. kubelet / containerd のキャッシュ: `IfNotPresent` では同名タグが既にあれば新イメージを見に行かない(registry なし運用では import が「pull」の代替なので、import し直せば containerd 内のタグは差し替わるが、既存 Pod は古いイメージのまま動き続ける)。
2. **より本質的な罠**: Deployment は「rollout is triggered if and only if the Deployment's Pod template (that is, `.spec.template`) is changed」([Deployment docs](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#updating-a-deployment))。固定タグだと manifest が変わらないため、**import し直しても rollout 自体が起きない**。`kubectl rollout restart` を毎回手で打つ運用になる。

**推奨**: dockerTools の nix hash タグ(`imageTag`)を Helm chart / manifest の `image:` に流し込み、**デプロイのたびにタグが変わる**ようにする。これなら `.spec.template` が変わって rollout が自然に走り、`imagePullPolicy: IfNotPresent`(特定タグの既定値)のままで registry への pull も発生しない。registry が本当に存在しない環境では、タグ解決に行かないことを保証する `Never` も選べるが、`IfNotPresent` + import 済みで実用上十分。

## 論点 4: CI 統合と Dockerfile 方式との比較

### nix flake check への組み込み

[`nix flake check`](https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-flake-check) は flake の評価検証に加えて「builds the derivations specified by the flake's `checks` output」を行う。既定では**現在の system の出力のみ**が対象(`--all-systems` で全 system、`--no-build` で評価のみ)。

パターン:

```nix
checks = eachSystem (pkgs: {
  backend = self.packages.${pkgs.system}.backend;   # buildGoModule (go test 込み)
} // lib.optionalAttrs pkgs.stdenv.isLinux {
  backend-image = self.packages.${pkgs.system}.backend-image;
});
```

- `buildGoModule` は checkPhase で `go test` を走らせる(論点 1)ので、`checks` に package を入れるだけで「ビルド + 単体テスト」が担保される。
- GitHub Actions の `ubuntu-latest` runner 上で `nix flake check` を実行すれば、イメージ derivation もネイティブビルドされる。macOS 開発機では checks のうち Linux 専用のもの(イメージ)は current system に含まれないため、`nix flake check` が darwin 上でも(linux-builder 無しで)通る構成にできる。イメージまで darwin で検証したい場合は linux-builder を立てて `nix build .#backend-image` を叩けばよい。

### Dockerfile(docker buildx)方式との比較

| 観点 | dockerTools | Dockerfile / buildx | 出典 |
|---|---|---|---|
| Reproducibility | 既定で `created` 固定・内容は Nix store 由来で決定的。タグ = nix hash で内容とタグが 1:1 | タイムスタンプ正規化は **opt-in**(`SOURCE_DATE_EPOCH` build-arg + `rewrite-timestamp=true`)。BuildKit ドキュメント自身が bit-for-bit 再現を保証していない。`apt-get`/`go mod download` 等の依存 pin は Dockerfile の仕組みの外 | [nixpkgs manual](https://nixos.org/manual/nixpkgs/unstable/#sec-pkgs-dockerTools), [BuildKit build-repro.md](https://github.com/moby/buildkit/blob/master/docs/build-repro.md) |
| レイヤーキャッシュ | Nix store パス単位。derivation が変わらなければ store / binary cache からそのまま再利用。レイヤーは「store オブジェクトごと」に分割され命令順序に依存しない | 命令 = レイヤーで、「If a layer changes, all other layers that come after it are also affected」— 命令順に依存した cascade invalidation。CI では cache backend(registry cache 等)の追加設定が必要 | [nixpkgs manual](https://nixos.org/manual/nixpkgs/unstable/#sec-pkgs-dockerTools), [Docker build cache docs](https://docs.docker.com/build/cache/) |
| CI 構成 | `nix flake check` 1 コマンドに集約。Nix binary cache(cachix 等)がそのままイメージビルドのキャッシュになる | Docker daemon / buildx のセットアップ + cache export 設定 + `docker save` → import 導線を別途組む | 同上 |
| macOS 開発機 | linux-builder で `nix build` が透過的に通る | Docker Desktop / colima 等の別 VM ランタイムが必要(nix flake の管理外) | [darwin-builder 節](https://nixos.org/manual/nixpkgs/unstable/#sec-darwin-builder) |

### Dockerfile 方式を採ると flake 統合がどう崩れるか

1. **依存の二重管理**: Go toolchain のバージョンが flake(devShell)と Dockerfile の `FROM golang:x.y` の 2 箇所に分かれ、flake.lock による一元 pin が効かなくなる。Dockerfile 側のベースイメージ digest pin は手動運用。
2. **`nix build` で完結しない**: イメージビルドに Docker daemon という Nix 外のグローバル状態が必要になり、「`nix build` で backend のコンテナイメージが作れる」という Issue #80 の acceptance criteria を素直に満たせない。`nix flake check` にも組み込めない(derivation にならないため)。
3. **成果物の同一性検証が弱くなる**: dockerTools ならイメージ内容 = derivation 出力なので、CI・開発機・本番で同じ store path であることをハッシュで確認できる。Dockerfile では同じ Dockerfile から異なるイメージが出うる(上記 reproducibility の行)。

### 補足: 代替ツール

- [nix2container](https://github.com/nlewo/nix2container)(サードパーティ flake)は skopeo ベースで tarball を store に置かず registry push まで統合するが、registry を立てない本件では streamLayeredImage で十分であり、追加 input を増やす理由は薄い。

## 出典一覧

- nixpkgs manual — dockerTools: https://nixos.org/manual/nixpkgs/unstable/#sec-pkgs-dockerTools(ソース: https://github.com/NixOS/nixpkgs/blob/master/doc/build-helpers/images/dockertools.section.md)
- nixpkgs manual — Go (buildGoModule): https://nixos.org/manual/nixpkgs/unstable/#sec-language-go(ソース: https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/go.section.md)
- nixpkgs manual — darwin.linux-builder: https://nixos.org/manual/nixpkgs/unstable/#sec-darwin-builder(ソース: https://github.com/NixOS/nixpkgs/blob/master/doc/packages/darwin-builder.section.md)
- nix-darwin — linux-builder module: https://github.com/nix-darwin/nix-darwin/blob/master/modules/nix/linux-builder.nix
- nixpkgs manual — Cross-compilation: https://nixos.org/manual/nixpkgs/unstable/#chap-cross
- nix.dev — Building and running Docker images: https://nix.dev/tutorials/nixos/building-and-running-docker-images.html
- Nix manual — nix flake check: https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-flake-check
- Nix manual — nix flake(self.rev / dirtyRev): https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-flake
- k3s docs — Import Images: https://docs.k3s.io/add-ons/import-images
- k3s docs — Air-Gap Install: https://docs.k3s.io/installation/airgap
- k3s discussion — ctr namespace: https://github.com/k3s-io/k3s/discussions/7018
- containerd — ctr images import(stdin / 形式): https://github.com/containerd/containerd/blob/main/cmd/ctr/commands/images/import.go
- containerd — namespaces: https://github.com/containerd/containerd/blob/main/docs/namespaces.md
- containerd — CRI namespace 定数: https://github.com/containerd/containerd/blob/main/internal/cri/constants/constants.go
- Kubernetes docs — Images / imagePullPolicy: https://kubernetes.io/docs/concepts/containers/images/
- Kubernetes docs — Deployment(rollout trigger): https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#updating-a-deployment
- microvm.nix — Network interfaces(vfkit は user-mode のみ): https://github.com/microvm-nix/microvm.nix/blob/main/doc/src/interfaces.md
- microvm.nix — Shared directories(vfkit virtiofs): https://microvm-nix.github.io/microvm.nix/shares.html
- Docker docs — Build cache: https://docs.docker.com/build/cache/
- BuildKit — Reproducible builds: https://github.com/moby/buildkit/blob/master/docs/build-repro.md
- nix2container: https://github.com/nlewo/nix2container
