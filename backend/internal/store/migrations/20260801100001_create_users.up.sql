-- User Account (CONTEXT.md)。soft delete は disabled フラグで表現する
-- (Disabled User Account: レコードは保持され、履歴から参照され続ける)。
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    userid text NOT NULL UNIQUE,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('student', 'manager', 'admin')),
    password_hash text NOT NULL,
    disabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- dev seed: 最初の Admin (issue #96)。initial-setup UI が入るまでの暫定で、
-- credential は admin / password (bcrypt cost 10)。
INSERT INTO users (userid, name, role, password_hash)
VALUES ('admin', 'Admin', 'admin', '$2a$10$sg7w2fx2bPcaXlrhTRZwOub7n1rkQuFHvi9qkZ92pfyYQDrlGdrsu');
