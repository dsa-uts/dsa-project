# DSA Project

This context describes the online judge domain language used by the project specification.

## Language

**Project**:
A collection of Workflows for one programming exercise or judging setup.
_Avoid_: Assignment, repository

**Resource**:
Trusted Project definition material maintained by Admins, including Resource YAML, Preset files, descriptions, and sandbox image build inputs.
_Avoid_: Test bundle, judge files

**Resource Version**:
An immutable version of a Resource associated with source history and sandbox image metadata.
_Avoid_: Release, revision

**User Account**:
An authenticated account for a person who can submit or manage Requests.
_Avoid_: Admin account, Manager account

**Role**:
An authorization level assigned to a User Account, such as Admin, Manager, or Student.
_Avoid_: Account type, user type

**System Account**:
A reserved User Account used as the actor for automated Requests created by the system.
_Avoid_: Null user, background actor

**Submission**:
An immutable record of an uploaded normalized file tree for a Project and Subject User, including its uploader, upload time, and content hash. Incorrect Submissions are archived and replaced rather than edited.
_Avoid_: Upload, answer

**Archived Submission**:
A Submission removed from current Request creation and normal result views because it was superseded by a corrected Submission.
_Avoid_: Deleted submission, mutable submission

**Request**:
A user or manager initiated execution of one or more Workflows against a Submission and one Resource Version.
_Avoid_: Run request, judge request

**Validation Request**:
A Request for a user's own Submission against the latest Resource Version that executes only public Jobs.
_Avoid_: Trial, self-check

**Evaluation Request**:
A Manager-initiated Request for a Subject User that executes both public and private Jobs.
_Avoid_: Batch request, delegated request

**Subject User**:
The User Account whose Submission is evaluated by an Evaluation Request.
_Avoid_: Delegator, owner

**Request Lineage**:
The relationship from a corrected or retried Request back to the Request it was derived from.
_Avoid_: Batch, duplicate marker

**Workflow**:
A dependency-ordered pipeline of Jobs defined by a Resource.
_Avoid_: CI, pipeline

**Job**:
An isolated sandbox execution unit with a fresh workspace, resource limits, Steps, and optional Artifact handoff.
_Avoid_: Task, stage

**Private Job**:
A Job that only Manager and Admin users can execute and inspect.
_Avoid_: Hidden job, secret job

**Step**:
One argv-style command execution within a Job.
_Avoid_: Command, script

**Preset File**:
A trusted Resource file made available to a sandboxed Job.
_Avoid_: Template file, provided file

**Preset Directory**:
The fixed read-only `/preset` mount that contains Preset Files for a Job.
_Avoid_: Preset workspace, preset path

**Artifact**:
A named regular file output declared by a Job for persistence after sandbox cleanup and optional use by later Jobs.
_Avoid_: Workspace copy, build output

**Public Artifact**:
An Artifact declared visible to clients when the producing Job is also visible to that client.
_Avoid_: Download, attachment

**CI Result**:
Captured Step status, stdout, stderr, Artifact capture status, judge Status, and related execution metadata from a Request.
_Avoid_: Artifact, output files

**Status**:
The judge verdict for a CI Result, such as AC, WA, TLE, MLE, RE, OLE, or IE.
_Avoid_: Result, state

**Sandbox Workspace**:
The per-Job filesystem view assembled from a Submission, Preset files, and declared input Artifact files.
_Avoid_: Worktree, project directory
