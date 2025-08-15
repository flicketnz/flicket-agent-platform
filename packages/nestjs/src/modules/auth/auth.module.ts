import { Module } from "@nestjs/common";
import { ConfigModule, type ConfigType } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";

import jwtConfig from "../config-management/configs/jwt.config";
import { JwtAuthGuard } from "./guards";

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    JwtModule.registerAsync({
      imports: [ConfigModule.forFeature(jwtConfig)],
      inject: [jwtConfig.KEY],
      useFactory: (config: ConfigType<typeof jwtConfig>) => {
        return {
          secret: config.secret,
          signOptions: {
            expiresIn: config.expiration,
            issuer: config.issuer,
            audience: config.audience,
          },
        };
      },
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
