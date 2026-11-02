# Stepwise v1 — scripted task-engine chat

Build exactly the spec from the uploaded brief: a chat-style web app where the assistant only posts short lines and task cards generated from plan data. No backend, no auth, no AI. All state lives in the browser (saved locally so goals survive refresh).

## Screens
- **Sidebar** (collapsible; sheet on mobile): "New goal" button, goals list with progress %.
- **Header** (pinned once a goal exists): "Goal: phone charges normally" + pill "2 of 5 steps" that opens the plan panel.
- **Chat thread** + composer at the bottom.
- **Plan panel** (right panel on desktop, drawer on mobile): "Done means" line, steps with locked / available / done icons, s2+s3 grouped as parallel. Tapping a locked step shows toast "Finish [step] first".
- **Empty state**: "What do you want to get done?", composer, three chips (phone works; website and robot disabled with "Soon").

## Flow (exactly as in brief)
1. Phone chip, or text containing "phone"/"charge", starts the goal; other text gets "v1 handles one goal: a phone that won't charge."
2. Goal card (goal, done-means, 5 steps + Goal check, "Start").
3. Task cards: "Step N of 5, title, about X min", safety note + "I understand" first (gates proof), numbered actions, proof items (checkboxes, short text, pass/fail, number), "Submit proof" disabled until all satisfied, "I'm stuck", collapsed one-line "Why this matters".
4. Submit: "Step N verified.", card collapses to expandable done row, newly unlocked steps posted (grouped under "Any order" when several).
5. Stuck: post hint, re-show open task.
6. Typing during a task: done/next/skip gives "Not yet. Missing proof: ..."; anything else gives "Noted. Back to Step N:"; both re-show task.
7. Goal check: battery after 30 min must be at least Step 5 "before" + 5. Pass: "Goal achieved" + one-line recap per step. Fail: "Goal not met yet. Replanning arrives in the next version." + "Retry check".

## Technical details
- Scaffold a web app; plan data in a single data module (steps with `prereqs: string[]`, proof item definitions, hints, "why" lines). Status (locked/available/done) computed purely from prereqs + completed IDs.
- Engine as pure functions (input text/events + state -> new messages), with a reducer in a store persisted to localStorage.
- Messages are typed (text, goal card, task card, task group, done row, goal check, recap); cards render live from state.
- Unit tests for the engine: unlock rules (s2+s3 together, s5 needs s3 and s4), input routing replies, goal-check threshold (+5).
- Mobile-first layout; clean neutral design, no third-party branding. Only listed features.
