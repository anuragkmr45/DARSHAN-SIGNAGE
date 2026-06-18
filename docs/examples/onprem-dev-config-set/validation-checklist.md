# Dev Config Validation Checklist

- [ ] Backend config JSON parses.
- [ ] Player config JSON parses.
- [ ] CMS runtime config JSON parses.
- [ ] No credentialed URLs are present in non-secret JSON files.
- [ ] `secrets.env.example` contains placeholders only.
- [ ] Backend is deployed before player validation is enabled.
- [ ] Duplicate identity enforcement remains `warn`.
- [ ] Runtime evidence is recorded separately; this profile is not evidence by itself.
