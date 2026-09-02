CREATE TABLE user_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    userid text NOT NULL UNIQUE,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('student', 'manager', 'admin')),
    password_hash text,
    disabled_at timestamptz,
    is_system boolean NOT NULL DEFAULT false,
    CONSTRAINT login_capability CHECK (
        (is_system AND password_hash IS NULL) OR (NOT is_system AND password_hash IS NOT NULL)
    )
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id uuid NOT NULL REFERENCES user_accounts(id),
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX sessions_user_account_created_idx ON sessions (user_account_id, created_at, id);
