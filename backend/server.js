import { createBackendApp, initializeBackend } from "./app.js";

const port = Number(process.env.PORT || 5000);
initializeBackend()
  .then(() => {
    createBackendApp().listen(port, () => {
      console.log(`LGS backend listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start backend:", error);
    process.exitCode = 1;
  });
