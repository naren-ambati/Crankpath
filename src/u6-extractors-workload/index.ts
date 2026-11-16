// The workload-family extractors, in a fixed order: Pod-template references and Service
// selectors, cloud identity, the secrets operator, cert-manager, the Vault seal.

import type { Extractor } from "../u1-graph-model/extractor.js";
import { certManagerExtractor } from "./cert-manager-extractor.js";
import { cloudIdentityExtractor } from "./cloud-identity.js";
import { secretStoreExtractor } from "./secret-store-extractor.js";
import { vaultSealExtractor } from "./vault-seal-extractor.js";
import { workloadRefExtractor } from "./workload-refs.js";

export const WORKLOAD_EXTRACTORS: readonly Extractor[] = Object.freeze([
  workloadRefExtractor,
  cloudIdentityExtractor,
  secretStoreExtractor,
  certManagerExtractor,
  vaultSealExtractor,
]);
