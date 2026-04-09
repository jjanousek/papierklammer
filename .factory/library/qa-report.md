# QA Report

Guidance for the final audit artifacts for this mission.

## Final markdown report

Create the final repository report as a markdown file that includes:

1. Executive summary
2. Environment posture and runtime constraints
3. Audit path taken
4. Validation matrix covering every `VAL-*` assertion with `pass`, `fail`, or `blocked`
5. Identifier ledger (`companyId`, `agentId`, `approvalId`, `issueId`, issue key, `runId` where available)
6. Product bugs
7. Test blockers / frictions
8. Evidence references for every finding

Raw evidence should be stored under `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/raw/` and cited by path from the report.

## Required bug entry fields

For each bug or blocker, include:

- title
- affected surfaces
- reproduction steps
- observed behavior
- expected behavior
- severity or reliability
- evidence references
- linked identifiers

## Final handoff note

Prepare a short handoff note alongside the report for the orchestrator’s final chat response. It should include:

- report path
- QA company name and `companyId`
- highest-priority findings
- any blocked areas that remain
