// Unit tests make no network call except loopback: this setup file makes any other socket
// connection throw, so a test that reaches outside fails loudly instead of passing quietly.

import net from "node:net";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class NonLoopbackConnection extends Error {}

function hostOf(args: unknown[]): string | undefined {
  const a = args[0];
  if (Array.isArray(a)) return hostOf(a);
  if (typeof a === "object" && a !== null) {
    const o = a as { host?: unknown; path?: unknown };
    if (typeof o.path === "string") return "localhost"; // a unix socket path
    return typeof o.host === "string" ? o.host : "localhost";
  }
  if (typeof a === "number" || (typeof a === "string" && /^\d+$/.test(a))) {
    return typeof args[1] === "string" ? args[1] : "localhost";
  }
  if (typeof a === "string") return "localhost"; // a unix socket path
  return undefined;
}

const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patched(this: net.Socket, ...args: unknown[]) {
  const host = hostOf(args);
  if (host === undefined || !LOOPBACK.has(host)) {
    throw new NonLoopbackConnection(`unit tests may connect to loopback only, not ${String(host)}`);
  }
  return (original as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
