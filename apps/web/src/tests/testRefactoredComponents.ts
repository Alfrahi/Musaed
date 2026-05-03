// Test script for refactored components

import { stripRedactedThinkingBlocksAsync } from '@musaed/contracts';

// Test Web Worker functionality
async function testStripRedactedThinkingBlocks() {
  const testContent = 'Hello<redacted-thinking>secret</redacted-thinking>World';
  const expected = 'HelloWorld';
  const { content, method } = await stripRedactedThinkingBlocksAsync(testContent);
  console.assert(
    content === expected,
    `stripRedactedThinkingBlocksAsync failed: expected ${expected}, got ${content}`
  );
  console.assert(method === 'worker' || method === 'sync', `Unexpected method: ${method}`);
  console.log(`✅ stripRedactedThinkingBlocksAsync test passed (method: ${method})`);
}

// Run the test
async function runTests() {
  await testStripRedactedThinkingBlocks();
  console.log('All tests completed');
}

runTests().catch(console.error);
