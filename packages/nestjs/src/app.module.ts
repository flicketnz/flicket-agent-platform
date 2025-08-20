import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { OpenTelemetryModule } from "nestjs-otel";

import { ConfigManagementModule } from "./modules/config-management";
import { DomainsModule } from "./modules/domains/domains.module";
import { EntrypointsModule } from "./modules/entrypoints/entrypoints.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ConfigManagementModule,
    HealthModule,
    CqrsModule.forRoot(),
    DomainsModule,
    EntrypointsModule,
    OpenTelemetryModule.forRoot(),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
