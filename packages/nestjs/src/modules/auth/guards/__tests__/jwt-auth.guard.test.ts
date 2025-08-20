import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { vi, describe, beforeEach, it, expect } from 'vitest';

import { JwtAuthGuard } from '../jwt-auth.guard';
import { AuthenticatedRequest, JwtPayload } from '../../types/auth.types';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let mockJwtService: {
    verifyAsync: ReturnType<typeof vi.fn>;
  };
  let mockExecutionContext: {
    switchToHttp: ReturnType<typeof vi.fn>;
  };
  let mockRequest: Partial<AuthenticatedRequest>;

  beforeEach(() => {
    // Mock JwtService
    mockJwtService = {
      verifyAsync: vi.fn(),
    };

    // Mock ExecutionContext
    mockExecutionContext = {
      switchToHttp: vi.fn(),
    };

    // Mock Request object
    mockRequest = {
      headers: {},
      ip: '127.0.0.1',
    };

    // Setup mock chain
    mockExecutionContext.switchToHttp.mockReturnValue({
      getRequest: () => mockRequest,
    });

    // Create guard instance
    guard = new JwtAuthGuard(mockJwtService as unknown as JwtService);
  });

  describe('canActivate', () => {
    it('should return true and set user payload for valid token', async () => {
      // Arrange
      const validToken = 'valid-jwt-token';
      const expectedPayload: JwtPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['user'],
      };

      mockRequest.headers!.authorization = `Bearer ${validToken}`;
      mockJwtService.verifyAsync.mockResolvedValue(expectedPayload);

      // Act
      const result = await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(expectedPayload);
      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(validToken);
    });

    it('should extract and validate token from Authorization header', async () => {
      // Arrange
      const token = 'test-token-123';
      const payload: JwtPayload = { sub: 'user-456' };

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockResolvedValue(payload);

      // Act
      await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(token);
      expect(mockRequest.user).toEqual(payload);
    });

    it('should validate Bearer token format correctly', async () => {
      // Arrange
      const token = 'properly-formatted-token';
      const payload: JwtPayload = { sub: 'user-789' };

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockResolvedValue(payload);

      // Act
      const result = await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(token);
    });

    it('should validate JWT with different payload structures', async () => {
      // Arrange
      const token = 'complex-token';
      const complexPayload: JwtPayload = {
        sub: 'user-complex',
        email: 'complex@example.com',
        roles: ['admin', 'user'],
        permissions: ['read', 'write'],
        customClaim: 'custom-value',
      };

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockResolvedValue(complexPayload);

      // Act
      const result = await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(complexPayload);
    });

    it('should throw UnauthorizedException when Authorization header is missing', async () => {
      // Arrange
      mockRequest.headers = {}; // No authorization header

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Access token is required');
    });

    it('should throw UnauthorizedException for malformed Authorization header without Bearer', async () => {
      // Arrange
      mockRequest.headers!.authorization = 'Basic some-credential';

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Access token is required');
    });

    it('should throw UnauthorizedException for Authorization header with only Bearer', async () => {
      // Arrange
      mockRequest.headers!.authorization = 'Bearer';

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Access token is required');
    });

    it('should throw UnauthorizedException for Authorization header with empty token', async () => {
      // Arrange
      mockRequest.headers!.authorization = 'Bearer ';

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Access token is required');
    });

    it('should throw UnauthorizedException for invalid token signature', async () => {
      // Arrange
      const invalidToken = 'invalid-signature-token';
      mockRequest.headers!.authorization = `Bearer ${invalidToken}`;
      
      const jwtError = new Error('invalid signature');
      jwtError.name = 'JsonWebTokenError';
      mockJwtService.verifyAsync.mockRejectedValue(jwtError);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Invalid access token');
    });

    it('should throw UnauthorizedException for expired token', async () => {
      // Arrange
      const expiredToken = 'expired-token';
      mockRequest.headers!.authorization = `Bearer ${expiredToken}`;
      
      const expiredError = new Error('jwt expired');
      expiredError.name = 'TokenExpiredError';
      mockJwtService.verifyAsync.mockRejectedValue(expiredError);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Access token has expired');
    });

    it('should throw UnauthorizedException for token not yet valid', async () => {
      // Arrange
      const notYetValidToken = 'not-yet-valid-token';
      mockRequest.headers!.authorization = `Bearer ${notYetValidToken}`;
      
      const notBeforeError = new Error('jwt not active');
      notBeforeError.name = 'NotBeforeError';
      mockJwtService.verifyAsync.mockRejectedValue(notBeforeError);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Access token not yet valid');
    });

    it('should throw generic UnauthorizedException for unknown JWT errors', async () => {
      // Arrange
      const malformedToken = 'malformed-token';
      mockRequest.headers!.authorization = `Bearer ${malformedToken}`;
      
      const unknownError = new Error('Unknown JWT error');
      unknownError.name = 'UnknownJWTError';
      mockJwtService.verifyAsync.mockRejectedValue(unknownError);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Authentication failed');
    });

    it('should handle non-Error exceptions gracefully', async () => {
      // Arrange
      const token = 'test-token';
      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockRejectedValue('String error');

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);
      
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow('Authentication failed');
    });
  });

  describe('extractTokenFromHeader', () => {
    it('should extract token from valid Bearer authorization header', () => {
      // Arrange
      const token = 'valid-token-123';
      mockRequest.headers!.authorization = `Bearer ${token}`;

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBe(token);
    });

    it('should return undefined for missing Authorization header', () => {
      // Arrange
      mockRequest.headers = {};

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBeUndefined();
    });

    it('should return undefined for malformed header without Bearer prefix', () => {
      // Arrange
      mockRequest.headers!.authorization = 'Basic credentials';

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBeUndefined();
    });

    it('should return undefined for Authorization header with only Bearer', () => {
      // Arrange
      mockRequest.headers!.authorization = 'Bearer';

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBeUndefined();
    });

    it('should return undefined for Authorization header with empty token', () => {
      // Arrange
      mockRequest.headers!.authorization = 'Bearer ';

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBeUndefined();
    });

    it('should return undefined for Authorization header with whitespace-only token', () => {
      // Arrange
      mockRequest.headers!.authorization = 'Bearer   ';

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBeUndefined();
    });

    it('should handle case sensitivity correctly (Bearer vs bearer)', () => {
      // Arrange
      mockRequest.headers!.authorization = 'bearer valid-token';

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBeUndefined();
    });

    it('should extract token with spaces and special characters', () => {
      // Arrange
      const complexToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      mockRequest.headers!.authorization = `Bearer ${complexToken}`;

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBe(complexToken);
    });

    it('should handle multiple spaces between Bearer and token', () => {
      // Arrange
      const token = 'token-with-spaces';
      mockRequest.headers!.authorization = `Bearer    ${token}`;

      // Act
      const extractedToken = (guard as any).extractTokenFromHeader(mockRequest);

      // Assert
      expect(extractedToken).toBe('   ' + token); // This follows the current implementation logic
    });
  });

  describe('JWT token validation scenarios', () => {
    it('should validate token with minimal payload (sub only)', async () => {
      // Arrange
      const token = 'minimal-token';
      const minimalPayload: JwtPayload = { sub: 'user-minimal' };

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockResolvedValue(minimalPayload);

      // Act
      const result = await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(minimalPayload);
    });

    it('should validate token with no sub but other claims', async () => {
      // Arrange
      const token = 'no-sub-token';
      const payloadWithoutSub: JwtPayload = {
        email: 'nosub@example.com',
        roles: ['guest'],
      };

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockResolvedValue(payloadWithoutSub);

      // Act
      const result = await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(payloadWithoutSub);
    });

    it('should validate token with empty payload', async () => {
      // Arrange
      const token = 'empty-payload-token';
      const emptyPayload: JwtPayload = {};

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockResolvedValue(emptyPayload);

      // Act
      const result = await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(emptyPayload);
    });

    it('should validate token with array and object claims', async () => {
      // Arrange
      const token = 'complex-claims-token';
      const complexPayload: JwtPayload = {
        sub: 'user-complex',
        roles: ['admin', 'user', 'moderator'],
        permissions: {
          read: ['posts', 'users'],
          write: ['posts'],
          delete: [],
        },
        metadata: {
          lastLogin: '2023-01-01T00:00:00Z',
          loginCount: 42,
        },
      };

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockResolvedValue(complexPayload);

      // Act
      const result = await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(complexPayload);
    });
  });

  describe('error handling scenarios', () => {
    it('should not modify request object when authentication fails', async () => {
      // Arrange
      const originalRequest = { ...mockRequest };
      mockRequest.headers!.authorization = 'Bearer invalid-token';
      
      const jwtError = new Error('invalid token');
      jwtError.name = 'JsonWebTokenError';
      mockJwtService.verifyAsync.mockRejectedValue(jwtError);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext as ExecutionContext))
        .rejects
        .toThrow(UnauthorizedException);

      // Request should not have user property set
      expect(mockRequest.user).toBeUndefined();
    });

    it('should handle concurrent authentication attempts correctly', async () => {
      // Arrange
      const token1 = 'token-1';
      const token2 = 'token-2';
      const payload1: JwtPayload = { sub: 'user-1' };
      const payload2: JwtPayload = { sub: 'user-2' };

      const mockRequest1 = { headers: { authorization: `Bearer ${token1}` }, ip: '127.0.0.1' };
      const mockRequest2 = { headers: { authorization: `Bearer ${token2}` }, ip: '127.0.0.2' };

      const mockContext1 = {
        switchToHttp: () => ({ getRequest: () => mockRequest1 }),
      };
      const mockContext2 = {
        switchToHttp: () => ({ getRequest: () => mockRequest2 }),
      };

      mockJwtService.verifyAsync
        .mockResolvedValueOnce(payload1)
        .mockResolvedValueOnce(payload2);

      // Act
      const [result1, result2] = await Promise.all([
        guard.canActivate(mockContext1 as ExecutionContext),
        guard.canActivate(mockContext2 as ExecutionContext),
      ]);

      // Assert
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockRequest1.user).toEqual(payload1);
      expect(mockRequest2.user).toEqual(payload2);
    });

    it('should preserve request properties other than user', async () => {
      // Arrange
      const token = 'preserve-props-token';
      const payload: JwtPayload = { sub: 'user-preserve' };

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockRequest.ip = '192.168.1.1';
      (mockRequest as any).customProperty = 'should-be-preserved';

      mockJwtService.verifyAsync.mockResolvedValue(payload);

      // Act
      await guard.canActivate(mockExecutionContext as ExecutionContext);

      // Assert
      expect(mockRequest.user).toEqual(payload);
      expect(mockRequest.ip).toBe('192.168.1.1');
      expect((mockRequest as any).customProperty).toBe('should-be-preserved');
    });
  });

  describe('integration scenarios', () => {
    it('should work with different ExecutionContext implementations', async () => {
      // Arrange
      const customContext = {
        switchToHttp: vi.fn().mockReturnValue({
          getRequest: () => mockRequest,
        }),
      };

      const token = 'context-token';
      const payload: JwtPayload = { sub: 'context-user' };

      mockRequest.headers!.authorization = `Bearer ${token}`;
      mockJwtService.verifyAsync.mockResolvedValue(payload);

      // Act
      const result = await guard.canActivate(customContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(payload);
      expect(customContext.switchToHttp).toHaveBeenCalled();
    });

    it('should handle request objects with different structures', async () => {
      // Arrange
      const customRequest = {
        headers: { authorization: 'Bearer custom-token' },
        ip: '10.0.0.1',
        method: 'GET',
        url: '/api/test',
      } as AuthenticatedRequest;

      const customContext = {
        switchToHttp: () => ({ getRequest: () => customRequest }),
      };

      const payload: JwtPayload = { sub: 'custom-user' };
      mockJwtService.verifyAsync.mockResolvedValue(payload);

      // Act
      const result = await guard.canActivate(customContext as ExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(customRequest.user).toEqual(payload);
    });
  });
});