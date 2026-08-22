# Production OpenBao Bootstrap

This runbook is for the one-time production trust bootstrap and for unsealing
after a full OpenBao restart. Application configuration is repeatable; OpenBao
initialization is not.

## Prerequisites

- A Kubernetes namespace named `openbao`.
- A TLS certificate whose SANs include `openbao`, `openbao.openbao`,
  `openbao.openbao.svc`, and `openbao-0.openbao-internal`.
- An `openbao-server-tls` Secret in that namespace with `tls.crt`, `tls.key`, and
  `ca.crt`. This is a trust-bootstrap exception: do not attempt to store the
  OpenBao server's own TLS key in OpenBao.
- A secure, cluster-external destination for the unseal key and the initial
  root token. Never write the initialization output into this repository, a
  Kubernetes Secret, CI logs, or ordinary shell history.
- `kubectl`, Helm, and Nushell, available through `nix develop`.

## Install

Point `KUBECONFIG` at production, verify the context, and install the pinned
charts:

```sh
kubectl config current-context
task openbao:install -- prod
```

The server Pods are expected to remain unready and sealed at this point. The
production installer intentionally does not use Helm `--wait`, because readiness
cannot succeed before initialization and unseal.

## Initialize exactly once

First check initialization status:

```sh
kubectl -n openbao exec openbao-0 -- bao operator init -status
```

An exit status of 2 means uninitialized. Initialize only in that state:

```sh
kubectl -n openbao exec -it openbao-0 -- \
  bao operator init -key-shares=1 -key-threshold=1
```

Immediately store the unseal key and initial root token offline. Do not leave
terminal capture or scrollback containing the output unattended.

## Unseal

Enter the unseal key only at the interactive prompt:

```sh
kubectl -n openbao exec -it openbao-0 -- bao operator unseal
```

Verify the server status:

```sh
kubectl -n openbao exec openbao-0 -- bao status
```

## Configure application access

Export the initial root token without putting it in a command argument, then run
the idempotent configuration script:

```sh
read -rs BAO_TOKEN
export BAO_TOKEN
task openbao:configure -- prod
```

This enables KV v2 and Kubernetes auth, writes least-privilege workload policies
and roles, and enables the file audit device. Establish the organization's normal
human administrator authentication before retiring the initial root token.

Set the initial datastore values interactively:

```sh
task openbao:set-production-secret -- postgresql
unset BAO_TOKEN
```

The command refuses to overwrite an existing path. Password input accepts only
letters, digits, `_`, and `-`. Initialize PostgreSQL only after the value exists,
then deploy the production application overlay.

## Change an existing static credential

The initial-value command must not be used for rotation. KV update alone would
make new Pods disagree with the datastore. Until dynamic rotation is designed,
perform changes in a maintenance window. Keep the new value only in protected
operator input and never put it in a CLI argument or shell history.

For PostgreSQL:

1. Stop backend traffic and scale `dsa-backend` to zero.
2. Change the `dsa` role password inside PostgreSQL.
3. Write the identical value to `kv/dsa/prod/postgresql` using an authorized
   OpenBao operator session.
4. Start one backend Pod, confirm its CSI mount and PostgreSQL connection, and
   verify readiness through the public health interface.
5. Restore the intended replica count and confirm the old password no longer
   authenticates.

If any step fails, keep traffic stopped and restore both the datastore credential
and OpenBao KV value to the previous matching pair before restarting backend.

## Restart and recovery

After a server restart, repeat only **Unseal**. Never run `operator init` against
existing storage. Alert when the server is sealed or when CSI mounts fail. Take
encrypted Raft snapshots regularly, store them outside the cluster, and test
restoration together with the TLS material and unseal key.
