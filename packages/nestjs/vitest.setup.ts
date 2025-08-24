// Setup environment variables for tests
process.env.SLACK_BOT_TOKEN = 'test-bot-token';
process.env.SLACK_APP_TOKEN = 'test-app-token';
process.env.SLACK_SOCKET_MODE = 'true';
process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';

// JWT Configuration
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.JWT_EXPIRATION = '24h';
process.env.JWT_ISSUER = 'test-app';
process.env.JWT_AUDIENCE = 'test-audience';

// LLM Configuration
process.env.LLM_PRIMARY_PROVIDER = 'openai';
process.env.LLM_OPENAI_KEY = 'test-openai-key';
process.env.LLM_OPENAI_BASE_URL = 'https://api.openai.com/v1';
process.env.LLM_OPENAI_MODEL = 'gpt-3.5-turbo';

// AWS Configuration
process.env.AWS_DEFAULT_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://localhost:8000';
process.env.DYNAMODB_CREATE_TABLES = 'false';

// Tool configurations
process.env.LLM_TOOLS_SEARXNG_ENABLED = 'false';
process.env.LLM_TOOLS_SLACK_ENABLED = 'false';

// Agent configurations
process.env.AGENT_SNOWFLAKE_CORTEX_ENABLED = 'false';
process.env.AGENT_SNOWFLAKE_CORTEX_ENDPOINT = 'http://localhost:3000';