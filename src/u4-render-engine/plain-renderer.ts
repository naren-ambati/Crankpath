// The plain renderer (U4; FR3.11, BR3.18): reads a plain directory's manifests (`.yaml`, `.yml`,
// `.json`, as Argo CD does) through BoundedReader, recursing only when the job says so, and builds
// its RenderedSet. No subprocess. A file it cannot read (a symlink, a limit, a parse error) is
// named and counted, the objects of the other files are kept, and the owner is opaque: `limit`
// when a limit stopped the read, `unreadable-file` otherwise.

import { makeOpaqueMark, type UnreadableFile } from "../u1-graph-model/graph-model.js";
import type { PlainJob, RenderedSet } from "../u3-discovery-expansion/render-job.js";
import { SKIP_DIRS } from "../u3-discovery-expansion/source-discovery.js";
import { buildObjects, type SourceDocument } from "./rendered-set-builder.js";
import type { RenderIo } from "./renderers.js";

const MANIFEST = /\.(?:ya?ml|json)$/;
const LIMIT_OUTCOMES: ReadonlySet<string> = new Set(["too-large", "too-deep", "too-many-documents", "alias-limit"]);

export function renderPlain(job: PlainJob, io: RenderIo): RenderedSet {
  const unreadable: UnreadableFile[] = [];
  const walk = io.walk(job.root, job.dir, { recurse: job.recurse, skipNames: SKIP_DIRS });
  if (!walk.ok) {
    const r = walk.refusal;
    unreadable.push({
      path: io.display(job.root, r.path),
      outcome: r.outcome,
      reasonWord: r.reasonWord,
      detail: r.detail ?? null,
    });
  } else {
    for (const r of walk.refusals) {
      unreadable.push({
        path: io.display(job.root, r.path),
        outcome: r.outcome,
        reasonWord: r.reasonWord,
        detail: r.detail ?? null,
      });
    }
  }
  const documents: SourceDocument[] = [];
  for (const file of walk.ok ? walk.files : []) {
    if (!MANIFEST.test(file)) continue;
    const read = io.read(job.root, file);
    const display = io.display(job.root, file);
    if (read.outcome !== "ok") {
      unreadable.push({
        path: display,
        outcome: read.outcome,
        reasonWord: read.reasonWord,
        detail: read.detail ?? null,
      });
      continue;
    }
    read.documents.forEach((value, i) => {
      documents.push({ file: display, document: i + 1, value });
    });
  }
  const built = buildObjects(documents, {
    renderJob: job.jobId,
    defaultNamespace: job.namespace,
    destination: job.destination,
    generatedBy: job.generatedBy,
  });
  const limited = unreadable.some((u) => LIMIT_OUTCOMES.has(u.outcome));
  const opaque =
    unreadable.length === 0
      ? null
      : makeOpaqueMark({
          reason: limited ? "limit" : "unreadable-file",
          lostEdges: ["objects in the files it could not read"],
          detail: `${unreadable.length} ${unreadable.length === 1 ? "file" : "files"} under its source path not read`,
          field: job.ownerField,
        });
  return Object.freeze({
    jobId: job.jobId,
    objects: built.objects,
    droppedHooks: built.droppedHooks,
    outcome: unreadable.length === 0 ? "ok" : limited ? "limit" : "unreadable-file",
    skipped: built.skipped,
    unreadable,
    opaque,
    timedOut: false,
    stringLeaves: built.stringLeaves,
  });
}
