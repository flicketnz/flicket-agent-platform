import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CheckpointSizeService } from '../checkpoint-size.service';
import { 
  CheckpointSplittingConfig, 
  SplittingStrategy 
} from '../../interfaces/checkpoint-splitting.interface';

describe('CheckpointSizeService', () => {
  let service: CheckpointSizeService;
  let mockLogger: jest.Mocked<Logger>;

  const mockConfig: CheckpointSplittingConfig = {
    enabled: true,
    maxSizeThreshold: 358400,
    strategy: SplittingStrategy.MESSAGE_LEVEL,
    maxChunkSize: 307200,
    enableSizeMonitoring: true,
    splitRecordPrefix: 'split',
    maxRetries: 3,
    operationTimeout: 30000
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CheckpointSizeService],
    }).compile();

    service = module.get<CheckpointSizeService>(CheckpointSizeService);
    
    // Mock the logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;
    
    // Replace the logger instance
    (service as any).logger = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeCheckpointSize', () => {
    it('should correctly analyze a small checkpoint', () => {
      const checkpoint = {
        id: 'test-checkpoint',
        channel_values: {
          messages: {
            messages: [
              { content: 'Hello', type: 'human' },
              { content: 'Hi there', type: 'ai' }
            ]
          }
        },
        channel_versions: { messages: '1' },
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };
      
      const metadata = { source: 'test' };

      const result = service.analyzeCheckpointSize(checkpoint, metadata, mockConfig);

      expect(result.exceedsThreshold).toBe(false);
      expect(result.totalSize).toBeGreaterThan(0);
      expect(result.estimatedParts).toBe(1);
      expect(result.largestComponent).toBeDefined();
      expect(result.largestChannel).toBeDefined();
      expect(result.largestChannel?.name).toBe('messages');
      expect(result.largestChannel?.messageCount).toBe(2);
    });

    it('should identify checkpoint that exceeds threshold', () => {
      // Create a large checkpoint
      const largeMessages = Array.from({ length: 1000 }, (_, i) => ({
        content: `This is a very long message with lots of content to make it exceed the size threshold. Message number ${i}. `.repeat(50),
        type: i % 2 === 0 ? 'human' : 'ai'
      }));

      const checkpoint = {
        id: 'large-checkpoint',
        channel_values: {
          messages: { messages: largeMessages }
        },
        channel_versions: { messages: '1' },
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };
      
      const metadata = { source: 'test' };

      const result = service.analyzeCheckpointSize(checkpoint, metadata, mockConfig);

      expect(result.exceedsThreshold).toBe(true);
      expect(result.estimatedParts).toBeGreaterThan(1);
      expect(result.largestChannel?.messageCount).toBe(1000);
    });

    it('should handle checkpoint without messages', () => {
      const checkpoint = {
        id: 'no-messages',
        channel_values: {
          state: { value: 'some state' }
        },
        channel_versions: { state: '1' },
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };
      
      const metadata = { source: 'test' };

      const result = service.analyzeCheckpointSize(checkpoint, metadata, mockConfig);

      expect(result.exceedsThreshold).toBe(false);
      expect(result.largestChannel).toBeUndefined();
    });

    it('should log size analysis when monitoring is enabled', () => {
      const checkpoint = {
        id: 'test-checkpoint',
        channel_values: {},
        channel_versions: {},
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };
      
      const metadata = { source: 'test' };

      service.analyzeCheckpointSize(checkpoint, metadata, mockConfig);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Size analysis completed'),
        expect.any(Object)
      );
    });

    it('should handle serialization errors gracefully', () => {
      const circularRef: any = { id: 'circular' };
      circularRef.self = circularRef;
      
      const checkpoint = {
        id: 'circular-checkpoint',
        channel_values: { circular: circularRef },
        channel_versions: {},
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };
      
      const metadata = { source: 'test' };

      expect(() => {
        service.analyzeCheckpointSize(checkpoint, metadata, mockConfig);
      }).toThrow();
    });
  });

  describe('canSplitCheckpoint', () => {
    it('should allow message-level splitting for checkpoint with messages', () => {
      const checkpoint = {
        id: 'test',
        channel_values: {
          messages: {
            messages: [
              { content: 'Hello', type: 'human' }
            ]
          }
        },
        channel_versions: {},
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };

      const result = service.canSplitCheckpoint(checkpoint, SplittingStrategy.MESSAGE_LEVEL);

      expect(result.canSplit).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject message-level splitting for checkpoint without messages', () => {
      const checkpoint = {
        id: 'test',
        channel_values: {
          state: { value: 'some state' }
        },
        channel_versions: {},
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };

      const result = service.canSplitCheckpoint(checkpoint, SplittingStrategy.MESSAGE_LEVEL);

      expect(result.canSplit).toBe(false);
      expect(result.reason).toBe('No messages found to split');
    });

    it('should always allow content-level splitting', () => {
      const checkpoint = {
        id: 'test',
        channel_values: {},
        channel_versions: {},
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };

      const result = service.canSplitCheckpoint(checkpoint, SplittingStrategy.CONTENT_LEVEL);

      expect(result.canSplit).toBe(true);
    });

    it('should reject non-serializable messages', () => {
      const nonSerializableMessage = {
        content: 'Hello',
        func: function() { return 'test'; }
      };
      
      const checkpoint = {
        id: 'test',
        channel_values: {
          messages: {
            messages: [nonSerializableMessage]
          }
        },
        channel_versions: {},
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };

      const result = service.canSplitCheckpoint(checkpoint, SplittingStrategy.MESSAGE_LEVEL);

      expect(result.canSplit).toBe(false);
      expect(result.reason).toContain('not serializable');
    });
  });

  describe('calculateChecksum', () => {
    it('should generate consistent checksums for same data', () => {
      const data = 'test data';
      
      const checksum1 = service.calculateChecksum(data);
      const checksum2 = service.calculateChecksum(data);
      
      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(16);
    });

    it('should generate different checksums for different data', () => {
      const data1 = 'test data 1';
      const data2 = 'test data 2';
      
      const checksum1 = service.calculateChecksum(data1);
      const checksum2 = service.calculateChecksum(data2);
      
      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('estimateSizeReduction', () => {
    it('should calculate size reduction correctly', () => {
      const originalSize = 1000000; // 1MB
      const parts = 4;
      
      const result = service.estimateSizeReduction(
        originalSize, 
        SplittingStrategy.MESSAGE_LEVEL, 
        parts
      );
      
      expect(result.reducedSize).toBe(250000); // 1MB / 4
      expect(result.overheadIncrease).toBeGreaterThan(0);
      expect(result.netReduction).toBeLessThan(originalSize);
    });

    it('should account for overhead increase with more parts', () => {
      const originalSize = 1000000;
      
      const result2Parts = service.estimateSizeReduction(originalSize, SplittingStrategy.MESSAGE_LEVEL, 2);
      const result10Parts = service.estimateSizeReduction(originalSize, SplittingStrategy.MESSAGE_LEVEL, 10);
      
      expect(result10Parts.overheadIncrease).toBeGreaterThan(result2Parts.overheadIncrease);
    });
  });
});