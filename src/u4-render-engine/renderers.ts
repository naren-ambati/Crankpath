// The one dispatch point for render jobs (C4): each job kind has exactly one renderer here, and
// the pipeline never branches on a job kind itself.

import type { RenderedSet, RenderJob } from "../u3-discovery-expansion/render-job.js";
import { renderHelm } from "./helm-renderer.js";
import { renderKustomize } from "./kustomize-renderer.js";
import { renderPlain } from "./plain-renderer.js";
import type { RenderIo } from "./render-io.js";

export type { RenderIo, RenderRuntime, ValuesData } from "./render-io.js";

type RendererTable = {
  readonly [K in RenderJob["kind"]]: (job: Extract<RenderJob, { kind: K }>, io: RenderIo) => RenderedSet;
};

export const RENDERERS: RendererTable = Object.freeze({
  plain: renderPlain,
  helm: renderHelm,
  kustomize: renderKustomize,
});

/** Renders one job with the renderer of its kind. */
export function render(job: RenderJob, io: RenderIo): RenderedSet {
  const renderer = RENDERERS[job.kind] as (job: RenderJob, io: RenderIo) => RenderedSet;
  return renderer(job, io);
}
