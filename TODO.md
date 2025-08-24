# Known Issues

- Checkpointer tests for `list` method don't pass
- Checkpointer does not seem to be restoring the full state on new invoctions
  with same thread id (previous messages are coming, but `selectedAgentId` is
  not) Was hoping to be able to shortcut the agent selection on subsequent
  invokes
  - if the above is fixed, then teach the agents how to nominate a different
    agent when they think it is needed
