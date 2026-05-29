import { bootstrap } from "./bootstrap";
import { logger } from "./logger";

bootstrap().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "Application failed to start");
  process.exit(1);
});
