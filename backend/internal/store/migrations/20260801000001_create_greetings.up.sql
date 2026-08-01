-- scaffolding 用のダミーテーブル (issue #95)。contract pipeline の疎通確認のため
-- だけに存在し、Auth スライス以降の migration で削除される。
CREATE TABLE greetings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
