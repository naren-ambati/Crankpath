// The declared facts of `crankpath.yaml` (contract C2) as typed data. ConfigReader (U2) is the only
// producer; the types live here so every unit can read them without depending on the reader. The
// whole key set is typed now; what each later bolt does with a key is that bolt's (match: B5,
// cranks: B5, clusters: B3, repos fetch: B3).

import type { ColdStart, NodeId } from "./graph-model.js";

export interface ExternalDecl {
  readonly name: string;
  readonly id: NodeId;
  /** `unspecified` when neither `cold_start` nor `served_by` is given (BR2.8). */
  readonly coldStart: ColdStart;
  readonly servedBy: NodeId | null;
  readonly keyPath: string;
}

export interface MatchRule {
  /** A host glob; `*` is the only wildcard. */
  readonly host: string;
  /** A node id or an external name. */
  readonly node: string;
  /** Position in the file, 0-based: the first matching rule wins (BR2.11). */
  readonly order: number;
  readonly keyPath: string;
}

export interface RepoMapping {
  /** The URL as written (repo text). */
  readonly url: string;
  /** Its normalised form (FR2.3). */
  readonly normalised: string;
  /** A canonical path inside the scanned root (`""` is the root), or null for a fetch entry. */
  readonly readFrom: string | null;
  readonly fetch: boolean;
  readonly keyPath: string;
}

export interface DeclaredEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly why: string;
  readonly keyPath: string;
}

export type CrankTarget =
  | { readonly kind: "node"; readonly node: NodeId }
  | { readonly kind: "render"; readonly path: string };

export interface CrankReroute {
  readonly node: NodeId;
  /** An external name. */
  readonly to: string;
}

export interface CrankDecl {
  /** `crank:<n>`, the 1-based position in the file. */
  readonly id: string;
  readonly creates: readonly CrankTarget[];
  readonly reroutes: readonly CrankReroute[];
  readonly by: string;
  readonly ref: string | null;
  /**
   * For a `render:<path>` target naming a chart or Kustomize directory applied by hand (FR7.4): the
   * namespace it is applied in (helm `--namespace`, and the namespace of its objects that name none),
   * or null (absent) for none.
   */
  readonly namespace?: string | null;
  /** For a hand-applied chart: the Helm release name, or null (absent) for the directory's last segment. */
  readonly release?: string | null;
  readonly keyPath: string;
}

export interface ClusterDecl {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
  readonly keyPath: string;
}

export interface ConfigDocument {
  /** The file read, as a label (`crankpath.yaml` or the `--config` base name), or null when absent. */
  readonly file: string | null;
  /** Sorted by name. */
  readonly externals: readonly ExternalDecl[];
  /** File order. */
  readonly matches: readonly MatchRule[];
  /** Sorted by normalised URL. */
  readonly repos: readonly RepoMapping[];
  /** File order. */
  readonly edges: readonly DeclaredEdge[];
  /** File order. */
  readonly cranks: readonly CrankDecl[];
  /** Sorted by name. */
  readonly clusters: readonly ClusterDecl[];
}

/** No declared facts: what an absent `crankpath.yaml` means (BR2.6). Nothing is assumed in their place. */
export const NO_DECLARED_FACTS: ConfigDocument = Object.freeze({
  file: null,
  externals: Object.freeze([]),
  matches: Object.freeze([]),
  repos: Object.freeze([]),
  edges: Object.freeze([]),
  cranks: Object.freeze([]),
  clusters: Object.freeze([]),
});
