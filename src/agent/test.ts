/**
 * Test script for the LangGraph agent.
 *
 * This file provides a simple way to test the agent locally.
 *
 * Prerequisites:
 * 1. Install Ollama: https://ollama.ai/
 * 2. Start Ollama service: `ollama serve` (or it may start automatically)
 * 3. Pull a model that supports tool calling: `ollama pull <model>`
 *
 * To run this test:
 * - Using bun (recommended):
 *   `bun run src/agent/test.ts`
 *
 * - With a custom query:
 *   `bun run src/agent/test.ts "Your custom query here"`
 *
 * - Or use the npm script:
 *   `bun run test-agent`
 */

import { createAgent } from "./graph.js";

/**
 * Test function to run the agent locally.
 *
 * Usage:
 * 1. Make sure Ollama is running: `ollama serve`
 * 2. Pull a model that supports tool calling: `ollama pull <model>`
 * 3. Run this file with: `bun run src/agent/test.ts`
 *
 * Or use the npm script:
 * `bun run test-agent`
 */
async function runTest() {
  // You can customize the test query here
  const testQuery = process.argv[2]
    ? process.argv.slice(2).join(" ")
    : "Read the package.json file and tell me what the project name is.";

  const projectPath = process.cwd();
  const model = "qwen3:1.7b";
  const agent = createAgent({ projectPath, model });

  console.log("🤖 Testing LangGraph Agent with model:", model);
  console.log("📁 Project path:", projectPath);
  console.log("💬 Query:", testQuery);
  console.log("\n--- Agent Response ---\n");

  try {
    const stream = await agent.stream({
      messages: [
        {
          role: "user",
          content: testQuery,
        },
      ],
    }, { streamMode: "updates" });

    for await (const chunk of stream) {
      const [step, content] = Object.entries(chunk)[0];
      console.log(`step: ${step}`);
      console.log(`content: ${JSON.stringify(content, null, 2)}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("\nTroubleshooting:");
      console.error("1. Make sure Ollama is running: ollama serve");
      console.error(`2. Make sure the model is installed: ollama pull ${model}`);
      console.error("3. Check that the model name is correct in the code");
    }
    process.exit(1);
  }
}

runTest().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
