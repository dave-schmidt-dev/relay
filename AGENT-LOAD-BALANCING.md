# Agent Load Balancing Notes

This note captures the minimum structure needed to spread work across multiple agent providers without lowering the repo's quality bar.

## Core Rule

Trust the contract and the gates, not the model.

Load balancing works when providers are interchangeable at the process level:

- same operating rules
- same acceptance criteria
- same validation commands
- same reporting format

If quality depends on "this model usually does better," the process is still underspecified.

## Control Plane

Use this hierarchy consistently:

1. `~/.agent/AGENTS.md`
2. `project.md`
3. `SPEC.md`
4. `tasks.md`
5. `package.json` scripts and Husky hooks

Guideline:

- `~/.agent/AGENTS.md` defines cross-agent behavior
- `project.md` defines repo-specific operating rules
- `SPEC.md` defines product truth
- `tasks.md` defines task and phase acceptance criteria
- scripts and hooks define machine-enforced gates

If these disagree, fix the docs before delegating.

## Global AGENTS Standard

Keep `~/.agent/AGENTS.md` short, stable, and provider-agnostic.

Recommended global rules:

- Do not claim completion unless the repo's canonical validation commands pass.
- Do not silently narrow scope from the spec or task plan.
- If code, behavior, or phase status changes, update the relevant project docs.
- Final reports must include:
  - files changed
  - commands run and pass/fail results
  - tests added or updated
  - remaining blockers or open questions
- If gates fail, continue fixing or report a blocker. Do not stop at "implemented."
- Never use `--no-verify` unless explicitly told.

## Repo-Local Files

Highest-value repo-local files:

### `project.md`

Should contain:

- short architecture summary
- canonical validation commands
- repo conventions
- risky subsystems
- known sharp edges
- what must be reviewed manually

### `tasks.md`

Each task should include:

- objective
- write scope
- non-goals
- required tests
- required commands
- docs to update
- definition of done
- required final report

### Provider playbook

Add a repo-local note later if needed, for example `provider-playbook.md`.

It should define:

- which providers are good for which tasks
- which providers require review on certain changes
- known failure modes by provider
- when a second-agent review is mandatory

## Machine Gates

The quality bar must live in commands and hooks, not in prompts.

Recommended pattern:

- `pnpm validate:fast`
- `pnpm validate`
- `pnpm ship:check`

Typical split:

- `validate:fast`: lint, format check, typecheck, other quick static checks
- `validate`: full suite including tests and build
- `ship:check`: whatever must be green before push or release

Husky should call the same commands you rely on operationally.

If CI exists later, CI should run those exact scripts, not near-matches.

## Definition Of Done Template

Use this shape in `tasks.md`:

```md
Definition of done:
- Spec behavior is implemented
- `pnpm typecheck` passes
- `pnpm lint` passes
- `pnpm test` passes
- `pnpm build:web` passes
- Tests for changed behavior are added or updated
- `tasks.md` and `HISTORY.md` are updated
- Do not claim complete or commit unless all of the above are true

Final report format:
- Files changed
- Commands run
- Tests added or updated
- Remaining blockers
```

## Trust Levels

Not all changes need the same review depth.

### Low risk

- docs
- small refactors
- isolated UI polish

Require:

- green local gates

### Medium risk

- API/UI contract changes
- multi-file features
- persistence changes

Require:

- green local gates
- second-agent review

### High risk

- security-sensitive logic
- destructive behavior
- concurrency
- state transitions
- data loss risk

Require:

- green local gates
- second-agent review
- manual signoff

## Minimum Reliable Multi-Agent Setup

To use multiple external providers safely, the minimum stack is:

- one canonical validation command
- hooks that enforce it
- task plans with explicit definition of done
- mandatory final report structure
- current docs
- no completion claims without green gates

At that point, work is being load balanced. Standards are not.

## Follow-Up Candidates

Useful next additions:

- `project.md` template
- `provider-playbook.md` template
- hardened `package.json` validation layout
- standardized task template for future repos
