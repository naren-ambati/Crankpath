// RenderedSetBuilder (U4, contract C4; BR4.6, BR4.7, FR1.7): turns parsed documents (from plain
// files now; from helm and kustomize output in B2) into RenderedObjects with their origin. Every
// object gets its canonical id here or is skipped and named (BR1.3); a `List` is expanded into its
// items; Helm test hooks are dropped and counted (Helm renders only); Secret `data` and `stringData` values are
// discarded at once, except the `url` of an Argo CD credential Secret, which is kept with its
// userinfo removed. Pure: the caller reads the files.

import { createHash } from "node:crypto";
import type { DataMap, DataValue, RenderedObject } from "../u1-graph-model/extractor.js";
import { asString, getPath, isDataMap } from "../u1-graph-model/extractor.js";
import { objectId, renderedPathOf, type SkippedObject } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { redactUrl } from "../u1-graph-model/safe-text.js";

/** One parsed document of a file, with where it came from (a display path). */
export interface SourceDocument {
  readonly file: string;
  /** 1-based document number in the file. */
  readonly document: number;
  readonly value: DataValue;
}

export interface BuildOptions {
  /** The job the documents were rendered by, or null for discovery. */
  readonly renderJob: string | null;
  /** The namespace an object without its own gets (an Application's destination namespace), or null. */
  readonly defaultNamespace: string | null;
  /** The destination key of the job (`in-cluster` or a foreign key), part of an object's identity of content. */
  readonly destination: string;
  readonly generatedBy?: string | null;
  /** Only keep objects for which this returns true (discovery keeps source kinds only). */
  readonly keep?: (apiVersion: string, kind: string) => boolean;
  /** Mark skipped items as sources (discovery). */
  readonly sourceDocuments?: boolean;
  /**
   * Drop Helm test hooks (`helm.sh/hook` holding `test`) and count them: true only for a Helm
   * render, where the annotation means a Helm test. A plain directory or discovery keeps every
   * object whatever its annotations (an annotation is repo-controlled).
   */
  readonly dropTestHooks?: boolean;
}

export interface BuiltObjects {
  readonly objects: readonly RenderedObject[];
  readonly skipped: readonly SkippedObject[];
  readonly droppedHooks: number;
  /**
   * String values in the objects (aliases counted as expanded), summed: every edge an extractor can
   * make from an object names a target by one of its string values, so this bounds the edges the
   * objects can produce; the run's memory budget charges it.
   */
  readonly stringLeaves: number;
}

export const ARGO_SECRET_TYPE_LABEL = "argocd.argoproj.io/secret-type";
const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";

function stringEntries(value: DataValue | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isDataMap(value)) return out;
  for (const k of Object.keys(value).sort(compareCodePoints)) {
    const v = value[k];
    if (typeof v === "string") Object.defineProperty(out, k, { value: v, enumerable: true });
  }
  return Object.freeze(out);
}

/** Canonical JSON (sorted keys) of a value, for the content digest. */
export function canonicalJson(value: DataValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort(compareCodePoints);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as DataValue)}`).join(",")}}`;
}

/** The string values in a value, counted as expanded (a shared subtree once per reference). Iterative. */
export function countStringLeaves(value: DataValue): number {
  let n = 0;
  const stack: DataValue[] = [value];
  while (stack.length > 0) {
    const v = stack.pop() as DataValue;
    if (typeof v === "string") n += 1;
    else if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (v !== null && typeof v === "object") for (const k of Object.keys(v)) stack.push(v[k] as DataValue);
  }
  return n;
}

function decodeBase64(text: string): string | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(text, "base64"));
  } catch {
    return undefined;
  }
}

/** A copy of a Secret with every data value removed (and the annotation that would repeat them). */
function stripSecret(body: DataMap): { body: DataMap; credentialUrl: string | null } {
  const labels = stringEntries(getPath(body, ["metadata", "labels"]));
  let credentialUrl: string | null = null;
  if (Object.hasOwn(labels, ARGO_SECRET_TYPE_LABEL)) {
    const plain = asString(getPath(body, ["stringData", "url"]));
    const encoded = asString(getPath(body, ["data", "url"]));
    const raw = plain ?? (encoded === undefined ? undefined : decodeBase64(encoded));
    credentialUrl = raw === undefined ? null : (redactUrl(raw) ?? null);
  }
  const out: { [key: string]: DataValue } = {};
  for (const k of Object.keys(body)) {
    if (k === "data" || k === "stringData") continue;
    if (k === "metadata" && isDataMap(body.metadata)) {
      const meta: { [key: string]: DataValue } = {};
      for (const mk of Object.keys(body.metadata)) {
        const mv = body.metadata[mk] as DataValue;
        if (mk === "annotations" && isDataMap(mv)) {
          const ann: { [key: string]: DataValue } = {};
          for (const ak of Object.keys(mv)) {
            if (ak !== LAST_APPLIED) Object.defineProperty(ann, ak, { value: mv[ak], enumerable: true });
          }
          Object.defineProperty(meta, mk, { value: ann, enumerable: true });
        } else Object.defineProperty(meta, mk, { value: mv, enumerable: true });
      }
      Object.defineProperty(out, k, { value: meta, enumerable: true });
      continue;
    }
    Object.defineProperty(out, k, { value: body[k], enumerable: true });
  }
  return { body: out, credentialUrl };
}

/** Helm's own test hook values (`helm test`); no other value marks a test. */
const HELM_TEST_HOOKS: ReadonlySet<string> = new Set(["test", "test-success", "test-failure"]);

function isTestHook(annotations: Readonly<Record<string, string>>): boolean {
  const hook = annotations["helm.sh/hook"];
  return hook?.split(",").some((h) => HELM_TEST_HOOKS.has(h.trim())) === true;
}

function rawString(v: DataValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function itemOf(renderedPath: string): number {
  const m = /\.items\[(\d+)\]$/.exec(renderedPath);
  return m === null ? -1 : Number(m[1]);
}

/** Order of objects by where they were read: file (code points), document, List item. */
export function byLocation(a: RenderedObject, b: RenderedObject): number {
  return (
    compareCodePoints(a.origin.path ?? "", b.origin.path ?? "") ||
    (a.origin.document ?? 0) - (b.origin.document ?? 0) ||
    itemOf(a.renderedPath) - itemOf(b.renderedPath) ||
    compareCodePoints(a.id, b.id)
  );
}

/** Builds the objects of parsed documents: ids, List items, Secret stripping, hook dropping. */
export function buildObjects(documents: readonly SourceDocument[], options: BuildOptions): BuiltObjects {
  const objects: RenderedObject[] = [];
  const skipped: SkippedObject[] = [];
  let droppedHooks = 0;
  let stringLeaves = 0;
  const skip = (doc: SourceDocument, item: number | null, value: DataValue, reason: SkippedObject["reason"]) => {
    skipped.push(
      Object.freeze({
        file: doc.file,
        document: doc.document,
        item,
        kind: rawString(getPath(value, ["kind"])),
        namespace: rawString(getPath(value, ["metadata", "namespace"])),
        name: rawString(getPath(value, ["metadata", "name"])),
        reason,
        renderJob: options.renderJob,
        source: options.sourceDocuments === true,
      }),
    );
  };
  const take = (doc: SourceDocument, item: number | null, value: DataValue) => {
    if (!isDataMap(value)) {
      if (options.keep === undefined) skip(doc, item, value, "not-an-object");
      return;
    }
    const apiVersion = value.apiVersion;
    const kind = value.kind;
    if (typeof apiVersion !== "string" || typeof kind !== "string") {
      if (options.keep === undefined) skip(doc, item, value, "not-an-object");
      return;
    }
    if (options.keep !== undefined && !options.keep(apiVersion, kind)) return;
    const metadata = value.metadata;
    const ownNamespace = getPath(metadata, ["namespace"]);
    const unset = ownNamespace === undefined || ownNamespace === null || ownNamespace === "";
    const effective = unset ? options.defaultNamespace : ownNamespace;
    const id = objectId(kind, effective, getPath(metadata, ["name"]));
    if (!id.ok) {
      skip(doc, item, value, id.refusal);
      return;
    }
    const annotations = stringEntries(getPath(metadata, ["annotations"]));
    if (options.dropTestHooks === true && isTestHook(annotations)) {
      droppedHooks += 1;
      return;
    }
    let body: DataMap = value;
    let credentialUrl: string | null = null;
    if (kind === "Secret") ({ body, credentialUrl } = stripSecret(value));
    const finalAnnotations =
      kind === "Secret" ? stringEntries(getPath(body, ["metadata", "annotations"])) : annotations;
    const renderedPath =
      item === null ? renderedPathOf(doc.file, doc.document) : renderedPathOf(doc.file, doc.document, item);
    stringLeaves += countStringLeaves(body);
    const digest = createHash("sha256")
      .update(canonicalJson({ body, namespace: id.namespace, destination: options.destination }))
      .digest("hex");
    objects.push(
      Object.freeze({
        id: id.id,
        apiVersion,
        kind: id.kind,
        namespace: id.namespace,
        name: id.name,
        labels: stringEntries(getPath(body, ["metadata", "labels"])),
        annotations: finalAnnotations,
        body,
        origin: Object.freeze({ renderJob: options.renderJob, path: doc.file, document: doc.document }),
        renderedPath,
        generatedBy: options.generatedBy ?? null,
        credentialUrl,
        digest,
      }),
    );
  };
  for (const doc of documents) {
    const v = doc.value;
    if (v === null) continue; // an empty document
    if (isDataMap(v) && v.kind === "List" && Array.isArray(v.items)) {
      v.items.forEach((itemValue, i) => {
        take(doc, i, itemValue);
      });
      continue;
    }
    take(doc, null, v);
  }
  objects.sort(byLocation);
  return { objects, skipped, droppedHooks, stringLeaves };
}
