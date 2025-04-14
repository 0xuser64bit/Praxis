import { SolanaAgentKit, createSolanaTools } from "solana-agent-kit";

const agent = new SolanaAgentKit(
  "your-wallet-private-key-as-base58",
  "https://api.mainnet-beta.solana.com",
  {
    OPENAI_API_KEY: "your-openai-api-key",
  }
);

// Create LangChain tools
const tools = createSolanaTools(agent);

/*
  - Fetch user's private key from backend
  - getAllTokens() // Fetch all tokens from user's wallet
  - example: https://github.com/sendaifun/solana-agent-kit/blob/main/examples/discord-bot-starter/src/index.ts 
*/
