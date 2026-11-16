// The GitOps-family extractors, in a fixed order. B4 appends the credential matching (part of
// ArgoExtractor) and FluxExtractor here; B6 adds ControllerSignatures beside them (explain only).

import type { Extractor } from "../u1-graph-model/extractor.js";
import { argoExtractor } from "./argo-extractor.js";

export const GITOPS_EXTRACTORS: readonly Extractor[] = Object.freeze([argoExtractor]);
