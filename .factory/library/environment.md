# Environment

Environment variables, external dependencies, and setup notes for the onboarding QA mission.

**What belongs here:** required env vars, local instance paths, external-service constraints, setup quirks.
**What does NOT belong here:** service commands or ports; use `.factory/services.yaml`.

---

## Runtime shape

- Primary validation URL: `http://127.0.0.1:3100`
- Mission instance home: `/tmp/papierklammer-onboarding-mission`
- Mission instance id: `onboarding-mission`
- Expected server entrypoint for started services: `node /Users/aischool/work/papierklammer_droid/server/dist/index.js`
- Embedded Postgres is expected under the mission home when `DATABASE_URL` is unset.

## Constraints

- Docker is unavailable in this environment; do not rely on Docker-based onboarding smoke flows.
- Another Droid mission may run in parallel. Workers must only stop processes they started themselves.
- The user requested that this mission never keep more than **3 mission-started Node processes** alive at once.
- Prefer one app instance and one browser session for validation.

## Credentials and external integrations

- Onboarding AI drafting may pass through either a preferred provider or the existing fallback drafting path. Validation should accept either as long as the returned draft is usable.
- Invite/join validation should prefer locally generated invites and local API evidence over external gateways.
- Do not require Docker, published images, or remote sandboxes for this mission.

## Startup notes

- `init.sh` ensures `server/dist/index.js` and `server/ui-dist/index.html` exist before workers rely on `qa-app`.
- If port `3100` is already healthy for this mission and the worker did not start it, reuse it and do not stop it.
