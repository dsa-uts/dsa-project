package judge

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"net"
	"sync"
	"testing"

	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/moby/moby/client"
)

func TestOutputBuffer(t *testing.T) {
	overflow := make(chan struct{}, 1)
	once := new(sync.Once)
	stdout := &outputBuffer{limit: 3, overflow: overflow, once: once}
	stderr := &outputBuffer{limit: 2, overflow: overflow, once: once}
	if got := stdout.result(); got.Data == nil || got.Truncated {
		t.Fatalf("empty output = %+v, want non-nil empty data", got)
	}
	for _, write := range []struct {
		buffer *outputBuffer
		data   string
	}{
		{stdout, "abc"}, {stdout, "def"}, {stderr, "12345"}, {stdout, "more"},
	} {
		n, err := write.buffer.Write([]byte(write.data))
		if n != len(write.data) || err != nil {
			t.Fatalf("Write = %d, %v; want %d, nil", n, err, len(write.data))
		}
	}
	for _, check := range []struct {
		buffer *outputBuffer
		want   string
	}{{stdout, "abc"}, {stderr, "12"}} {
		got := check.buffer.result()
		if !bytes.Equal(got.Data, []byte(check.want)) || !got.Truncated {
			t.Errorf("result = %+v, want %q truncated", got, check.want)
		}
	}
	if len(overflow) != 1 {
		t.Errorf("overflow notifications = %d, want 1", len(overflow))
	}
}

// Exercise the real copy goroutines with an in-memory connection. In particular,
// finish must release a stdin writer even if the program never reads its input.
func TestStepIOFinish(t *testing.T) {
	for _, consumed := range []bool{false, true} {
		t.Run(fmt.Sprintf("outputConsumed=%v", consumed), func(t *testing.T) {
			conn, peer := net.Pipe()
			defer conn.Close()
			defer peer.Close()
			// Docker multiplexed frames: stream ID, padding, big-endian payload size.
			output := bytes.NewReader([]byte("\x01\x00\x00\x00\x00\x00\x00\x06abcdef\x02\x00\x00\x00\x00\x00\x00\x03err"))
			stream := client.ExecAttachResult{HijackedResponse: client.HijackedResponse{Conn: conn, Reader: bufio.NewReader(output)}}
			streams := startStepIO(stream, []byte("unread input"), resource.Limits{StdoutSize: 3, StderrSize: 10})
			if consumed {
				streams.outputErr = <-streams.outputDone
				streams.outputFinished = true
			}
			if err := streams.finish(context.Background(), "sandbox", 0); err != nil {
				t.Fatal(err)
			}
			stdout, stderr := streams.stdout.result(), streams.stderr.result()
			if string(stdout.Data) != "abc" || !stdout.Truncated {
				t.Errorf("stdout = %+v, want abc truncated", stdout)
			}
			if string(stderr.Data) != "err" || stderr.Truncated {
				t.Errorf("stderr = %+v, want err untruncated", stderr)
			}
			select {
			case <-streams.inputStopped:
			default:
				t.Fatal("stdin writer still running after finish")
			}
		})
	}
}
