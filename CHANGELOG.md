# Changelog

## 0.3.0 — 2026-09-13

- Add local context preflight and per-request metadata across Responses, Chat Completions and Messages using the same request builder as execution.
- Show omitted older feedback, requirement coverage and changes, file indexes versus successful text reads, and overlap by content version. Local CSV analysis is identified as summary-only processing.
- Let users pin up to 12 concise requirements to subsequent model requests, remove pins, and manually report included requirements that were not followed.
- Export diagnostic metadata without prompt bodies, file contents, API headers or reasoning. Keep the latest 120 records and distinguish unrecorded history from missing information.
- Associate recorded requests with actual provider usage; keep character counts and unknown token usage distinct. Inspection adds no model calls.
- Preserve clarification questions alongside new user answers so a resumed run receives their meaning.
- Fall back to port 14318 when the OS denies access to the default port; preserve explicit PORT settings.
- Add unit, mock-provider integration and browser coverage for context health. Source packaging derives its version from the committed package file.

These checks establish what the application prepared to send, not model comprehension or provider-side retention. No live-provider savings or quality improvement is claimed.

## 0.2.0 — 2026-09-13

First public preview of Gongzuo, a local task workspace aimed at reducing total token usage and rework while preserving personal requirements.

- Add general tasks with goals, materials, personal choices and acceptance criteria.
- Add separate DeepSeek, OpenAI, GLM and Claude presets; support Responses, Chat Completions and Messages protocols.
- Add bounded tool execution, clarification pauses, cancellation and provider-reported usage history.
- Add deterministic CSV cleanup, grouping, audit output and SVG charts.
- Add artifact versioning, manual acceptance, isolated HTML previews and downloads with saved data.
- Keep the first prototype's examples available locally.
- Add isolated runtime tests, browser acceptance scripts and cross-platform CI.

Live-provider task quality and token savings have not been evaluated. See `docs/benchmark.md` for the planned comparison.
