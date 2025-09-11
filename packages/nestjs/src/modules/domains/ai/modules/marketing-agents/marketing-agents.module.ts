import { Module } from "@nestjs/common";

import { SnowflakeUtilsModule } from "../../../../snowflake-utils/snowflake-utils.module";
import { AgentServicesModule } from "../agent-services";
import { SnowflakeCortexModule } from "../snowflake-agent/snowflake-agent.module";
import { MarketingCampaignAgent } from "./adapters/marketing-campaign.agent";

@Module({
  imports: [SnowflakeUtilsModule, AgentServicesModule, SnowflakeCortexModule],
  providers: [MarketingCampaignAgent],
  exports: [MarketingCampaignAgent],
})
export class MarketingAgentsModule {}
