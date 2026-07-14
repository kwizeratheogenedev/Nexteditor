import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedOrigins, isOriginAllowed } from '../socket.js';

test('parseAllowedOrigins trims comma-separated values', () => {
  const origins = parseAllowedOrigins(' http://localhost:5173 , http://127.0.0.1:5173 ');
  assert.deepStrictEqual(origins, ['http://localhost:5173', 'http://127.0.0.1:5173']);
});

test('isOriginAllowed accepts localhost and loopback origins', () => {
  const origins = parseAllowedOrigins('http://localhost:5173, http://127.0.0.1:5173');
  assert.equal(isOriginAllowed('http://localhost:5173', origins), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:5173', origins), true);
  assert.equal(isOriginAllowed('http://localhost:5175', origins), true);
  assert.equal(isOriginAllowed('https://example.com', origins), false);
});
