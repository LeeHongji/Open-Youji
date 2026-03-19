# 0034: S3 Read-Only Access

Date: 2026-02-23
Status: accepted

## Context

Youji agents and experiment scripts need access to data stored in AWS S3 buckets (datasets, pre-computed results, shared research artifacts). The current infrastructure has no external storage abstraction — agents can only access data on the local filesystem.

Adding S3 access introduces an **autonomy vs safety** tension: agents need external data for research work, but unrestricted S3 access could lead to accidental writes, deletions, or modifications of shared data. S3 data is treated as a shared, immutable resource for Youji.

## Decision

Create `infra/s3-reader/` — a Python module providing **strictly read-only** S3 access with three enforcement layers:

1. **Code level**: The `S3Reader` class only implements read operations (`get_object`, `list_objects_v2`, `head_object`, `head_bucket`, `list_buckets`). No write, delete, or modify operations exist in the codebase. This is a safety invariant enforced by tests (`TestReadOnlyInvariant`).

2. **IAM level**: Documentation recommends configuring AWS credentials with a minimal read-only IAM policy. Even if the code could theoretically access boto3 write operations via the private `_client`, properly scoped IAM credentials prevent writes at the AWS level.

3. **Interface level**: The internal boto3 client is private (`_client`, underscore-prefixed). No public method or attribute exposes it.

The module provides both a CLI (for agents to use via shell) and a Python API (for experiment scripts to import). S3 URIs (`s3://bucket/key`) are the standard addressing format.

Python was chosen over TypeScript because:
- Experiment scripts (the primary data consumers) are Python
- boto3 is the standard, mature AWS SDK
- The scheduler (TypeScript) does not directly need S3 access
- Follows the existing pattern of Python infra tools (`experiment-runner`, `budget-verify`, `experiment-pipeline`)

## Consequences

- Agents can read S3 data via `python infra/s3-reader/s3_reader.py cat s3://bucket/key` in shell commands.
- Experiment scripts can import `S3Reader` for programmatic data access.
- No S3 data can be modified through this module, regardless of IAM permissions.
- AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) must be configured in the environment. This is a standard AWS pattern requiring no custom env vars.
- S3-compatible services (MinIO, Backblaze B2) are supported via `AWS_ENDPOINT_URL`.
- Future sessions requiring S3 write access must go through the approval queue — this module is not the mechanism for that.
