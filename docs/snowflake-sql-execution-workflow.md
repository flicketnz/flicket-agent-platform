# Snowflake SQL Execution Workflow

## Complete Agent Workflow

The following diagram illustrates the enhanced Snowflake Cortex agent workflow with SQL execution capabilities:

```mermaid
graph TD
    A[User Request via API] --> B[CortexController.chat]
    B --> C[SnowflakeCortexAgentAdapter.invoke]
    C --> D[cortexAnalystNode]
    
    D --> E[Call Snowflake Cortex API]
    E --> F[Parse Response Content]
    F --> G{SQL Statement Found?}
    
    G -->|No| H[Return Text Response Only]
    G -->|Yes| I[shouldSegmentSql = yes]
    
    I --> J[addTenantSegmentationNode]
    J --> K[Extract Tenant Context]
    K --> L[Validate SQL Security]
    L --> M[Add Tenant WHERE Clauses]
    M --> N[Validate Table Permissions]
    
    N --> O[executeSnowflakeSQLNode]
    O --> P[SnowflakeSQLExecutionService]
    P --> Q[Execute via SQL REST API v2]
    Q --> R[Format Results]
    R --> S[Generate Insights]
    
    S --> T[Update Agent State]
    T --> U[Convert to LangChain Messages]
    U --> V[Return Enhanced Response]
    
    H --> W[END]
    V --> W[END]
    
    %% Error Handling
    L -->|Security Violation| X[Log Security Alert]
    Q -->|API Error| Y[Handle Error & Retry]
    X --> Z[Return Error Response]
    Y --> Z
    Z --> W
    
    %% Styling
    classDef nodeStyle fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef securityStyle fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef errorStyle fill:#ffebee,stroke:#c62828,stroke-width:2px
    
    class J,K,L,M,N securityStyle
    class X,Y,Z errorStyle
    class D,E,F,O,P,Q,R,S nodeStyle
```

## Data Flow Architecture

```mermaid
graph LR
    subgraph "Input Layer"
        A[User Chat Request]
        B[Session Context]
        C[Tenant Information]
    end
    
    subgraph "Agent Processing"
        D[Cortex Analysis]
        E[SQL Generation]
        F[Tenant Segmentation]
        G[SQL Execution]
    end
    
    subgraph "External APIs"
        H[Snowflake Cortex API]
        I[Snowflake SQL API v2]
    end
    
    subgraph "Output Layer"
        J[Text Response]
        K[SQL Results]
        L[Formatted Data]
        M[Insights]
    end
    
    A --> D
    B --> D
    C --> F
    D --> H
    D --> E
    E --> F
    F --> G
    G --> I
    
    H --> J
    I --> K
    K --> L
    L --> M
    
    J --> N[Combined Response]
    M --> N
```

## Security Flow

```mermaid
sequenceDiagram
    participant User
    participant Agent
    participant Security as SQL Security Layer
    participant Tenant as Tenant Service
    participant Snowflake
    
    User->>Agent: SQL Query Request
    Agent->>Security: Validate SQL Statement
    
    alt SQL Validation Fails
        Security-->>Agent: Security Violation
        Agent-->>User: Error Response
    else SQL Valid
        Security->>Tenant: Get Tenant Context
        Tenant->>Security: Tenant Filters
        Security->>Security: Apply Tenant Segmentation
        Security->>Agent: Segmented SQL
        Agent->>Snowflake: Execute SQL
        
        alt SQL Execution Success
            Snowflake-->>Agent: Results
            Agent->>Agent: Format & Generate Insights
            Agent-->>User: Enhanced Response
        else SQL Execution Fails
            Snowflake-->>Agent: Error
            Agent-->>User: Error Response
        end
    end
```

## State Transitions

```mermaid
stateDiagram-v2
    [*] --> AnalyzingRequest: User Request
    
    AnalyzingRequest --> GeneratingSQL: Cortex API Call
    GeneratingSQL --> SQLGenerated: SQL Found
    GeneratingSQL --> TextOnly: No SQL
    
    SQLGenerated --> ValidatingSQL: Security Check
    ValidatingSQL --> SQLRejected: Validation Failed
    ValidatingSQL --> SegmentingSQL: Validation Passed
    
    SegmentingSQL --> ExecutingSQL: Tenant Filters Applied
    ExecutingSQL --> ResultsReady: Success
    ExecutingSQL --> ExecutionFailed: Error
    
    TextOnly --> [*]: Return Text Response
    SQLRejected --> [*]: Return Error
    ResultsReady --> FormattingResults: Process Data
    FormattingResults --> [*]: Return Enhanced Response
    ExecutionFailed --> [*]: Return Error Response
```

## Component Integration

The implementation integrates with existing Flicket Agent Platform components:

### 1. Authentication Flow
- Uses existing JWT authentication via `SnowflakeJwtService`
- Leverages HTTP interceptors for automatic token refresh
- Maintains secure API communication

### 2. Agent Orchestration
- Integrates with LangGraph state management
- Follows existing agent pattern with ports/adapters
- Supports multi-agent workflows through orchestration module

### 3. Configuration Management
- Extends existing config system for SQL execution settings
- Supports environment-specific configurations
- Includes feature flags for gradual rollout

### 4. Error Handling & Monitoring
- Uses NestJS logging infrastructure
- Integrates with existing health check endpoints
- Supports metrics collection for observability

## Implementation Phases

### Phase 1: Core SQL Execution (2-3 days)
- Implement `SnowflakeSQLExecutionService`
- Create basic SQL validation
- Add Snowflake API v2 integration
- Implement `executeSnowflakeSQLNode`

### Phase 2: Security & Tenant Isolation (2-3 days)
- Implement SQL parsing and validation
- Add tenant segmentation logic
- Create security audit logging
- Implement `addTenantSegmentationNode`

### Phase 3: Response Enhancement (1-2 days)
- Update message conversion logic
- Add result formatting and insights generation
- Implement data visualization helpers
- Enhanced error messaging

### Phase 4: Testing & Monitoring (2-3 days)
- Create comprehensive unit tests
- Add integration tests with Snowflake
- Implement performance monitoring
- Security penetration testing

### Phase 5: Documentation & Deployment (1 day)
- Update API documentation
- Create usage guides
- Deploy to staging environment
- Performance tuning

This workflow design ensures secure, scalable, and maintainable SQL execution capabilities while maintaining the existing agent architecture and security principles.