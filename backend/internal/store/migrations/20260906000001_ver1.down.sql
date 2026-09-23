DROP TABLE IF EXISTS requests;
DROP TABLE IF EXISTS submission_files;
DROP TABLE IF EXISTS submissions;
ALTER TABLE IF EXISTS projects DROP CONSTRAINT IF EXISTS projects_latest_version_fkey;
DROP TABLE IF EXISTS project_versions;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS user_accounts;
