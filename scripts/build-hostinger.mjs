import { spawn } from "node:child_process";
import { access, cp, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".output");
await access(path.join(root, "backend/node_modules/express/package.json"));
const child = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, DEPLOY_TARGET: "hostinger" },
});
await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`Frontend build failed (${code}).`)),
  );
});

// Publish a self-contained app. Never copy developer .env files, database
// exports or uploads into a release artifact.
for (const entry of [
  "app.js",
  "package.json",
  "config",
  "controllers",
  "middleware",
  "models",
  "routes",
  "services",
  "node_modules",
]) {
  await cp(path.join(root, "backend", entry), path.join(output, "backend", entry), {
    recursive: true,
    dereference: true,
    filter: (source) =>
      !path.basename(source).startsWith(".env") && path.basename(source) !== ".npmrc",
  });
}
await copyFile(path.join(root, "hostinger.mjs"), path.join(output, "app.mjs"));
console.log("Hostinger single-app build ready: output .output, entry app.mjs");
