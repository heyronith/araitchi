/**
 * Preload for `tsx --import ./scripts/register-server-only.mjs …`
 * so `import "server-only"` is a no-op outside Next.js.
 */
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stub = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "stubs",
  "server-only.js",
);

const original = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(
  request,
  parent,
  isMain,
  options,
) {
  if (request === "server-only") return stub;
  return original.call(this, request, parent, isMain, options);
};
