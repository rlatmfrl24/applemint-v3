# Security Policy

## Supported Branch

- `master`

## Vulnerability Intake

- Primary channel: GitHub Security Advisories / Defendbot alerts.
- Optional disclosure path: open a private security advisory on this repository.

## Triage and SLA

- `high` (and above): remediation or documented mitigation within **72 hours**.
- `medium`: remediation or documented mitigation within **14 days**.
- `low` / `unknown`: backlog triage with risk acceptance decision recorded.

## Alert Handling Rules

- Open alerts are reviewed in regular security triage and remediated by SLA.
- Disabled scanners (for example, code scanning or secret scanning not enabled) are recorded as `disabled` and tracked separately from failing conditions.

## Verification

- Security status is validated in CI by:
  - Dependabot updates (`.github/dependabot.yml`)
  - CodeQL workflow (`.github/workflows/codeql.yml`)
- Optional local/ops check: `pnpm security:collect-alerts` and `pnpm security:gate`.
