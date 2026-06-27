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

**Submission**:
User-provided files submitted for a Request.
_Avoid_: Upload, answer

**Request**:
A user or manager initiated execution of one or more Workflows against a Submission and Resource Version.
_Avoid_: Run request, judge request

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

**CI Result**:
Captured Step status, stdout, stderr, Artifact capture status, and related execution metadata from a Request.
_Avoid_: Artifact, output files

**Sandbox Workspace**:
The per-Job filesystem view assembled from a Submission, Preset files, and declared input Artifact files.
_Avoid_: Worktree, project directory
