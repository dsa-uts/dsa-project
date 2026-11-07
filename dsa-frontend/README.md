# installation（for Mac & Linux）
以下の手順は、ローカル環境でtypescriptのhintingおよびフロントのみの実行チェックをする場合に行う
必要がある。Webアプリを立ち上げるだけの場合は特に必要ない。

1. nodeのインストール

   ```sh
   # nvm(nodeのバージョンマネージャー)をインストール
   # ref: https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   # dsa-frontendで、.nvmrcに指定したNodeをインストール
   nvm install
   nvm use
   npm install -g npm@12.2.2
   # バージョン確認
   node -v
   npm -v
   ```

3. リポジトリをクローン(dsa-projectのクローンでまとめて行われるはずなので基本的には不要)
   ```sh
   # 作業したいディレクトリへ移動
   cd {ディレクトリのパス}

   # リポジトリをクローン
   git clone https://github.com/dsa-uts/dsa-front.git
   ```

4. アプリケーションの起動(dsa-projectのdocker起動時に起動されるので基本的には不要)
   ```sh
   # ディレクトリ移動
   cd dsa-frontend

   # スタート
   npm ci
   npm run dev
   ```

## ホスト環境でIntellisenseなどを有効にする方法(環境をいじらずに)
1. venv環境の作成
   ```sh
   python3 -m venv venv
   source venv/bin/activate
   ```
2. nodeenvのインストール
   ```sh
   pip install nodeenv
   ```
3. nodeenvの実行
   ```sh
   nodeenv -p
   ```
