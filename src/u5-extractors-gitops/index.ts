// The GitOps-family extractors, in a fixed order: Argo CD Applications and ApplicationSets, their
// repository credentials, then Flux. B6 adds ControllerSignatures beside them (explain only).

import type { Extractor } from "../u1-graph-model/extractor.js";
import { argoExtractor } from "./argo-extractor.js";
import { credentialExtractor } from "./credential-extractor.js";
import { fluxExtractor } from "./flux-extractor.js";

export const GITOPS_EXTRACTORS: readonly Extractor[] = Object.freeze([
  argoExtractor,
  credentialExtractor,
  fluxExtractor,
]);
