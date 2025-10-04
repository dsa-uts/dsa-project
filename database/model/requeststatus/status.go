package requeststatus

type State int64

// refer to docs/README.md
const (
	AC State = iota
	WA
	TLE
	MLE
	RE
	CE
	OLE
	IE
	FN
	Judging
	WJ
)

func (s State) Max(other State) State {
	if s > other {
		return s
	}
	return other
}
