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
