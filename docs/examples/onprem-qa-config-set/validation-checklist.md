# QA Config Validation Checklist

- [ ] Backend config JSON parses.
- [ ] Player config JSON parses.
- [ ] CMS runtime config JSON parses.
- [ ] No credentialed URLs are present in non-secret JSON files.
- [ ] `secrets.env.example` contains placeholders only.
- [ ] Backend-first ghost-pairing rollout is followed.
- [ ] Duplicate identity enforcement remains `warn`.
- [ ] Node 20 builds/tests are run before runtime QA signoff.
- [ ] Browser CMS Pairing Health QA evidence is captured separately.
- [ ] Packaged player reset/revoke/re-pair smoke evidence is captured separately.
