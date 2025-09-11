import { Module, Provider } from "@nestjs/common";
import { ConfigModule, type ConfigType } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";

import jwtConfig from "../config-management/configs/jwt.config";
import { JwtAuthGuard } from "./guards";
import { AUTH_GUARD__JWT_SERVICE } from "./jwt.service";

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
  providers: [
    { provide: AUTH_GUARD__JWT_SERVICE, useExisting: JwtService },

    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard, { provide: AUTH_GUARD__JWT_SERVICE } as Provider],
})
export class AuthModule {}
