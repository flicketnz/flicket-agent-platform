import { Schema } from "dynamoose";

export const CheckpointsSchema = new Schema({
  threadId: {
    type: String,
    hashKey: true,
  },
  recordId: {
    type: String,
    rangeKey: true,
  },
  checkpoint: {
    type: String,
  },
  checkpointTs: {
    type: String,
  },
  metadata: {
    type: String,
  },
  parentCheckpointId: {
    type: String,
  },
  // writes
  taskId: {
    type: String,
  },
  channel: {
    type: String,
  },
  value: {
    type: String,
  },
  writeIdx: {
    type: Number,
  },
});
