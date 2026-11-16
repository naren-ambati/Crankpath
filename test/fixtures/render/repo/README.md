# Render fixture

A small estate written for crankpath's tests: an Argo CD Application rendering an in-repo Helm
chart (`charts/web`), one rendering a Kustomize overlay (`kustomize/platform/overlay`), and Flux
objects (a GitRepository naming this repository, a HelmRelease of the same chart with values from
a ConfigMap, and one whose values Secret is not in the repository). `fake-render.yaml` in the
chart is what helm v4.3.2 rendered for it (release name replaced by `RELEASE`), so the unit tests'
fake helm and the live lane's real helm can be compared.
