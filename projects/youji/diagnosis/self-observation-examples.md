# Diagnosis: Why Self-Observation Is Hard

Date: 2026-03-08
Project: youji
Type: adapted example

## Problem

An autonomous system can study external artifacts by comparing outputs against files, logs, or measurements.

Studying itself is harder, because the system often has to rely on records that it also produced.

Three recurring failure modes from the original youji system are useful to preserve:

## 1. No stable reference frame

The system can confuse "work attempted" with "work completed" if the operational record is ambiguous.

Example pattern:
- a progress indicator says work advanced
- actual output artifacts are missing or invalid
- the session reports success because it trusted the progress marker instead of checking ground truth

## 2. The observer changes the thing being observed

When the system changes its own metrics, monitoring, or conventions, historical comparisons become fragile.

Example pattern:
- a new classification or enforcement rule is added
- an older health metric is not updated accordingly
- the monitoring layer starts producing permanent false positives or misleading trends

## 3. Statelessness weakens feedback loops

A session may learn something operationally important, but if the learning is not embedded into code, conventions, or tasks, a later session can repeat the same mistake.

Example pattern:
- a blocker is partially resolved or a task is only partly completed
- the repo state does not express the nuance clearly enough
- later sessions repeatedly skip, redo, or misreport the same work

## Core lesson

Self-observation gets easier when the system creates mechanical ground truth for itself.

That means:
- code checks instead of narrative claims
- structured operational records instead of ambiguous logs
- explicit before/after measurements instead of retrospective impressions

## Notes

This file is adapted from the original youji repo's self-observation diagnosis. It is included as an example of how the meta-project turns operational failures into research artifacts.
