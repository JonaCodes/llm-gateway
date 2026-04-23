import Fastify from "fastify";

import type { AdapterRegistry } from "../core/adapters.js";
import type { RuntimeConfig } from "../config/runtime.js";
import type { AdapterAlias, ResolvedAdapterConfig } from "../core/types.js";
import { registerRoutes } from "./routes.js";

interface CreateServerOptions {
  readonly runtimeConfig: RuntimeConfig;
  readonly adapterConfigs: Record<AdapterAlias, ResolvedAdapterConfig>;
  readonly adapterRegistry: AdapterRegistry;
}

export async function createServer(options: CreateServerOptions) {
  const server = Fastify({
    logger: {
      level: "info"
    },
    disableRequestLogging: true
  });

  server.addHook("onClose", async () => {
    await options.adapterRegistry.close();
  });

  await registerRoutes(server, {
    runtimeConfig: options.runtimeConfig,
    adapterConfigs: options.adapterConfigs,
    adapterRegistry: options.adapterRegistry
  });

  return server;
}
