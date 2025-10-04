use std::{
    io::{self, Read, Write},
    os::unix::process::CommandExt,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use nix::{
    sys::signal::{Signal, kill},
    unistd::{Pid, setpgid},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct TaskInput {
    command: String,
    stdin: String,
    timeout_ms: u64,
    memory_limit_mb: u64,
    uid: u32,
    gid: u32,
    stdout_max_bytes: usize,
    stderr_max_bytes: usize,
}

#[derive(Debug, Serialize)]
struct TaskOutput {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    time_ms: u64,
    memory_kb: u64,
    #[serde(rename = "TLE")]
    tle: bool,
    #[serde(rename = "MLE")]
    mle: bool,
    #[serde(rename = "OLE")]
    ole: bool,
}

fn get_memory_usage_by_kb() -> io::Result<u64> {
    let path = "/sys/fs/cgroup/memory.current";
    let contents = std::fs::read_to_string(path)?;
    contents
        .trim()
        .parse::<u64>()
        .map(|bytes| bytes / 1024) // Convert to KB
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

// Alternative method using /proc/[pid]/status
// Uncomment if needed
// fn get_memory_usage(pid: u32) -> io::Result<u64> {
//     let status_path = format!("/proc/{}/status", pid);
//     let content = std::fs::read_to_string(status_path)?;

//     for line in content.lines() {
//         if line.starts_with("VmRSS:") {
//             let parts: Vec<&str> = line.split_whitespace().collect();
//             if parts.len() >= 2 {
//                 if let Ok(kb) = parts[1].parse::<u64>() {
//                     return Ok(kb);
//                 }
//             }
//         }
//     }
//     Ok(0)
// }

fn monitor_output<R: Read + Send + 'static>(
    mut reader: R,
    buffer: Arc<Mutex<Vec<u8>>>,
    max_bytes: usize,
    ole_flag: Arc<Mutex<bool>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut local_buffer = vec![0u8; 1024];
        loop {
            match reader.read(&mut local_buffer) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let mut buf = buffer.lock().unwrap();
                    let new_size = buf.len() + n;

                    if new_size > max_bytes {
                        *ole_flag.lock().unwrap() = true;
                        let allowed = max_bytes.saturating_sub(buf.len());
                        let to_copy = n.min(allowed);
                        buf.extend_from_slice(&local_buffer[..to_copy]);
                        break;
                    } else {
                        buf.extend_from_slice(&local_buffer[..n]);
                    }
                }
                Err(_) => break,
            }
        }
    })
}

fn kill_process_group(pid: u32) {
    // Kill the entire process group by using negative PID
    // This will kill the process and all its descendants
    let pgid = Pid::from_raw(-(pid as i32));

    // First try SIGTERM for graceful shutdown
    let _ = kill(pgid, Signal::SIGTERM);

    // Wait a bit for graceful shutdown
    thread::sleep(Duration::from_millis(100));

    // Then force kill with SIGKILL if still running
    let _ = kill(pgid, Signal::SIGKILL);
}

fn execute_task(task: TaskInput) -> TaskOutput {
    let start_time = Instant::now();
    let mut tle = false;
    let mut mle = false;
    let ole = Arc::new(Mutex::new(false));

    // Parse command and arguments
    let parts: Vec<&str> = task.command.split_whitespace().collect();
    if parts.is_empty() {
        return TaskOutput {
            exit_code: None,
            stdout: String::new(),
            stderr: "Invalid command".to_string(),
            time_ms: 0,
            memory_kb: 0,
            tle: false,
            mle: false,
            ole: false,
        };
    }

    // Spawn child process with specified uid/gid
    // Use process_group(0) to create a new process group with the child as leader
    let mut child = match unsafe {
        Command::new("/bin/sh")
            .arg("-c")
            .arg(&task.command)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .uid(task.uid)
            .gid(task.gid)
            .pre_exec(|| {
                // Create a new process group with this process as the leader
                // This ensures all child processes are in the same group
                setpgid(Pid::from_raw(0), Pid::from_raw(0))?;
                Ok(())
            })
            .spawn()
    } {
        Ok(child) => child,
        Err(e) => {
            return TaskOutput {
                exit_code: None,
                stdout: String::new(),
                stderr: format!("Failed to spawn process: {}", e),
                time_ms: 0,
                memory_kb: 0,
                tle: false,
                mle: false,
                ole: false,
            };
        }
    };

    let pid = child.id();

    // Write stdin
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(task.stdin.as_bytes());
        let _ = stdin.flush();
        // Close stdin to signal EOF
        drop(stdin);
    }

    // Set up output monitoring
    let stdout_buffer = Arc::new(Mutex::new(Vec::new()));
    let stderr_buffer = Arc::new(Mutex::new(Vec::new()));
    let ole_flag = ole.clone();

    let stdout_handle = match child.stdout.take() {
        Some(stdout) => monitor_output(
            stdout,
            stdout_buffer.clone(),
            task.stdout_max_bytes,
            ole_flag.clone(),
        ),
        None => {
            return TaskOutput {
                exit_code: None,
                stdout: String::new(),
                stderr: "Failed to capture stdout".to_string(),
                time_ms: 0,
                memory_kb: 0,
                tle: false,
                mle: false,
                ole: false,
            };
        }
    };

    let stderr_handle = match child.stderr.take() {
        Some(stderr) => monitor_output(
            stderr,
            stderr_buffer.clone(),
            task.stderr_max_bytes,
            ole_flag.clone(),
        ),
        None => {
            return TaskOutput {
                exit_code: None,
                stdout: String::new(),
                stderr: "Failed to capture stderr".to_string(),
                time_ms: 0,
                memory_kb: 0,
                tle: false,
                mle: false,
                ole: false,
            };
        }
    };

    // Monitor process
    let timeout = Duration::from_millis(task.timeout_ms);
    let memory_limit_kb = task.memory_limit_mb * 1024;
    let check_interval = Duration::from_millis(10);
    let mut max_memory_kb = 0u64;

    let monitoring_start = Instant::now();
    let mut process_killed = false;

    loop {
        // Check if process has exited
        match child.try_wait() {
            Ok(Some(status)) => {
                // Process has exited
                let elapsed = start_time.elapsed();

                // Wait for output threads to finish
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();

                let stdout = String::from_utf8_lossy(&stdout_buffer.lock().unwrap()).to_string();
                let stderr = String::from_utf8_lossy(&stderr_buffer.lock().unwrap()).to_string();

                return TaskOutput {
                    exit_code: status.code(),
                    stdout,
                    stderr,
                    time_ms: elapsed.as_millis() as u64,
                    memory_kb: max_memory_kb,
                    tle,
                    mle,
                    ole: *ole.lock().unwrap(),
                };
            }
            Ok(None) => {
                // Process still running, do nothing.
            }
            Err(e) => {
                return TaskOutput {
                    exit_code: None,
                    stdout: String::new(),
                    stderr: format!("Error waiting for process: {}", e),
                    time_ms: start_time.elapsed().as_millis() as u64,
                    memory_kb: max_memory_kb,
                    tle,
                    mle,
                    ole: *ole.lock().unwrap(),
                };
            }
        }

        // Only check limits if we haven't already killed the process
        if !process_killed {
            // Check timeout
            if monitoring_start.elapsed() > timeout {
                tle = true;
                kill_process_group(pid);
                process_killed = true;
                continue;
            }

            // Check memory usage
            if let Ok(memory_kb) = get_memory_usage_by_kb() {
                max_memory_kb = max_memory_kb.max(memory_kb);
                if memory_kb > memory_limit_kb {
                    mle = true;
                    kill_process_group(pid);
                    process_killed = true;
                    continue;
                }
            }

            // Check output limit exceeded
            if *ole.lock().unwrap() {
                kill_process_group(pid);
                process_killed = true;
                continue;
            }
        }

        thread::sleep(check_interval);
    }
}

/// Executes a task with resource limits and captures output.
/// Returns JSON log with execution details.
///
/// Input are given on stdin as JSON, output is printed to stdout as JSON.
///
/// ```json
/// {
///    "command": "cmd [args...]",
///    "stdin": "stdin data",
///    "timeout_ms": 3000,
///    "memory_limit_mb": 1024,
///    "uid": 1000,
///    "gid": 1000,
///    "stdout_max_bytes": 1024,
///    "stderr_max_bytes": 1024,
/// }
/// ```
///
/// The command is executed as `/bin/sh -c "command"`, so shell features like
///  pipe forwarding are available.
///
/// Output JSON format:
///
/// ```json
/// {
///    "exit_code": 0,   // None if error occurs on setup/monitoring
///    "stdout": "",
///    "stderr": "",     // Contains error message if exit_code is None
///    "time_ms": 123,
///    "memory_kb": 456,
///    "TLE": false,     // Time Limit Exceeded If true
///    "MLE": false,     // Memory Limit Exceeded If true
///    "OLE": false,     // Output Limit Exceeded If true
/// }
/// ```
///
/// If there are some errors when setting up or monitoring the process,
/// exit_code will be None and stderr will contain the error message.
fn main() {
    // Read JSON from stdin
    // Expected JSON format:
    //    {
    //       "command": "cmd [args...]",
    //       "stdin": "stdin data",
    //       "timeout_ms": 3000,
    //       "memory_limit_mb": 1024,
    //       "uid": 1000,
    //       "gid": 1000,
    //       "stdout_max_bytes": 1024,
    //       "stderr_max_bytes": 1024,
    //    }
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        eprintln!("Failed to read input: {}", e);
        std::process::exit(1);
    }

    // Parse JSON
    let task: TaskInput = match serde_json::from_str(&input) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Failed to parse JSON: {}", e);
            std::process::exit(1);
        }
    };

    // Execute task
    let output = execute_task(task);

    // Output JSON result
    match serde_json::to_string(&output) {
        Ok(json) => {
            println!("{}", json);
        }
        Err(e) => {
            eprintln!("Failed to serialize output: {}", e);
            std::process::exit(1);
        }
    }
}
