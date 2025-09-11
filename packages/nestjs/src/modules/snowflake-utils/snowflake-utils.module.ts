import { HttpModule, HttpService } from "@nestjs/axios";
import { Module, Provider } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import snowflakeConfig from "src/modules/config-management/configs/snowflake.config";

import { SnowflakeService } from "./services/snowflake.service";
import { SnowflakeJwtService } from "./services/snowflake-jwt.service";
import { SNOWFLAKE_HTTP } from "./snowflake-http.provider";

@Module({
  imports: [
    ConfigModule.forFeature(snowflakeConfig),
    HttpModule.registerAsync({
      imports: [ConfigModule.forFeature(snowflakeConfig)],
      inject: [snowflakeConfig.KEY],
      useFactory: (config: ConfigType<typeof snowflakeConfig>) => {
        return {
          baseURL: config.endpoint,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "flicket-agent-platform/1.0.0", // get app_version from env var?
          },
        };
      },
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule.forFeature(snowflakeConfig)],
      inject: [snowflakeConfig.KEY],
      useFactory: (config: ConfigType<typeof snowflakeConfig>) => {
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
    SnowflakeService,
    SnowflakeJwtService,
    // Alias the Pre-Configured HTTP Service
    {
      provide: SNOWFLAKE_HTTP,
      inject: [HttpService, SnowflakeJwtService],
      useFactory: (
        httpService: HttpService,
        jwtService: SnowflakeJwtService,
      ) => {
        httpService.axiosRef.interceptors.request.use(
          (config) => {
            const token = jwtService.getJwt();
            if (token) {
              config.headers.Authorization = `Bearer ${token}`;
              config.headers["X-Snowflake-Authorization-Token-Type"] =
                "KEYPAIR_JWT";
            }
            return config;
          },
          (error) => {
            if (error instanceof Error) {
              return Promise.reject(error);
            } else {
              return Promise.reject(new Error(error));
            }
          },
        );
        return httpService;
      },
    },
  ],
  exports: [
    SnowflakeService,
    SnowflakeJwtService,
    // Export the Pre-Configured HTTP Service
    {
      provide: SNOWFLAKE_HTTP,
    } as Provider,
  ],
})
export class SnowflakeUtilsModule {}
