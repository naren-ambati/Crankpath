# Vault fixture: rendered objects

Hand-written stand-ins for what `helm template` produces for the fixture's Helm Applications, in
the shape that matters to crankpath's extractors and nothing more (FR11.4, OD-6). They are not
rendered output and are not copied from any chart: the Vault chart is MPL-2.0, so no copy of its
templates or of its rendered output is committed. The facts reproduced are names and keys: the
Vault chart renders its server configuration into a ConfigMap named `<fullname>-config` under the
key `extraconfig-from-values.hcl` (`vault-config` for release `vault`,
`platform-secrets-vault-config` for release `platform-secrets`), a Service and a headless
`<fullname>-internal` Service selecting the server Pods, a ServiceAccount carrying the configured
annotations, and a StatefulSet mounting the ConfigMap and any `extraVolumes` Secret.

`jobs.yaml` names each render job: the Application that owns it, its evidence field, its
destination namespace, and the directory (relative to the fixture) whose YAML is its output. The
directory-type Applications (`root`, `platform`) read the repository trees themselves.
