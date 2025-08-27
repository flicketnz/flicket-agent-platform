# Checkpoint Splitting Migration Guide

This guide provides instructions for migrating to the new checkpoint splitting functionality and handling existing oversized records.

## Overview

The checkpoint splitting system is designed to be backward compatible with existing checkpoint data. However, some considerations are needed for environments with existing large checkpoints that exceed DynamoDB's 400KB limit.

## Pre-Migration Checklist

### 1. Backup Existing Data

Before enabling checkpoint splitting, ensure you have a complete backup of your DynamoDB checkpoints table:

```bash
# Using AWS CLI to export table
aws dynamodb create-backup \
  --table-name your-checkpoints-table \
  --backup-name pre-splitting-migration-backup
```

### 2. Analyze Current Data Size

Run this script to analyze your current checkpoint sizes:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

async function analyzeCheckpointSizes() {
  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);
  
  let totalScanned = 0;
  let oversizedCount = 0;
  let maxSize = 0;
  let lastKey;
  
  do {
    const command = new ScanCommand({
      TableName: 'your-checkpoints-table',
      FilterExpression: 'begins_with(recordId, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'checkpoint#'
      },
      ExclusiveStartKey: lastKey
    });
    
    const result = await docClient.send(command);
    
    for (const item of result.Items || []) {
      const itemSize = JSON.stringify(item).length;
      totalScanned++;
      
      if (itemSize > 400000) { // 400KB
        oversizedCount++;
        console.log(`Oversized checkpoint: ${item.recordId} (${itemSize} bytes)`);
      }
      
      maxSize = Math.max(maxSize, itemSize);
    }
    
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  
  console.log(`Analysis complete:`);
  console.log(`Total checkpoints: ${totalScanned}`);
  console.log(`Oversized checkpoints: ${oversizedCount}`);
  console.log(`Largest checkpoint: ${maxSize} bytes`);
  console.log(`Percentage oversized: ${(oversizedCount / totalScanned * 100).toFixed(2)}%`);
}

analyzeCheckpointSizes().catch(console.error);
```

### 3. Update DynamoDB Schema

The existing DynamoDB table schema is automatically compatible with the new splitting fields. No schema migration is required as the new fields are optional.

## Migration Steps

### Step 1: Update Application Configuration

Add the checkpoint splitting configuration to your environment:

```bash
# .env or environment variables
CHECKPOINT_SPLITTING_ENABLED=true
CHECKPOINT_MAX_SIZE_THRESHOLD=358400
CHECKPOINT_SPLITTING_STRATEGY=message_level
CHECKPOINT_MAX_CHUNK_SIZE=307200
CHECKPOINT_SIZE_MONITORING_ENABLED=true
CHECKPOINT_SPLIT_RECORD_PREFIX=split
CHECKPOINT_SPLITTING_MAX_RETRIES=3
CHECKPOINT_OPERATION_TIMEOUT=30000
```

### Step 2: Deploy with Splitting Disabled

First, deploy the new code with splitting **disabled** to ensure compatibility:

```bash
# Deploy with splitting disabled initially
CHECKPOINT_SPLITTING_ENABLED=false npm run deploy
```

### Step 3: Test Read Operations

Verify that existing checkpoints can still be read correctly:

```typescript
// Test script to verify existing checkpoints
import { DynamoDBCheckpointerAdapter } from './path/to/adapter';

async function testExistingCheckpoints() {
  const adapter = new DynamoDBCheckpointerAdapter(/* dependencies */);
  
  // Test reading various existing checkpoints
  const testConfigs = [
    { configurable: { thread_id: 'test-thread-1', checkpoint_ns: 'test' } },
    { configurable: { thread_id: 'test-thread-2', checkpoint_ns: 'test' } },
    // Add more test cases
  ];
  
  for (const config of testConfigs) {
    try {
      const tuple = await adapter.getTuple(config);
      console.log(`✓ Successfully read checkpoint for ${config.configurable.thread_id}`);
    } catch (error) {
      console.error(`✗ Failed to read checkpoint for ${config.configurable.thread_id}:`, error);
    }
  }
}
```

### Step 4: Enable Splitting Gradually

Enable splitting in a controlled manner:

```bash
# Enable splitting with conservative settings
CHECKPOINT_SPLITTING_ENABLED=true
CHECKPOINT_MAX_SIZE_THRESHOLD=450000  # Start with higher threshold
```

### Step 5: Monitor and Adjust

Monitor the application logs for splitting activity:

```bash
# Monitor splitting operations
kubectl logs -f your-app-pod | grep "CheckpointSplitting\|CheckpointSize"
```

### Step 6: Handle Existing Oversized Records

For existing oversized records that cannot be read, you have several options:

#### Option A: Gradual Migration (Recommended)

Let the natural flow of the application handle oversized records as they're accessed:

```typescript
// The adapter will automatically handle oversized records on write
// No manual intervention needed
```

#### Option B: Proactive Migration

Create a migration script to proactively split existing oversized records:

```typescript
async function migrateOversizedCheckpoints() {
  const adapter = new DynamoDBCheckpointerAdapter(/* dependencies */);
  
  // Find oversized checkpoints
  const oversizedRecords = await findOversizedCheckpoints();
  
  for (const record of oversizedRecords) {
    try {
      // Read the existing record
      const data = await adapter.getTuple({
        configurable: {
          thread_id: record.threadId,
          checkpoint_ns: record.namespace,
          checkpoint_id: record.checkpointId
        }
      });
      
      if (data) {
        // Re-save to trigger splitting
        await adapter.put(
          { configurable: { thread_id: record.threadId } },
          data.checkpoint,
          data.metadata,
          {} // Empty new versions to trigger full save
        );
        
        console.log(`✓ Migrated oversized checkpoint: ${record.recordId}`);
      }
    } catch (error) {
      console.error(`✗ Failed to migrate ${record.recordId}:`, error);
    }
  }
}
```

## Rollback Plan

If issues arise, you can safely rollback:

### Step 1: Disable Splitting

```bash
CHECKPOINT_SPLITTING_ENABLED=false
```

### Step 2: Clean Up Split Records (if needed)

```typescript
async function cleanupSplitRecords() {
  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);
  
  // Find split records
  const command = new ScanCommand({
    TableName: 'your-checkpoints-table',
    FilterExpression: 'begins_with(recordId, :prefix)',
    ExpressionAttributeValues: {
      ':prefix': 'split#'
    }
  });
  
  const result = await docClient.send(command);
  
  // Delete split records (keep only primary split records with actual checkpoint data)
  for (const item of result.Items || []) {
    if (!item.checkpoint && !item.metadata) {
      // This is a split part, safe to delete
      await docClient.send(new DeleteCommand({
        TableName: 'your-checkpoints-table',
        Key: {
          threadId: item.threadId,
          recordId: item.recordId
        }
      }));
    }
  }
}
```

### Step 3: Restore from Backup (if necessary)

```bash
aws dynamodb restore-table-from-backup \
  --target-table-name your-checkpoints-table-restored \
  --backup-arn arn:aws:dynamodb:region:account:table/your-checkpoints-table/backup/backup-id
```

## Monitoring and Validation

### Key Metrics to Monitor

1. **Application Error Rates**: Watch for increases in checkpoint-related errors
2. **DynamoDB Throttling**: Monitor read/write capacity consumption
3. **Response Times**: Track checkpoint read/write latency
4. **Split Operations**: Monitor frequency and success rate of splitting

### Validation Checklist

- [ ] All existing checkpoints can be read successfully
- [ ] New large checkpoints are split automatically
- [ ] Split records can be reassembled correctly
- [ ] Application performance remains stable
- [ ] DynamoDB costs remain within expected ranges
- [ ] Error rates remain low

### Health Check Script

```typescript
async function healthCheck() {
  const tests = [
    testReadExistingCheckpoint,
    testWriteLargeCheckpoint,
    testReadSplitCheckpoint,
    testListOperations
  ];
  
  for (const test of tests) {
    try {
      await test();
      console.log(`✓ ${test.name} passed`);
    } catch (error) {
      console.error(`✗ ${test.name} failed:`, error);
    }
  }
}
```

## Troubleshooting

### Common Issues

#### 1. Read Timeouts

**Symptom**: Timeouts when reading split checkpoints
**Solution**: Increase `CHECKPOINT_OPERATION_TIMEOUT`

```bash
CHECKPOINT_OPERATION_TIMEOUT=60000  # Increase to 60 seconds
```

#### 2. DynamoDB Throttling

**Symptom**: DynamoDB throttling errors during splitting
**Solution**: Adjust DynamoDB capacity or reduce chunk size

```bash
CHECKPOINT_MAX_CHUNK_SIZE=204800  # Reduce to 200KB chunks
```

#### 3. Missing Split Parts

**Symptom**: Warnings about missing parts during reassembly
**Solution**: Check for partial failures and re-run migration

#### 4. Memory Issues

**Symptom**: Out of memory errors with large checkpoints
**Solution**: Increase application memory limits

```yaml
# kubernetes/deployment.yaml
resources:
  limits:
    memory: "2Gi"
  requests:
    memory: "1Gi"
```

### Debug Commands

```bash
# Check split record distribution
aws dynamodb scan \
  --table-name your-checkpoints-table \
  --filter-expression "begins_with(recordId, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"split#"}}' \
  --select COUNT

# Find checkpoints by size
aws dynamodb scan \
  --table-name your-checkpoints-table \
  --filter-expression "begins_with(recordId, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"checkpoint#"}}' \
  --projection-expression "threadId, recordId" \
  | jq '.Items[] | select(.checkpoint.S | length > 400000)'
```

## Performance Considerations

### Before Migration

- Single large items (up to 400KB)
- Potential DynamoDB write failures
- Memory spikes during large checkpoint processing

### After Migration

- Multiple smaller items (typically 50-300KB each)
- Increased read operations for split checkpoints
- More predictable memory usage
- Additional DynamoDB storage overhead (~5-10%)

### Optimization Tips

1. **Choose the Right Strategy**: Use message-level splitting for conversation-heavy workloads
2. **Tune Chunk Sizes**: Adjust based on your data patterns and performance requirements
3. **Monitor Costs**: Track DynamoDB usage and optimize chunk sizes accordingly
4. **Cache Frequently Accessed Data**: Consider application-level caching for hot checkpoints

## Support

For issues during migration:

1. Check application logs for detailed error messages
2. Review DynamoDB CloudWatch metrics
3. Use the provided health check and validation scripts
4. Consider temporary rollback if critical issues arise

Remember: The migration is designed to be safe and reversible. Take your time and validate each step before proceeding.