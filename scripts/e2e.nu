const root = path self | path dirname | path dirname

const compose_args = [
    compose
    -p
    dsa-e2e
    -f
    docker-compose.base.yaml
    -f
    docker-compose.e2e.yaml
]

# Keep command output on disk even when setup fails.
def --wrapped logged [log: path, command: string, ...args: string] {
    print $"Running: ($command) ($args | str join ' ')"
    let result = (^$command ...$args o+e>| tee { save --append $log } | complete)
    print --no-newline $result.stdout
    if $result.exit_code != 0 {
        error make {msg: $"Command failed with exit code ($result.exit_code): ($command)"}
    }
}

def snapshot [dir: path] {
    ^docker ...$compose_args logs --no-color --timestamps o+e> ($dir | path join compose.log)
}

def setup [dir: path] {
    snapshot $dir
    mv ($dir | path join compose.log) ($dir | path join previous-compose.log)
    (logged
        ($dir | path join setup.log)
        docker
        ...$compose_args
        down
        --volumes
    )
    (logged
        ($dir | path join setup.log)
        docker
        ...$compose_args
        up
        --build
        --wait
        --wait-timeout
        300
    )
}

def test-suite [dir: path, args: list<string>] {
    cd ($root | path join e2e)
    with-env {
        E2E_BASE_URL: "http://localhost:15173"
        E2E_ADMIN_USER_ID: admin
        E2E_ADMIN_PASSWORD: adminPassword
        E2E_ARTIFACT_DIR: $dir
    } {
        logged ($dir | path join test.log) npm test -- ...$args
    }
}

# Install host test dependencies and the shared sandbox images once.
def "main install" [] {
    cd $root
    ^bash sandbox/build.sh
    if $env.LAST_EXIT_CODE != 0 { error make {msg: "Sandbox image build failed"} }
    cd e2e
    ^npm ci
    if $env.LAST_EXIT_CODE != 0 { error make {msg: "npm ci failed"} }
    ^npx playwright install chromium
    if $env.LAST_EXIT_CODE != 0 { error make {msg: "Browser installation failed"} }
}

# setup | test | logs | down | run; arguments after the action go to Playwright.
def --wrapped main [action: string, ...args: string] {
    cd $root
    if $action == logs {
        ^docker ...$compose_args logs --follow
        exit $env.LAST_EXIT_CODE
    }
    if $action not-in [setup test down run] {
        error make {msg: $"Unknown action: ($action)"}
    }
    let dir = $root | path join e2e artifacts $"(date now | format date '%Y%m%d-%H%M%S-%f')-($action)"
    mkdir $dir
    print $"Artifacts: ($dir)"
    try {
        match $action {
            setup => { setup $dir }
            test => { test-suite $dir $args }
            down => {
                snapshot $dir
                (logged
                    ($dir | path join teardown.log)
                    docker
                    ...$compose_args
                    down
                    --volumes
                )
            }
            run => {
                setup $dir
                test-suite $dir $args
                snapshot $dir
                (logged
                    ($dir | path join teardown.log)
                    docker
                    ...$compose_args
                    down
                    --volumes
                )
            }
        }
    } catch {|err|
        snapshot $dir
        print --stderr $err.msg
        print --stderr $"E2E environment retained. Logs: ($dir). Cleanup: task e2e:down"
        exit 1
    }
    if $action in [setup test] { snapshot $dir }
}
