# Architecture

## System Architecture

The Flicket Agent Platform is a monorepo composed of two main components:

1.  **NestJS Application (`packages/nestjs`):** This is the core application,
    serving as a Slack bot with AI capabilities. It's built with NestJS and
    integrates with Slack, LangChain, and AWS DynamoDB.
2.  **AWS CDK (`packages/cdk`):** This project manages the deployment of the
    necessary AWS infrastructure for the NestJS application.

The application follows a modular architecture, with a clear separation of
concerns:

- **`entrypoints`:** Handles incoming requests and events.
- **`domains`:** Contains the core business logic, including the AI and
  agent-related functionalities.
- **`config-management`:** Manages application configuration.
- **`health`:** Provides health check endpoints.

## Source Code paths

- **NestJS Application:** [`packages/nestjs`](packages/nestjs)
- **AWS CDK:** [`packages/cdk`](packages/cdk)
- **Core AI logic:**
  [`packages/nestjs/src/modules/domains/ai`](packages/nestjs/src/modules/domains/ai)

## Key technical decisions

- **Monorepo:** Using a monorepo (likely with npm workspaces) allows for better
  code sharing and dependency management between the application and
  infrastructure code.
- **NestJS:** Chosen as the backend framework for its modularity, dependency
  injection, and TypeScript support.
- **AWS CDK:** Used for defining and deploying infrastructure as code, ensuring
  consistency and repeatability.
- **LangChain:** The primary framework for building AI and LLM-powered features.
- **Slack Bolt:** The framework for building the Slack integration.

## Design patterns in use

- **Modular Architecture:** The application is divided into modules with
  distinct responsibilities, promoting separation of concerns.
- **CQRS (Command Query Responsibility Segregation):** The use of `@nestjs/cqrs`
  if intended to gain separation of concerns between business logic layer (in
  `domains/`) and the frontend layer (in `entrypoints/`) This aligns with CQRS
  principles of separating read and write responsibilities. This app currently
  utilizes 'Read' for almost everything i.e. using Queries
- **Dependency Injection:** Heavily used by NestJS to manage dependencies
  between different parts of the application.
- **Hexagonal Architecture** We adopt aspects of hexagonal architecture -
  specifically the port/adapter pattern. this allows us to define an interface
  that will be fulfilled, without known who or what wil fulfill it - aiding in
  the abstraction and separation of concerns.

## Component relationships

- The **`entrypoints`** module receives events from Slack or other inbound apis,
  and dispatches them to the **`domains`** module.
- The **`domains`** module, specifically the **`ai`** submodule, contains the
  core logic for agents, LLMs, and orchestration.
- The **`ai`** submodule is further broken down into `agents`, `llm`,
  `llm-storage`, `model-providers`, `orchestration`, and `tools`, indicating a
  sophisticated AI architecture.
- The application relies on **DynamoDB** for data persistence, managed through
  the `nestjs-dynamoose` library.

## Critical implementation paths

- The orchestration of agents, likely handled by the `orchestration` module
  within the `ai` domain, is a critical part of the system.
- The integration with Slack, managed by the `@slack/bolt` library, is the
  primary entry point for user interaction.
- The interaction with LLMs, managed by LangChain, is central to the
  application's AI capabilities.
