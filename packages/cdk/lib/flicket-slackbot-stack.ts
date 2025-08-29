import { resolve } from "node:path";

import {
  Cpu,
  Memory,
  Secret as AppRunnerSecret,
  Service,
  Source,
} from "@aws-cdk/aws-apprunner-alpha";
import * as cdk from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

const SERVICE_NAME = `FlicketAgentPlatform`;
/**
 * Build id for cdk constructs
 * @param idPartial Must be provided in PascalCase
 * @returns
 */
const buildId = (idPartial: `${Uppercase<string>}${string}`) =>
  `${SERVICE_NAME}_${idPartial}`;
export class FlicketSlackbotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    /**
     *
     * @param contextKeyPartial PascalCased Context key name will be prefixed with ServiceName
     * @param defaultValue default value to return.
     * @returns
     */
    const getContext = (
      contextKeyPartial: `${Uppercase<string>}${string}`,
      defaultValue?: string,
    ) =>
      this.node.tryGetContext(`${SERVICE_NAME}_${contextKeyPartial}`) ??
      defaultValue;

    const applicationPort = Number.parseInt(getContext("Port") ?? "8000");

    const slackSigningSecret = new Secret(
      this,
      buildId("SlackSigningSecret"),
      {},
    );
    const openRouterApiKey = new Secret(this, buildId("OpenRouterAPIKey"), {});
    const slackBotToken = new Secret(this, buildId("SlackBotToken"), {});

    // Define a Docker image asset
    const dockerImageAsset = new DockerImageAsset(
      this,
      buildId("NestJsImage"),
      {
        directory: resolve("..", ".."), // Path to the directory containing the Dockerfile
        file: "packages/nestjs/Dockerfile",
        cacheFrom: [
          {
            type: "local",
            params: { src: resolve("..", "cache/flicket-ai-npm") },
          },
        ],
        cacheTo: {
          type: "local",
          params: { dest: resolve("..", "cache/flicket-ai-npm") },
        },
        buildArgs: {
          NODE_VERSION: getContext("ImageBuildNodeVersion", "24"),
          ALPINE_VERSION: getContext("ImageBuildAlpineVersion", "3.21"),
        },
        platform: {
          platform: getContext("ImageBuildPlatform", "linux/amd64"),
        },
      },
    );

    const instanceRole = new Role(this, "FlicketAiInstanceRole", {
      assumedBy: new ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });

    const dynamoDbPrefix = getContext(
      "DynamoDBTablePrefix",
      `${SERVICE_NAME}_`,
    );

    const appRunnerAgentPlatform = new Service(this, "FlicketAgentPlatform", {
      cpu: Cpu.QUARTER_VCPU,
      memory: Memory.HALF_GB,
      source: Source.fromAsset({
        imageConfiguration: {
          port: applicationPort,
          environmentVariables: {
            LLM_PRIMARY_PROVIDER: "openai",
            LLM_OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
            LLM_OPENAI_MODEL: "anthropic/claude-3.5-haiku",
            LLM_TOOLS_SEARXNG_ENABLED: "true",
            LLM_TOOLS_SEARXNG_API_BASE: "https://search.canine.tools/",
            LLM_TOOLS_SLACK_ENABLED: "true",
            NODE_ENV: "production",
            DYNAMODB_TABLE_PREFIX: dynamoDbPrefix,
            PORT: `${applicationPort}`,
          },
          environmentSecrets: {
            SLACK_SIGNING_SECRET:
              AppRunnerSecret.fromSecretsManager(slackSigningSecret),
            SLACK_BOT_TOKEN: AppRunnerSecret.fromSecretsManager(slackBotToken),
            LLM_OPENAI_KEY:
              AppRunnerSecret.fromSecretsManager(openRouterApiKey),
          },
        },
        asset: dockerImageAsset,
      }),
      instanceRole,
      autoDeploymentsEnabled: false,
    });

    const checkpointTable = new Table(this, "FlicketAiCheckpointTable", {
      partitionKey: { name: "threadId", type: AttributeType.STRING },
      sortKey: { name: "recordId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: `${dynamoDbPrefix}Checkpoints`,
    });
    checkpointTable.grantReadWriteData(instanceRole);

    // Output the ECR URI
    new cdk.CfnOutput(this, "ECRImageUri", {
      value: dockerImageAsset.imageUri,
    });

    // Output the FlicketAgentPlatform AppRunner Public URL
    new cdk.CfnOutput(this, "AppRunnerPublicUrl", {
      value: appRunnerAgentPlatform.serviceUrl,
    });
  }
}
