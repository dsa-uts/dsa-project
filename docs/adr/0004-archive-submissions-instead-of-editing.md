# Archive Submissions Instead of Editing

Submissions and Requests are treated as immutable records. When an Evaluation Submission has the wrong Subject User or other identifying metadata, the old Submission is archived and a corrected Submission plus Request are created, which preserves past results while giving Managers a practical correction workflow.

## Consequences

Only evaluation Submissions can be archived, hiding all their Requests from normal result views while retaining the records. Validation Submissions cannot be archived, including by Managers or Admins; corrections are new uploads and earlier attempts remain in the result history.

Submissions and Requests do not store correction or rerun lineage: no current operation needs those links. Each Request still references its Submission and Resource Version.
