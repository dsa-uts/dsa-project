package queuestatus

type Status string

const (
	Pending    Status = "pending"
	Fetched    Status = "fetched"
	Processing Status = "processing"
	Done       Status = "done"
	Failed     Status = "failed"
)
