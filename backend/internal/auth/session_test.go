package auth

import (
	"encoding/hex"
	"testing"
)

func TestHashTokenUsesSHA256(t *testing.T) {
	got := hex.EncodeToString(HashToken("session-token"))
	want := "c101e911469c969171040b50d70543313cf968fdef5bacc780776f8fb399ab36"
	if got != want {
		t.Fatalf("HashToken() = %q, want %q", got, want)
	}
}

func TestNewTokenIsOpaqueAndRandom(t *testing.T) {
	first, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) < 40 || first == second {
		t.Fatalf("NewToken() returned unsuitable tokens: lengths %d/%d, equal=%v", len(first), len(second), first == second)
	}
}
