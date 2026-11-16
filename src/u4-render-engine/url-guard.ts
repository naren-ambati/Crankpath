// The URL guard (U4; FR1.8, BR4.11, BR4.20): a chart repository or registry URL read from the
// scanned repo (an Application's `repoURL`, a HelmRepository's `url`, a `repository:` of
// `Chart.yaml` or `Chart.lock`) is given to helm only when it is https or `oci://`, names a host by
// name (no IP literal, no loopback or link-local name) and carries no credential. crankpath gives
// helm no credential of its own; helm follows redirects itself, which crankpath cannot stop (OD-29,
// a stated limit). A name that resolves to a private address (DNS rebinding) is a stated residual
// risk: the guard sees names, not addresses.

export type UrlProblem = "unparseable" | "scheme" | "credential" | "ip-literal" | "loopback" | "query";

/** crankpath's fixed wording for each refusal (shown as a detail, never with the URL's own text). */
export const URL_PROBLEM_WORDS: Readonly<Record<UrlProblem, string>> = Object.freeze({
  unparseable: "not a URL crankpath can read",
  scheme: "only https and oci:// repositories are fetched",
  credential: "a URL holding a credential is never used",
  "ip-literal": "an IP address is never fetched from (a host name is required)",
  loopback: "a loopback or link-local host is never fetched from",
  query: "a URL with a query or fragment is never used",
});

export type GuardedUrl =
  | {
      readonly ok: true;
      readonly scheme: "https" | "oci";
      /** The URL as helm is given it: no trailing slash. */
      readonly url: string;
      /** Lower-cased host (and port), for the cache key. */
      readonly host: string;
      /** The path without a trailing slash (`""` for none). */
      readonly path: string;
    }
  | { readonly ok: false; readonly problem: UrlProblem };

const IPV4 = /^\d+(?:\.\d+){0,3}$/;
const HEXISH_IPV4 = /^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}$/i;
// No whitespace and no control or format character anywhere; a non-ASCII host is allowed and
// reaches the checks (and helm) as punycode, as the URL parser gives it (B2 review pass 2, m1).
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find them
const UNSAFE = /[\s\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

function hostProblem(hostname: string): UrlProblem | null {
  const h = hostname.toLowerCase();
  if (h.startsWith("[") || h.includes(":")) return "ip-literal";
  if (IPV4.test(h) || HEXISH_IPV4.test(h)) return "ip-literal";
  if (h === "localhost" || h.endsWith(".localhost") || h === "localhost.localdomain") return "loopback";
  // link-local and loopback names some resolvers answer without DNS
  if (h === "ip6-localhost" || h === "ip6-loopback" || h.endsWith(".local")) return "loopback";
  return null;
}

/** Checks one chart repository or registry URL. Never throws. */
export function guardChartUrl(raw: string): GuardedUrl {
  if (raw.length === 0 || raw.length > 2048 || UNSAFE.test(raw)) return { ok: false, problem: "unparseable" };
  const lower = raw.toLowerCase();
  let scheme: "https" | "oci";
  if (lower.startsWith("https://")) scheme = "https";
  else if (lower.startsWith("oci://")) scheme = "oci";
  else return { ok: false, problem: "scheme" };
  // Parse an oci:// URL as https so the WHATWG parser normalises its host the same way.
  const asHttps = scheme === "oci" ? `https://${raw.slice("oci://".length)}` : raw;
  let u: URL;
  try {
    u = new URL(asHttps);
  } catch {
    return { ok: false, problem: "unparseable" };
  }
  const rest = raw.slice(raw.indexOf("://") + 3);
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  if (u.username !== "" || u.password !== "" || authority.includes("@")) return { ok: false, problem: "credential" };
  if (u.search !== "" || u.hash !== "" || raw.includes("?") || raw.includes("#"))
    return { ok: false, problem: "query" };
  // the name as DNS sees it: lower case and punycode (both the URL parser's, which reads oci://
  // as https://), and no trailing dot, so `localhost.` is localhost (m1)
  const name = u.hostname.replace(/\.+$/, "");
  if (name === "") return { ok: false, problem: "unparseable" };
  const problem = hostProblem(name);
  if (problem !== null) return { ok: false, problem };
  const host = u.port === "" ? name : `${name}:${u.port}`;
  const p = u.pathname.replace(/\/+$/, "");
  return { ok: true, scheme, url: `${scheme}://${host}${p}`, host, path: p };
}
