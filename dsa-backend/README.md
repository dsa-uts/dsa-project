# 準備
1. パッケージのインストール  
   注意: このセクションは，ローカル環境でインテリセンスが利くようにするための手順について
   記述している．実際にアプリを動かす際には，venvを作成しなくても良い．

   Pythonパッケージマネージャーの[uv](https://docs.astral.sh/uv/)をインストールする．
   ```bash
   # macOSまたはLinuxの場合
   curl -LsSf https://astral.sh/uv/install.sh | sh
   # 実行後、環境変数の設定が即座に反映されない場合は、シェルを開きなおしてください
   # バージョン確認
   uv --version
   ```

   venvを作成する．
   ```bash
   .../dsa-back$ uv sync
   ```

   venvをactivateする
   ```bash
   .../dsa-back$ . .venv/bin/activate
   ```

2. 環境変数の設定  
   .env.exampleを参考に，.envファイルを作成する．
   ```bash
   cp .env.example .env
   ```
   opensslをインストールする．
   ```bash
   brew install openssl
   ```
   SECRET_KEYを作成する．
   ```bash
   openssl rand -hex 32
   ```
   最後に.envに作成したSECRET_KEYを貼り付ける．
   ```bash
   # viを使用した例
   vi .env
   # iを押すと入力モードになり編集が可能．(INSERT)
   # 該当箇所にカーソルを移動し，貼り付け
   # escでコマンドモードに戻り，:wqで保存して終了．
   ```
   