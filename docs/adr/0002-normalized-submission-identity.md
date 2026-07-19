# Normalized Submission Identity

Submissions have stable IDs, and their file contents are fingerprinted by hashing the normalized file tree after archive path normalization, not by hashing the uploaded archive bytes. This makes content comparison independent of zip entry order, archive metadata, and platform-specific path separators while keeping file contents immutable after upload.

## Consequences

Two uploads with the same normalized paths and file bytes have the same content hash even if their archive bytes differ. Correcting a mistaken Submission archives the old Submission and creates a new one instead of mutating file contents, uploader, upload time, or Project.
