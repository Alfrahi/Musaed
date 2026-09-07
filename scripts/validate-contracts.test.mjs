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
        stateTypes: [],
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

// LOW-2: bare (unwrapped) command returns must be rejected even when the
// inner type matches, since the frontend protocol requires ApiResponse.
test('strict flags non-ApiResponse wrapper shape', () => {
  const make = (returnType) => {
    const rust = new Map([
      ['cmd_test', { argCount: 0, argNames: [], argTypes: [], stateTypes: [], returnType }],
    ]);
    const ts = new Map([
      [
        'cmd_test',
        { argCount: 0, argNames: [], argTypes: [], argOptional: [], returnType: 'boolean' },
      ],
    ]);
    return validate(rust, ts, { strict: true }).filter((i) => i.type === 'WRAPPER_SHAPE');
  };
  assert.strictEqual(make('bool').length, 1, 'bare bool must be flagged');
  assert.strictEqual(make('boolean').length, 1, 'bare boolean must be flagged');
  assert.strictEqual(make('ApiResponse<bool>').length, 0);
  assert.strictEqual(make('Result<ApiResponse<bool>, String>').length, 0);
  assert.strictEqual(make('Result<ApiResponse<()>, String>').length, 0);
});
