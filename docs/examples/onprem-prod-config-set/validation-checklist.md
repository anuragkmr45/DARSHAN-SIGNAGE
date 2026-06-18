# Production Config Validation Checklist

- [ ] Backend config JSON parses.
- [ ] Player config JSON parses.
- [ ] CMS runtime config JSON parses.
- [ ] No credentialed URLs are present in non-secret JSON files.
- [ ] `secrets.env.example` contains placeholders only.
- [ ] Backend-first ghost-pairing rollout is followed.
- [ ] Duplicate identity enforcement remains `warn` unless a separate approved change enables blocking.
- [ ] Node 20 builds/tests are run before production readiness review.
- [ ] Browser CMS Pairing Health QA evidence is captured separately.
- [ ] Packaged player reset/revoke/re-pair smoke evidence is captured separately.
- [ ] Human risk acceptance is recorded for any remaining runtime blocker.
