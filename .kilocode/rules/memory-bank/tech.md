# Tech

## Technologies used

- **Backend Framework:** NestJS
- **Language:** TypeScript
- **Infrastructure as Code:** AWS CDK
- **AI/LLM Framework:** LangChain
- **Database:** AWS DynamoDB
- **Real-time Communication (Slack):** @slack/bolt
- **Testing:** Vitest
- **Linting & Formatting:** ESLint, Prettier

## Development setup

The project is a monorepo, likely managed with npm workspaces (implied by the
`packages` directory and root `package.json`). It consists of two main packages:

- `packages/cdk`: Handles AWS infrastructure deployment.
- `packages/nestjs`: The core NestJS application, which appears to be a Slack
  bot with AI capabilities.

To run the application in a development environment, the `start:dev` script in
`packages/nestjs/package.json` should be used:
`slack run --app $(jq -r '.custom_managed_local_app.app_id // empty' .slack/custom-managed-apps.json)`.

## Technical constraints

- The application is designed to run as a container - the cdk infrastructure is
  specific to AWS.
- It is tightly coupled with Slack, using the Bolt framework for real-time
  communication and the Slack CLI for local development.

## Dependencies

### Core Application (NestJS)

- `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `@nestjs/cqrs`
- `@slack/bolt`, `nestjs-slack-bolt`
- `langchain`, `@langchain/community`, `@langchain/core`,
  `@langchain/langgraph`, `@langchain/openai`
- `@aws-sdk/client-dynamodb`, `nestjs-dynamoose`

### Infrastructure (CDK)

- `aws-cdk-lib`, `constructs`

### Development

- `typescript`, `vitest`, `eslint`, `prettier`, `syncpack`

## Tool usage patterns

- **`syncpack`**: Used to keep dependencies consistent across the monorepo.
- **`vitest`**: The testing framework of choice for the NestJS application.
- **Slack CLI**: Used for local development and running the application in a
  simulated Slack environment.
