// Simple test script for Web Worker functionality

const { stripRedactedThinkingBlocksAsync } = require('@musaed/contracts');

// Test Web Worker functionality
async function testStripRedactedThinkingBlocks() {
  const testContent = 'Hello<redacted-thinking>secret</redacted-thinking>World';
  const expected = 'HelloWorld';
  const result = await stripRedactedThinkingBlocksAsync(testContent);
  console.assert(result === expected, `stripRedactedThinkingBlocksAsync failed: expected ${expected}, got ${result}`);
  console.log('✅ stripRedactedThinkingBlocksAsync test passed');
}

// Run the test
async function runTests() {
  await testStripRedactedThinkingBlocks();
  console.log('All tests completed');
}

runTests().catch(console.error);