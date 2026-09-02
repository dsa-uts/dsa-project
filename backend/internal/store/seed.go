package store

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun"
	"golang.org/x/crypto/bcrypt"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
)

const ExpiredDevelopmentSessionToken = "expired-development-session"

// SeedDevelopment creates only non-production fixture data and is idempotent.
func SeedDevelopment(ctx context.Context, db *bun.DB) error {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("admin"), 12)
	if err != nil {
		return fmt.Errorf("hash development password: %w", err)
	}
	if _, err := db.NewRaw(`
		INSERT INTO user_accounts (userid, name, role, password_hash)
		VALUES ('admin', 'Development Admin', 'admin', ?)
		ON CONFLICT (userid) DO UPDATE
		SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash,
		    disabled_at = NULL, is_system = false
	`, string(passwordHash)).Exec(ctx); err != nil {
		return err
	}
	if _, err := db.NewRaw(`
		INSERT INTO user_accounts (userid, name, role, password_hash, disabled_at)
		VALUES ('disabled', 'Disabled Development User', 'student', ?, now())
		ON CONFLICT (userid) DO UPDATE SET disabled_at = now(), is_system = false
	`, string(passwordHash)).Exec(ctx); err != nil {
		return err
	}
	if _, err := db.NewRaw(`
		INSERT INTO user_accounts (userid, name, role, password_hash, is_system)
		VALUES ('system', 'Development System Account', 'admin', NULL, true)
		ON CONFLICT (userid) DO UPDATE SET password_hash = NULL, disabled_at = NULL, is_system = true
	`).Exec(ctx); err != nil {
		return err
	}
	_, err = db.NewRaw(`
		INSERT INTO sessions (user_account_id, token_hash, expires_at)
		SELECT id, ?, ? FROM user_accounts WHERE userid = 'admin'
		ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at
	`, auth.HashToken(ExpiredDevelopmentSessionToken), time.Unix(1, 0).UTC()).Exec(ctx)
	return err
}
