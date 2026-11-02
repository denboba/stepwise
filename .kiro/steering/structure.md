---
inclusion: always
---
# Repository working rules

Start with #[[file:AGENTS.md]]. Read #[[file:docs/AGENT_PLAYBOOK.md]] and #[[file:docs/TESTING.md]] before implementation. Keep changes small and PR-reviewable. New persisted state requires migration, rollback and auth checks. Never bypass deterministic goal transitions or silently erase verified work.

User experience belongs primarily in `src/components/stepwise/`, with authenticated route code in `src/routes/_authenticated/`. `src/integrations/` contains generated external integrations; do not edit generated code manually. Case-method implementation in `src/lib/casefw.ts` remains partial.

Separate current code from future product ambitions. Always disclose unrun tests, infrastructure assumptions and unresolved risks.
