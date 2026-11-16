# Host placement: when a host becomes a Service, an external, or an item

crankpath reads hosts only from named fields (FR5.9, BR6.16): an Application's or ApplicationSet's
`repoURL`, a Flux source's `spec.url` (a Bucket's `spec.endpoint`), a secret store's provider
server, a Vault or ACME issuer's server, and a Vault transit seal's `address`. It never reads a host
from free text. Each host is placed in this order (`src/u6-extractors-workload/external-host.ts`):

1. **An in-estate Service.** The forms `svc`, `svc.ns`, `svc.ns.svc` and `svc.ns.svc.cluster.local`
   match the Service `svc` in namespace `ns` (BR6.13). A bare `svc` matches only in a namespace the
   field states. Only a transit seal states one: the Vault pod's own namespace, because Vault itself
   dials the address. Argo CD, Flux, the secrets operator and cert-manager dial from their
   controller's namespace, which the estate does not show, so their bare names state none.
2. **Two or more candidates** are an ambiguity: no edge, a `host-ambiguous` item listing them.
3. **An external precondition** `external:<host>`, with cold-start availability unspecified until
   `crankpath.yaml` declares it. This applies only to a name that cannot be the cluster's own DNS:
   - it has at least two labels;
   - it is not an IP literal;
   - no label after the first is `svc`;
   - it does not end in `.local` or `.cluster`;
   - if it has exactly two labels, its last label is a top-level domain delegated in the DNS root
     zone and no namespace of the estate has that name.

   The root zone is the registry's list
   (https://data.iana.org/TLD/tlds-alpha-by-domain.txt), copied as data with its version line into
   `src/u6-extractors-workload/root-zone-tlds.ts`. The lookup and its date are in `docs/lookups.md`.
4. **Anything else may be in-cluster** and is no edge and a `host-unplaced` item naming the host.
   This covers a bare name with no stated namespace (the one same-named Service, if any, is listed),
   `kubernetes.default`, `prometheus.monitoring`, IP literals, and reserved names such as
   `x.example`, `x.test`, `x.internal` and `x.localhost`, which are not delegated top-level domains.
   A field holding text that yields no host (unparseable, an IPv6 zone id) is the same kind of item,
   quoting the text. A transit seal's address of that kind is `address-missing`, quoting the text.

So `github.com` and `charts.example.org` are externals. `gitea-http.gitea` is unplaced unless a
`gitea` Service matches it. `github.com` is also unplaced in an estate that has a namespace named
`com`.
