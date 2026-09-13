<div align="center">
<img src="assets/logo.svg" width="72" alt="Gongzuo">

# Gongzuo · 共作

**Less waste. Faster work. More of you.**

A local AI task workspace for people who want useful results without becoming prompt experts.

[中文](README.md) · [Getting started](#getting-started) · [Evaluation data](docs/benchmark.md)
</div>

![The actual task workspace before configuring a model](assets/overview.png)

**Early preview, v0.3.0.** Adds local context health checks and pinned requirements. Provider adapters, task tools and artifact workflows are implemented. Regression tests use mock providers. A small live DeepSeek context-strategy pilot is now available: token and latency results vary by task, and equal-quality completion savings have **not** been demonstrated.

## The goal

Help people finish research, writing, office and small product tasks with less total token usage and rework, while preserving their own requirements and style. We care about the cost of reaching an acceptable result, including failed attempts.

## What exists today

- Goals, personal requirements, acceptance criteria, materials and revision feedback in one task.
- Separate API-key presets for DeepSeek, OpenAI, GLM and Claude; advanced configuration for compatible local services.
- Material indexes and bounded reads instead of automatically placing every file in the initial context.
- Deterministic CSV cleanup, grouping and SVG charts with zero model calls.
- Plans, clarification pauses, cancellation, artifact versions and manual acceptance.
- Sandboxed HTML previews with per-version data; standalone downloads include saved preview data.
- Per-request provider-reported token usage. Missing usage remains unknown. Connection tests have their own history.
- Context preflight without a key or model call; request metadata shows omitted older feedback, included requirements and overlapping file reads. Important requirements can be pinned to subsequent requests.
- Human reports distinguish an included requirement that was not followed from an omitted input. Metadata exports omit prompt bodies, API headers and model reasoning.

Context still accumulates during a run; there is no automatic compaction, model routing or patch-based artifact editing yet. The pilot measures fixed-budget resource use; it does not establish general savings or novice productivity gains.

## Getting started

Install Node.js **22 or later**. There are no third-party runtime dependencies.

```bash
git clone https://github.com/liruoshui-com/gongzuo.git
cd gongzuo
npm start
```

Open **http://127.0.0.1:4318**. The interface is currently in Chinese. On Windows, `启动共作.cmd` is also available.

If the OS reserves the default port, the server tries 14318; use the address printed at startup. An explicit `PORT` environment variable is honored without fallback.

Choose a provider in the top-right settings, paste its API key, and save. Defaults are prefilled and each provider's key is stored separately. Saving does not call a model; connection testing does and records its usage.

No API key yet? Upload `examples/团队工时.csv`, run the local CSV tool, and export real tables and charts.

The **上下文体检** (context health) tab also works without a key. A fresh run includes the goal, preferences, criteria, pinned requirements, the latest 12 feedback entries and file indexes. Prior replies and tool results are not automatically carried into a new run. During a run, successful read receipts are counted only from the next request that includes their output. CSV analysis is local processing with a model-visible summary, not a full-text read.

The last 120 request records contain IDs, hashes, sizes and read ranges, not full prompts. Old requests without records remain unknown. Character counts are not token counts, and inclusion does not prove comprehension, server retention or compliance. Pinning adds input length; keep requirements short. No model calls are added by inspection, pinning, manual reports or export.

## Boundaries

This is a single-user local application. Keys are stored **unencrypted** in `.local-data/config.json`, which is excluded from Git. Starting an AI run sends the task requirements and requested material content to the configured provider. Do not expose the service publicly.

Inputs are UTF-8 TXT, Markdown, CSV and JSON. Generated HTML must be self-contained. Native office formats, arbitrary host execution, external application control, cloud sync and automatic multi-model collaboration are not implemented. Only the official OpenAI Responses preset currently offers optional built-in web search.

Artifact validation covers limited checks, such as JSON parsing or consistent CSV columns. It does not establish factual accuracy or functional quality. Human acceptance is required.

## Contribute

```bash
npm run check
npm test
```

Tests use isolated local mock providers. See [CONTRIBUTING.md](CONTRIBUTING.md) for browser testing. Help with reproducible tasks, failure cases and fair evaluations is especially welcome. The initial evaluation plan compares direct chat, a strong fixed prompt and this workspace under matched model/tool conditions; no fabricated benchmark scores are published.

Licensed under [MIT](LICENSE).
