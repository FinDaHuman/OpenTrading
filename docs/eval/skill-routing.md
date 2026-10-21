# Skill routing verification

Offline routing measures deterministic keyword/soft suggestions and tool search. It does **not** measure whether a model understands shortened skill descriptions.

```sh
bun test test/skills.test.ts test/routing-eval.test.ts
bun scripts/dev/routing-eval.ts
```

PR116 adds exact-set regressions (Q278–Q291), including all nine reported misroutes. Existing aggregate floors are retained. The catalog test reads the real bundled skills: A has at least 20% estimated token headroom, B keeps every name and shortened descriptions, and C keeps every name without descriptions. Token estimates use the application's chars/4 estimator, not a provider tokenizer.

## Opt-in live smoke test

The evaluator issues one bounded model request per question and tier (default 10 questions × A/B = 20). It uses the configured OpenTrading provider/model, or `--model provider/model`. It consumes provider quota. It never runs in CI or calls finance/data tools: the model can select `load_skill` or `no_skill`, with execution disabled.

```sh
# Inspect exact submitted prompts without resolving credentials or network calls.
bun scripts/dev/skill-routing-live-eval.ts --dry-run --out /tmp/routing-plan.json
# Harness behavior: real tiered catalog plus deterministic skill reminders.
bun scripts/dev/skill-routing-live-eval.ts --out /tmp/routing-live.json
# Catalog comprehension alone: remove skill reminders; retain other assembled context.
bun scripts/dev/skill-routing-live-eval.ts --catalog-only --out /tmp/routing-catalog-live.json
# Small reproducible subset, one tier and explicit model.
bun scripts/dev/skill-routing-live-eval.ts --model provider/model --only 278,288,284 --tiers B --catalog-only --out /tmp/routing-subset.json
```

Evidence contains the questions, exact prompts, selected model, generation settings, provider thinking options, commit, tracked diff/evaluator/payload SHA256, prompt version, expected sets, tool-call trace, token usage, timing and errors. It omits credentials and provider configuration. Keep output outside the repository unless deliberately publishing a reviewed artifact.

Each case passes only when the selected set exactly matches its expected set. An empty response is not a successful abstention: `no_skill` must be called. Mixing `no_skill` with a selected skill fails. Provider errors, timeouts and invalid tool calls fail; they are not counted as routing success. The process exits nonzero if any case fails and saves progress after each case.

A dry run verifies payload construction only; it is not live model evidence. A live run demonstrates behavior for the recorded model, prompts and snapshot; it does not establish accuracy for every model or every paraphrase. Report A/B and catalog-only results separately rather than claiming offline routing proves shortened-catalog comprehension.
