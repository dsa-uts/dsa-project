package main

type WatchdogInput struct {
	Command        string `json:"command"`
	Stdin          string `json:"stdin"`
	TimeoutMS      int64  `json:"timeout_ms"`
	MemoryMB       int64  `json:"memory_limit_mb"`
	UID            int64  `json:"uid"`
	GID            int64  `json:"gid"`
	StdoutMaxBytes int64  `json:"stdout_max_bytes"`
	StderrMaxBytes int64  `json:"stderr_max_bytes"`
}

func NewWatchdogInput(command string, stdin string, timeoutMS int64, memoryMB int64, uid int64, gid int64, stdoutMaxBytes int64, stderrMaxBytes int64) WatchdogInput {
	return WatchdogInput{
		Command:        command,
		Stdin:          stdin,
		TimeoutMS:      timeoutMS,
		MemoryMB:       memoryMB,
		UID:            uid,
		GID:            gid,
		StdoutMaxBytes: stdoutMaxBytes,
		StderrMaxBytes: stderrMaxBytes,
	}
}

type WatchdogOutput struct {
	ExitCode *int64 `json:"exit_code"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	TimeMS   int64  `json:"time_ms"`
	MemoryKB int64  `json:"memory_kb"`
	TLE      bool   `json:"TLE"`
	MLE      bool   `json:"MLE"`
	OLE      bool   `json:"OLE"`
}
