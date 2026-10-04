package judge

import (
	"strings"
	"testing"
)

func TestValidateSubmissionUser(t *testing.T) {
	// Captured Docker exec credentials, including the primary GID repeated in Groups.
	const status = `Uid: 10001 10001 10001 10001
Gid: 10001 10001 10001 10001
Groups: 10001
CapInh: 0000000000000000
CapPrm: 0000000000000000
CapEff: 0000000000000000
CapBnd: 0000000000000000
CapAmb: 0000000000000000
NoNewPrivs: 1
`
	for _, tt := range []struct {
		name        string
		old         string
		replacement string
		wantErr     bool
	}{
		{name: "primary group only"},
		{name: "empty groups", old: "Groups: 10001", replacement: "Groups:"},
		{name: "root group", old: "Groups: 10001", replacement: "Groups: 0", wantErr: true},
		{name: "extra group", old: "Groups: 10001", replacement: "Groups: 10001 10000", wantErr: true},
		{name: "missing groups", old: "Groups: 10001\n", wantErr: true},
		{name: "wrong uid", old: "Uid: 10001 10001 10001 10001", replacement: "Uid: 0 0 0 0", wantErr: true},
		{name: "wrong gid", old: "Gid: 10001 10001 10001 10001", replacement: "Gid: 10000 10000 10000 10000", wantErr: true},
		{name: "capabilities", old: "CapEff: 0000000000000000", replacement: "CapEff: 0000000000000001", wantErr: true},
		{name: "privilege escalation", old: "NoNewPrivs: 1", replacement: "NoNewPrivs: 0", wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			input := status
			if tt.old != "" {
				input = strings.Replace(input, tt.old, tt.replacement, 1)
			}
			if err := validateSubmissionUser(input); (err != nil) != tt.wantErr {
				t.Fatalf("validateSubmissionUser() = %v, want error %v", err, tt.wantErr)
			}
		})
	}
}
