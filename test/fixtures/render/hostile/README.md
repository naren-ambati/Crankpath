# Hostile render fixture

Hand-written inputs that must fail closed: a chart naming a `file://` dependency outside the
scanned root, a chart whose template emits an alias bomb, a chart that calls `lookup` (rendered
with no cluster), a chart into which the test puts a symlink (created at run time, never
committed), a kustomization with a URL resource, and one whose resource leaves the root.

Added after the B2 review (its repros, written again without any path of the reviewer's machine):
a dependency key in another case (`Repository:`), a v1 chart's `requirements.yaml` naming a
loopback http repository and a `requirements.lock` naming an absolute `file://` path, a
`values.schema.json` whose `$ref` is a loopback URL, a template with `randAlphaNum` in a name, a
template calling `getHostByName`, a dependency repository behind a YAML anchor and merge key; and
kustomizations with `Resources:`, `RESOURCES:`, an unknown key, an `ssh://` resource, an exec
function generator, `HelmCharts:` and `resources` behind an anchor and merge key.

Added after the second B2 review: a kustomization whose `generators` entry is a block scalar
holding a git URL (kustomize would fetch it; the pre-read refuses any entry that is not a plain
one-line path).

Added after the third B2 review: a transformer and a generator configuration file naming a
loopback URL (kustomize loads such a file and fetches what it names; the pre-read reads the file
and refuses it).

Added after the fourth B2 review: a patch path, a transformer configuration's path and a patch
entry's key written with the YAML tag `!!binary` (the base64 text of a loopback URL, or of
`path`), which kustomize decodes and crankpath's reader does not; the pre-read refuses any tag.
