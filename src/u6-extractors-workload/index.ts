// The workload-family extractors, in a fixed order. B4 appends SecretStoreExtractor,
// CertManagerExtractor, VaultSealExtractor and the cloud-identity part of WorkloadRefExtractor here.

import type { Extractor } from "../u1-graph-model/extractor.js";
import { workloadRefExtractor } from "./workload-refs.js";

export const WORKLOAD_EXTRACTORS: readonly Extractor[] = Object.freeze([workloadRefExtractor]);
