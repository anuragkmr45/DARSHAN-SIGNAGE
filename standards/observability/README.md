# Observability Standards

These standards govern DARSHAN observability work across platform, backend, CMS, and player repos.

Required policy areas:

- [Metric Design](./metric-design.md)
- [Deployment And Packaging](./deployment-and-packaging.md)
- [Security And Access](./security-and-access.md)
- [Alerting And Operations](./alerting-and-operations.md)

Every observability change must stay compatible with:

- air-gapped production runtime constraints
- low-cardinality Prometheus metric design
- dashboards-as-code and rule files in git
- environment-specific rendering without hardcoded site values
