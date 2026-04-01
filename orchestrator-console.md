
## 1. Purpose

Define the product and system contract for a board-facing Commander surface inside
Paperclip.

This feature should let a human operator open a CLI-like surface in the GUI,
talk to one top-level agent, and turn vague intent into concrete company work:

- new issues
- issue updates
- goal updates
- unblock requests
- prioritization changes
- review comments

The console is not a replacement for the existing issue/control-plane model.
It is a management surface that produces normal Paperclip work objects.

## 2. Problem Statement

Today Paperclip does not yet have a first-class "talk to the company" surface where the
board can say:

- "figure out what is blocked"
- "turn this wish into concrete work"
- "split this into tickets"
- "reprioritize the next week"
- "prepare something the CEO can delegate"

That leaves a gap between human intent and durable operational work.


## 3. Goals

The Commander surface should:

1. Let the board operator talk to a top-level management agent in a CLI UI.
2. Turn free-form requests into structured, auditable Paperclip actions.
3. Preserve session continuity across visits.
4. Reuse existing scheduler/manual admission and live run streaming.
5. Keep all meaningful work represented as issues, goals, comments, and normal
   Paperclip state.
