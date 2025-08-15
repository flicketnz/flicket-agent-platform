import {
  AIMessage,
  BaseMessage,
  BaseMessageLike,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

export const normalizeMessage = (message: BaseMessageLike) => {
  // If the message is already a LangChain class, just return it.
  if (message instanceof BaseMessage) {
    return message;
  }

  let role;
  let content;

  // Handle the string input (implicitly a human/user message)
  if (typeof message === "string") {
    role = "user";
    content = message;
  }
  // Handle the [role, content] array input
  else if (
    Array.isArray(message) &&
    message.length === 2 &&
    typeof message[0] === "string"
  ) {
    [role, content] = message;
  }
  // Throw an error for unrecognized formats.
  else {
    throw new Error(
      `Invalid BaseMessageLike format: ${JSON.stringify(message)}`,
    );
  }

  // Use a switch statement to instantiate the correct LangChain class
  // based on the message role.
  switch (role.toLowerCase()) {
    case "human":
    case "user":
      return new HumanMessage({ content });
    case "ai":
    case "assistant":
      return new AIMessage({ content });
    case "system":
      return new SystemMessage({ content });

    // intentionally ignore tool and function messages
    default:
      throw new Error(`cannot handle role "${role}" at this time`);
  }
};
