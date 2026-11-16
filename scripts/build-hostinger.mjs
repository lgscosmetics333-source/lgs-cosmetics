import { spawn } from "node:child_process";
import { access, cp, copyFile, mkdir, writeFile } from "node:fs/promises";
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
// Product and Instagram images referenced by the restored November catalog.
// New uploads continue to live in UPLOAD_DIR, outside the deployment.
const legacyImages = [
  "1788339637744-14.png", "1788339637762-1.png", "1788339637774-2.png",
  "1788339637788-3.png", "1788339637808-4.png", "1788341205040-13.png",
  "1788341258918-12.png", "1788341676424-11.png", "1788341741932-10.png",
  "1788341792808-9.png", "1788341837596-8.png", "1788341870561-7.png",
  "1788342257853-6.png", "1788342320640-5.png", "1788342355117-4.png",
  "1788342387362-3.png", "1788342459319-2.png", "1788344476725-1.png",
  "instagram-98051fb8-87ab-44d6-b732-98a957216997.jpg",
];
await mkdir(path.join(output, "legacy-uploads"), { recursive: true });
for (const name of legacyImages) {
  await copyFile(path.join(root, "backend", "uploads", name), path.join(output, "legacy-uploads", name));
}
await copyFile(path.join(root, "hostinger.mjs"), path.join(output, "hostinger.mjs"));
await writeFile(path.join(output, "app.mjs"), `import { startCombinedServer } from "./hostinger.mjs";
startCombinedServer().then((running) => {
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 15000);
    timeout.unref();
    await running.close();
    clearTimeout(timeout);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}).catch((error) => {
  console.error("Failed to start the combined LGS app:", error);
  process.exitCode = 1;
});
`);
console.log("Hostinger single-app build ready: output .output, entry app.mjs");
