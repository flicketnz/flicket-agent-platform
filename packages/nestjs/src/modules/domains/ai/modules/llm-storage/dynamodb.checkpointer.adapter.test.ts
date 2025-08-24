import { randomBytes } from "node:crypto";

import { DynamoDB } from "@aws-sdk/client-dynamodb";
import {
  type CheckpointSaverTestInitializer,
  validate,
} from "@langchain/langgraph-checkpoint-validation";
import { Test } from "@nestjs/testing";
import { DynamooseModule } from "nestjs-dynamoose";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { DynamoDBCheckpointerAdapter } from "./dynamodb.checkpointer.adapter";
import { LlmStorageModule } from "./llm-storage.module";
import { CHECKPOINTER } from "./ports/checkpointer.port";

//@ts-expect-error add global
global.describe = describe;
//@ts-expect-error add global
global.it = it;
//@ts-expect-error add global
global.expect = expect;
//@ts-expect-error add global
global.beforeAll = beforeAll;
//@ts-expect-error add global
global.afterAll = afterAll;
//@ts-expect-error add global
global.beforeEach = beforeEach;
//@ts-expect-error add global
global.afterEach = afterEach;

const container = new GenericContainer(
  "amazon/dynamodb-local",
).withExposedPorts(8000);

let startedContainer: StartedTestContainer;

export const initializer: CheckpointSaverTestInitializer<DynamoDBCheckpointerAdapter> =
  {
    checkpointerName: "dynamodb-checkpoint-saver",

    async beforeAll() {
      startedContainer = await container.start();
    },

    beforeAllTimeout: 300_000, // five minutes, to pull docker container

    async afterAll() {
      await startedContainer.stop();
    },

    async createCheckpointer() {
      const moduleRef = await Test.createTestingModule({
        imports: [
          DynamooseModule.forRootAsync({
            imports: [],
            inject: [],
            useFactory: () => {
              const ddb = new DynamoDB({
                credentials: {
                  accessKeyId: "fake",
                  secretAccessKey: "fake",
                },
                endpoint: `http://${startedContainer.getHost()}:${startedContainer.getMappedPort(8000)}`,
                // endpoint: `http://localhost:8000`,
                region: "localhost",
              });

              return {
                ddb,
                logger: false,
                table: {
                  create: true,
                  prefix: randomBytes(4).toString("hex"),
                },
              };
            },
          }),
          LlmStorageModule,
        ],
        providers: [],
      }).compile();

      const checkpointer =
        moduleRef.get<DynamoDBCheckpointerAdapter>(CHECKPOINTER);

      return checkpointer;
    },

    // async destroyCheckpointer(checkpointer: unknown) {

    // },
  };

validate(initializer);
