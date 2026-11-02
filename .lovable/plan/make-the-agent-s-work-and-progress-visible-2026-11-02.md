# Make the agent's work and progress visible

Design and presentation only. The engine, gating rules, backend proof checks, plan generation and word limits stay as they are.

## What you will see

1. **Phase tracker in the header**: Understand · Research · Plan · Do · Check. The current phase has a soft pulsing indicator, finished phases show a tick, and upcoming ones are muted. Research only shows up for goals that use it, which none do yet. Next to it sits a progress ring that reads "2 of 5". On phones the tracker shrinks to one pill ("Planning · 2 of 4") that opens the plan drawer when tapped.
2. **Live activity card in the chat** while the agent works. Each line has a status icon plus a label: spinner, tick, cross or waiting dot. Lines are at most 6 words, for example "Understanding your goal", "Building your plan", "Checking your photo" or "Updating your plan". A running line shows how long it has taken. When the work ends, the card folds to "Worked for 12s · 4 steps" and opens again on tap. A failed line shows the existing "Couldn't reach the assistant" line with Retry. Hints and side questions keep the inline "Thinking…" line.
3. **Redesigned task cards**:
   - a step number chip, title, time chip and status badge
   - a distinct "Safety" callout
   - large tappable proof rows with clear ticked, unticked and error states
   - a ring countdown for timers
   - a full-width main button on phones
   - Finishing a step plays a short tick animation, folds the card into a one-line done row and animates in "Unlocked: …" chips.
   - Locked steps are dimmed and show a lock icon with "Unlocks after …".
   - Image rows are prepared for later but hidden, since steps have no images yet.
4. **Plan panel**: a progress ring at the top, then the steps grouped as Now, Next, Later and Done (Done starts collapsed). The List / Map switch and the map stay unchanged.
5. **Overall look**:
   - an 8px spacing grid, 16px card corners, fully round chips, soft layered shadows, neutral surfaces with one accent color
   - one sans-serif font at 16px, with fixed-width numbers for timers and progress
   - 150–250 ms ease-out motion, a gentle spring for completions, shimmer placeholders while loading, and instant changes for people who turn off motion
   - a subtly frosted header and a floating rounded composer
   - an empty state with a centered heading and suggestion chips
6. **Accessibility**:
   - Screen readers announce phase changes and failures, but not every activity tick.
   - Every control shows a visible focus ring.
   - Every status has an icon and a label.

## Technical details

- **Phase**: a pure helper `derivePhase(goal, messages, busy)` in a new `src/lib/phase.ts`, with tests. It is display-only, reads existing state and gives Research an optional slot.
- **Activity events**: `{id, phase, label, status, detail, startedAt, endedAt}`.
  - The client wrapper in `store.ts` creates events around the existing AI-calling actions (intake, plan, photo check, replan).
  - When a run finishes, the events are saved as one chat message of a new kind, `activity`, with the events as JSON in the existing message row. The message is written by the existing server functions, so the browser still never writes directly.
  - This needs a small database change: allow `activity` as a message kind and add a nullable `meta` JSON column, if the current kind constraint requires it. That change will be confirmed before it is applied.
  - The labels are fixed strings, kept at 6 words or fewer by a test.
- **Plan groups**: a pure helper `groupSteps` (Now/Next/Later/Done), built on existing engine status functions, with tests. The engine itself is not changed.
- **Animation**: CSS and `tw-animate-css` keyframes. A library is added only if the spring effect needs it, and it is turned off under `prefers-reduced-motion`.
- **Styles**:
  - `src/styles.css` gets new tokens: status colors (success, warning, info), shadow layers, motion durations and a shimmer utility.
  - Light and dark contrast are checked against the 4.5:1 and 3:1 targets.
- **Files changed**:
  - main files: `App.tsx`, `Cards.tsx`, `styles.css`, `store.ts`
  - small new components: `PhaseTracker`, `ProgressRing`, `ActivityCard`, `RingTimer`
- **Checks**: tests, a typecheck, and Playwright screenshots at 375 px and 1280 px in light and dark mode. Anything I can't check gets reported.
