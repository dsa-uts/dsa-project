use std::io;

use nix::{
    libc::{self, group, setresgid, setresuid},
    sys::prctl,
    unistd::{Gid, Uid, getresgid, getresuid, setgroups},
};

#[repr(C)]
struct CapHeader {
    version: u32,
    pid: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct CapData {
    effective: u32,
    permitted: u32,
    inheritable: u32,
}

fn clear_capabilities() -> io::Result<()> {
    // Linux capability ABI v3は、32ビットx2要素で表現する。
    let mut header = CapHeader {
        version: 0x2008_0522,
        pid: 0,
    };
    let mut data = [CapData::default(); 2];

    // SAFETY: ABIに一致する構造体と、有効な2要素の配列を渡す。
    let result =
        unsafe { libc::syscall(libc::SYS_capset, &header as *const CapHeader, data.as_ptr()) };
    if result == -1 {
        return Err(io::Error::last_os_error());
    }

    // SAFETY: headerとdataは、カーネルが書き込める有効な領域。
    let result = unsafe {
        libc::syscall(
            libc::SYS_capget,
            &mut header as *mut CapHeader,
            data.as_mut_ptr(),
        )
    };
    if result == -1 {
        return Err(io::Error::last_os_error());
    }

    if data != [CapData::default(); 2] {
        return Err(io::Error::from_raw_os_error(libc::EPERM));
    }

    Ok(())
}

pub const SUBMISSION_UID: u32 = 10001;
pub const SUBMISSION_GID: u32 = 10001;

/// Command::pre_execから子プロセス内で呼ぶ。
pub fn drop_privileges() -> io::Result<()> {
    let uid = Uid::from_raw(SUBMISSION_UID);
    let gid = Gid::from_raw(SUBMISSION_GID);

    prctl::set_no_new_privs()?;
    prctl::set_keepcaps(false)?;

    setgroups(&[])?;
    setresgid(gid, gid, gid)?;
    setresuid(uid, uid, uid)?;

    clear_capabilities()?;

    let uids = getresuid()?;
    let gids = getresgid()?;

    // SAFETY: size=0なので、バッファへ書き込まず個数だけ取得する。
    let group_count = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
    if group_count == -1 {
        return Err(io::Error::last_os_error());
    }

    if uids.real != uid
        || uids.effective != uid
        || uids.saved != uid
        || gids.real != gid
        || gids.effective != gid
        || gids.saved != gid
        || group_count != 0
        || !prctl::get_no_new_privs()?
    {
        return Err(io::Error::from_raw_os_error(libc::EPERM));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::unix::process::CommandExt, process::Command};

    #[test]
    #[ignore = "requires a Linux container with root and SETUID/SETGUID"]
    fn child_runs_without_privileges() {
        assert!(nix::unistd::geteuid().is_root());

        let mut command = Command::new("/bin/cat");
        command
            .arg("/proc/self/status")
            .current_dir("/")
            .env_clear();

        // SAFETY: 子側の処理はメモリ確保・ロック・ログ出力を行わない。
        unsafe {
            command.pre_exec(drop_privileges);
        }

        let output = command.output().unwrap();
        assert!(output.status.success());

        let status = String::from_utf8(output.stdout).unwrap();

        let field = |name: &str| {
            status
                .lines()
                .find_map(|line| line.strip_prefix(name))
                .unwrap()
                .split_whitespace()
                .collect::<Vec<_>>()
        };

        assert_eq!(field("Uid:"), vec!["10001"; 4]);
        assert_eq!(field("Gid:"), vec!["10001"; 4]);
        assert!(field("Groups:").is_empty());
        assert_eq!(field("NoNewPrivs:"), vec!["1"]);

        for name in ["CapInh:", "CapPrm:", "CapEff:", "CapAmb:"] {
            assert_eq!(field(name), vec!["0000000000000000"]);
        }

        // 親の権限は変更していない。
        assert!(nix::unistd::geteuid().is_root());
    }
}
