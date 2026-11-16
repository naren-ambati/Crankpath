// The adversarial suite in one place (US11.5, FR11.5, NFR1): every failure class the design names,
// its expected outcome, and the tests that hunt it. Most were written by earlier bolts beside the
// unit they test; this index references them (file, describe title, test title, exactly as written),
// and `suite.test.ts` fails when a reference no longer matches a test, so the index cannot rot.
// Cases no earlier bolt covered through the whole command are in `gaps.test.ts`.

export interface Reference {
  readonly file: string;
  readonly describe: string;
  readonly it: string;
}
export interface FailureClass {
  readonly id: string;
  readonly hostile: string;
  readonly outcome: string;
  readonly refs: readonly Reference[];
}

const RE = "test/u9-cli-package/render-e2e.test.ts";
const RE_DESCRIBE =
  "hostile charts and kustomizations fail closed with a named reason (B2 demo, B2 review M1 to M3, m2, m6)";
const RE_IT = "makes each hostile source opaque, runs nothing for the refused ones, and finishes the run";
const GAPS = "test/adversarial/gaps.test.ts";

export const SUITE: readonly FailureClass[] = [
  {
    id: "hostile-chart",
    hostile:
      "a Helm chart with a file:// dependency outside the root, http, IP, loopback or userinfo repositories, a symlink, a lookup, a schema $ref, a YAML-bomb render",
    outcome:
      "the Application is opaque with a named reason (unsupported-field, unreadable-file, limit, render-failed); nothing outside the root is read; the run finishes",
    refs: [
      { file: RE, describe: RE_DESCRIBE, it: RE_IT },
      {
        file: "test/u4-render-engine/helm-renderer.test.ts",
        describe: "Chart.yaml and Chart.lock pre-read (BR4.20)",
        it: "fails closed on a symlink in the chart: unreadable-file, named, helm not run",
      },
      {
        file: "test/u4-render-engine/helm-renderer.test.ts",
        describe: "hostile render output and limits (BR4.2, FR1.4)",
        it: "a render that emits a YAML bomb is limit for the owner; the bomb document is named, the next kept",
      },
      {
        file: "test/u4-render-engine/review-b2-preread.test.ts",
        describe: "M3: helm never validates a values schema (it would fetch $ref URLs)",
        it: "always passes --skip-schema-validation, whatever the source says",
      },
    ],
  },
  {
    id: "hostile-kustomization",
    hostile: "a kustomization with remote bases, an escaping resource, exec or plugin generators, helmCharts",
    outcome: "remote-base, render-failed or unsupported-field before kustomize runs; no generator executes",
    refs: [
      { file: RE, describe: RE_DESCRIBE, it: RE_IT },
      {
        file: "test/u4-render-engine/kustomize-renderer.test.ts",
        describe: "kustomize pre-read (BR4.4, BR4.5)",
        it: "fails closed as render-failed for an entry outside the scanned root",
      },
      {
        file: "test/u4-render-engine/kustomize-renderer.test.ts",
        describe: "kustomize pre-read (BR4.4, BR4.5)",
        it: "never enables Helm inflation: helmCharts is unsupported-field",
      },
    ],
  },
  {
    id: "symlink-escape",
    hostile: "a file or directory symlink in the scanned tree pointing outside it",
    outcome: "named and counted as a symlink (unreadable-file), never followed; the counts become a floor",
    refs: [
      {
        file: "test/u9-cli-package/pipeline-runner.test.ts",
        describe: "pipeline composition",
        it: "names and counts a symlink in the scanned tree, and never reads through it",
      },
      {
        file: "test/u2-intake-config/bounded-reader.test.ts",
        describe: "BoundedReader confinement (BR2.1)",
        it: "never returns content from outside the root through a symlink to outside",
      },
      {
        file: "test/u2-intake-config/config-reader.test.ts",
        describe: "crankpath.yaml: the full C2 key set (BR2.5 to BR2.7)",
        it: "refuses a repos read_from naming %s (FR2.6, FR6.7)",
      },
    ],
  },
  {
    id: "path-traversal",
    hostile: "`../` in an Application path, a value file, a crank target or a repos: read_from",
    outcome: "unreadable-file or a refused crankpath.yaml key, naming the field; nothing outside the root is read",
    refs: [
      {
        file: GAPS,
        describe: "path traversal in an Application, through the whole command (BR11.11)",
        it: "makes an Application whose path climbs out of the root opaque, reading nothing outside",
      },
      {
        file: "test/u3-discovery-expansion/render-planner-render.test.ts",
        describe: "Argo CD Helm sources (BR3.4, BR3.5, BR3.6, FR3.1)",
        it: "is unreadable-file for a value file outside the scanned root",
      },
      {
        file: "test/u9-cli-package/declared-facts.test.ts",
        describe: "a crank that breaks nothing (BR7.9, US7.4)",
        it: "refuses a crank that names a path outside the scanned root, with the key path",
      },
      {
        file: "test/u9-cli-package/cli.test.ts",
        describe: "exit codes (BR9.3 to BR9.5)",
        it: "is 1 when a repo-supplied repos: entry points outside the root, and names it",
      },
    ],
  },
  {
    id: "look-alike-url",
    hostile:
      "a repoURL that looks like the scanned repo but is not (other host, host prefix, longer name, prefix or sub-path, case, port, punycode)",
    outcome: "unreadable-repo: the repo is never assumed to be the scanned one",
    refs: [
      {
        file: GAPS,
        describe: "a URL that looks like the scanned repo but is not is unreadable (BR11.12, AC11.5.2)",
        it: `\${what}: \${reason ?? "read"}`,
      },
      {
        file: "test/u2-intake-config/repo-identity.test.ts",
        describe: "normalisation (FR2.3, BR2.13)",
        it: "never makes look-alike hosts, prefix paths or other cases equal",
      },
      {
        file: "test/u6-extractors-workload/host-matcher.test.ts",
        describe: "host matching (BR6.13, BR6.14)",
        it: "matches nothing for other hosts and look-alikes",
      },
    ],
  },
  {
    id: "dormant-cycle",
    hostile: "a dependsOn cycle closed by one patch (dormant in the controller until the next revision)",
    outcome: "the extracted cycle is found on the revision that carries the patch, and not before",
    refs: [
      {
        file: GAPS,
        describe:
          "a cycle dormant until one patch is found on the revision that closes it (BR11.12, research section 4)",
        it: "finds the extracted 2-node dependsOn cycle once the one patch is applied",
      },
    ],
  },
  {
    id: "zero-applications",
    hostile: "a repository with no Application, ApplicationSet, Kustomization or HelmRelease",
    outcome: "NOTHING ANALYSED, exit 2, never a clean result",
    refs: [
      {
        file: "test/u9-cli-package/cli.test.ts",
        describe: "exit codes (BR9.3 to BR9.5)",
        it: "is 2 with nothing analysed (M4), quoting the path",
      },
      {
        file: "test/u9-cli-package/review-b6.test.ts",
        describe: "M2: Mermaid on a NOTHING ANALYSED run prints the M4 shape and no diagram",
        it: "prints the nothing-analysed text in one text fence, exit 2, with no cycles line and no drawn claim",
      },
    ],
  },
  {
    id: "yaml-bomb",
    hostile: "an alias bomb in a scanned file, a values file or a render's output",
    outcome: "a named refusal (unreadable file, or limit for a render), counted; the run finishes",
    refs: [
      {
        file: GAPS,
        describe: "a YAML bomb and deep nesting in a scanned file, through the whole command (BR11.11)",
        it: `names \${name} as an unreadable file, counts it, says "at least", and finishes`,
      },
      {
        file: "test/u2-intake-config/bounded-reader.test.ts",
        describe: "BoundedReader YAML limits (BR2.2, BR2.3)",
        it: "refuses a billion-laughs alias bomb quickly, without expanding it",
      },
      {
        file: "test/u4-render-engine/helm-renderer.test.ts",
        describe: "helm template of a chart in the repo (BR4.1, BR4.6, BR4.7)",
        it: "refuses a values file that is a YAML bomb before helm reads it",
      },
    ],
  },
  {
    id: "deep-nesting",
    hostile: "deeply nested YAML or JSON, HCL blocks, auth blocks",
    outcome: "too-deep (or a named HCL refusal), never a stack overflow",
    refs: [
      {
        file: "test/u2-intake-config/bounded-reader.test.ts",
        describe: "BoundedReader YAML limits (BR2.2, BR2.3)",
        it: "refuses 10,000-deep and 10,001-deep nesting without crashing",
      },
      {
        file: "test/u6-extractors-workload/hcl-seal-reader.test.ts",
        describe: "hostile input ends in a named refusal, quickly, and never throws",
        it: "deep nesting of blocks, closed",
      },
    ],
  },
  {
    id: "size-count-time",
    hostile: "huge files, huge renders, too many documents or objects, a render that never ends",
    outcome: "a counted limit outcome (too-large, limit, timeout) and a floor; never silence, never a crash",
    refs: [
      {
        file: "test/u9-cli-package/render-e2e.test.ts",
        describe: "tools, failures and limits",
        it: "reports a timeout as limit (timeout), counts it, and says the output may differ on a rerun (OD-30, BR9.11)",
      },
      {
        file: "test/u9-cli-package/review-b1-pass2.test.ts",
        describe: "N2: the run's memory budget ends in counted limit outcomes, never a crash",
        it: "refuses a file over the budget as a counted unreadable file, so the counts are a floor",
      },
      {
        file: "test/u2-intake-config/bounded-reader.test.ts",
        describe: "BoundedReader size limit (BR2.2)",
        it: "refuses a file over fileBytes from stat, before reading",
      },
    ],
  },
  {
    id: "hostile-names",
    hostile: "names and values with terminal escapes, newlines, `/` `:`, forged ids, bidi, NUL, claim words, long text",
    outcome: "quoted after a fixed label, escaped for each destination, never at a line start, never a forged node",
    refs: [
      {
        file: "test/u8-output/hostile-renderers.test.ts",
        describe: "the checks fire when escaping is taken away (the property test can fail)",
        it: "catches a raw escape, a line starting with repo text, an unbalanced quote and a claim word",
      },
      {
        file: "test/u9-cli-package/thin-slice.test.ts",
        describe: "thin slice: hostile input (FR8.6, NFR4, BR1.3)",
        it: "shows control characters as visible codes and never emits a raw one",
      },
      {
        file: "test/u1-graph-model/graph-model.test.ts",
        describe: "canonical ids (BR1.3, AC1.1.3)",
        it: "refuses a `/` or `:` in any part, so no name can forge another node's id",
      },
    ],
  },
  {
    id: "crank-everything",
    hostile: "a crankpath.yaml in the scanned repo that cranks every path and declares every external available",
    outcome:
      "the cycle is still shown (cranked, never gone); every crank documented and every external declared, not verified; the repo's words quoted",
    refs: [
      {
        file: GAPS,
        describe: "a crankpath.yaml that cranks everything and declares everything available (US11.5)",
        it: "calls every crank documented and every external declared, never verified",
      },
      {
        file: "test/u7-graph-analysis/crank-applier.test.ts",
        describe: "cranks: creates (BR7.7, AC7.3.1)",
        it: "never creates an external (a crank cannot make an unspecified external available)",
      },
    ],
  },
  {
    id: "repo-supplied-config",
    hostile: "a crankpath.yaml in the scanned repo that maps repos outside the root or shadows an alias",
    outcome: "refused with the key path (exit 1), or the user's alias kept",
    refs: [
      {
        file: "test/u9-cli-package/review-b1.test.ts",
        describe: "M1: a repo-supplied repos: entry can never shadow a --repo-alias root",
        it: "keeps the user's alias root when the repo maps a directory named alias:1",
      },
    ],
  },
  {
    id: "credentials",
    hostile: "planted tokens, credentials, a kubeconfig or a proxy in the environment; userinfo in URLs",
    outcome: "no child process receives them; no token or userinfo in any output",
    refs: [
      {
        file: "test/u4-render-engine/command-runner.test.ts",
        describe: "the child environment (BR4.18, C12)",
        it: "never reaches a real child with a planted credential, token, kubeconfig or proxy",
      },
      {
        file: "test/u9-cli-package/render-e2e.test.ts",
        describe: "tools, failures and limits",
        it: "--verbose prints fixed words and counts only: no token, no Secret value, no path",
      },
    ],
  },
  {
    id: "token-host",
    hostile:
      "a repository that names a token host: a CRANKPATH_TOKEN_<HOST> set, and repo URLs or repos: entries that point elsewhere (AC11.5.3)",
    outcome:
      "the token is read for its own host only and sent only to it over https; no other host's variable is read or sent; the token is in no output, cache or log",
    refs: [
      {
        file: "test/u4-render-engine/repo-fetcher.test.ts",
        describe: "the fetch (fake git)",
        it: "gives another host no token: a token never follows the input to another host",
      },
      {
        file: "test/u4-render-engine/repo-fetcher.test.ts",
        describe: "the fetch (fake git)",
        it: "sends a token only to its own host, only through the call's environment (AC4.5.2)",
      },
      {
        file: "test/u9-cli-package/repo-fetch.test.ts",
        describe: "the token reaches its own host only, and only for the URL the invoker names (AC4.5.2, B3 review M2)",
        it: "goes to the command line's URL only; a repos: entry on the same host gets none; it is in no output or cache",
      },
    ],
  },
  {
    id: "unknown-not-gone",
    hostile: "a chart repository answering 403, 404 or 429, or unreachable",
    outcome: 'private-chart or render-failed with "unknown whether the chart exists"; never gone, never a pass',
    refs: [
      {
        file: "test/u4-render-engine/helm-renderer.test.ts",
        describe: "charts from a repository: the chart cache (BR4.8 to BR4.10, FR1.8)",
        it: "reports 403 as private-chart, and 404, unreachable and timeout as what they are, never as absent",
      },
      {
        file: GAPS,
        describe: "a 403, 404 or rate limit from a chart repository is unknown, never gone (failure classes)",
        it: "%s is %s: %s",
      },
    ],
  },
];
