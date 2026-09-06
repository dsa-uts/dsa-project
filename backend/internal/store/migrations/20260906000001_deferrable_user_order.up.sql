DROP INDEX user_accounts_display_order_idx;
ALTER TABLE user_accounts ADD CONSTRAINT user_accounts_display_order_key
    UNIQUE (display_order) DEFERRABLE INITIALLY IMMEDIATE;
