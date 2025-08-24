import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { AuthenticatedRequest, JwtPayload } from "../types/auth.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      this.logger.warn(
        `Authentication failed: No token provided from ${request.ip}`,
      );
      throw new UnauthorizedException("Access token is required");
    }

    try {
      // ensure we have unit test that validates that our jwt are signed correctly (as well as all the other traditional JWT security benefits are applied and followed)
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      // Attach the payload to the request object for downstream use
      request.user = payload;

      this.logger.debug(
        `Authentication successful for user: ${payload.sub || "unknown"}`,
      );
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.warn(
        `Authentication failed: ${errorMessage} from ${request.ip}`,
        errorStack,
      );

      // Provide more specific error messages based on error type
      if (error instanceof Error) {
        if (error.name === "TokenExpiredError") {
          throw new UnauthorizedException("Access token has expired");
        } else if (error.name === "JsonWebTokenError") {
          throw new UnauthorizedException("Invalid access token");
        } else if (error.name === "NotBeforeError") {
          throw new UnauthorizedException("Access token not yet valid");
        }
      }

      throw new UnauthorizedException("Authentication failed");
    }
  }

  private extractTokenFromHeader(
    request: AuthenticatedRequest,
  ): string | undefined {
    const authorization = request.headers.authorization;

    if (!authorization) {
      return undefined;
    }

    // Check if the authorization header follows the Bearer token format
    const [type, ...rest] = authorization.split(" ") ?? [];

    // grab the lsat segment - which will be the token
    const token = rest[rest.length - 1];

    if (type !== "Bearer") {
      this.logger.warn(
        `Invalid authorization header format from ${request.ip}: Expected 'Bearer <token>', got '${type}'`,
      );
      return undefined;
    }

    if (!token || token.trim() === "") {
      this.logger.warn(
        `Empty token in authorization header from ${request.ip}`,
      );
      return undefined;
    }

    return token;
  }
}
