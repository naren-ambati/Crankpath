// A module-resolution hook for child processes in tests: lets plain `node` (with its built-in
// type stripping) import crankpath's TypeScript sources, whose imports name `.js` files.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(specifier: string, context: object) => Promise<unknown>} next
 */
export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".js") && (specifier.startsWith(".") || specifier.startsWith("file:")) && context.parentURL) {
    const url = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    if (fs.existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
}
