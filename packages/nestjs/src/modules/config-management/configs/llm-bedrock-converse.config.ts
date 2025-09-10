import { registerAs } from "@nestjs/config";

export default registerAs("llm.bedrock-converse", () => {
  return {
    model: process.env.LLM_BEDROCK_CONVERSE_MODEL,
    region: process.env.LLM_BEDROCK_CONVERSE_REGION,
    temp: Number.parseFloat(process.env.LLM_BEDROCK_CONVERSE_TEMP!),
  };
});
