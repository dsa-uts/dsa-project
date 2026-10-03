package judge

import (
	"bytes"
	"context"
	"io"
	"log"
	"sync"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/client"
)

type outputBuffer struct {
	data      bytes.Buffer
	limit     int
	truncated bool
	overflow  chan<- struct{}
	once      *sync.Once
}

func (b *outputBuffer) Write(data []byte) (int, error) {
	remaining := b.limit - b.data.Len()
	_, _ = b.data.Write(data[:min(len(data), remaining)])
	if len(data) > remaining {
		b.truncated = true
		b.once.Do(func() { b.overflow <- struct{}{} })
	}
	// Keep draining until the Judge kills the Step. Memory stays bounded even
	// when the stream contains a large frame or cleanup cannot start.
	return len(data), nil
}

func (b *outputBuffer) result() store.OutputResult {
	data := b.data.Bytes()
	if data == nil {
		data = []byte{}
	}
	return store.OutputResult{
		Data:      data,
		Truncated: b.truncated,
	}
}

// stepIO owns both copy goroutines. finish must join them before reading buffers.
type stepIO struct {
	stream         client.ExecAttachResult
	stdout, stderr *outputBuffer
	overflow       chan struct{}
	inputDone      chan error
	inputStopped   chan struct{}
	outputDone     chan error
	outputFinished bool
	outputErr      error
}

func startStepIO(stream client.ExecAttachResult, stdin []byte, limits resource.Limits) *stepIO {
	overflow := make(chan struct{}, 1)
	once := new(sync.Once)
	streams := &stepIO{
		stream:       stream,
		stdout:       &outputBuffer{limit: int(min(limits.StdoutSize, maxOutputBytes)), overflow: overflow, once: once},
		stderr:       &outputBuffer{limit: int(min(limits.StderrSize, maxOutputBytes)), overflow: overflow, once: once},
		overflow:     overflow,
		inputDone:    make(chan error, 1),
		inputStopped: make(chan struct{}),
		outputDone:   make(chan error, 1),
	}
	go func() {
		defer close(streams.inputStopped)
		_, err := io.Copy(stream.Conn, bytes.NewReader(stdin))
		if err == nil {
			err = stream.CloseWrite()
		}
		streams.inputDone <- err
	}()
	go func() {
		_, err := stdcopy.StdCopy(streams.stdout, streams.stderr, stream.Reader)
		streams.outputDone <- err
	}()
	return streams
}

// finish drains output after UID cleanup, then closes stdin and joins its writer.
// A timeout here is logged but does not invalidate an already completed exec.
func (s *stepIO) finish(ctx context.Context, sandboxID string, stepIndex int) error {
	if !s.outputFinished {
		drainCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
		defer cancel()
		select {
		case s.outputErr = <-s.outputDone:
		case <-drainCtx.Done():
			s.stream.Close()
			<-s.outputDone
			s.outputErr = nil
			log.Printf("sandbox %s step %d: output stream did not close after UID cleanup", sandboxID, stepIndex)
		}
	}
	s.stream.Close()
	<-s.inputStopped
	return s.outputErr
}
