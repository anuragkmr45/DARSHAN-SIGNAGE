# Security Planning Baseline

Use this reference only to design authorized QA/security verification checklists. It does not authorize active penetration testing.

## Primary references

- OWASP Application Security Verification Standard (ASVS), stable 5.0.0 at time this skill package was authored.
- OWASP Web Security Testing Guide (WSTG), stable 4.2 at time this skill package was authored.

If network browsing is available and the user wants current standards, verify the current stable versions before naming a version in generated artifacts.

Do not copy large portions of standards into the output. Map applicable requirements/categories by identifier or topic where practical and write repository-specific test objectives.

## Applicability-first approach

Do not mechanically create every possible security case. Determine the attack surface first:

- public vs private system
- authentication method
- roles/tenants
- sensitive data classes
- administrative interfaces
- browser/mobile/API clients
- file handling
- external webhooks/integrations
- payment/financial workflows
- secrets and cryptographic operations

## Minimum security coverage areas when applicable

1. Architecture and threat surface
2. Input validation and business validation
3. Authentication
4. Session/token management
5. Authorization and tenant isolation
6. Stored/reflected/DOM output encoding and XSS
7. Injection classes
8. CSRF and browser-origin controls
9. SSRF and outbound-request restrictions
10. File upload/download handling
11. API object/function/property authorization
12. Rate limiting and abuse controls
13. Security headers and transport assumptions
14. Sensitive-data protection
15. Secrets/configuration handling
16. Cryptographic key/use assumptions
17. Error handling and information leakage
18. Security logging/auditing and redaction
19. Dependency/supply-chain risks visible from manifests
20. Webhook/event authenticity, replay, and idempotency
21. Administrative/support tooling
22. Multi-tenant isolation
23. Cache/proxy/CDN exposure when relevant
24. Account recovery and lifecycle
25. Data export/deletion/privacy behavior when relevant

## Authorization matrix

For each protected resource, derive:

`Actor role × action × resource ownership/tenant × allowed/denied`

Include tests that bypass the UI and call the server operation directly when APIs exist.

## Security expected-result wording

Prefer observable outcomes:

- request denied with no protected data returned
- operation does not change server state
- error does not reveal whether another user's resource exists
- sensitive value is not written to client-visible logs/errors
- expired/revoked credential is rejected
- duplicate webhook does not duplicate the business transaction

Avoid vague wording such as "secure" or "protected".
