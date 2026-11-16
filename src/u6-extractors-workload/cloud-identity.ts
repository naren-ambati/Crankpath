// Cloud identity (U6; BR6.12, FR5.8): a ServiceAccount annotated for a cloud workload identity
// depends on that cloud's token service from a cold start (`assumes-identity`):
// `eks.amazonaws.com/role-arn` (IAM roles for service accounts) gives `external:aws-sts`,
// `iam.gke.io/gcp-service-account` (GKE workload identity) gives `external:gcp-iam`. Only these
// fixed annotation keys are read; an empty value is no edge. A workload depends on its
// ServiceAccount through WorkloadRefExtractor's `runs-as`. Pure (C3).

import {
  type ExtractContext,
  type Extractor,
  type ExtractResult,
  emptyResult,
  type RenderedObject,
} from "../u1-graph-model/extractor.js";
import { externalNode } from "./external-host.js";
import { edgeFrom } from "./references.js";

/** Annotation key to the external identity service it needs. */
export const IDENTITY_ANNOTATIONS: Readonly<Record<string, string>> = Object.freeze({
  "eks.amazonaws.com/role-arn": "aws-sts",
  "iam.gke.io/gcp-service-account": "gcp-iam",
});

export const cloudIdentityExtractor: Extractor = Object.freeze({
  name: "cloud-identity",
  extract(objects: readonly RenderedObject[], _ctx: ExtractContext): ExtractResult {
    const out = emptyResult();
    let read = 0;
    for (const sa of objects) {
      if (sa.kind !== "ServiceAccount" || sa.apiVersion !== "v1") continue;
      read += 1;
      for (const key of Object.keys(IDENTITY_ANNOTATIONS).sort()) {
        const value = sa.annotations[key];
        if (value === undefined || value.trim() === "") continue;
        const ext = externalNode(IDENTITY_ANNOTATIONS[key] as string);
        if (ext === null) continue;
        out.externals.push(ext);
        out.edges.push(edgeFrom(sa, ext.id, "assumes-identity", `metadata.annotations.${key}`));
      }
    }
    out.ignoredKinds = objects.length - read;
    return out;
  },
});
