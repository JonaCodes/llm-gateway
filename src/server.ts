import { cwd } from "node:process";

import { loadAdapterConfigs } from "./config/adapters.js";
import { loadRuntimeConfig, parseStartupOptions } from "./config/runtime.js";
import { buildAdapterRegistry, assertStartupHealth } from "./core/adapters.js";
import { createServer } from "./http/server.js";

async function main(): Promise<void> {
  const projectRoot = cwd();
  const startupOptions = parseStartupOptions(process.argv.slice(2));
  const runtimeConfig = loadRuntimeConfig(process.env, startupOptions);
  const adapterConfigs = loadAdapterConfigs(projectRoot);
  const adapterRegistry = buildAdapterRegistry(adapterConfigs, runtimeConfig.skipAliases);

  await assertStartupHealth(adapterRegistry);

  const server = await createServer({
    runtimeConfig,
    adapterConfigs,
    adapterRegistry
  });

  await server.listen({
    host: runtimeConfig.host,
    port: runtimeConfig.port
  });

  server.log.info(
    {
      host: runtimeConfig.host,
      port: runtimeConfig.port,
      requestTimeoutMs: runtimeConfig.requestTimeoutMs,
      skipAliases: runtimeConfig.skipAliases
    },
    "local-llms listening"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
