ALTER TABLE user_accounts DROP CONSTRAINT user_accounts_display_order_key;
CREATE UNIQUE INDEX user_accounts_display_order_idx ON user_accounts (display_order);
