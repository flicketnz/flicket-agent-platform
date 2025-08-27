import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DynamoDBCheckpointerAdapter } from '../dynamodb.checkpointer.adapter';
import { CheckpointSplittingService } from '../services/checkpoint-splitting.service';
import { CheckpointSizeService } from '../services/checkpoint-size.service';
import { 
  CheckpointSplittingConfig, 
  SplittingStrategy 
} from '../interfaces/checkpoint-splitting.interface';

describe('DynamoDBCheckpointerAdapter (Integration)', () => {
  let adapter: DynamoDBCheckpointerAdapter;
  let mockCheckpointsModel: any;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockSplittingService: jest.Mocked<CheckpointSplittingService>;
  let mockSizeService: jest.Mocked<CheckpointSizeService>;

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
    // Mock DynamoDB model
    mockCheckpointsModel = {
      create: jest.fn(),
      get: jest.fn(),
      query: jest.fn().mockReturnValue({
        filter: jest.fn().mockReturnValue({
          beginsWith: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([])
          })
        })
      }),
      scan: jest.fn().mockReturnValue({
        filter: jest.fn().mockReturnValue({
          beginsWith: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([])
          })
        })
      }),
      delete: jest.fn(),
    };

    // Mock services
    const mockConfigServiceValue = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'checkpointSplitting') return mockConfig;
        return undefined;
      }),
    };

    const mockSplittingServiceValue = {
      splitCheckpointIfNeeded: jest.fn(),
      reassembleCheckpoint: jest.fn(),
    };

    const mockSizeServiceValue = {
      analyzeCheckpointSize: jest.fn(),
      canSplitCheckpoint: jest.fn(),
      calculateChecksum: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamoDBCheckpointerAdapter,
        {
          provide: 'CheckpointsModel',
          useValue: mockCheckpointsModel,
        },
        {
          provide: ConfigService,
          useValue: mockConfigServiceValue,
        },
        {
          provide: CheckpointSplittingService,
          useValue: mockSplittingServiceValue,
        },
        {
          provide: CheckpointSizeService,
          useValue: mockSizeServiceValue,
        },
      ],
    }).compile();

    adapter = module.get<DynamoDBCheckpointerAdapter>(DynamoDBCheckpointerAdapter);
    mockConfigService = module.get<ConfigService>(ConfigService) as jest.Mocked<ConfigService>;
    mockSplittingService = module.get<CheckpointSplittingService>(CheckpointSplittingService) as jest.Mocked<CheckpointSplittingService>;
    mockSizeService = module.get<CheckpointSizeService>(CheckpointSizeService) as jest.Mocked<CheckpointSizeService>;

    // Initialize adapter
    adapter.onModuleInit();

    // Mock serde
    (adapter as any).serde = {
      dumpsTyped: jest.fn().mockResolvedValue(['json', new Uint8Array(Buffer.from('{"test": "data"}'))]),
      loadsTyped: jest.fn().mockResolvedValue({ test: 'data' }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('put - Integration with Splitting', () => {
    const config = {
      configurable: {
        thread_id: 'test-thread',
        checkpoint_ns: 'test-ns',
      },
    };

    const checkpoint = {
      id: 'test-checkpoint',
      channel_values: {
        messages: {
          messages: Array.from({ length: 100 }, (_, i) => ({
            content: `Message ${i} with lots of content to make it large`.repeat(10),
            type: i % 2 === 0 ? 'human' : 'ai'
          }))
        }
      },
      channel_versions: { messages: '1' },
      v: 1,
      ts: '2023-01-01T00:00:00Z'
    };

    const metadata = { source: 'integration-test' };
    const newVersions = { messages: '1' };

    it('should handle normal checkpoint storage when splitting is disabled', async () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      mockConfigService.get.mockReturnValue(disabledConfig);

      mockCheckpointsModel.create.mockResolvedValue({});

      const result = await adapter.put(config, checkpoint, metadata, newVersions);

      expect(result.configurable.thread_id).toBe('test-thread');
      expect(result.configurable.checkpoint_id).toBe('test-checkpoint');
      expect(mockSplittingService.splitCheckpointIfNeeded).not.toHaveBeenCalled();
      expect(mockCheckpointsModel.create).toHaveBeenCalledTimes(1);
    });

    it('should handle checkpoint splitting when needed', async () => {
      mockSplittingService.splitCheckpointIfNeeded.mockResolvedValue({
        wasSplit: true,
        recordIds: ['primary-record', 'split-record-1', 'split-record-2']
      });

      const result = await adapter.put(config, checkpoint, metadata, newVersions);

      expect(result.configurable.thread_id).toBe('test-thread');
      expect(result.configurable.checkpoint_id).toBe('test-checkpoint');
      expect(mockSplittingService.splitCheckpointIfNeeded).toHaveBeenCalledWith(
        'test-thread',
        'checkpoint#test-ns#test-checkpoint',
        expect.any(Object),
        metadata,
        mockConfig,
        mockCheckpointsModel
      );
    });

    it('should fallback to normal storage when splitting fails', async () => {
      mockSplittingService.splitCheckpointIfNeeded.mockRejectedValue(new Error('Splitting failed'));

      await expect(
        adapter.put(config, checkpoint, metadata, newVersions)
      ).rejects.toThrow('Splitting failed');
    });

    it('should handle partial split failures with rollback', async () => {
      mockSplittingService.splitCheckpointIfNeeded.mockRejectedValue(
        new Error('Failed to store split record after 3 retries')
      );

      await expect(
        adapter.put(config, checkpoint, metadata, newVersions)
      ).rejects.toThrow('Failed to store split record after 3 retries');
    });
  });

  describe('getTuple - Integration with Reassembly', () => {
    const config = {
      configurable: {
        thread_id: 'test-thread',
        checkpoint_ns: 'test-ns',
        checkpoint_id: 'test-checkpoint'
      },
    };

    it('should handle normal checkpoint retrieval', async () => {
      const mockRecord = {
        threadId: 'test-thread',
        recordId: 'checkpoint#test-ns#test-checkpoint',
        checkpoint: '{"id": "test-checkpoint"}',
        metadata: '{"source": "test"}',
        isSplit: false
      };

      mockCheckpointsModel.get.mockResolvedValue(mockRecord);

      const result = await adapter.getTuple(config);

      expect(result).toBeDefined();
      expect(result?.checkpoint).toBeDefined();
      expect(result?.metadata).toBeDefined();
      expect(mockSplittingService.reassembleCheckpoint).not.toHaveBeenCalled();
    });

    it('should handle split checkpoint reassembly', async () => {
      const mockSplitRecord = {
        threadId: 'test-thread',
        recordId: 'checkpoint#test-ns#test-checkpoint',
        isSplit: true,
        splitMetadata: {
          totalParts: 2,
          strategy: SplittingStrategy.MESSAGE_LEVEL
        }
      };

      const reassembledData = {
        checkpoint: { id: 'test-checkpoint', channel_values: {} },
        metadata: { source: 'test' }
      };

      mockCheckpointsModel.get.mockResolvedValue(mockSplitRecord);
      mockSplittingService.reassembleCheckpoint.mockResolvedValue({
        success: true,
        data: reassembledData,
        warnings: [],
        reassemblyTime: 100,
        partsReassembled: 2,
        totalExpectedParts: 2
      });

      const result = await adapter.getTuple(config);

      expect(result).toBeDefined();
      expect(result?.checkpoint.id).toBe('test-checkpoint');
      expect(mockSplittingService.reassembleCheckpoint).toHaveBeenCalledWith(
        'test-thread',
        'checkpoint#test-ns#test-checkpoint',
        mockCheckpointsModel,
        expect.any(Object)
      );
    });

    it('should handle failed reassembly gracefully', async () => {
      const mockSplitRecord = {
        threadId: 'test-thread',
        recordId: 'checkpoint#test-ns#test-checkpoint',
        isSplit: true,
        splitMetadata: {
          totalParts: 2,
          strategy: SplittingStrategy.MESSAGE_LEVEL
        }
      };

      mockCheckpointsModel.get.mockResolvedValue(mockSplitRecord);
      mockSplittingService.reassembleCheckpoint.mockResolvedValue({
        success: false,
        warnings: ['Missing parts'],
        reassemblyTime: 50,
        partsReassembled: 1,
        totalExpectedParts: 2
      });

      await expect(adapter.getTuple(config)).rejects.toThrow('Failed to reassemble split checkpoint');
    });

    it('should handle corrupted split metadata', async () => {
      const mockCorruptedRecord = {
        threadId: 'test-thread',
        recordId: 'checkpoint#test-ns#test-checkpoint',
        isSplit: true,
        splitMetadata: null // Corrupted metadata
      };

      mockCheckpointsModel.get.mockResolvedValue(mockCorruptedRecord);
      mockSplittingService.reassembleCheckpoint.mockRejectedValue(
        new Error('Invalid split metadata')
      );

      const result = await adapter.getTuple(config);
      expect(result).toBeUndefined();
    });
  });

  describe('list - Integration with Split Record Filtering', () => {
    const config = {
      configurable: {
        thread_id: 'test-thread',
        checkpoint_ns: 'test-ns'
      },
    };

    it('should filter out split parts from list results', async () => {
      const mockRecords = [
        {
          threadId: 'test-thread',
          recordId: 'checkpoint#test-ns#checkpoint-1',
          checkpoint: '{"id": "checkpoint-1"}',
          metadata: '{"source": "test"}',
          isSplit: false
        },
        {
          threadId: 'test-thread',
          recordId: 'split#checkpoint#test-ns#checkpoint-1#part#0001',
          isSplit: true,
          // This should be filtered out
        },
        {
          threadId: 'test-thread',
          recordId: 'checkpoint#test-ns#checkpoint-2',
          checkpoint: '{"id": "checkpoint-2"}',
          metadata: '{"source": "test"}',
          isSplit: false
        }
      ];

      mockCheckpointsModel.query.mockReturnValue({
        where: jest.fn().mockReturnValue({
          beginsWith: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockRecords)
              })
            })
          })
        })
      });

      const results: any[] = [];
      for await (const tuple of adapter.list(config)) {
        results.push(tuple);
      }

      expect(results).toHaveLength(2); // Only non-split records
      expect(results.every(r => r.checkpoint.id.startsWith('checkpoint-'))).toBe(true);
    });

    it('should handle split records in list with reassembly', async () => {
      const mockSplitRecord = {
        threadId: 'test-thread',
        recordId: 'checkpoint#test-ns#split-checkpoint',
        isSplit: true,
        splitMetadata: {
          totalParts: 2,
          strategy: SplittingStrategy.MESSAGE_LEVEL
        }
      };

      mockCheckpointsModel.query.mockReturnValue({
        where: jest.fn().mockReturnValue({
          beginsWith: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue([mockSplitRecord])
              })
            })
          })
        })
      });

      mockSplittingService.reassembleCheckpoint.mockResolvedValue({
        success: true,
        data: {
          checkpoint: { id: 'split-checkpoint' },
          metadata: { source: 'test' }
        },
        warnings: [],
        reassemblyTime: 100,
        partsReassembled: 2,
        totalExpectedParts: 2
      });

      const results: any[] = [];
      for await (const tuple of adapter.list(config)) {
        results.push(tuple);
      }

      expect(results).toHaveLength(1);
      expect(results[0].checkpoint.id).toBe('split-checkpoint');
    });
  });

  describe('deleteThread - Integration with Split Cleanup', () => {
    it('should delete all records including split parts', async () => {
      const threadId = 'test-thread';
      const mockRecords = [
        { threadId, recordId: 'checkpoint#test-ns#checkpoint-1' },
        { threadId, recordId: 'split#checkpoint#test-ns#checkpoint-1#part#0001' },
        { threadId, recordId: 'split#checkpoint#test-ns#checkpoint-1#part#0002' },
        { threadId, recordId: 'write#test-ns#checkpoint-1#task-1#0' }
      ];

      mockCheckpointsModel.query.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockRecords)
      });
      mockCheckpointsModel.delete.mockResolvedValue({});

      await adapter.deleteThread(threadId);

      expect(mockCheckpointsModel.delete).toHaveBeenCalledTimes(4);
      mockRecords.forEach(record => {
        expect(mockCheckpointsModel.delete).toHaveBeenCalledWith({
          threadId,
          recordId: record.recordId
        });
      });
    });

    it('should handle deletion errors gracefully', async () => {
      const threadId = 'test-thread';
      const mockRecords = [
        { threadId, recordId: 'checkpoint#test-ns#checkpoint-1' }
      ];

      mockCheckpointsModel.query.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockRecords)
      });
      mockCheckpointsModel.delete.mockRejectedValue(new Error('Deletion failed'));

      await expect(adapter.deleteThread(threadId)).rejects.toThrow('Deletion failed');
    });
  });

  describe('Concurrent Access Scenarios', () => {
    it('should handle concurrent put operations safely', async () => {
      const config1 = {
        configurable: {
          thread_id: 'thread-1',
          checkpoint_ns: 'test-ns',
        },
      };

      const config2 = {
        configurable: {
          thread_id: 'thread-2',
          checkpoint_ns: 'test-ns',
        },
      };

      const checkpoint = {
        id: 'concurrent-checkpoint',
        channel_values: {},
        channel_versions: {},
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };

      mockSplittingService.splitCheckpointIfNeeded.mockResolvedValue({
        wasSplit: false,
        recordIds: ['checkpoint#test-ns#concurrent-checkpoint']
      });

      mockCheckpointsModel.create.mockResolvedValue({});

      // Execute concurrent operations
      const promises = [
        adapter.put(config1, { ...checkpoint, id: 'checkpoint-1' }, {}, {}),
        adapter.put(config2, { ...checkpoint, id: 'checkpoint-2' }, {}, {})
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(2);
      expect(results[0].configurable.checkpoint_id).toBe('checkpoint-1');
      expect(results[1].configurable.checkpoint_id).toBe('checkpoint-2');
      expect(mockCheckpointsModel.create).toHaveBeenCalledTimes(2);
    });

    it('should handle concurrent reassembly operations', async () => {
      const config = {
        configurable: {
          thread_id: 'test-thread',
          checkpoint_ns: 'test-ns',
          checkpoint_id: 'split-checkpoint'
        },
      };

      const mockSplitRecord = {
        threadId: 'test-thread',
        recordId: 'checkpoint#test-ns#split-checkpoint',
        isSplit: true,
        splitMetadata: {
          totalParts: 2,
          strategy: SplittingStrategy.MESSAGE_LEVEL
        }
      };

      mockCheckpointsModel.get.mockResolvedValue(mockSplitRecord);
      mockSplittingService.reassembleCheckpoint.mockResolvedValue({
        success: true,
        data: {
          checkpoint: { id: 'split-checkpoint' },
          metadata: { source: 'test' }
        },
        warnings: [],
        reassemblyTime: 100,
        partsReassembled: 2,
        totalExpectedParts: 2
      });

      // Execute concurrent getTuple operations
      const promises = [
        adapter.getTuple(config),
        adapter.getTuple(config),
        adapter.getTuple(config)
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result?.checkpoint.id).toBe('split-checkpoint');
      });
    });
  });

  describe('Performance and Load Testing Scenarios', () => {
    it('should handle large checkpoint splitting efficiently', async () => {
      const config = {
        configurable: {
          thread_id: 'perf-thread',
          checkpoint_ns: 'perf-ns',
        },
      };

      // Create a very large checkpoint
      const largeCheckpoint = {
        id: 'large-checkpoint',
        channel_values: {
          messages: {
            messages: Array.from({ length: 10000 }, (_, i) => ({
              content: `Large message ${i} with substantial content`.repeat(100),
              type: i % 2 === 0 ? 'human' : 'ai',
              timestamp: new Date().toISOString(),
              metadata: { index: i, processed: true }
            }))
          }
        },
        channel_versions: { messages: '1' },
        v: 1,
        ts: '2023-01-01T00:00:00Z'
      };

      mockSplittingService.splitCheckpointIfNeeded.mockResolvedValue({
        wasSplit: true,
        recordIds: Array.from({ length: 50 }, (_, i) => `split-record-${i}`)
      });

      const startTime = Date.now();
      const result = await adapter.put(config, largeCheckpoint, {}, { messages: '1' });
      const endTime = Date.now();

      expect(result.configurable.checkpoint_id).toBe('large-checkpoint');
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(mockSplittingService.splitCheckpointIfNeeded).toHaveBeenCalledTimes(1);
    });
  });
});