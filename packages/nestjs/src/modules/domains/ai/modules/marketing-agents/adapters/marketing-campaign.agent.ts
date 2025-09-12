import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  Annotation,
  type CompiledStateGraph,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { Injectable, Logger } from "@nestjs/common";
import {
  SnowflakeService,
  type SQLExecutionResult,
} from "src/modules/snowflake-utils";
import { v4 as uuidv4 } from "uuid";

import { Agent, GraphAgentPort } from "../../agent-services";
import {
  InjectPrimaryChatModel,
  type PrimaryChatModelPort,
} from "../../model-providers/ports/primary-model.port";
import { SnowflakeCortexAgentAdapter } from "../../snowflake-agent/adapters/snowflake-cortex.agent";

/**
 * Agent Identifier
 */
const agentId = "marketing-campaign";
/**
 * Agent Name
 */
const agentName = "Marketing Campaign Agent";

@Injectable()
@Agent({
  agentId,
  capabilities: ["marketing", "high-value-conversions-for-event"],
})
export class MarketingCampaignAgent extends GraphAgentPort {
  readonly agentId = agentId;
  readonly agentName = agentName;
  protected graph:
    | CompiledStateGraph<
        typeof this.stateDefinition.State,
        Partial<typeof this.stateDefinition.Update>,
        | "__start__"
        | "validateInput"
        | "queryPotentialUsers"
        | "validateUsersInOrg"
        | "getEventDetails"
        | "generateEmailContent"
        | "executeCampaignActions"
        | "handleError"
      >
    | undefined;

  private readonly logger = new Logger(
    `${MarketingCampaignAgent.name} - ${agentId}`,
  );

  private readonly stateDefinition = Annotation.Root({
    organisationId: Annotation<string>(),
    eventId: Annotation<string>(),
    eventName: Annotation<string>(),
    eventDescription: Annotation<string>(),
    rawUserList: Annotation<any[][]>(),
    validatedUserList: Annotation<{ user_id: string }[]>(),
    emailContent: Annotation<string>(),
    executionId: Annotation<string>(),
    error: Annotation<string>(),
  });

  constructor(
    @InjectPrimaryChatModel()
    private readonly primaryChatModel: PrimaryChatModelPort,
    private readonly snowflakeCortexAgent: SnowflakeCortexAgentAdapter,
    private readonly snowflakeService: SnowflakeService,
  ) {
    super();
  }

  /**
   * @inheritdoc
   */
  getGraph() {
    if (this.graph) {
      return this.graph;
    }
    const workflow = new StateGraph(this.stateDefinition)
      .addNode("validateInput", this.validateInput.bind(this))
      .addNode("queryPotentialUsers", this.queryPotentialUsers.bind(this))
      .addNode("validateUsersInOrg", this.validateUsersInOrg.bind(this))
      .addNode("getEventDetails", this.getEventDetails.bind(this))
      .addNode("generateEmailContent", this.generateEmailContent.bind(this))
      .addNode("executeCampaignActions", this.executeCampaignActions.bind(this))
      .addNode("handleError", this.handleError.bind(this))

      // Add Edges
      .addEdge(START, "validateInput")
      .addConditionalEdges("validateInput", (state) => {
        if (state.error) {
          return "handleError";
        }
        return "queryPotentialUsers";
      })
      .addEdge("queryPotentialUsers", "validateUsersInOrg")
      .addConditionalEdges("validateUsersInOrg", (state) => {
        if (state.validatedUserList && state.validatedUserList.length > 0) {
          return "getEventDetails";
        }
        return END;
      })
      .addEdge("getEventDetails", "generateEmailContent")
      .addEdge("generateEmailContent", "executeCampaignActions")
      .addEdge("executeCampaignActions", END)
      .addEdge("handleError", END);

    this.graph = workflow.compile();
    return this.graph;
  }

  private validateInput(
    state: typeof this.stateDefinition.State,
  ): Partial<typeof this.stateDefinition.Update> {
    if (!state.organisationId || !state.eventId) {
      return {
        error: "Invalid input: organisationId and eventId are required.",
      };
    }
    return {};
  }

  private async queryPotentialUsers(
    state: typeof this.stateDefinition.State,
  ): Promise<Partial<typeof this.stateDefinition.Update>> {
    const question = `
      Find a list of potential customers who might be interested in the event with ID '${state.eventId}' run by the promoter (organization) with the organizationId '${state.organisationId}'.
      The final result should be a list of user IDs.

      Please strictly apply the following business rules when generating the user list:
      1.  **Ticket Exclusion:** The user must NOT already own a ticket for the event with ID '${state.eventId}'.
      2.  **Similar Event Exclusion:** The user must NOT own a ticket for any "similar" event.
        A similar event is defined as:
        - Any other event that shares the same name AND starts within 30 days of the target event
        - Any other event that has the same name, but has a different date identifier (i.e. a Day of Week, Day of Month, a date like 31-12-2025 etc.) AND starts within 30 days of the target event
    `;

    const result = (await this.snowflakeCortexAgent
      .getGraph()
      .invoke({ question })) as { response: SQLExecutionResult };

    return { rawUserList: result.response.data };
  }

  private async validateUsersInOrg(
    state: typeof this.stateDefinition.State,
  ): Promise<Partial<typeof this.stateDefinition.Update>> {
    if (!state.rawUserList || state.rawUserList.length === 0) {
      return { validatedUserList: [] };
    }

    const userIds = state.rawUserList.map((row) => row[0] as string);
    const query = `
      SELECT "id", "organizationId" FROM USERS
      WHERE "organizationId" = '${state.organisationId}' AND "id" IN (${userIds.map((id) => `'${id}'`).join(",")})
    `;

    const result = await this.snowflakeService.executeSQL(query);
    const confirmedUsers = result.data.map((row: any[]) => ({
      user_id: row[0] as string,
    }));

    return { validatedUserList: confirmedUsers };
  }

  private async getEventDetails(
    state: typeof this.stateDefinition.State,
  ): Promise<Partial<typeof this.stateDefinition.Update>> {
    const question = `
      For the event with ID '${state.eventId}', find the event name and description.
      Return just the event name and description.
    `;

    const result = (await this.snowflakeCortexAgent
      .getGraph()
      .invoke({ question })) as { response: SQLExecutionResult };

    if (result.response.data && result.response.data.length > 0) {
      const eventDetails = result.response.data[0];
      return {
        eventName: eventDetails[0] as string,
        eventDescription: eventDetails[1] as string,
      };
    }
    return {
      eventName: "our latest event",
      eventDescription: "a fantastic experience",
    };
  }

  private async generateEmailContent(
    state: typeof this.stateDefinition.State,
  ): Promise<Partial<typeof this.stateDefinition.Update>> {
    const executionId = uuidv4();
    const llm = this.primaryChatModel.model;

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a marketing expert. Write a short, exciting email to promote an event. The email should be personalized for the user, so please include the placeholder '{{user_name}}' where their name should go.
        
        Here are some tips on writing good emails:
        1. Keep the subject brief and to the point.
          - Mention the event name and reason for the email.
          - Aim for 7 words or less.
          Example: "Bay Dreams tomorrow! Remember your sunscreen! ☀️"
          Example: "Chiefs v Blues this Saturday 🏉 Avoid the queues"
        2. Make it easy to skim read.
          - Be clear and concise. Get to the point quickly.
          - For important links consider a button to draw attention.
          - Consider breaking up long paragraphs with headers or using bullet points.
        3. Make your links easy to understand.
          - Links should say where they go.
          - Don't rely on people reading the surrounding text.
          Example: If you need help please <a>contact support</a>.
          Example: Read the <a>terms and conditions</a> for more information.
          Example: Never say <a>click here</a>`,
      ],
      [
        "user",
        `Generate the email copy for the event '${state.eventName}' (ID: ${state.eventId}). The published event description is below: 
        
        ${state.eventDescription}`,
      ],
    ]);

    const chain = prompt.pipe(llm);
    const response = await chain.invoke({});

    let emailContent: string | undefined = undefined;
    if (typeof response.content === "string") {
      emailContent = response.content;
    } else if (Array.isArray(response.content)) {
      for (const element of response.content) {
        if (element.type == "text") {
          emailContent = element.text as string;
        }
      }
    }
    if (emailContent === undefined) {
      this.logger.error("Payload: ", response.content);
      throw new Error("Could not find llm response in payload");
    }
    return {
      emailContent,
      executionId,
    };
  }

  private async executeCampaignActions(
    state: typeof this.stateDefinition.State,
  ): Promise<Partial<typeof this.stateDefinition.Update>> {
    for (const user of state.validatedUserList) {
      await this.tagUserInFlicket(
        user.user_id,
        `campaign-run-${state.executionId}`,
      );
    }
    await this.createBroadcast(
      state.emailContent,
      `campaign-run-${state.executionId}`,
    );
    await this.notifyAdmins(
      `Broadcast created for organisation ${state.organisationId} and event ${state.eventId}.`,
    );
    return {};
  }

  private handleError(
    state: typeof this.stateDefinition.State,
  ): Partial<typeof this.stateDefinition.Update> {
    this.logger.error(state.error);
    return {};
  }

  // Placeholder methods for side effects
  private async tagUserInFlicket(userId: string, tag: string): Promise<void> {
    this.logger.debug(`Tagging user ${userId} with '${tag}'`);
    // Simulate API call
    return Promise.resolve();
  }

  private async createBroadcast(
    content: string,
    campaignId: string,
  ): Promise<void> {
    this.logger.debug(
      `Creating broadcast for campaign '${campaignId}' with content: ${content.substring(
        0,
        50,
      )}...`,
    );
    // Simulate API call
    return Promise.resolve();
  }

  /**
   * This method would create a new 'notification' for the org admins - potentially using productfruits newsfeed
   *
   * Looks like we can do that by creating a news feed item for a segment, and making the segment org specific (need to check but if product fruits is also available to end users, would need to further segment by role/admin )
   * @param message
   * @returns
   */
  private async notifyAdmins(message: string): Promise<void> {
    this.logger.log(`Notifying admins: ${message}`);
    // Simulate notification
    return Promise.resolve();
  }

  healthcheck() {
    return { status: "up" as const };
  }
}
