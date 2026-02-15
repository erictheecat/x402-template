import "dotenv/config";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting_down");
    await app.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await app.listen({
      host: "0.0.0.0",
      port: config.port,
    });
  } catch (error) {
    app.log.error({ err: error }, "startup_failed");
    process.exit(1);
  }
}

void main();
