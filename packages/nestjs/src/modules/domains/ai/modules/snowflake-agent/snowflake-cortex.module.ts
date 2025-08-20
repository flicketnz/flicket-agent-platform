import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "src/modules/auth";
import agentSnowflakeCortexConfig from "src/modules/config-management/configs/agent-snowflake-cortex.config";

import { SnowflakeCortexAgentAdapter } from "./adapters/snowflake-cortex.agent";
import { CortexController } from "./controllers";
import { SnowflakeJwtService } from "./services/snowflake-jwt.service";

@Module({
  imports: [
    ConfigModule.forFeature(agentSnowflakeCortexConfig),
    HttpModule.registerAsync({
      imports: [ConfigModule.forFeature(agentSnowflakeCortexConfig)],
      inject: [agentSnowflakeCortexConfig.KEY],
      useFactory: (config: ConfigType<typeof agentSnowflakeCortexConfig>) => {
        return {
          baseURL: config.endpoint,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "flicket-agent-platform/1.0.0", // get app_version from env var?
          },
        };
      },
    }),
    AuthModule,
    JwtModule.registerAsync({
      imports: [ConfigModule.forFeature(agentSnowflakeCortexConfig)],
      inject: [agentSnowflakeCortexConfig.KEY],
      useFactory: (config: ConfigType<typeof agentSnowflakeCortexConfig>) => {
        return {
          privateKey: config.privateKey,
          signOptions: {
            issuer: `${config.accountIdentifier}.${config.user}.SHA256:${config.publicKeyFingerprint}`,
            subject: `${config.accountIdentifier}.${config.user}`,
            expiresIn: "60m",
            algorithm: "RS256",
          },
        };
      },
    }),
  ],
  providers: [
    {
      provide: SnowflakeCortexAgentAdapter,
      inject: [agentSnowflakeCortexConfig.KEY, ModuleRef],
      useFactory: (
        config: ConfigType<typeof agentSnowflakeCortexConfig>,
        moduleRef: ModuleRef,
      ) => {
        if (!config.enabled) {
          return null;
        }
        return moduleRef.create<SnowflakeCortexAgentAdapter>(
          SnowflakeCortexAgentAdapter,
        );
      },
    },
    SnowflakeJwtService,
  ],
  exports: [SnowflakeCortexAgentAdapter, SnowflakeJwtService],
  // TODO: this controller is here until i move it to an proper entrypoint module
  controllers: [CortexController],
})
export class SnowflakeCortexModule {}
