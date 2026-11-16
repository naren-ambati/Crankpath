// Path patterns of the ApplicationSet git generator (U3, part of GeneratorExpander), as Argo CD
// v3.6.1 matches them, with every step counted against `generatorPatternSteps`:
//
// - `directories`: Go's `path.Match` (applicationset/generators/repo_path_utils.go, filterPaths):
//   `*` is any run of characters other than `/`, `?` one such character, everything else literal.
//   A directory is generated when it matches an entry without `exclude` and no entry with it.
// - `files`: the default (old) globbing of the repo-server, `git ls-files -- <pattern>`: a git
//   pathspec with wildcards matches the whole path with `*` and `?` crossing `/`; one without
//   wildcards matches the path itself or anything under it as a directory.
//
// Character classes (`[...]`) and backslash escapes are refused by name (`unsupported-field`):
// crankpath does not reproduce Go's or git's class syntax. The matcher is a dynamic-programming
// table (no backtracking, no regular expression built from repo text), so one comparison costs at
// most pattern length times path length steps.

export type PatternKind = "directory" | "file";

export type PatternCheck = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/** Whether crankpath matches this pattern (no character class, no escape, not empty). */
export function checkPattern(pattern: string): PatternCheck {
  if (pattern === "") return { ok: false, detail: "an empty path pattern" };
  if (pattern.includes("[") || pattern.includes("\\")) {
    return { ok: false, detail: "a path pattern with a character class or an escape (not matched by crankpath)" };
  }
  return { ok: true };
}

/** A step counter shared by one ApplicationSet's matching; `spend` is false once the budget is gone. */
export class StepBudget {
  private left: number;
  constructor(limit: number) {
    this.left = limit;
  }
  spend(steps: number): boolean {
    if (steps > this.left) {
      this.left = 0;
      return false;
    }
    this.left -= steps;
    return true;
  }
}

/** Wildcard match of a whole string: `*` any run, `?` one character, of the given alphabet. */
function wildMatch(pattern: string, text: string, slashIsWild: boolean): boolean {
  // prev[j]: pattern[0..i) matches text[0..j)
  let prev = new Uint8Array(text.length + 1);
  prev[0] = 1;
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i] as string;
    const cur = new Uint8Array(text.length + 1);
    if (p === "*") {
      cur[0] = prev[0] as number;
      for (let j = 1; j <= text.length; j++) {
        const c = text[j - 1] as string;
        cur[j] = prev[j] === 1 || (cur[j - 1] === 1 && (slashIsWild || c !== "/")) ? 1 : 0;
      }
    } else {
      for (let j = 1; j <= text.length; j++) {
        const c = text[j - 1] as string;
        const one = p === "?" ? slashIsWild || c !== "/" : p === c;
        cur[j] = one && prev[j - 1] === 1 ? 1 : 0;
      }
    }
    prev = cur;
  }
  return prev[text.length] === 1;
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

/**
 * Matches one pattern (already checked) against one path; null when the step budget ran out.
 * Directory patterns never cross `/`, so a path with another segment count is no match at once.
 */
export function matchPath(kind: PatternKind, pattern: string, p: string, budget: StepBudget): boolean | null {
  if (kind === "directory") {
    if (pattern.split("/").length !== p.split("/").length) return false;
    if (!budget.spend(1 + pattern.length * p.length)) return null;
    return wildMatch(pattern, p, false);
  }
  if (!hasWildcard(pattern)) {
    if (!budget.spend(1 + pattern.length)) return null;
    const lit = pattern.replace(/\/+$/, "");
    return p === lit || p.startsWith(`${lit}/`);
  }
  if (!budget.spend(1 + pattern.length * p.length)) return null;
  return wildMatch(pattern, p, true);
}

/**
 * Paths indexed by segment count and first segment, so a directory pattern whose first segment is
 * literal consults only the paths of its depth under that segment.
 */
export class DirectoryIndex {
  private readonly byDepth = new Map<number, string[]>();
  private readonly byDepthFirst = new Map<string, string[]>();
  constructor(paths: readonly string[]) {
    for (const p of paths) {
      const parts = p.split("/");
      const depth = parts.length;
      const all = this.byDepth.get(depth) ?? [];
      all.push(p);
      this.byDepth.set(depth, all);
      const key = `${depth}\n${parts[0] as string}`;
      const first = this.byDepthFirst.get(key) ?? [];
      first.push(p);
      this.byDepthFirst.set(key, first);
    }
  }
  /** The paths a directory pattern can match, in their sorted order. */
  candidates(pattern: string): readonly string[] {
    const parts = pattern.split("/");
    const first = parts[0] as string;
    if (hasWildcard(first)) return this.byDepth.get(parts.length) ?? [];
    return this.byDepthFirst.get(`${parts.length}\n${first}`) ?? [];
  }
}
