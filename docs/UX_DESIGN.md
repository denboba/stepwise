# Stepwise — UX design direction (target concept)

This is the **target experience**, not a screenshot or claim that the current code implements every element. An illustrative visual design was created in the planning conversation; implementation must reflect actual data and actions.

## Desktop structure

- **Left rail:** Stepwise branding, New goal, existing goal sessions, honest state chips; navigation should not overwhelm the user.
- **Center conversation:** short contextual AI responses, an actionable "Do this next" card, expected outcome and "Tell me what happened" prompts. Inline options and easy "More detail", "Why", "I'm stuck", "It failed" actions; full text entry always supported.
- **Right panel:** collapsible project execution graph and optional Memory / Evidence tabs. Show prerequisites, blocked branches, attempts and the current focus; clicking a node must not bypass rules.
- **Header:** current goal, truthful status, progress toward **verified outcome**, pause/resume and view plan.

## Mobile structure

Conversation and next action dominate. Project graph/memory live in accessible sheets or tabs. Ensure large touch targets, correct focus and a composer that respects safe areas.

## Visual direction

Warm neutral surfaces, deep ink typography, restrained indigo/teal emphasis, amber for uncertainty, red for stop conditions, green only for genuinely verified success. Rounded cards, readable instructional text, clear spacing, no gratuitous gamification. A dark theme is optional; the mockup shows one possible dark direction.

## Key interaction states

- **Goal start:** "What are you working on?" with optional starter prompts and free text.
- **Investigation:** ask only a useful missing question; record the answer as user-provided, not proven.
- **Next action:** say what to do, how, and what result to report.
- **Teaching:** expand detail within the same task context.
- **Failure:** record the attempt, compare expected and observed result, change diagnostic branch and explain the plan diff.
- **Evidence:** label reports, measurements, AI-reviewed photos and independently verified results distinctly.
- **Completion:** only after the agreed outcome check passes. Otherwise show *waiting*, *blocked*, *paused* or *escalated*, not a misleading 100%.

## Accessible graph

Every node has a text description, status, dependencies and explanation for why blocked. Provide an equivalent list. Preserve keyboard navigation, zoom/pan where useful and screen-reader labeling.

## Implementation constraint

Evolve existing `src/components/stepwise/App.tsx`, `Cards.tsx`, `PlanMap.tsx` and `Progress.tsx` incrementally. No redesign should break goal persistence, auth or server-authoritative verification. Adopt in a reviewed Kiro spec after the end-to-end baseline is established.
