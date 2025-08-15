import { DynamoDB, DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { DynamooseModule } from "nestjs-dynamoose";

import awsConfig from "../config-management/configs/aws.config";
import { AiModule } from "./ai/ai.module";

@Module({
  imports: [
    // this is intentionally here, and not in app.module.ts as it represents that Dynmoose features should only be used withing 'domains' and not within other higher level modules
    DynamooseModule.forRootAsync({
      imports: [ConfigModule.forFeature(awsConfig)],
      inject: [awsConfig.KEY],
      useFactory: (config: ConfigType<typeof awsConfig>) => {
        const ddbConfig: DynamoDBClientConfig = {};

        if (config.accessKeyId && config.secretAccessKey) {
          ddbConfig.credentials = {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          };
        }

        if (config["dynamodb.endpoint"]) {
          ddbConfig.endpoint = config["dynamodb.endpoint"];
        }

        if (config.region) {
          ddbConfig.region = config.region;
        }

        const ddb = new DynamoDB(ddbConfig);

        return {
          ddb,
          logger: false,
          table: {
            create: config["dynamodb.createTables"],
            prefix: config["dynamodb.tablePrefix"],
          },
        };
      },
    }),
    AiModule,
  ],
})
export class DomainsModule {}
