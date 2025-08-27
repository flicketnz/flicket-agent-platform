import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DynamooseModule } from "nestjs-dynamoose";

import checkpointSplittingConfig from "../../../../config-management/configs/checkpoint-splitting.config";
import { DynamoDBCheckpointerAdapter } from "./dynamodb.checkpointer.adapter";
import { CHECKPOINTER } from "./ports/checkpointer.port";
import { CheckpointsSchema } from "./schemas/checkpoints.schema";
import { CheckpointSizeService } from "./services/checkpoint-size.service";
import { CheckpointSplittingService } from "./services/checkpoint-splitting.service";

@Module({
  imports: [
    ConfigModule.forFeature(checkpointSplittingConfig),
    DynamooseModule.forFeature([
      {
        name: "Checkpoints",
        schema: CheckpointsSchema,
      },
    ]),
  ],
  providers: [
    CheckpointSizeService,
    CheckpointSplittingService,
    {
      provide: CHECKPOINTER,
      useClass: DynamoDBCheckpointerAdapter,
    },
  ],
  exports: [{ provide: CHECKPOINTER, useClass: DynamoDBCheckpointerAdapter }],
})
export class LlmStorageModule {}
