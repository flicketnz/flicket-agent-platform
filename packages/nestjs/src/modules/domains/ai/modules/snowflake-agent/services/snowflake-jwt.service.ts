import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class SnowflakeJwtService {
  private readonly logger = new Logger(SnowflakeJwtService.name);

  private jwt: string | undefined;

  constructor(private readonly jwtService: JwtService) {}

  public getJwt() {
    this.logger.debug("Getting JWT");
    if (this.jwt && this.isValid(this.jwt)) {
      return this.jwt;
    }

    const jwt = this.jwtService.sign({});

    this.logger.debug("Produced signed jwt", jwt);

    this.jwt = jwt;
    return this.jwt;
  }

  private isValid(jwt: string) {
    try {
      const decoded = this.jwtService.decode<{ exp?: number }>(jwt);
      if (!decoded || !decoded.exp) {
        return false;
      }
      const now = Math.floor(Date.now() / 1000);
      return decoded.exp > now;
    } catch (error) {
      this.logger.error("Failed to decode JWT", error);
      return false;
    }
  }
}
