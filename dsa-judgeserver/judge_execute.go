package main

import (
	"bytes"
	"context"
	"dsa-judgeserver/match"
	"dsa-judgeserver/util"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/volume"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/dsa-uts/dsa-project/database/model/requeststatus"
	"github.com/google/uuid"
)

type JobExecutor struct {
	client *client.Client
}

const UPLOAD_DIR_IN_HOST = "upload/"
const UID_GUEST = 1002
const GID_GUEST = 1002
const MAX_STDOUT_BYTES = 2 * 1024 // 2 KB
const MAX_STDERR_BYTES = 2 * 1024 // 2 KB

const CPU_SET = "0"                       // only 1 CPU core can be used.
const TIMEOUT_BEFORE_CONTAINER_STOP = 120 // timeout in seconds for stopping container
const PID_LIMIT = 64                      // limit max number of processes available to spawn
const MAX_MEMORY_LIMIT_MB = 1024          // 1 GB

func NewJobExecutor() (*JobExecutor, error) {
	// Create API Client
	apiClient, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}

	return &JobExecutor{
		client: apiClient,
	}, nil
}

func (executor *JobExecutor) ExecuteJob(ctx context.Context, job *model.JobDetail) (*model.RequestLog, error) {
	// Create Docker Volume to store user program files and compilation results
	volume_name := fmt.Sprintf("job-%s", uuid.New().String())

	volume, err := executor.client.VolumeCreate(ctx, volume.CreateOptions{
		Name: volume_name,
	})

	if err != nil {
		return nil, err
	}

	defer executor.RemoveVolume(ctx, volume.Name)

	requestLog := model.RequestLog{}

	buildLog, err := executor.executeBuildTasks(ctx, job, volume.Name)
	if err != nil {
		requestLog.ConstructFromTaskLogs(buildLog, nil)
		return &requestLog, err
	}

	judgeLog, err := executor.executeJudgeTasks(ctx, job, volume.Name)

	requestLog.ConstructFromTaskLogs(buildLog, judgeLog)
	return &requestLog, err
}

func (executor *JobExecutor) executeBuildTasks(ctx context.Context, job *model.JobDetail, volumeName string) ([]model.TaskLog, error) {
	// Launch Sandbox Container to compile user codes
	build_container_name := fmt.Sprintf("build-%s", uuid.New().String())

	cpuSet := CPU_SET
	timeout := TIMEOUT_BEFORE_CONTAINER_STOP
	pidLimit := int64(256) // allow more processes for build tasks
	// add 32MB for overhead
	totalMemoryInBytes := min(
		(job.MemoryMB+32)*1024*1024, MAX_MEMORY_LIMIT_MB*1024*1024)

	buildContainer_createResponse, err := executor.client.ContainerCreate(ctx,
		&container.Config{
			User:  "root",
			Cmd:   []string{"/bin/sh", "-c", "sleep 3600"},
			Image: "checker-lang-gcc",
			Volumes: map[string]struct{}{
				"/home/guest": {},
			},
			WorkingDir:      "/home/guest",
			NetworkDisabled: true,
			StopTimeout:     &timeout,
		},
		&container.HostConfig{
			Binds: []string{fmt.Sprintf("%s:/home/guest", volumeName)},
			Resources: container.Resources{
				CpusetCpus: cpuSet, // only 1 CPU core can be used.
				Memory:     totalMemoryInBytes,
				MemorySwap: totalMemoryInBytes, // disable swap
				PidsLimit:  &pidLimit,          // limit max number of processes available to spawn
				Ulimits: []*container.Ulimit{
					{
						Name: "nofile", // limit max number of open files
						Hard: 768,
						Soft: 768,
					},
					{
						Name: "nproc", // limit max number of processes
						Hard: pidLimit,
						Soft: pidLimit,
					},
					{
						Name: "fsize",          // limit max size of files that can be created, the unit is bytes
						Hard: 10 * 1024 * 1024, // 10 MB
						Soft: 10 * 1024 * 1024, // 10 MB
					},
					{
						Name: "stack",           // limit max stack size, the unit is bytes
						Hard: (8 * 1024 * 1024), // 8 MB
						Soft: (8 * 1024 * 1024), // 8 MB
					},
				},
			},
			// TODO: try this to check whether this works or not.
			// StorageOpt: map[string]string{
			// 	"size": "256m", // limit container writable layer size
			// },
		},
		nil,
		nil,
		build_container_name,
	)

	if buildContainer_createResponse.Warnings != nil {
		for _, warning := range buildContainer_createResponse.Warnings {
			fmt.Printf("Docker Warning: %s\n", warning)
		}
	}

	if err != nil {
		return nil, err
	}

	defer executor.RemoveContainer(ctx, buildContainer_createResponse.ID)

	// Start the build container
	err = executor.client.ContainerStart(ctx, buildContainer_createResponse.ID, container.StartOptions{})
	if err != nil {
		return nil, err
	}

	timeoutBeforeStop := 0
	defer executor.client.ContainerStop(ctx, buildContainer_createResponse.ID, container.StopOptions{
		Signal:  "SIGKILL",
		Timeout: &timeoutBeforeStop, // do not wait before killing the container
	})

	// ---------------------------------------------------------------------------
	// Copy test files and user submitted files to the build container
	// to /home/guest/, with guest:guest ownership
	// ---------------------------------------------------------------------------

	// Copy test files
	for _, testFile := range job.TestFiles {
		testFilePath := filepath.Join(job.ResourceDir, testFile)
		err = executor.CopyContentsToContainer(ctx, testFilePath, buildContainer_createResponse.ID, "/home/guest/")
		if err != nil {
			return nil, err
		}
	}

	// Copy user submitted files
	userSubmittedFolderPath := job.FileDir
	err = executor.CopyContentsToContainer(ctx, userSubmittedFolderPath, buildContainer_createResponse.ID, "/home/guest/")
	if err != nil {
		return nil, err
	}

	// modify ownership of all files under /home/guest to guest:guest
	res, err := executor.ExecuteSimpleCommand(ctx, buildContainer_createResponse.ID, []string{
		"chown", "-R", "guest:guest", "/home/guest/",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to change ownership of /home/guest: %s, stderr: %s", err.Error(), res.Stderr)
	}
	if res.ExitCode != 0 {
		return nil, fmt.Errorf("failed to change ownership of /home/guest, exit code: %d, stderr: %s", res.ExitCode, res.Stderr)
	}

	buildLog := []model.TaskLog{}

	// Execute build tasks
	for _, buildTask := range job.BuildTasks {
		result := model.TaskLog{
			TestCaseID: buildTask.ID,
			ResultID:   requeststatus.IE,
			TimeMS:     0,
			MemoryKB:   0,
			ExitCode:   -1,
		}

		// Read stdin from buildTask.StdinPath
		stdinContent := []byte{}
		if buildTask.StdinPath != "" {
			stdinPath := filepath.Join(job.ResourceDir, buildTask.StdinPath)
			stdinContent, err = os.ReadFile(stdinPath)
			if err != nil {
				return buildLog, fmt.Errorf("failed to read stdin file %s: %w", stdinPath, err)
			}
		}

		TotalTimeoutInSeconds := job.TimeMS/1000 + 5 // add 5 seconds for overhead

		watchdogInput := WatchdogInput{
			Command:        buildTask.Command,
			Stdin:          string(stdinContent),
			TimeoutMS:      job.TimeMS,
			MemoryMB:       job.MemoryMB,
			UID:            UID_GUEST,
			GID:            GID_GUEST,
			StdoutMaxBytes: MAX_STDOUT_BYTES,
			StderrMaxBytes: MAX_STDERR_BYTES,
		}

		// Convert watchdogInput to JSON string
		watchdogInputJSON, err := json.Marshal(watchdogInput)
		if err != nil {
			return buildLog, fmt.Errorf("failed to marshal watchdog input: %w", err)
		}

		execConfig := ExecConfig{
			Cmd:              []string{"/home/watchdog"},
			Stdin:            string(watchdogInputJSON),
			WorkingDir:       "/home/guest",
			Env:              []string{},
			TimeoutInSeconds: TotalTimeoutInSeconds,
			User:             "root", // need root to run watchdog
		}

		execResult, err := executor.ExecuteCommand(ctx, buildContainer_createResponse.ID, execConfig)
		if err != nil {
			// If some internal error occurs (not the command execution error),
			// return ResultDetail with IE(Internal Error) status.
			buildLog = append(buildLog, result)
			return buildLog, fmt.Errorf("failed to execute command: %w", err)
		}

		if execResult.ExitCode != 0 {
			buildLog = append(buildLog, result)
			// If the watchdog itself fails (e.g., due to OOM), return IE(Internal Error) status.
			return buildLog, fmt.Errorf("watchdog failed with exit code %d, stderr: %s", execResult.ExitCode, execResult.Stderr)
		}

		if execResult.Stderr != "" {
			buildLog = append(buildLog, result)
			// If watchdog writes something to stderr, return IE(Internal Error) status.
			return buildLog, fmt.Errorf("watchdog wrote to stderr: %s", execResult.Stderr)
		}

		// parse execResult.Stdout as WatchdogOutput
		var watchdogOutput WatchdogOutput
		err = json.Unmarshal([]byte(execResult.Stdout), &watchdogOutput)
		if err != nil {
			buildLog = append(buildLog, result)
			// If parsing watchdog output fails, return IE(Internal Error) status.
			return buildLog, fmt.Errorf("failed to unmarshal watchdog output: %w", err)
		}

		// Save stdout and stderr to files
		if err = os.MkdirAll(job.ResultDir, 0755); err != nil {
			buildLog = append(buildLog, result)
			return buildLog, fmt.Errorf("failed to create result directory %s: %w", job.ResultDir, err)
		}

		stdoutFilePath := filepath.Join(job.ResultDir, fmt.Sprintf("build_%d_stdout.txt", buildTask.ID))
		err = os.WriteFile(stdoutFilePath, []byte(watchdogOutput.Stdout), 0644)
		if err != nil {
			buildLog = append(buildLog, result)
			return buildLog, fmt.Errorf("failed to write stdout file %s: %w", stdoutFilePath, err)
		}

		stderrFilePath := filepath.Join(job.ResultDir, fmt.Sprintf("build_%d_stderr.txt", buildTask.ID))
		err = os.WriteFile(stderrFilePath, []byte(watchdogOutput.Stderr), 0644)
		if err != nil {
			buildLog = append(buildLog, result)
			return buildLog, fmt.Errorf("failed to write stderr file %s: %w", stderrFilePath, err)
		}

		if watchdogOutput.ExitCode == nil {
			// If ExitCode is nil, it means the watchdog was terminated abnormally.
			// In this case, there is a log message in watchdogOutput.stderr,
			buildLog = append(buildLog, result)
			return buildLog, fmt.Errorf("watchdog terminated abnormally, stderr: %s", watchdogOutput.Stderr)
		}

		// Determine result status
		var resultStatus requeststatus.State = requeststatus.AC

		if watchdogOutput.OLE {
			resultStatus = resultStatus.Max(requeststatus.OLE)
		}
		if watchdogOutput.MLE {
			resultStatus = resultStatus.Max(requeststatus.MLE)
		}
		if watchdogOutput.TLE {
			resultStatus = resultStatus.Max(requeststatus.TLE)
		}

		if !buildTask.IgnoreExit && buildTask.ExitCode == 0 && *watchdogOutput.ExitCode != 0 {
			// If the expected exit code is 0 (successful execution), but the actual exit code is not 0, mark it as CE
			resultStatus = resultStatus.Max(requeststatus.CE)
		}
		if !buildTask.IgnoreExit && buildTask.ExitCode != 0 && *watchdogOutput.ExitCode == 0 {
			// If the exit code is not 0 (expected failure), but the actual exit code is 0, mark it as RE (Runtime Error)
			resultStatus = resultStatus.Max(requeststatus.RE)
		}

		// Append to requestLog
		result = model.TaskLog{
			TestCaseID: buildTask.ID,
			ResultID:   resultStatus,
			TimeMS:     watchdogOutput.TimeMS,
			MemoryKB:   watchdogOutput.MemoryKB,
			ExitCode:   *watchdogOutput.ExitCode,
			StdoutPath: stdoutFilePath,
			StderrPath: stderrFilePath,
		}
		buildLog = append(buildLog, result)
	}

	return buildLog, nil
}

func (executor *JobExecutor) executeJudgeTasks(ctx context.Context, job *model.JobDetail, volumeName string) ([]model.TaskLog, error) {
	// Start Judge Container to run user program against test cases
	judge_container_name := fmt.Sprintf("judge-%s", uuid.New().String())

	cpuSet := CPU_SET
	timeout := TIMEOUT_BEFORE_CONTAINER_STOP
	pidLimit := int64(PID_LIMIT)
	// add 32MB for overhead
	totalMemoryInBytes := min(
		(job.MemoryMB+32)*1024*1024, MAX_MEMORY_LIMIT_MB*1024*1024)

	judgeContainer_createResponse, err := executor.client.ContainerCreate(ctx,
		&container.Config{
			User:  "root",
			Cmd:   []string{"/bin/sh", "-c", "sleep 3600"},
			Image: "binary-runner",
			Volumes: map[string]struct{}{
				"/home/guest": {},
			},
			WorkingDir:      "/home/guest",
			NetworkDisabled: true,
			StopTimeout:     &timeout,
		},
		&container.HostConfig{
			Binds: []string{fmt.Sprintf("%s:/home/guest", volumeName)},
			Resources: container.Resources{
				CpusetCpus: cpuSet, // only 1 CPU core can be used.
				Memory:     totalMemoryInBytes,
				MemorySwap: totalMemoryInBytes, // disable swap
				PidsLimit:  &pidLimit,          // limit max number of processes available to spawn
				Ulimits: []*container.Ulimit{
					{
						Name: "nofile", // limit max number of open files
						Hard: 128,
						Soft: 128,
					},
					{
						Name: "nproc", // limit max number of processes
						Hard: pidLimit,
						Soft: pidLimit,
					},
					{
						Name: "fsize",          // limit max size of files that can be created, the unit is bytes
						Hard: 10 * 1024 * 1024, // 10 MB
						Soft: 10 * 1024 * 1024, // 10 MB
					},
					{
						Name: "stack",           // limit max stack size, the unit is bytes
						Hard: (8 * 1024 * 1024), // 8 MB
						Soft: (8 * 1024 * 1024), // 8 MB
					},
				},
			},
			// TODO: try this to check whether this works or not.
			// StorageOpt: map[string]string{
			// 	"size": "256m", // limit container writable layer size
			// },
		},
		nil,
		nil,
		judge_container_name,
	)

	if judgeContainer_createResponse.Warnings != nil {
		for _, warning := range judgeContainer_createResponse.Warnings {
			fmt.Printf("Docker Warning: %s\n", warning)
		}
	}

	if err != nil {
		return nil, err
	}

	defer executor.RemoveContainer(ctx, judgeContainer_createResponse.ID)

	// Start the judge container
	err = executor.client.ContainerStart(ctx, judgeContainer_createResponse.ID, container.StartOptions{})
	if err != nil {
		return nil, err
	}
	timeoutBeforeStop := 0
	defer executor.client.ContainerStop(ctx, judgeContainer_createResponse.ID, container.StopOptions{
		Signal:  "SIGKILL",
		Timeout: &timeoutBeforeStop, // do not wait before killing the container
	})

	judgeLog := []model.TaskLog{}

	// Execute judge tasks
	for _, judgeTask := range job.JudgeTasks {
		result := model.TaskLog{
			TestCaseID: judgeTask.ID,
			ResultID:   requeststatus.IE,
			TimeMS:     0,
			MemoryKB:   0,
			ExitCode:   -1,
		}

		// Read stdin from judgeTask.StdinPath
		stdinContent := []byte{}
		if judgeTask.StdinPath != "" {
			stdinPath := filepath.Join(job.ResourceDir, judgeTask.StdinPath)
			stdinContent, err = os.ReadFile(stdinPath)
			if err != nil {
				return judgeLog, fmt.Errorf("failed to read stdin file %s: %w", stdinPath, err)
			}
		}

		// Read expected stdout and stderr if specified
		expectedStdoutContent := []byte{}
		expectedStderrContent := []byte{}
		if judgeTask.StdoutPath != "" {
			expectedStdoutPath := filepath.Join(job.ResourceDir, judgeTask.StdoutPath)
			expectedStdoutContent, err = os.ReadFile(expectedStdoutPath)
			if err != nil {
				return judgeLog, fmt.Errorf("failed to read expected stdout file %s: %w", expectedStdoutPath, err)
			}
		}
		if judgeTask.StderrPath != "" {
			expectedStderrPath := filepath.Join(job.ResourceDir, judgeTask.StderrPath)
			expectedStderrContent, err = os.ReadFile(expectedStderrPath)
			if err != nil {
				return judgeLog, fmt.Errorf("failed to read expected stderr file %s: %w", expectedStderrPath, err)
			}
		}

		TotalTimeoutInSeconds := job.TimeMS/1000 + 5 // add 5 seconds for overhead

		watchdogInput := WatchdogInput{
			Command:        judgeTask.Command,
			Stdin:          string(stdinContent),
			TimeoutMS:      job.TimeMS,
			MemoryMB:       job.MemoryMB,
			UID:            UID_GUEST,
			GID:            GID_GUEST,
			StdoutMaxBytes: MAX_STDOUT_BYTES,
			StderrMaxBytes: MAX_STDERR_BYTES,
		}

		// Convert watchdogInput to JSON string
		watchdogInputJSON, err := json.Marshal(watchdogInput)
		if err != nil {
			return judgeLog, fmt.Errorf("failed to marshal watchdog input: %w", err)
		}

		execConfig := ExecConfig{
			Cmd:              []string{"/home/watchdog"},
			Stdin:            string(watchdogInputJSON),
			WorkingDir:       "/home/guest",
			Env:              []string{},
			TimeoutInSeconds: TotalTimeoutInSeconds,
			User:             "root", // need root to run watchdog
		}

		execResult, err := executor.ExecuteCommand(ctx, judgeContainer_createResponse.ID, execConfig)
		if err != nil {
			// If some internal error occurs (not the command execution error),
			// return ResultDetail with IE(Internal Error) status.
			judgeLog = append(judgeLog, result)
			return judgeLog, fmt.Errorf("failed to execute judge task %s: %w", judgeTask.Title, err)
		}

		if execResult.Stderr != "" {
			// If watchdog writes something to stderr, return IE(Internal Error) status.
			judgeLog = append(judgeLog, result)
			return judgeLog, fmt.Errorf("watchdog wrote to stderr: %s", execResult.Stderr)
		}

		// parse execResult.Stdout as WatchdogOutput
		var watchdogOutput WatchdogOutput
		err = json.Unmarshal([]byte(execResult.Stdout), &watchdogOutput)
		if err != nil {
			judgeLog = append(judgeLog, result)
			return judgeLog, fmt.Errorf("failed to unmarshal watchdog output: %w", err)
		}

		// Save stdout and stderr to files
		if err = os.MkdirAll(job.ResultDir, 0755); err != nil {
			judgeLog = append(judgeLog, result)
			return judgeLog, fmt.Errorf("failed to create result directory %s: %w", job.ResultDir, err)
		}

		stdoutFilePath := filepath.Join(job.ResultDir, fmt.Sprintf("judge_%d_stdout.txt", judgeTask.ID))
		err = os.WriteFile(stdoutFilePath, []byte(watchdogOutput.Stdout), 0644)
		if err != nil {
			judgeLog = append(judgeLog, result)
			return judgeLog, fmt.Errorf("failed to write stdout file %s: %w", stdoutFilePath, err)
		}

		stderrFilePath := filepath.Join(job.ResultDir, fmt.Sprintf("judge_%d_stderr.txt", judgeTask.ID))
		err = os.WriteFile(stderrFilePath, []byte(watchdogOutput.Stderr), 0644)
		if err != nil {
			judgeLog = append(judgeLog, result)
			return judgeLog, fmt.Errorf("failed to write stderr file %s: %w", stderrFilePath, err)
		}

		if watchdogOutput.ExitCode == nil {
			// If ExitCode is nil, it means the watchdog was terminated abnormally.
			// In this case, there is a log message in watchdogOutput.stderr,
			judgeLog = append(judgeLog, result)
			return judgeLog, fmt.Errorf("watchdog terminated abnormally: %s", watchdogOutput.Stderr)
		}

		// Determine result status
		var resultStatus requeststatus.State = requeststatus.AC

		if watchdogOutput.OLE {
			resultStatus = resultStatus.Max(requeststatus.OLE)
		}
		if watchdogOutput.MLE {
			resultStatus = resultStatus.Max(requeststatus.MLE)
		}
		if watchdogOutput.TLE {
			resultStatus = resultStatus.Max(requeststatus.TLE)
		}

		if !judgeTask.IgnoreExit && judgeTask.ExitCode == 0 && *watchdogOutput.ExitCode != 0 {
			// If the expected exit code is 0 (successful execution), but the actual exit code is not 0, mark it as RE (Runtime Error)
			resultStatus = resultStatus.Max(requeststatus.RE)
		}
		if !judgeTask.IgnoreExit && judgeTask.ExitCode != 0 && *watchdogOutput.ExitCode == 0 {
			// Expected non-zero exit code (expected failure), but the actual exit code is 0, mark it as WA (Wrong Answer)
			resultStatus = resultStatus.Max(requeststatus.WA)
		}

		// Check stdout and stderr if expected files are provided

		if judgeTask.StdoutPath != "" {
			if !match.Match(string(expectedStdoutContent), watchdogOutput.Stdout) {
				resultStatus = resultStatus.Max(requeststatus.WA)
			}
		}

		if judgeTask.StderrPath != "" {
			if !match.Match(string(expectedStderrContent), watchdogOutput.Stderr) {
				resultStatus = resultStatus.Max(requeststatus.WA)
			}
		}

		// Append to judgeLog
		result = model.TaskLog{
			TestCaseID: judgeTask.ID,
			ResultID:   resultStatus,
			TimeMS:     watchdogOutput.TimeMS,
			MemoryKB:   watchdogOutput.MemoryKB,
			ExitCode:   *watchdogOutput.ExitCode,
			StdoutPath: stdoutFilePath,
			StderrPath: stderrFilePath,
		}
		judgeLog = append(judgeLog, result)
	}

	return judgeLog, nil
}

// Copy file (or directory) from host to container
func (executor *JobExecutor) CopyContentsToContainer(ctx context.Context, srcInHost, containerID, dstInContainer string) error {
	// Create tar archive from source path
	tarReader, err := util.CreateTarArchive(srcInHost)
	if err != nil {
		return fmt.Errorf("failed to create tar archive: %w", err)
	}

	// Copy tar archive to container
	err = executor.client.CopyToContainer(ctx, containerID, dstInContainer, tarReader, container.CopyToContainerOptions{
		// it will be an error if unpacking the given content would cause an existing directory to be replaced with a non-directory and vice versa.
		AllowOverwriteDirWithFile: false,
		CopyUIDGID:                false,
	})

	if err != nil {
		return fmt.Errorf("failed to copy to container: %w", err)
	}

	return nil
}

type ExecConfig struct {
	Cmd              []string
	Stdin            string
	WorkingDir       string
	Env              []string
	TimeoutInSeconds int64
	User             string // Format: "uid:gid" or just "uid"
}

type ExecResult struct {
	ExitCode int64
	Stdout   string
	Stderr   string
	TimeOut  bool
}

// Execute a command in a running container with given configuration.
func (executor *JobExecutor) ExecuteCommand(ctx context.Context, containerID string, config ExecConfig) (ExecResult, error) {
	var result ExecResult

	// Create a context with timeout if specified
	var cancelFunc context.CancelFunc
	if config.TimeoutInSeconds > 0 {
		ctx, cancelFunc = context.WithTimeout(ctx, time.Duration(config.TimeoutInSeconds)*time.Second)
		defer cancelFunc()
	}

	// Prepare exec configuration
	execOptions := container.ExecOptions{
		User:         config.User,
		Privileged:   false,
		Tty:          false,
		AttachStdin:  config.Stdin != "",
		AttachStdout: true,
		AttachStderr: true,
		Env:          config.Env,
		WorkingDir:   config.WorkingDir,
		Cmd:          config.Cmd,
	}

	// Create exec instance
	execResp, err := executor.client.ContainerExecCreate(ctx, containerID, execOptions)
	if err != nil {
		return result, fmt.Errorf("failed to create exec instance: %w", err)
	}

	// Attach to exec instance
	attachResp, err := executor.client.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{
		Detach: false,
		Tty:    false,
	})
	if err != nil {
		return result, fmt.Errorf("failed to attach to exec instance: %w", err)
	}
	defer attachResp.Close()

	// Handle stdin if provided
	if config.Stdin != "" {
		go func() {
			defer attachResp.CloseWrite()
			_, _ = attachResp.Conn.Write([]byte(config.Stdin))
		}()
	}

	// Create channels for output collection
	outputDone := make(chan error, 1)
	var stdoutBuf, stderrBuf bytes.Buffer

	// Collect output in a goroutine
	go func() {
		// Since we're not using TTY, we need to use stdcopy to demultiplex stdout and stderr
		_, err := stdcopy.StdCopy(&stdoutBuf, &stderrBuf, attachResp.Reader)
		outputDone <- err
	}()

	// Wait for output collection or timeout
	select {
	case err := <-outputDone:
		if err != nil {
			return result, fmt.Errorf("error while reading output: %w", err)
		}
	case <-ctx.Done():
		// Timeout occurred
		result.TimeOut = true
		result.Stderr = stdoutBuf.String()
		result.Stdout = stderrBuf.String()

		// Return timeout error immediately
		// The caller has responsibility to container cleanup
		return result, fmt.Errorf("command execution timed out after %d seconds", config.TimeoutInSeconds)
	}

	// Get exec inspect information to retrieve exit code
	inspectResp, err := executor.client.ContainerExecInspect(context.Background(), execResp.ID)
	if err != nil {
		return result, fmt.Errorf("failed to inspect exec instance: %w", err)
	}

	// Set results
	result.ExitCode = int64(inspectResp.ExitCode)
	result.Stdout = stdoutBuf.String()
	result.Stderr = stderrBuf.String()

	return result, nil
}

// Helper function to execute a simple command and get output
func (executor *JobExecutor) ExecuteSimpleCommand(ctx context.Context, containerID string, cmd []string) (ExecResult, error) {
	config := ExecConfig{
		Cmd:              cmd,
		TimeoutInSeconds: 30,
	}

	result, err := executor.ExecuteCommand(ctx, containerID, config)
	if err != nil {
		return ExecResult{}, err
	}

	if result.ExitCode != 0 {
		return result, fmt.Errorf("command %v failed with exit code %d, stderr: %s", cmd, result.ExitCode, result.Stderr)
	}

	return result, nil
}

func (executor *JobExecutor) CheckImageExists(ctx context.Context, imageName string) (bool, error) {
	// Check the existence of a docker image
	_, err := executor.client.ImageInspect(ctx, imageName)
	if err != nil {
		return false, err
	}
	return true, nil
}

func (executor *JobExecutor) Close() error {
	return executor.client.Close()
}

func (executor *JobExecutor) RemoveVolume(ctx context.Context, volumeName string) error {
	return executor.client.VolumeRemove(ctx, volumeName, true)
}

func (executor *JobExecutor) RemoveContainer(ctx context.Context, containerID string) error {
	return executor.client.ContainerRemove(ctx, containerID, container.RemoveOptions{
		// Remove anonymous volumes associated with the container.
		Force: true,
		// If the container is running, kill it before removing it.
		RemoveVolumes: true,
	})
}
