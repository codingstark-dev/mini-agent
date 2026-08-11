import { chmod, rm } from "node:fs/promises";

import { build } from "esbuild";

const inkDevtoolsStub = {
  name: "ink-devtools-stub",
  setup(builder) {
    builder.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "ink-devtools-stub",
    }));
    builder.onLoad({ filter: /.*/, namespace: "ink-devtools-stub" }, () => ({
      contents: "export default {initialize() {}, connectToDevTools() {}};",
      loader: "js",
    }));
  },
};

const liteUi = {
  name: "lite-ui-stub",
  setup(builder) {
    builder.onResolve({ filter: /\/ui\/start\.js$/ }, () => ({
      path: "start",
      namespace: "lite-ui-stub",
    }));
    builder.onLoad({ filter: /.*/, namespace: "lite-ui-stub" }, () => ({
      contents: 'export async function startInteractive(){throw new Error("Interactive mode is not included in the lite build")}',
      loader: "js",
    }));
  },
};

const shared = {
  banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" },
  bundle: true,
  charset: "utf8",
  format: "esm",
  jsx: "automatic",
  legalComments: "none",
  minify: true,
  platform: "node",
  plugins: [inkDevtoolsStub],
  sourcemap: false,
  target: "node20",
};

await rm("dist", { recursive: true, force: true });

await build({
  ...shared,
  entryPoints: { cli: "src/cli.ts" },
  outdir: "dist",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  outExtension: { ".js": ".mjs" },
  define: { __MINI_AGENT_LITE__: "false", "process.env.DEV": '"false"' },
});

await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/lite.mjs",
  splitting: false,
  plugins: [liteUi],
  define: { __MINI_AGENT_LITE__: "true", "process.env.DEV": '"false"' },
});

await Promise.all([chmod("dist/cli.mjs", 0o755), chmod("dist/lite.mjs", 0o755)]);
