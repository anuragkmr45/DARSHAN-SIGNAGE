# Controlled recovery Packet 3 operator boundary

The CMS is a monitoring and encrypted-artifact download surface. It cannot
prepare, restore, reconcile, validate, promote, accept or roll back recovery.

Use the installed backend role's fixed `controlled-recovery:*` commands and
the separately approved Packet 1/2 profile. Import only a deployment-signed,
secret-free report projection with `controlled-recovery:import-report`; exact
paths, signing custody and approvals remain deployment-operator inputs.

Production native recovery remains unavailable (`ENOTSUP`) and unselected.
Consult the release-bundled `docs/runbooks/controlled-docker-recovery-packet3.md`
for the full contract and pending Docker, topology, browser, promotion and
rollback gates.
