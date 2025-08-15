# JWT Auth Module

This module provides JWT authentication functionality for the application.

## Features

- JWT token validation using configurable secret, issuer, and audience
- Comprehensive error handling with specific error messages
- Security logging for authentication events
- TypeScript support with proper type definitions
- Integration with existing config management module

## Usage

### Import the Auth Module

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth';

@Module({
  imports: [AuthModule],
  // ... other module configuration
})
export class YourModule {}
```

### Use the JWT Auth Guard

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './modules/auth';

@Controller('protected')
@UseGuards(JwtAuthGuard)
export class ProtectedController {
  @Get()
  getProtectedResource() {
    return { message: 'This is a protected resource' };
  }
}
```

### Access User Information

```typescript
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from './modules/auth';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  @Get('profile')
  getProfile(@Request() req: AuthenticatedRequest) {
    return { user: req.user };
  }
}
```

## Configuration

The guard uses the JWT configuration from the config management module:

```env
JWT_SECRET=your-secret-key
JWT_EXPIRATION=24h
JWT_ISSUER=your-issuer
JWT_AUDIENCE=your-audience
```

## Token Format

Tokens should be sent in the Authorization header using the Bearer format:

```
Authorization: Bearer <your-jwt-token>
```

## Error Responses

The guard provides specific error messages for different scenarios:

- `Access token is required` - When no token is provided
- `Access token has expired` - When the token is expired
- `Invalid access token` - When the token is malformed or has invalid signature
- `Access token not yet valid` - When the token's `nbf` claim is in the future
- `Authentication failed` - Generic authentication error

## Security Features

- Comprehensive logging of authentication events
- IP address tracking for security auditing
- Proper error handling without exposing sensitive information
- Support for issuer and audience validation when configured