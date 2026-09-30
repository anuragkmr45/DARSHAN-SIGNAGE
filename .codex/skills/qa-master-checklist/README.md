# QA Master Checklist — Codex Skill

This package is a reusable Codex Agent Skill for generating a repository-specific QA master checklist for human testing engineers.

It does **not** execute tests by default. It performs read-only codebase analysis and creates QA planning artifacts.

## Install for one repository

From the repository root:

```bash
mkdir -p .codex/skills
cp -R /path/to/qa-master-checklist .codex/skills/qa-master-checklist
```

Expected location:

```text
<your-repo>/.codex/skills/qa-master-checklist/SKILL.md
```

## Install for your user account

```bash
mkdir -p ~/.codex/skills
cp -R /path/to/qa-master-checklist ~/.codex/skills/qa-master-checklist
```

Expected location:

```text
~/.codex/skills/qa-master-checklist/SKILL.md
```

## Invoke

In Codex:

```text
$qa-master-checklist
```

Recommended first request:

```text
$qa-master-checklist
Analyze this entire repository and create the complete QA planning package for a human testing engineer.
Do not execute tests and do not modify application code.
Use interactive business-logic discovery: infer what you can from the repository, then ask me only the business questions whose answers materially change expected behavior.
After my answers, finalize the master checklist, detailed test cases, risk register, security checklist, performance/reliability plan, traceability matrix, smoke/regression/UAT sets, and release-readiness checklist.
```

For a non-interactive first pass:

```text
$qa-master-checklist
Analyze this repository and generate a provisional full QA package without asking questions first.
Mark every uncertain business rule NEEDS_BUSINESS_CONFIRMATION and generate BUSINESS_QUESTIONS.md.
Do not execute any tests.
```

## Outputs

By default the skill asks Codex to create `qa-artifacts/` in the analyzed repository containing system understanding, business rules/questions, risks, master checklist, CSV test catalogue, traceability, security, performance/reliability, test-data/environment, smoke/regression/UAT, and release-readiness artifacts.

## Standards referenced

The skill uses OWASP ASVS/WSTG as security-planning references and standard load/reliability test families (baseline, stress, spike, soak, breakpoint, etc.) as planning guidance. Version numbers should be re-verified when current-version accuracy matters.
