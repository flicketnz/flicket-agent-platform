import * as Joi from "joi";

export const jwtValidationSchema = Joi.object({
  JWT_SECRET: Joi.string()
    .required()
    .description("Secret key for JWT token signing"),
  JWT_EXPIRATION: Joi.string()
    .default("24h")
    .description("JWT token expiration time"),
  JWT_ISSUER: Joi.string().optional().description("JWT token issuer"),
  JWT_AUDIENCE: Joi.string().optional().description("JWT token audience"),
});
