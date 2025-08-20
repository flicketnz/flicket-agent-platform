# Technical Debt - TODO Items

> **Last Updated**: 2025-08-18  
> **Total Items**: 16 TODOs across 5 files  
> **Status**: Analysis Complete, Implementation Pending

## Overview

This document tracks all TODO comments found in the NestJS codebase, categorized by priority and complexity to guide future development efforts.

## 🔴 Critical Priority (Immediate Action Required)

### 1. Complex Return Type Handling
- **File**: `src/modules/domains/ai/modules/orchestration/services/agent-orchestrator.service.ts:352`
- **Issue**: Response type handling assumes simple types, complex return types not handled
- **Risk**: Runtime failures with complex responses
- **TODO Comment**: 
  ```typescript
  //TODO: the response type might be simple of complex, we are not handling complex return types here becasue we assume they wont happen
  ```
- **Action Required**: Implement robust type checking and parsing for complex response content
- **Estimated Effort**: 2-3 days
- **Dependencies**: None

### 2. Eliminate Manual Response Parsing
- **File**: `src/modules/domains/ai/modules/orchestration/services/agent-orchestrator.service.ts:486`
- **Issue**: Manual parsing method shouldn't be necessary with proper structured output
- **Risk**: Architectural inefficiency, brittle parsing logic
- **TODO Comment**: 
  ```typescript
  //TODO: this method should not be nessaasary - We can defined a structured output that the LLM must comply with in langraph/chain
  ```
- **Action Required**: Define structured output schema in LangGraph/chain configuration
- **Estimated Effort**: 3-5 days
- **Dependencies**: LangGraph configuration changes

## 🟡 High Priority (Next Sprint)

### 3. Scope Tool Providers Correctly
- **File**: `src/modules/domains/ai/modules/agents/adapters/langgraph-react.agent.ts:65`
- **Issue**: Tool discovery gets providers from entire system instead of module scope
- **Risk**: Performance impact, potential security concerns
- **TODO Comment**: 
  ```typescript
  // TODO: refine this to only get tools providers that are in scope of this module. currently gets providers from across the system
  ```
- **Action Required**: Refine dependency injection to limit tool provider scope
- **Estimated Effort**: 2-4 days
- **Dependencies**: Module architecture review

### 4. Remove Hardcoded Message Limits
- **File**: `src/modules/domains/ai/modules/agents/adapters/snowflake-cortex.agent.ts:278`
- **Issue**: Max messages hardcoded to 50
- **Risk**: Inflexibility, potential message truncation issues
- **TODO Comment**: 
  ```typescript
  // TODO: dont hardcode the max messages
  ```
- **Action Required**: Move to configuration service
- **Estimated Effort**: 1 day
- **Dependencies**: Configuration service setup

### 5. Fix Async Configuration Access
- **File**: `src/modules/domains/ai/modules/agents/adapters/snowflake-cortex.agent.ts:277`
- **Issue**: Cannot easily consume async maxMessages property from getCapabilities()
- **Risk**: Configuration inconsistency
- **TODO Comment**: 
  ```typescript
  // TODO: there is a maxMessages property in the getCapailities method - which we cant easily consume here as that method is async
  ```
- **Action Required**: Restructure to properly handle async configuration access
- **Estimated Effort**: 1-2 days
- **Dependencies**: None

### 6. Add Missing Test Coverage
- **File**: `src/modules/domains/ai/modules/agents/agents.module.ts:30`
- **Issue**: Enabled statement functionality not tested
- **Risk**: Untested feature may fail in production
- **TODO Comment**: 
  ```typescript
  // TODO: test this enabled statement works
  ```
- **Action Required**: Write unit test for module factory enabled statement
- **Estimated Effort**: 0.5 days
- **Dependencies**: Test infrastructure

## 🟢 Medium Priority (Future Sprints)

### 7. Implement Caller-Based Timezone
- **File**: `src/modules/domains/ai/modules/agents/adapters/langgraph-react.agent.ts:109`
- **Issue**: Date and timezone come from server instead of caller
- **Risk**: Timezone inconsistencies in distributed systems
- **TODO Comment**: 
  ```typescript
  // TODO: the date and timezone should come from the caller, not the server
  ```
- **Action Required**: Update API to accept timezone from caller
- **Estimated Effort**: 1 day
- **Dependencies**: API contract changes

### 8. Remove Unsuitable Confidence Metric
- **File**: `src/modules/domains/ai/modules/agents/adapters/langgraph-react.agent.ts:140`
- **Issue**: Confidence defaulted to 1.0 when LangGraph doesn't provide it
- **Risk**: Misleading metrics
- **TODO Comment**: 
  ```typescript
  // TODO: remove confidence if we cant set a suitable value
  ```
- **Action Required**: Conditionally include confidence only when meaningful
- **Estimated Effort**: 0.5 days
- **Dependencies**: API compatibility check

### 9. Remove Valueless toolsUsed Metric
- **File**: `src/modules/domains/ai/modules/agents/adapters/langgraph-react.agent.ts:143`
- **Issue**: toolsUsed metric provides no value
- **Risk**: Bloated response objects
- **TODO Comment**: 
  ```typescript
  // TODO: remove toolsUsed - this isnt providing value as it is
  ```
- **Action Required**: Remove toolsUsed from response
- **Estimated Effort**: 0.5 days
- **Dependencies**: API compatibility check

### 10. Clean Up Derived Metrics
- **File**: `src/modules/domains/ai/modules/agents/adapters/langgraph-react.agent.ts:183`
- **Issue**: Most metrics are derived from basic data and don't add value
- **Risk**: Performance overhead, maintenance burden
- **TODO Comment**: 
  ```typescript
  //TODO: most of these metrics do not add value. they are derivde from basic stuff - we should probably remove them
  ```
- **Action Required**: Review and remove unnecessary derived metrics
- **Estimated Effort**: 1 day
- **Dependencies**: Metrics requirements review

### 11. Reduce Decorator Duplication
- **File**: `src/modules/domains/ai/modules/agents/adapters/snowflake-cortex.agent.ts:80`
- **Issue**: Agent decorator requires more data than necessary
- **Risk**: Code duplication, maintenance overhead
- **TODO Comment**: 
  ```typescript
  //TODO: i think the only data required in the decorator is the capabilities - reducing the duplciation required. unsure at this stage though
  ```
- **Action Required**: Refactor decorator to only require capabilities
- **Estimated Effort**: 1 day
- **Dependencies**: None

## 🔵 Low Priority (Technical Discussion Required)

### 12. Review Health Check Value
- **File**: `src/modules/domains/ai/modules/orchestration/services/agent-orchestrator.service.ts:423`
- **Issue**: Uncertainty about isHealthy filter value
- **Risk**: Unclear business value
- **TODO Comment**: 
  ```typescript
  //TODO: not sure if the isHealthy filter here is valuable.
  ```
- **Action Required**: Team discussion on health check requirements
- **Estimated Effort**: Discussion only
- **Dependencies**: Product requirements clarification

### 13. Address Capabilities Architecture Concerns
- **File**: `src/modules/domains/ai/modules/orchestration/services/agent-orchestrator.service.ts:427`
- **Issue**: Growing collection of capabilities as text strings may not scale
- **Risk**: Type safety, scalability concerns
- **TODO Comment**: 
  ```typescript
  //TODO: im mildly concenred we are getting quite the large collection of random capabilities scattered around all as text strings. Not sure if this is a good or bad thing. I guess it may be ok as we are working with llms
  ```
- **Action Required**: Architecture review for capabilities system
- **Estimated Effort**: 1-2 days analysis
- **Dependencies**: Architecture team input

### 14. Implement Prompt Templates
- **File**: `src/modules/domains/ai/modules/orchestration/services/agent-orchestrator.service.ts:432`
- **Issue**: String concatenation for prompts instead of templates
- **Risk**: Maintenance burden, formatting inconsistency
- **TODO Comment**: 
  ```typescript
  //TODO: if we continue down this path - we should mabey use a prompt template here
  ```
- **Action Required**: Implement prompt template system
- **Estimated Effort**: 1-2 days
- **Dependencies**: Template library selection

### 15. Evaluate Health Check Necessity
- **File**: `src/modules/domains/ai/modules/orchestration/services/agent-orchestrator.service.ts:568`
- **Issue**: Health check feels like overkill
- **Risk**: Unnecessary complexity
- **TODO Comment**: 
  ```typescript
  //TODO: still not convinced about this healthcheck - feels overkill
  ```
- **Action Required**: Review health check requirements and simplify if possible
- **Estimated Effort**: Discussion + 0.5 days
- **Dependencies**: Operations team input

### 16. Review Capabilities Fallback Logic
- **File**: `src/modules/domains/ai/modules/orchestration/services/agent-orchestrator.service.ts:585`
- **Issue**: Metadata capabilities used as fallback instead of primary source
- **Risk**: Inconsistent capability reporting
- **TODO Comment**: 
  ```typescript
  //TODO: I would think this is the best place to retreive capabilities from - not a fallback
  ```
- **Action Required**: Review capabilities retrieval strategy
- **Estimated Effort**: 1 day
- **Dependencies**: Architecture review

### 17. Review Capabilities Usage Patterns
- **File**: `src/modules/domains/ai/modules/agents/adapters/langgraph-react.agent.ts:209`
- **Issue**: Duplicate and worthless data in capabilities object
- **Risk**: Confusion, maintenance overhead
- **TODO Comment**: 
  ```typescript
  //TODO: review how 'capabilities' are being used. there seems to be duplicate and worthless stuff in this object
  ```
- **Action Required**: Audit and clean up capabilities object structure
- **Estimated Effort**: 1-2 days
- **Dependencies**: Capabilities system review

### 18. Research Slack API Limitations
- **File**: `src/modules/domains/ai/modules/tools/slack.tools.ts:57`
- **Issue**: Bot token search doesn't work as expected
- **Risk**: Limited Slack integration functionality
- **TODO Comment**: 
  ```typescript
  // TODO: searching does not appear to work as initialy expected when using a bot token. At best you can locate files that your bot has access to.
  ```
- **Action Required**: Research Slack API alternatives and limitations
- **Estimated Effort**: 1-2 days
- **Dependencies**: Slack API documentation review

## Implementation Roadmap

### Sprint 1 (Critical - 1-2 weeks)
- [ ] Fix complex return type handling
- [ ] Restructure LangGraph output parsing

### Sprint 2-3 (High Priority - 2-3 weeks)
- [ ] Scope tool providers correctly
- [ ] Remove hardcoded message limits
- [ ] Fix async configuration access
- [ ] Add missing test coverage

### Sprint 4-5 (Medium Priority - 1-2 weeks)
- [ ] Implement caller-based timezone
- [ ] Clean up response metrics (confidence, toolsUsed, derived metrics)
- [ ] Reduce decorator duplication

### Ongoing (Discussion Items)
- [ ] Review health check requirements
- [ ] Capabilities architecture review
- [ ] Implement prompt templates
- [ ] Research Slack API alternatives

## Success Criteria

- [ ] All critical TODOs resolved
- [ ] No hardcoded configuration values
- [ ] Improved type safety and error handling
- [ ] Reduced code duplication
- [ ] Enhanced test coverage
- [ ] Architecture decisions documented
- [ ] Performance improvements validated

---

*This document should be reviewed and updated as TODOs are resolved or new technical debt is identified.*