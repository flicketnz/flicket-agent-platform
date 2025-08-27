import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CheckpointSplittingService } from '../checkpoint-splitting.service';
import { CheckpointSizeService } from '../checkpoint-size.service';
import { 
  CheckpointSplittingConfig, 
  SplittingStrategy,
  SplitCheckpointRecord,
  ReassemblyOptions 
} from '../../interfaces/checkpoint-splitting.interface';

describe('CheckpointSplittingService', () => {
  let service: CheckpointSplittingService;
  let sizeService: jest.Mocked<CheckpointSizeService>;
  let mockLogger: jest.Mocked<Logger>;
  let mockCheckpointsModel: any;

  const mockConfig: CheckpointSplittingConfig = {
    enabled: true,
    maxSizeThreshold: 10000, // Small threshold for testing
    strategy: SplittingStrategy.MESSAGE_LEVEL,
    maxChunkSize: 5000,
    enableSizeMonitoring: true,
    splitRecordPrefix: 'split',
    maxRetries: 3,
    operationTimeout: 30000
  };

  beforeEach(async () => {
    // Mock CheckpointSizeService
    const mockSizeService = {
      analyzeCheckpointSize: jest.fn(),
      canSplitCheckpoint: jest.fn(),
      calculateChecksum: jest.fn(),
    };

    // Mock DynamoDB model
    mockCheckpointsModel = {
      create: jest.fn(),
      get: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckpointSplittingService,
        {
          provide: CheckpointSizeService,
          useValue: mockSizeService,
        },
      ],
    }).compile();

    service = module.get<CheckpointSplittingService>(CheckpointSplittingService);
    sizeService = module.get<CheckpointSizeService>(CheckpointSizeService) as jest.Mocked<CheckpointSizeService>;
    
    // Mock the logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;
    
    (service as any).logger = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('splitCheckpointIfNeeded', () => {
    const threadId = 'test-thread';
    const recordId = 'checkpoint#test#123';
    const checkpoint = {
      id: '123',
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

    it('should not split when disabled', async () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      
      const result = await service.splitCheckpointIfNeeded(
        threadId,
        recordId,
        checkpoint,
        metadata,
        disabledConfig,
        mockCheckpointsModel
      );

      expect(result.wasSplit).toBe(false);
      expect(result.recordIds).toEqual([recordId]);
      expect(sizeService.analyzeCheckpointSize).not.toHaveBeenCalled();
    });

    it('should not split when under threshold', async () => {
      sizeService.analyzeCheckpointSize.mockReturnValue({
        totalSize: 5000,
        exceedsThreshold: false,
        sizeBreakdown: { checkpoint: 3000, metadata: 1000, overhead: 1000 },
        estimatedParts: 1,
        largestComponent: 'checkpoint'
      });

      const result = await service.splitCheckpointIfNeeded(
        threadId,
        recordId,
        checkpoint,
        metadata,
        mockConfig,
        mockCheckpointsModel
      );

      expect(result.wasSplit).toBe(false);
      expect(result.recordIds).toEqual([recordId]);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('within size limits')
      );
    });

    it('should not split when splitting is not possible', async () => {
      sizeService.analyzeCheckpointSize.mockReturnValue({
        totalSize: 15000,
        exceedsThreshold: true,
        sizeBreakdown: { checkpoint: 10000, metadata: 3000, overhead: 2000 },
        estimatedParts: 2,
        largestComponent: 'checkpoint'
      });

      sizeService.canSplitCheckpoint.mockReturnValue({
        canSplit: false,
        reason: 'No messages found'
      });

      const result = await service.splitCheckpointIfNeeded(
        threadId,
        recordId,
        checkpoint,
        metadata,
        mockConfig,
        mockCheckpointsModel
      );

      expect(result.wasSplit).toBe(false);
      expect(result.recordIds).toEqual([recordId]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot split checkpoint')
      );
    });

    it('should split checkpoint when necessary and possible', async () => {
      sizeService.analyzeCheckpointSize.mockReturnValue({
        totalSize: 15000,
        exceedsThreshold: true,
        sizeBreakdown: { checkpoint: 10000, metadata: 3000, overhead: 2000 },
        estimatedParts: 2,
        largestComponent: 'checkpoint'
      });

      sizeService.canSplitCheckpoint.mockReturnValue({
        canSplit: true
      });

      sizeService.calculateChecksum.mockReturnValue('mockchecksum123');

      mockCheckpointsModel.create.mockResolvedValue({});

      const result = await service.splitCheckpointIfNeeded(
        threadId,
        recordId,
        checkpoint,
        metadata,
        mockConfig,
        mockCheckpointsModel
      );

      expect(result.wasSplit).toBe(true);
      expect(result.recordIds.length).toBeGreaterThan(1);
      expect(mockCheckpointsModel.create).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Successfully split checkpoint')
      );
    });

    it('should handle storage errors with rollback', async () => {
      sizeService.analyzeCheckpointSize.mockReturnValue({
        totalSize: 15000,
        exceedsThreshold: true,
        sizeBreakdown: { checkpoint: 10000, metadata: 3000, overhead: 2000 },
        estimatedParts: 2,
        largestComponent: 'checkpoint'
      });

      sizeService.canSplitCheckpoint.mockReturnValue({
        canSplit: true
      });

      // Simulate storage failure
      mockCheckpointsModel.create.mockRejectedValue(new Error('Storage failed'));

      await expect(
        service.splitCheckpointIfNeeded(
          threadId,
          recordId,
          checkpoint,
          metadata,
          mockConfig,
          mockCheckpointsModel
        )
      ).rejects.toThrow('Checkpoint splitting failed');
    });
  });

  describe('reassembleCheckpoint', () => {
    const threadId = 'test-thread';
    const recordId = 'checkpoint#test#123';
    const options: ReassemblyOptions = {
      validateChecksums: true,
      timeout: 5000,
      enableLogging: true
    };

    it('should handle non-split records', async () => {
      mockCheckpointsModel.get.mockResolvedValue({
        threadId,
        recordId,
        checkpoint: JSON.stringify({ id: '123' }),
        metadata: JSON.stringify({ source: 'test' }),
        isSplit: false
      });

      const result = await service.reassembleCheckpoint(
        threadId,
        recordId,
        mockCheckpointsModel,
        options
      );

      expect(result.success).toBe(false);
      expect(result.warnings).toContain('Record is not split');
    });

    it('should successfully reassemble message-level split', async () => {
      const primaryRecord = {
        threadId,
        recordId,
        checkpoint: JSON.stringify({
          id: '123',
          channel_values: { messages: { messages: [] } }
        }),
        metadata: JSON.stringify({ source: 'test' }),
        isSplit: true,
        splitMetadata: {
          originalRecordId: recordId,
          totalParts: 2,
          partNumber: 0,
          strategy: SplittingStrategy.MESSAGE_LEVEL,
          splitTimestamp: '2023-01-01T00:00:00Z',
          originalSize: 1000,
          partSize: 500
        }
      };

      const splitPart = {
        threadId,
        recordId: 'split#checkpoint#test#123#part#0001',
        isSplit: true,
        splitMetadata: {
          originalRecordId: recordId,
          totalParts: 2,
          partNumber: 1,
          strategy: SplittingStrategy.MESSAGE_LEVEL,
          splitTimestamp: '2023-01-01T00:00:00Z',
          originalSize: 1000,
          partSize: 500,
          checksum: 'mockchecksum'
        },
        messageSplitData: {
          channelName: 'messages',
          startMessageIndex: 0,
          endMessageIndex: 1,
          messagesData: JSON.stringify([
            { content: 'Hello', type: 'human' },
            { content: 'Hi there', type: 'ai' }
          ]),
          checkpointMetadata: {
            totalMessages: 2,
            channelVersion: '1'
          }
        }
      };

      mockCheckpointsModel.get
        .mockResolvedValueOnce(primaryRecord)
        .mockResolvedValueOnce(splitPart);

      sizeService.calculateChecksum.mockReturnValue('mockchecksum');

      const result = await service.reassembleCheckpoint(
        threadId,
        recordId,
        mockCheckpointsModel,
        options
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.checkpoint.channel_values.messages.messages).toHaveLength(2);
      expect(result.partsReassembled).toBe(2);
    });

    it('should successfully reassemble content-level split', async () => {
      const part1 = {
        threadId,
        recordId,
        isSplit: true,
        splitMetadata: {
          originalRecordId: recordId,
          totalParts: 2,
          partNumber: 1,
          strategy: SplittingStrategy.CONTENT_LEVEL,
          splitTimestamp: '2023-01-01T00:00:00Z',
          originalSize: 1000,
          partSize: 500,
          checksum: 'checksum1'
        },
        contentSplitData: {
          chunkData: Buffer.from('{"checkpoint":{"id":"123"},"metadata":{"source":"te').toString('base64'),
          encoding: 'base64' as const
        }
      };

      const part2 = {
        threadId,
        recordId: 'split#checkpoint#test#123#part#0001',
        isSplit: true,
        splitMetadata: {
          originalRecordId: recordId,
          totalParts: 2,
          partNumber: 2,
          strategy: SplittingStrategy.CONTENT_LEVEL,
          splitTimestamp: '2023-01-01T00:00:00Z',
          originalSize: 1000,
          partSize: 500,
          checksum: 'checksum2'
        },
        contentSplitData: {
          chunkData: Buffer.from('st"}}').toString('base64'),
          encoding: 'base64' as const
        }
      };

      mockCheckpointsModel.get
        .mockResolvedValueOnce(part1)
        .mockResolvedValueOnce(part2);

      sizeService.calculateChecksum
        .mockReturnValueOnce('checksum1')
        .mockReturnValueOnce('checksum2');

      const result = await service.reassembleCheckpoint(
        threadId,
        recordId,
        mockCheckpointsModel,
        options
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.checkpoint.id).toBe('123');
      expect(result.data?.metadata.source).toBe('test');
    });

    it('should handle checksum validation failures', async () => {
      const primaryRecord = {
        threadId,
        recordId,
        checkpoint: JSON.stringify({ id: '123' }),
        metadata: JSON.stringify({ source: 'test' }),
        isSplit: true,
        splitMetadata: {
          originalRecordId: recordId,
          totalParts: 2,
          partNumber: 0,
          strategy: SplittingStrategy.MESSAGE_LEVEL,
          splitTimestamp: '2023-01-01T00:00:00Z',
          originalSize: 1000,
          partSize: 500
        }
      };

      const splitPart = {
        threadId,
        recordId: 'split#checkpoint#test#123#part#0001',
        isSplit: true,
        splitMetadata: {
          originalRecordId: recordId,
          totalParts: 2,
          partNumber: 1,
          strategy: SplittingStrategy.MESSAGE_LEVEL,
          splitTimestamp: '2023-01-01T00:00:00Z',
          originalSize: 1000,
          partSize: 500,
          checksum: 'expected-checksum'
        },
        messageSplitData: {
          channelName: 'messages',
          startMessageIndex: 0,
          endMessageIndex: 1,
          messagesData: JSON.stringify([{ content: 'Hello' }]),
          checkpointMetadata: { totalMessages: 1, channelVersion: '1' }
        }
      };

      mockCheckpointsModel.get
        .mockResolvedValueOnce(primaryRecord)
        .mockResolvedValueOnce(splitPart);

      sizeService.calculateChecksum.mockReturnValue('different-checksum');

      const result = await service.reassembleCheckpoint(
        threadId,
        recordId,
        mockCheckpointsModel,
        options
      );

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('Checksum mismatch');
    });

    it('should handle missing parts gracefully', async () => {
      const primaryRecord = {
        threadId,
        recordId,
        checkpoint: JSON.stringify({ id: '123' }),
        metadata: JSON.stringify({ source: 'test' }),
        isSplit: true,
        splitMetadata: {
          originalRecordId: recordId,
          totalParts: 3, // Expecting 3 parts
          partNumber: 0,
          strategy: SplittingStrategy.MESSAGE_LEVEL,
          splitTimestamp: '2023-01-01T00:00:00Z',
          originalSize: 1000,
          partSize: 500
        }
      };

      mockCheckpointsModel.get
        .mockResolvedValueOnce(primaryRecord)
        .mockResolvedValueOnce(null) // Missing part 1
        .mockResolvedValueOnce(null); // Missing part 2

      const result = await service.reassembleCheckpoint(
        threadId,
        recordId,
        mockCheckpointsModel,
        options
      );

      expect(result.warnings).toContain('Found 1/3 parts');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle malformed split metadata', async () => {
      const malformedRecord = {
        threadId: 'test-thread',
        recordId: 'checkpoint#test#123',
        isSplit: true,
        splitMetadata: null // Malformed metadata
      };

      mockCheckpointsModel.get.mockResolvedValue(malformedRecord);

      const options: ReassemblyOptions = {
        validateChecksums: false,
        timeout: 5000,
        enableLogging: false
      };

      const result = await service.reassembleCheckpoint(
        'test-thread',
        'checkpoint#test#123',
        mockCheckpointsModel,
        options
      );

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('failed');
    });

    it('should handle timeout during reassembly', async () => {
      const primaryRecord = {
        threadId: 'test-thread',
        recordId: 'checkpoint#test#123',
        isSplit: true,
        splitMetadata: {
          originalRecordId: 'checkpoint#test#123',
          totalParts: 2,
          partNumber: 0,
          strategy: SplittingStrategy.MESSAGE_LEVEL,
          splitTimestamp: '2023-01-01T00:00:00Z',
          originalSize: 1000,
          partSize: 500
        }
      };

      mockCheckpointsModel.get
        .mockResolvedValueOnce(primaryRecord)
        .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10000))); // Long delay

      const options: ReassemblyOptions = {
        validateChecksums: false,
        timeout: 100, // Very short timeout
        enableLogging: false
      };

      const result = await service.reassembleCheckpoint(
        'test-thread',
        'checkpoint#test#123',
        mockCheckpointsModel,
        options
      );

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('Timeout');
    });
  });
});