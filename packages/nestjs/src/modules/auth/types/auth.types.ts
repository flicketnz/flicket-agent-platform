import { Request } from "express";

export type AuthenticatedRequest<T extends Request = Request> = T & {
  user?: JwtPayload;
};

export interface JwtConfig {
  secret: string;
  expiration: string;
  issuer?: string;
  audience?: string;
}

export interface JwtVerifyOptions {
  secret: string;
  issuer?: string;
  audience?: string;
}

export interface JwtPayload {
  sub?: string;
  [key: string]: any;
}
