import { test } from 'node:test';
import assert from 'node:assert';
import { validate, parseRustCommands, parseTsCommandMap } from './validate-contracts.mjs';

// Baseline sanity check – using the live codebase should produce no error‑severity issues
test('baseline non‑strict passes', () => {
  const rust = parseRustCommands();
  const ts = parseTsCommandMap();
  const issues = validate(rust, ts, { strict: false });
  const errorIssues = issues.filter((i) => i.severity === 'error');
  assert.strictEqual(errorIssues.length, 0);
});

// Strict mode validation – construct a minimal mismatch to ensure TYPE_MISMATCH is reported
test('strict detects return‑type drift', () => {
  const rust = new Map([
    [
      'cmd_test',
      {
        argCount: 0,
        argNames: [],
        argTypes: [],
        returnType: 'bool',
      },
    ],
  ]);
  const ts = new Map([
    [
      'cmd_test',
      {
        argCount: 0,
        argNames: [],
        argTypes: [],
        argOptional: [],
        returnType: 'string',
      },
    ],
  ]);
  const issues = validate(rust, ts, { strict: true });
  const typeMismatch = issues.find((i) => i.type === 'TYPE_MISMATCH');
  assert.ok(typeMismatch, 'Expected a TYPE_MISMATCH issue');
  assert.ok(typeMismatch.message.includes('return type drift'));
});
