/**
 * ENGINE V4 VX - Pre-transpile the engine + lib TS to plain ESM for testing.
 * Produces *.vxtest.mjs siblings so tests can import them with Node directly.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = process.cwd();

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

export function transpileDir(relDir) {
  const dir = path.join(ROOT, relDir);
  const files = walk(dir);
  const written = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        esModuleInterop: true,
      },
      fileName: file,
    }).outputText;
    let patched = out.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, spec, b) => {
      let s = spec.replace(/\.tsx?$/, "");
      if (!s.endsWith(".vxtest.mjs")) {
        // Directory import (e.g. "../../lib/engine-v4-vx") must resolve to its
        // index module, matching Node/TS barrel resolution.
        const abs = path.resolve(path.dirname(file), s);
        if (fs.existsSync(path.join(abs, "index.ts"))) s += "/index";
        s += ".vxtest.mjs";
      }
      return a + s + b;
    });
    // Node ESM cannot resolve the extensionless bare specifier "next/server";
    // point it at the real "next/server.js" entry so handlers run without a
    // bundler (and without ever starting a development server).
    patched = patched.replace(/(from\s+["'])next\/server(["'])/g, "$1next/server.js$2");
    const tmp = file.replace(/\.ts$/, ".vxtest.mjs");
    fs.writeFileSync(tmp, patched, "utf8");
    written.push(tmp);
  }
  return written;
}

export function cleanupDir(relDir) {
  const dir = path.join(ROOT, relDir);
  for (const f of walk(dir)) {
    const tmp = f.replace(/\.ts$/, ".vxtest.mjs");
    try { fs.unlinkSync(tmp); } catch {}
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("transpile.mjs")) {
  const dirs = process.argv.slice(2);
  for (const d of dirs.length ? dirs : ["lib/engine-v4-vx", "lib"]) {
    const written = transpileDir(d);
    console.log(`transpiled ${written.length} file(s) in ${d}`);
  }
}
