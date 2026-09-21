# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `deduped(kept, dropped, strategy)` event so collapsing a task is observable
  rather than silent
- One-time development warning the first time deduplication discards a
  payload, with `silenceDedupeWarning` to opt out
- Chat recipe in the guide, including why `dedupeKey` must not be used for
  messages

### Fixed
- Strict submission order was not preserved at `concurrency: 1` when a task
  failed transiently: the backing-off head task was skipped and a later task
  delivered ahead of it. The queue now waits for the head task, restoring strict
  FIFO order under failure. This is deliberate head-of-line blocking — a
  persistently failing task delays those behind it until it is discarded at the
  retry limit; raise `concurrency` to favour throughput over ordering (added a
  regression test).

## [0.1.0] - 2026-09-03

Initial release.

### Added
- Persistent offline mutation queue with a storage-agnostic adapter interface
- Exponential backoff with jitter and a configurable retry policy
- Deduplication strategies: `replace`, `drop`, `keep`
- `classifyError` to separate permanent failures from transient ones
- `onDiscard` conflict hook for exhausted or permanently failed tasks
- Connectivity control via `setOnline`, with no NetInfo dependency
- Interrupted in-flight tasks restored as pending on relaunch
- `useOfflineQueue` React hook for rendering sync state
- Runnable Node demo and an Expo example app
