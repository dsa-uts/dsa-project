# Git-Only Resource Lifecycle

Everything that defines a Project's content lives in the Resource repository and can only be changed through git: the Workflow definitions, the project title (`resource.name` in the Resource YAML, refreshed on every Resource Version registration), and the project's very existence (root manifest membership defines the active set — removing the entry retires the Project, re-adding it revives it). Resource Versions are immutable and cannot be archived or retracted; corrections are fix-forward only, and `latest` is always the newest registered Version. The console owns only operational metadata that must not require a new Resource Version: publish time, deadline, and display order (Git-for-Logic, Console-for-Operations).

## Considered Options

- Console-side archive for Resource Versions, with `latest` falling back to the previous non-archived Version. This is an instant-rollback lever when a broken Version lands right before a deadline, but it creates a second edit path and moments where `latest` disagrees with the repo's main HEAD. Rejected: two ways to edit the same thing invites operational confusion; the mitigation is a revert commit, which keeps git as the single source of truth.
- Console-editable project title, importing an initial value from the manifest and overriding it afterwards (the display-order pattern). Rejected: after the first import the manifest value goes dead and the screen permanently disagrees with the repo. The title is course content — the same side of the line as the description Markdown — not an operational knob.
- Console-side archive flag for Projects. Rejected: a Project absent from the manifest can no longer register Versions anyway, so "unlisted but active" is a half-broken state; defining manifest membership as the active set makes that state unrepresentable.

## Consequences

- There is no instant retraction: a broken `latest` stays `latest` until a fix or revert commit is pushed and registered. This is accepted; the failure mode folds into `completed` + IE Statuses rather than blocking the pipeline.
- Title typo fixes and semester-end retirement each require a push, not a console click.
- Publish time, deadline, and display order can be changed at any moment without minting a Resource Version, so day-to-day operations never touch git.
- Every content change is auditable through git history plus the Registration-only API's audit log; the console cannot create states that git history does not explain.
