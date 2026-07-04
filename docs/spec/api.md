# REST API Design

This document defines the client-facing REST API shape. Public API language uses Project and Version; Resource and Resource Version remain internal/admin concepts.

## Conventions

- Base path: `/api`
- Auth: backend-managed session cookie.
- IDs: opaque UUID strings.
- Timestamps: RFC 3339 UTC strings.
- Request and Submission records are immutable. Corrections archive old Submissions and create new ones.
- A Request targets one Project, one Submission, one Version, and all Workflows in that Version.
- Clients poll; no SSE or WebSocket requirement.

## Roles

| Role | Summary |
| --- | --- |
| Student | Creates validation Submissions and Requests for self. Sees own public validation results for the latest Project version. |
| Manager | Creates validation Requests for self and evaluation Requests for any Subject User. Sees validation and evaluation results for all users. Can compare Versions by viewing multiple Requests for one Submission. |
| Admin | Manages users, Project display order, and Resource registration credentials. |
| System Account | Actor for queued rerun Requests created after a new Version is registered. |

## Auth

### `POST /api/session`

Creates a session.

```json
{
  "userid": "student001",
  "password": "..."
}
```

### `DELETE /api/session`

Deletes the current session.

### `GET /api/me`

Returns the current User Account and Role.

## Projects

### `GET /api/projects`

Lists Projects in `display_order`.

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "DSA Basic",
      "latest_version_id": "uuid",
      "display_order": 10
    }
  ]
}
```

### `GET /api/projects/{project_id}`

Returns the latest Project view by default.

Query:

| name | role | description |
| --- | --- | --- |
| `version_id` | Manager/Admin | Optional explicit Version ID. Students cannot use old versions. |

### `GET /api/projects/{project_id}/versions`

Manager/Admin only. Lists Versions for diff views and manual reruns.

### `PATCH /api/projects/order`

Admin only. Persists drag-and-drop order in DB. Initial order is imported from the Resource repo manifest.

```json
{
  "project_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

## Submissions

### Submission Fields

| field | description |
| --- | --- |
| `id` | Submission UUID. |
| `project_id` | Target Project. |
| `kind` | `validation` or `evaluation`. |
| `subject_user_id` | User Account whose Submission is judged. |
| `uploader_id` | User Account that uploaded the archive. |
| `uploaded_at` | Upload timestamp. |
| `original_submitted_at` | Optional external timestamp for evaluation imports. |
| `content_hash` | Hash of the normalized file tree after path normalization. |
| `archived_at` | Null unless archived. |

Rules:

- File contents, `project_id`, `kind`, `subject_user_id`, `uploader_id`, `uploaded_at`, `original_submitted_at`, and `content_hash` are immutable.
- `kind=validation` requires `subject_user_id == uploader_id`.
- `kind=evaluation` may use a different Subject User.
- Two Submissions can share the same `content_hash`; they still have different `id` values.

### `POST /api/projects/{project_id}/submissions`

Uploads a Submission archive.

Request: `multipart/form-data`

| field | required | description |
| --- | --- | --- |
| `archive` | yes | Submission archive file. |
| `kind` | yes | `validation` or `evaluation`. |
| `subject_user_id` | evaluation only | Required for evaluation. For validation, server uses current user. |
| `original_submitted_at` | no | External submitted-at timestamp for evaluation imports. |

Response:

```json
{
  "id": "uuid",
  "content_hash": "sha256:..."
}
```

### `POST /api/submissions/{submission_id}/archive`

Archives a Submission and hides its Requests from normal result views. Use this for correction workflows instead of editing Submission metadata.

## Requests

### Request Fields

| field | description |
| --- | --- |
| `id` | Request UUID. |
| `submission_id` | Submission to judge. |
| `version_id` | Single Version target. |
| `requested_by` | User Account actor, including System Account. |
| `requested_at` | Request creation timestamp. |
| `derived_from_request_id` | Nullable lineage link for correction or retry. |
| `state` | `pending`, `queued`, `running`, `completed`. |
| `status` | Null until complete, then `AC`, `WA`, `TLE`, `MLE`, `RE`, `OLE`, or `IE`. |

Rules:

- A Request always runs every Workflow in the Version.
- Students can create validation Requests only for their own non-archived validation Submissions.
- Managers can create evaluation Requests for non-archived evaluation Submissions.
- Version omission means latest.
- Students can use only the latest Version. Managers may pass explicit Version IDs.

### `POST /api/projects/{project_id}/requests`

Creates a Request.

```json
{
  "submission_id": "uuid",
  "version_id": "uuid",
  "derived_from_request_id": null
}
```

### `GET /api/projects/{project_id}/requests`

Lists visible Requests. Archived Submissions are excluded by default.

Query:

| name | description |
| --- | --- |
| `kind` | `validation` or `evaluation`. |
| `subject_user_id` | Manager/Admin filter. |
| `version_id` | Filter for diff views. |
| `include_archived` | Manager/Admin audit view only. |

### `GET /api/requests/{request_id}`

Returns one Request, aggregate Workflow results, and visible Job results.

## Results

Detailed Step results are stored. Job, Workflow, and Request `status` values are derived aggregates.

Worst-wins order:

```text
IE > OLE > MLE > TLE > RE > WA > AC
```

Status comparison notifications compare per-Workflow aggregate Status for the new latest Version against the old latest Version.

## Artifacts

Artifacts are private unless declared public by Resource YAML and visible through the producing Job.

Allowed public content types:

- `image/png`
- `image/jpeg`
- `text/plain`
- `application/json`

SVG is not allowed as a public Artifact.

### `GET /api/requests/{request_id}/artifacts/{artifact_id}`

Authenticated API only. Returns a public Artifact visible to the current user with the declared `Content-Type`.

Private Artifacts have no client download API.

## Queued Reruns

When a new Version becomes latest, the system creates pending Requests first, then enqueues execution.

For each `(project_id, kind, subject_user_id)`, the source Submission is the latest non-archived Submission by `uploaded_at`.

Queued reruns cover:

- latest validation Submissions
- latest evaluation Submissions

The `requested_by` actor is the System Account.

## Admin Resource Registration

### `POST /api/admin/resource-versions`

Registration-only Admin API called by GitHub Actions after sandbox images are built and pushed.

```json
{
  "resource_id": "dsa-basic",
  "source_ref": "git-commit-sha",
  "workflow_run_id": "github-actions-run-id",
  "sandbox_images": {
    "default": {
      "image": "ghcr.io/example/dsa-basic-sandbox",
      "tag": "git-commit-sha",
      "digest": "sha256:..."
    }
  }
}
```

Backend fetches `resources.yaml` and Resource YAML from the private GitHub repository, validates them, verifies that image digests are provided for every `sandbox-images` ID, and rejects the registration if validation fails.

## Resource Repo Contract

The Resource repo has a root manifest:

```yaml
resources:
  - id: dsa-basic
    path: dsa-basic/resource.yaml
```

Resource YAML provides top-level sandbox image definitions, and Jobs reference them by ID:

```yaml
sandbox-images:
  default:
    build:
      context: .
      dockerfile: sandbox/Dockerfile
      image: ghcr.io/example/dsa-basic-sandbox

jobs:
  test:
    sandbox-image: default
```

Public Artifacts must declare `content-type`:

```yaml
artifacts:
  outputs:
    - name: diagram
      path: out/diagram.png
      visibility: public
      content-type: image/png
```
