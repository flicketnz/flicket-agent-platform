export interface CheckpointsKey {
  threadId: string;
  recordId: string; // This will be either checkpoint#{namespace}#{id} or write#{namespace}#{id}#{taskId}#{writeIdx}
}

export interface Checkpoints extends CheckpointsKey {
  // Checkpoint-specific fields (only present for checkpoint records)
  checkpoint?: string;
  metadata?: string;
  parentCheckpointId?: string;
  checkpointTs?: string;

  // Write-specific fields (only present for write records)
  taskId?: string;
  channel?: string;
  value?: string;
  writeIdx?: number;
}
