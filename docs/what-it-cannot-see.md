# What static analysis cannot see

crankpath reads a repository; it never looks at a cluster. Everything it reports is about the files as read and rendered, so some dependencies of a real black start are outside what it can see. This page lists them. The derived limits that bound each run (sizes, depths, counts, time) are in [limits](limits.md); the words are defined in [concepts](concepts.md).

## What every report says it does not model

Every run closes with the same list, so no report can be read without it:

<!-- claim CL-6 -->
Excerpt of `crankpath repo --repo-url https://github.com/example-org/estate --repo-alias http://gitea-http.gitea:3000/ops/estate=repo --no-network`, run 2026-11-16 in `test/fixtures/docs-example`:

```text
Not modelled (5 items): a running Argo CD or Flux controller is assumed;
    dependencies only visible at runtime are not seen; the content of opaque
    nodes is not seen; the revision each Application names is taken to be the
    files as read; repository credentials not defined in the estate are not
    seen.
```

- **A running controller is assumed.** The plan says what Argo CD or Flux must apply and in what order; it does not model the controller's own start-up, its reconcile loop, retries or health checks.
- **Runtime-only dependencies are not seen.** A dependency that exists only in running code (a host name built at run time, a database an application connects to from a value crankpath does not read, an init script that waits for another service) makes no edge. Edges come only from the fields crankpath's extractors read: sources, Secret and ConfigMap references, Service selectors, credentials, secret stores, certificate issuers, the Vault seal, cloud identities, and hosts in the fields that name a host.
- **The content of opaque sources is not seen.** An opaque source keeps the edges that point to it, but the objects it would deploy, and their edges, are missing. The opacity line counts these sources and says `at least` when anything was unreadable.
- **The revision is taken to be the files as read.** crankpath reads the checkout it is given; if an Application names a branch, tag or version range, a later commit may hold other content. Such sources are listed as floating.
- **Repository credentials not defined in the estate are not seen.** A repository that needs credentials kept only in the cluster cannot be read, and the credential edge it would add is missing.

## Other things outside a repository

- **State that exists only in the cluster.** Values from Secrets or ConfigMaps the cluster creates (`cluster-created-values`), encrypted values (`encrypted-values`), and the labels and annotations of Argo CD cluster Secrets that ApplicationSet generators select on (`cluster-inputs-missing` unless declared under `clusters:`) are opaque, never guessed.
- **Objects that operators create at run time.** Beyond the kinds crankpath models (an ExternalSecret producing its Secret, a Certificate its Secret), an object a controller creates when it runs is not in the graph; a reference to it is an object no readable source defines, and what needs it is unverified.
- **Helm functions that read a cluster or vary.** `helm template` renders `lookup` as empty and runs `randAlphaNum`, `now` and the like afresh each time. crankpath renders each chart twice and names the functions it finds; two renders that agree cannot prove a chart never varies ([limits](limits.md#render-limits-first-real-renders-and-the-cost-at-the-limits-b2-step-0-od-5-od-7)).
- **Helm test hooks** are dropped from renders and counted; they are not part of a black start.
- **Timing.** The plan is an order, not a schedule: it does not model how long a step takes, cold-load pickup (the load that hits a service as it starts), readiness or timeouts. Argo CD sync waves are an ordering attribute, never an edge.
- **Availability outside the estate.** Whether a public Git host, a registry or a cloud key service is up during a black start is never assumed: it comes only from `external:` in `crankpath.yaml`, and is shown as declared and not verified.
- **Whether a crank works.** A crank is a documented step; crankpath applies it to the graph and never runs or checks it ([write your cranks](write-your-cranks.md#what-a-crank-does-not-do)).

## Where it runs

Intended for macOS and Linux (arm64 and x64) by design (D2); this build was run on macOS arm64 only, and Linux and x64 have not been run. Windows is not supported.
