import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = existsSync(path.join(directory, "server/index.mjs"))
  ? directory
  : path.join(directory, ".output");

// This entry is copied to .output/app.mjs by build:hostinger. Both the API and
// Nitro middleware share one HTTP server and Hostinger's assigned PORT.
export async function startCombinedServer({
  port = Number(process.env.PORT || 3000),
  hostname = process.env.HOST || "0.0.0.0",
  initialize,
  retryMs = 30_000,
} = {}) {
  process.env.NODE_ENV ||= "production";
  const frontendEntry = path.join(outputDirectory, "server/index.mjs");
  if (!existsSync(frontendEntry))
    throw new Error("Frontend build is missing. Run npm run build:hostinger first.");
  const [{ middleware }, { createBackendApp, initializeBackend }] = await Promise.all([
    import(pathToFileURL(frontendEntry).href),
    import("./backend/app.js"),
  ]);
  if (typeof middleware !== "function")
    throw new Error("Expected a Node middleware build. Run npm run build:hostinger.");

  let ready = false;
  let stopped = false;
  let retryTimer;
  let pendingInitialization;
  const app = createBackendApp({
    isReady: () => ready,
    frontend: middleware,
    publicDirectory: path.join(outputDirectory, "public"),
  });
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });
  const address = server.address();
  // SSR calls the API through this process, never through public DNS or a
  // second backend server. The browser still requests relative /api URLs.
  process.env.LGS_INTERNAL_API_ORIGIN = `http://127.0.0.1:${address.port}`;

  const connect = () =>
    (pendingInitialization = (async () => {
      try {
        await (initialize || initializeBackend)();
        if (!stopped) {
          ready = true;
          console.log("LGS database and customer authentication are ready.");
        }
      } catch (error) {
        if (stopped) return;
        console.error(
          "LGS database initialization failed; storefront remains available. Retrying shortly.",
          error,
        );
        retryTimer = setTimeout(() => void connect(), retryMs);
        retryTimer.unref();
      }
    })());
  const initialization = connect();
  console.log(`LGS frontend + API listening on port ${address.port}`);

  return {
    server,
    initialization,
    isReady: () => ready,
    async close() {
      stopped = true;
      ready = false;
      clearTimeout(retryTimer);
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pendingInitialization;
      const [{ sequelize }, { customerPool }] = await Promise.all([
        import("./backend/config/database.js"),
        import("./backend/config/customer-auth.js"),
      ]);
      await Promise.allSettled([sequelize.close(), customerPool.end()]);
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startCombinedServer()
    .then((running) => {
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        const timeout = setTimeout(() => process.exit(1), 15_000);
        timeout.unref();
        await running.close();
        clearTimeout(timeout);
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    })
    .catch((error) => {
      console.error("Failed to start the combined LGS app:", error);
      process.exitCode = 1;
    });
}
