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

## Testing Best Practices

### Unit Testing Guidelines

**Preferred Approach:**

- Use direct class instantiation with mocked dependencies instead of NestJS
  TestingModule
- Mock dependencies at the interface level, not implementation details
- Focus on testing business logic and behavior, not implementation details

**Example Pattern:**

```typescript
// ✅ Preferred: Direct instantiation
const service = new MyService(
  mockDependency1 as unknown as Dependency1Port,
  mockDependency2 as unknown as Dependency2Port,
);

// ❌ Avoid: TestingModule for unit tests
const module = await Test.createTestingModule({...}).compile();
```

### What NOT to Test

**Avoid Fragile Tests:**

- **Logger statements** - These are implementation details and make tests
  brittle
- **Framework internals** - Focus on your business logic, not NestJS mechanics
- **External library behavior** - Mock the interfaces, don't test library
  implementations

**Example of what to avoid:**

```typescript
// ❌ Fragile - testing logging implementation
expect(mockLogger.debug).toHaveBeenCalledWith("Starting process");

// ✅ Better - test the actual behavior
expect(result.success).toBe(true);
expect(result.data).toEqual(expectedData);
```

### Mocking Strategy

**Complex Dependencies:**

- When working with complex frameworks like LangGraph, mock at the service
  boundary
- Create simple mocks that simulate expected behavior without complex internal
  logic
- Use spies on methods that matter for your business logic, not framework
  internals

**Dependency Injection:**

- Mock ports/interfaces, not concrete implementations
- Use `vi.fn()` for simple function mocking
- Use proper TypeScript casting: `mockObject as unknown as InterfaceType`

### Test Structure

**Focus Areas:**

- Constructor dependency injection
- Core business logic methods
- Error handling scenarios
- Edge cases and boundary conditions

**Avoid:**

- Testing framework setup/teardown
- Testing that mocks work as expected
- Over-mocking internal implementation details
