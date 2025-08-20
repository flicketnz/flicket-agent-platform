// eslint-disable-next-line simple-import-sort/imports
import otelSDK from "./tracing";

import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "../app.module";

async function bootstrap() {
  otelSDK.start();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["debug", "verbose", "log", "warn"],
    rawBody: true,
  });

  app.useGlobalPipes(new ValidationPipe());

  // GET port from config
  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>("PORT");

  const server = await app.listen(port, "0.0.0.0");
  const serverDetails = server.address();

  if (serverDetails && typeof serverDetails !== "string") {
    console.log(
      `Listening on ${serverDetails.family} ${serverDetails.address}:${serverDetails.port}`,
    );
  }

  return app;
}

async function closeGracefully(signal: NodeJS.Signals) {
  console.log(`*^!@4=> Received signal to terminate: ${signal}`);

  try {
    const nestApp = await app;

    // Gracefully close the NestJS application
    await Promise.all([nestApp.close(), otelSDK.shutdown()]);

    console.log("Application closed gracefully");
    console.log("Tracing shutdown");
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);

    process.exit(1);
  }
}

process.on("SIGINT", closeGracefully as NodeJS.SignalsListener);
process.on("SIGTERM", closeGracefully as NodeJS.SignalsListener);

// Start the Application
const app = bootstrap();
