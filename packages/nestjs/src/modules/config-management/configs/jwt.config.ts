import { registerAs } from "@nestjs/config";

export default registerAs("jwt", () => {
  return {
    secret: process.env.JWT_SECRET,
    expiration: process.env.JWT_EXPIRATION || "24h",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
  };
});
