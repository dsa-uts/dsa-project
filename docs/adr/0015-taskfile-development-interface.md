# Taskfile as the development interface

Development and local operations use Taskfile as their public interface. Nix
continues to own reproducible development environments, package builds,
container images, and flake checks. Procedural automation is implemented in
Nushell and is invoked through `task`; scripts under `scripts/` are internal
implementation details rather than separately documented interfaces.

This supersedes the local deployment command named in ADR 0013. In particular,
`task k3s:deploy` replaces `nix run .#k3s-deploy`. Other host operations such as
k3s lifecycle management, dependency metadata maintenance, code generation, and
manifest rendering follow the same interface. Developers run tasks inside
`nix develop` or a direnv environment, so Taskfile does not recursively enter a
Nix shell.

Nix derivations may invoke a Nushell script with an explicit source root when a
flake check needs the same implementation. That path is internal to the build;
repository-root arguments are not exposed to developers.

Consequences:

- Flake apps that wrapped shell applications are removed. The backend binary
  remains a flake app because it directly exposes a built package.
- Task names are the stable commands documented for developers and CI.
- Bash scripts and procedural shell embedded in `writeShellApplication` or
  check derivations are replaced by Nushell implementations.
- Running a task requires the project dev shell, which supplies Task, Nushell,
  and the external tools used by the scripts.
