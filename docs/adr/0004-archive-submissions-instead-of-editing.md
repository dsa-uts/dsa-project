# Archive Submissions Instead of Editing

Submissions and Requests are treated as immutable records. When an Evaluation Submission has the wrong Subject User or other identifying metadata, the old Submission is archived and a corrected Submission plus Request are created, which preserves auditability while still giving Managers a practical correction workflow.

## Consequences

Archived Submissions and their Requests are hidden from normal result views. They remain available for audit history and Request lineage through `derived_from_request_id`.
