// The one dispatch point for render jobs (C4): each job kind has exactly one renderer here. B2 adds
// the helm and kustomize renderers (and the CommandRunner they use) to this table; the pipeline
// never branches on a job kind itself.

import type { ReadResult } from "../u2-intake-config/bounded-reader.js";
import type { WalkOptions, WalkOutcome } from "../u2-intake-config/tree-walk.js";
import type { RenderedSet, RenderJob } from "../u3-discovery-expansion/render-job.js";
import { renderPlain } from "./plain-renderer.js";

/** What a renderer may do: list and read files under a root label, and name a file for output. */
export interface RenderIo {
  walk(root: string, dir: string, options: WalkOptions): WalkOutcome;
  read(root: string, path: string): ReadResult;
  /** The display path of a file under a root label (`alias:N/` prefixed outside the scanned root). */
  display(root: string, path: string): string;
}

type RendererTable = {
  readonly [K in RenderJob["kind"]]: (job: Extract<RenderJob, { kind: K }>, io: RenderIo) => RenderedSet;
};

export const RENDERERS: RendererTable = Object.freeze({
  plain: renderPlain,
});

/** Renders one job with the renderer of its kind. */
export function render(job: RenderJob, io: RenderIo): RenderedSet {
  const renderer = RENDERERS[job.kind] as (job: RenderJob, io: RenderIo) => RenderedSet;
  return renderer(job, io);
}
