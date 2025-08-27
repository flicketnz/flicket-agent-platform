# DynamoDB Checkpoint Splitting

This module provides robust checkpoint record splitting and reassembly functionality for the DynamoDB checkpointer adapter to handle DynamoDB's 400KB item size limit.

## Overview

The checkpoint splitting system automatically detects when checkpoint records approach or exceed DynamoDB's 400KB item size limit and splits them into smaller, manageable pieces. This ensures that AI agent conversations with large message histories or complex state can be stored reliably in DynamoDB.

## Features

- **Automatic Size Detection**: Monitors checkpoint sizes and triggers splitting when approaching limits
- **Two Splitting Strategies**: 
  - Message-level splitting: Extracts individual messages into separate records
  - Content-level splitting: Base64 encodes and chunks the entire checkpoint
- **Data Integrity**: Includes checksums and validation for split/reassembly operations
- **Transparent Operation**: Maintains API compatibility - splitting/reassembly is invisible to consumers
- **Error Handling**: Comprehensive rollback mechanisms and retry logic
- **Performance Optimized**: Efficient reassembly with caching and parallel operations
- **Configurable**: Environment-based configuration for thresholds and strategies

## Architecture

### Core Components

1. **CheckpointSizeService**: Analyzes checkpoint sizes and determines splitting requirements
2. **CheckpointSplittingService**: Handles splitting and reassembly logic for both strategies
3. **DynamoDBCheckpointerAdapter**: Enhanced adapter with transparent splitting integration
4. **Configuration**: Environment-based configuration system

### Splitting Strategies

#### Message-Level Splitting
- **Use Case**: Checkpoints with large message arrays in `channel_values[string].messages`
- **Method**: Extracts messages into separate DynamoDB items with proper indexing
- **Benefits**: More granular control, faster partial retrieval
- **Limitations**: Requires specific checkpoint structure with messages

#### Content-Level Splitting
- **Use Case**: Any large checkpoint regardless of structure
- **Method**: Base64 encodes entire checkpoint and splits into fixed-size chunks
- **Benefits**: Works with any checkpoint structure, simple implementation
- **Limitations**: Requires full reassembly for any access

## Configuration

### Environment Variables

```bash
# Enable/disable checkpoint splitting
CHECKPOINT_SPLITTING_ENABLED=true

# Maximum size threshold (default: 350KB to leave buffer under 400KB)
CHECKPOINT_MAX_SIZE_THRESHOLD=358400

# Splitting strategy: 'message_level' or 'content_level'
CHECKPOINT_SPLITTING_STRATEGY=message_level

# Maximum chunk size for content-level splitting (default: 300KB)
CHECKPOINT_MAX_CHUNK_SIZE=307200

# Enable size monitoring and detailed logging
CHECKPOINT_SIZE_MONITORING_ENABLED=true

# Prefix for split record IDs
CHECKPOINT_SPLIT_RECORD_PREFIX=split

# Maximum retry attempts for split operations
CHECKPOINT_SPLITTING_MAX_RETRIES=3

# Operation timeout in milliseconds
CHECKPOINT_OPERATION_TIMEOUT=30000
```

### Configuration Schema

The configuration is validated using Joi schema with the following constraints:

- `CHECKPOINT_MAX_SIZE_THRESHOLD`: 100KB - 400KB
- `CHECKPOINT_MAX_CHUNK_SIZE`: 50KB - 350KB
- `CHECKPOINT_SPLITTING_MAX_RETRIES`: 1 - 10 attempts
- `CHECKPOINT_OPERATION_TIMEOUT`: 5s - 120s

## Usage

### Basic Usage

The splitting functionality is transparent to consumers. Simply use the DynamoDB checkpointer as normal:

```typescript
import { DynamoDBCheckpointerAdapter } from './dynamodb.checkpointer.adapter';

// No changes needed - splitting happens automatically
const checkpointer = new DynamoDBCheckpointerAdapter(/* dependencies */);

// Store checkpoint (will split if needed)
await checkpointer.put(config, checkpoint, metadata, newVersions);

// Retrieve checkpoint (will reassemble if split)
const tuple = await checkpointer.getTuple(config);
```

### Monitoring Split Operations

Enable detailed logging to monitor split operations:

```typescript
// Set in environment
CHECKPOINT_SIZE_MONITORING_ENABLED=true

// Logs will include:
// - Size analysis results
// - Split operation details
// - Reassembly performance metrics
// - Warning for missing parts or errors
```

## Database Schema

### Standard Checkpoint Record

```typescript
{
  threadId: string;          // Hash key
  recordId: string;          // Range key: 'checkpoint#{namespace}#{id}'
  checkpoint?: string;       // Serialized checkpoint data
  metadata?: string;         // Serialized metadata
  checkpointTs?: string;     // Timestamp
  parentCheckpointId?: string;
}
```

### Split Checkpoint Records

```typescript
{
  threadId: string;          // Hash key
  recordId: string;          // Range key: 'checkpoint#{namespace}#{id}' or 'split#...'
  isSplit?: boolean;         // Indicates this is a split record
  splitMetadata?: {          // Split operation metadata
    originalRecordId: string;
    totalParts: number;
    partNumber: number;
    strategy: 'message_level' | 'content_level';
    splitTimestamp: string;
    checksum?: string;
    originalSize: number;
    partSize: number;
  };
  messageSplitData?: {       // For message-level splits
    channelName: string;
    startMessageIndex: number;
    endMessageIndex: number;
    messagesData: string;
    checkpointMetadata: object;
  };
  contentSplitData?: {       // For content-level splits
    chunkData: string;
    encoding: 'base64';
  };
}
```

## Performance Considerations

### Split Operation Performance

- **Message-level splitting**: O(n) where n = number of messages
- **Content-level splitting**: O(1) for splitting, O(k) for storage where k = number of chunks
- **Storage overhead**: ~5-10% increase due to metadata and DynamoDB overhead per part

### Reassembly Performance

- **Message-level**: Can partially load specific channels if needed (future optimization)
- **Content-level**: Requires loading all parts for any access
- **Caching**: Consider implementing application-level caching for frequently accessed checkpoints

### DynamoDB Considerations

- **Read capacity**: Split records require multiple read operations
- **Write capacity**: Split operations require multiple write operations
- **Consistency**: Use consistent reads when reassembling to ensure all parts are available

## Error Handling

### Common Error Scenarios

1. **Partial Split Failure**: Automatic rollback of successfully stored parts
2. **Missing Parts During Reassembly**: Graceful degradation with warnings
3. **Checksum Mismatch**: Data corruption detection and error reporting
4. **Timeout During Operations**: Configurable timeouts with proper cleanup

### Error Recovery

```typescript
// The system automatically handles:
// - Retry logic with exponential backoff
// - Rollback of partial operations
// - Graceful degradation for missing parts
// - Detailed error logging for debugging
```

## Monitoring and Debugging

### Key Metrics to Monitor

1. **Split Rate**: Percentage of checkpoints requiring splitting
2. **Reassembly Time**: Time taken to reassemble split checkpoints
3. **Error Rate**: Failed split/reassembly operations
4. **Storage Overhead**: Increase in DynamoDB item count due to splitting

### Debug Logging

Enable detailed logging with `CHECKPOINT_SIZE_MONITORING_ENABLED=true`:

```
[CheckpointSizeService] Size analysis completed in 45ms {
  totalSize: 425123,
  exceedsThreshold: true,
  estimatedParts: 3,
  largestChannel: "messages"
}

[CheckpointSplittingService] Successfully split checkpoint checkpoint#ns#123 into 3 parts in 156ms

[DynamoDBCheckpointerAdapter] Reassembled checkpoint checkpoint#ns#123 {
  partsReassembled: 3,
  totalExpectedParts: 3,
  reassemblyTime: 89ms,
  warnings: []
}
```

## Migration Guide

See [MIGRATION.md](./MIGRATION.md) for detailed migration instructions.

## Testing

The module includes comprehensive test coverage:

- **Unit Tests**: Individual service testing with mocks
- **Integration Tests**: End-to-end testing with real DynamoDB operations
- **Performance Tests**: Load testing with large checkpoints
- **Error Scenario Tests**: Failure mode and recovery testing

Run tests:

```bash
npm test -- --testPathPattern=llm-storage
```

## Troubleshooting

### Common Issues

1. **Configuration Errors**: Verify environment variables are set correctly
2. **DynamoDB Permissions**: Ensure read/write access to the checkpoints table
3. **Memory Issues**: Large checkpoints may require increased memory limits
4. **Timeout Issues**: Increase `CHECKPOINT_OPERATION_TIMEOUT` for large datasets

### Performance Tuning

1. **Adjust Chunk Size**: Optimize `CHECKPOINT_MAX_CHUNK_SIZE` based on your data patterns
2. **Strategy Selection**: Choose appropriate splitting strategy for your use case
3. **DynamoDB Capacity**: Ensure adequate read/write capacity for split operations
4. **Application Caching**: Implement caching layer for frequently accessed checkpoints

## Security Considerations

- **Data Integrity**: All split operations include checksums for validation
- **Access Control**: Split records inherit same access controls as original checkpoints
- **Encryption**: DynamoDB encryption-at-rest applies to all split records
- **Audit Trail**: All split operations are logged for audit purposes

## Future Enhancements

- **Compression**: Add compression before Base64 encoding for content-level splits
- **Lazy Loading**: Partial reassembly for message-level splits
- **Smart Chunking**: Dynamic chunk sizing based on data patterns
- **Caching Layer**: Distributed caching for reassembled checkpoints
- **Metrics Dashboard**: Real-time monitoring of split operations