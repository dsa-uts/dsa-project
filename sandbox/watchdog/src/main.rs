use base64::{Engine as _, engine::general_purpose::STANDARD};
use nix::{
    errno::Errno,
    fcntl::{FcntlArg, OFlag, fcntl},
    poll::{PollFd, PollFlags, poll},
};
use serde::{Deserialize, Serialize};
use std::{
    io::{self, ErrorKind, Read, Write},
    os::fd::{AsFd, BorrowedFd},
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
mod linux;

const CHUNK_SIZE: usize = 8192;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    run: String,
    #[serde(deserialize_with = "decode_stdin")]
    stdin: Vec<u8>,
    timeout_ms: u64,
    memory_limit_bytes: u64,
    stdout_limit_bytes: usize,
    stderr_limit_bytes: usize,
}

#[derive(Debug, Serialize)]
struct Output {
    exit_code: Option<i32>,
    signal: Option<i32>,
    stdout_base64: String,
    stderr_base64: String,
    elapsed_ms: u64,
    memory_peak_bytes: u64,
    tle: bool,
    mle: bool,
    ole: bool,
}

fn decode_stdin<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let encoded = String::deserialize(deserializer)?;
    STANDARD.decode(encoded).map_err(serde::de::Error::custom)
}

fn read_input(
    reader: impl std::io::Read,
    max_bytes: usize,
) -> Result<Input, Box<dyn std::error::Error>> {
    let read_limit = u64::try_from(max_bytes)?
        .checked_add(1)
        .ok_or_else(|| io::Error::other("input size limit is too large"))?;

    let mut bytes = Vec::new();
    reader.take(read_limit).read_to_end(&mut bytes)?;

    if bytes.len() > max_bytes {
        return Err(
            io::Error::new(io::ErrorKind::InvalidData, "input JSON exceeds size limit").into(),
        );
    }

    let input: Input = serde_json::from_slice(&bytes)?;

    if input.run.contains('\0') {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "run must not conatin NUL").into());
    }

    if input.timeout_ms == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "timeout_ms must be greater than 0",
        )
        .into());
    }

    if Instant::now()
        .checked_add(Duration::from_millis(input.timeout_ms))
        .is_none()
    {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "timeout_ms is too large").into());
    }

    if input.memory_limit_bytes < 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "memory_limit_bytes must be larger than 0",
        )
        .into());
    }

    if input.stdout_limit_bytes < 1 || input.stdout_limit_bytes > (128 * 1024) {
        return Err(
            io::Error::new(io::ErrorKind::InvalidData, "stdout_limit_bytes is invalid.").into(),
        );
    }

    if input.stderr_limit_bytes < 1 || input.stderr_limit_bytes > (128 * 1024) {
        return Err(
            io::Error::new(io::ErrorKind::InvalidData, "stderr_limit_bytes is invalid.").into(),
        );
    }

    Ok(input)
}

fn capture_output(buffer: &mut Vec<u8>, chunk: &[u8], limit: usize) -> bool {
    let remaining = limit.saturating_sub(buffer.len());
    let keep = chunk.len().min(remaining);
    buffer.extend_from_slice(&chunk[..keep]);
    chunk.len() > remaining
}

fn set_nonblocking(fd: &impl AsFd) -> nix::Result<()> {
    let flags = OFlag::from_bits_retain(fcntl(fd, FcntlArg::F_GETFL)?);
    fcntl(fd, FcntlArg::F_SETFL(flags | OFlag::O_NONBLOCK))?;
    Ok(())
}

/// EOFならtrueを返す。readerはnonblockingに設定しておく。
fn read_output(
    reader: &mut impl Read,
    buffer: &mut Vec<u8>,
    limit: usize,
    ole: &mut bool,
) -> io::Result<bool> {
    let mut chunk = [0u8; CHUNK_SIZE];

    match reader.read(&mut chunk) {
        Ok(0) => Ok(true),
        Ok(n) => {
            *ole |= capture_output(buffer, &chunk[..n], limit);
            Ok(false)
        }
        Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

/// stdinを閉じてよければtrueを返す
/// writerはnonblockingに設定しておく
fn write_input(writer: &mut impl Write, remaining: &mut &[u8]) -> io::Result<bool> {
    if remaining.is_empty() {
        return Ok(true);
    }

    let length = remaining.len().min(CHUNK_SIZE);

    match writer.write(&remaining[..length]) {
        Ok(0) => Err(io::Error::new(
            ErrorKind::WriteZero,
            "failed to write child stdin",
        )),
        Ok(n) => {
            *remaining = &remaining[n..];
            Ok(remaining.is_empty())
        }
        Err(error) if error.kind() == ErrorKind::BrokenPipe => Ok(true),
        Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

/// stdin・stdout・stderrの順でイベントを返す。
fn wait_for_io(
    streams: [Option<BorrowedFd<'_>>; 3],
    timeout_ms: u16,
) -> io::Result<[PollFlags; 3]> {
    let interests = [
        PollFlags::POLLOUT, /* STDIN */
        PollFlags::POLLIN,  /* STDOUT */
        PollFlags::POLLIN,  /* STDERR */
    ];

    let mut fds: Vec<_> = streams
        .iter()
        .enumerate()
        .filter_map(|(index, fd)| fd.map(|fd| PollFd::new(fd, interests[index])))
        .collect();

    let mut events = [PollFlags::empty(); 3];

    match poll(&mut fds, timeout_ms) {
        Ok(_) => {}
        Err(Errno::EINTR) => return Ok(events),
        Err(error) => return Err(error.into()),
    }

    let active = streams.iter().enumerate().filter(|(_, fd)| fd.is_some());

    for ((index, _), fd) in active.zip(&fds) {
        let flags = fd
            .revents()
            .ok_or_else(|| io::Error::other("unknown poll event"))?;

        if flags.contains(PollFlags::POLLNVAL) {
            return Err(io::Error::other("invalid pipe descriptor"));
        }

        events[index] = flags;
    }

    Ok(events)
}

fn main() {
    println!("Hello, world!");
}

#[cfg(test)]
mod test {
    use super::*;
    use serde_json::json;

    #[test]
    fn read_input_and_checks_limits() {
        let mut value = json!({
            "run": "cat",
            "stdin": "AP8=",
            "timeout_ms": 1000,
            "memory_limit_bytes": 134217728,
            "stdout_limit_bytes": 131072,
            "stderr_limit_bytes": 131072
        });

        let bytes = serde_json::to_vec(&value).unwrap();
        let input = read_input(bytes.as_slice(), bytes.len()).unwrap();

        assert_eq!(input.run, "cat");
        assert_eq!(input.stdin, vec![0, 255]);
        assert!(read_input(bytes.as_slice(), bytes.len() - 1).is_err());

        for (field, invalid) in [
            ("run", json!("echo \u{0000}")),
            ("stdin", json!("!invalid-base64!")),
            ("timeout_ms", json!(0)),
            ("memory_limit_bytes", json!(0)),
            ("stdout_limit_bytes", json!(0)),
            ("stderr_limit_bytes", json!(0)),
            ("stderr_limit_bytes", json!(131073)),
        ] {
            let mut invalid_input = value.clone();
            invalid_input[field] = invalid;
            let bytes = serde_json::to_vec(&invalid_input).unwrap();

            assert!(
                read_input(bytes.as_slice(), bytes.len()).is_err(),
                "{field} should be rejected",
            );
        }

        value["stdout_limit_bytes"] = json!(131073);
        let bytes = serde_json::to_vec(&value).unwrap();
        assert!(read_input(bytes.as_slice(), bytes.len()).is_err());
    }

    #[test]
    fn captures_output_up_to_limit() {
        let mut buffer = Vec::new();

        assert!(!capture_output(&mut buffer, &[0, 255], 3));
        assert!(!capture_output(&mut buffer, &[42], 3)); // 上限ちょうど
        assert!(!capture_output(&mut buffer, &[], 3)); // 追加出力なし
        assert!(capture_output(&mut buffer, &[99], 3)); // 上限超過
        assert_eq!(buffer, vec![0, 255, 42]);

        let mut buffer = Vec::new();
        assert!(capture_output(&mut buffer, &[1, 2, 3, 4], 3));
        assert_eq!(buffer, vec![1, 2, 3]);
    }

    #[test]
    fn reads_nonblocking_output_through_eof() {
        use nix::{
            poll::{PollFd, PollFlags, poll},
            unistd::pipe,
        };
        use std::{fs::File, io::Write};

        let (read_fd, write_fd) = pipe().unwrap();
        let mut reader = File::from(read_fd);
        let mut writer = File::from(write_fd);
        set_nonblocking(&reader).unwrap();

        let mut output = Vec::new();
        let mut ole = false;

        // 書き手が生存し、データがない状態はEOFではない。
        assert!(!read_output(&mut reader, &mut output, 3, &mut ole).unwrap());
        assert!(output.is_empty());
        assert!(!ole);

        writer.write_all(&[0, 255, 42, 99]).unwrap();
        drop(writer);

        let events = {
            let mut fds = [PollFd::new(reader.as_fd(), PollFlags::POLLIN)];
            assert_eq!(poll(&mut fds, 0u16).unwrap(), 1);
            fds[0].revents().unwrap()
        };

        assert!(events.intersects(PollFlags::POLLIN | PollFlags::POLLHUP));

        // 書き手が閉じても、残っているデータを先に読む。
        assert!(!read_output(&mut reader, &mut output, 3, &mut ole).unwrap());
        assert_eq!(output, vec![0, 255, 42]);
        assert!(ole);

        // データを読み切った後にEOFになる。
        assert!(read_output(&mut reader, &mut output, 3, &mut ole).unwrap());
    }

    #[test]
    fn output_limit_flag_is_preserved_across_streams() {
        let mut ole = false;

        read_output(&mut &b"abcd"[..], &mut Vec::new(), 3, &mut ole).unwrap();
        assert!(ole);

        read_output(&mut &b"x"[..], &mut Vec::new(), 3, &mut ole).unwrap();
        assert!(ole);
    }

    #[test]
    fn writes_input_without_losing_remaining_bytes() {
        let mut remaining: &[u8] = &[0, 255, 42, 99];
        let mut first = [0u8; 2];

        assert!(!write_input(&mut &mut first[..], &mut remaining).unwrap());
        assert_eq!(first, [0, 255]);
        assert_eq!(remaining, &[42, 99]);

        let mut rest = Vec::new();
        assert!(write_input(&mut rest, &mut remaining).unwrap());
        assert_eq!(rest, vec![42, 99]);
        assert!(remaining.is_empty());

        // 空なら書き込みを行わず完了する。
        assert!(write_input(&mut rest, &mut remaining).unwrap());
        assert_eq!(rest, vec![42, 99]);
    }

    #[test]
    fn stops_writing_when_child_closes_stdin() {
        use nix::unistd::pipe;
        use std::fs::File;

        let (read_fd, write_fd) = pipe().unwrap();
        let mut writer = File::from(write_fd);
        set_nonblocking(&writer).unwrap();
        drop(read_fd);

        let mut remaining: &[u8] = b"input";
        assert!(write_input(&mut writer, &mut remaining).unwrap());
        assert_eq!(remaining, b"input"); // 送信済みと偽らない
    }

    #[test]
    fn polls_only_open_streams() {
        use nix::unistd::pipe;
        use std::fs::File;

        let (read_fd, write_fd) = pipe().unwrap();
        let reader = File::from(read_fd);
        let mut writer = File::from(write_fd);

        // stdoutにデータがなければイベントなし。
        let events = wait_for_io([None, Some(reader.as_fd()), None], 0).unwrap();
        assert_eq!(events, [PollFlags::empty(); 3]);

        writer.write_all(b"x").unwrap();

        // stdoutの位置だけに読み取り可能イベントが返る。
        let events = wait_for_io([None, Some(reader.as_fd()), None], 0).unwrap();
        assert!(events[0].is_empty());
        assert!(events[1].contains(PollFlags::POLLIN));
        assert!(events[2].is_empty());

        // stdinとして渡した書き込み端点は書き込み可能。
        let events = wait_for_io([Some(writer.as_fd()), None, None], 0).unwrap();
        assert!(events[0].contains(PollFlags::POLLOUT));
        assert!(events[1].is_empty());
        assert!(events[2].is_empty());

        assert_eq!(
            wait_for_io([None, None, None], 0).unwrap(),
            [PollFlags::empty(); 3],
        );
    }
}
