// Test helpers: rendered objects built through the real RenderedSetBuilder, and an extract context
// with the real HostMatcher, so unit tests exercise the same construction the pipeline uses.

import type { ConfigDocument } from "../../src/u1-graph-model/declared-facts.js";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import type { DataValue, ExtractContext, JobInfo, RenderedObject } from "../../src/u1-graph-model/extractor.js";
import { IN_CLUSTER } from "../../src/u1-graph-model/extractor.js";
import { createRepoIdentity } from "../../src/u2-intake-config/repo-identity.js";
import { buildObjects } from "../../src/u4-render-engine/rendered-set-builder.js";
import { hostResolution } from "../../src/u6-extractors-workload/host-matcher.js";

export interface ObjOptions {
  readonly file?: string;
  readonly document?: number;
  readonly renderJob?: string | null;
  readonly defaultNamespace?: string | null;
  readonly destination?: string;
}

/** One rendered object from a document; throws when the document would be skipped. */
export function obj(doc: DataValue, options: ObjOptions = {}): RenderedObject {
  const built = buildObjects([{ file: options.file ?? "x.yaml", document: options.document ?? 1, value: doc }], {
    renderJob: options.renderJob ?? null,
    defaultNamespace: options.defaultNamespace ?? null,
    destination: options.destination ?? IN_CLUSTER,
  });
  const first = built.objects[0];
  if (first === undefined) throw new Error("test helper: the document was skipped");
  return first;
}

export function meta(
  kind: string,
  namespace: string | null,
  name: string,
  extra: Record<string, DataValue> = {},
): DataValue {
  const metadata: Record<string, DataValue> = { name };
  if (namespace !== null) metadata.namespace = namespace;
  const apiVersion =
    kind === "Application" || kind === "ApplicationSet"
      ? "argoproj.io/v1alpha1"
      : kind === "Deployment" || kind === "StatefulSet" || kind === "DaemonSet"
        ? "apps/v1"
        : kind === "Job"
          ? "batch/v1"
          : kind === "CronJob"
            ? "batch/v1"
            : "v1";
  return { apiVersion, kind, metadata, ...extra };
}

export function job(owner: string, destination = IN_CLUSTER, ownerFile = "apps/app.yaml"): JobInfo {
  return {
    jobId: `${owner}#0`,
    owner,
    ownerFile,
    ownerField: "spec.source.path",
    ownerRenderedPath: `${ownerFile}#1`,
    destination,
  };
}

/** An extract context over the objects: in-cluster Services offered to host matching. */
export function context(
  objects: readonly RenderedObject[],
  jobs: readonly JobInfo[] = [],
  config: ConfigDocument = NO_DECLARED_FACTS,
): ExtractContext {
  const jobMap = new Map(jobs.map((j) => [j.jobId, j]));
  const services = objects
    .filter((o) => o.kind === "Service" && o.namespace !== null)
    .filter(
      (o) => o.origin.renderJob === null || (jobMap.get(o.origin.renderJob)?.destination ?? IN_CLUSTER) === IN_CLUSTER,
    )
    .map((o) => ({ id: o.id, name: o.name, namespace: o.namespace as string }));
  const identity = createRepoIdentity({ scannedUrl: null, scannedFrom: null, aliases: [], mappings: [] });
  const resolution = hostResolution(objects, services, config.matches);
  return {
    resolveRepo: identity.resolve,
    matchHost: resolution.matching.match,
    externalOf: resolution.externalOf,
    config,
    jobs: jobMap,
  };
}
