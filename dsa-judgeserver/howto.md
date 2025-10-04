# 前提
パッケージマネージャ`rye`をインストールしていること。

# パッケージの追加方法
`rye`を使ってパッケージを追加するには、以下のコマンドを実行します。

```bash
rye add <package-name>
```

追加したパッケージをrequirements.lockに更新するには、以下のコマンドを実行します。

```bash
rye sync
```

＃ ローカル環境でテストする方法
まず、``langs/``フォルダにあるDockerfileを元に、sandbox用のDockerイメージを生成します。

```bash
cd langs/
sudo ./build.sh
```

# 注意
* DBテーブルのスキーマ(`db/init.sql`)の変更などを行う場合、古いDBデータのボリュームを削除しないとその変更が反映されない。