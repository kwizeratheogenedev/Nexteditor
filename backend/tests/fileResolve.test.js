import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateFilePath, getFileSource } from '../services/fileResolve.js';

const base = path.resolve('/srv/app/uploads');
const inside = path.join(base, 'abc123');

test('accepts a file inside the allowed folder', () => {
  assert.equal(validateFilePath(inside, [base]), true);
});

test('rejects the folder itself and anything outside it', () => {
  assert.equal(validateFilePath(base, [base]), false);
  assert.equal(validateFilePath(path.resolve('/etc/passwd'), [base]), false);
  assert.equal(validateFilePath(path.resolve('/srv/app/other/file'), [base]), false);
});

test('rejects path traversal that climbs out of the folder', () => {
  assert.equal(validateFilePath(path.join(base, '..', '..', 'etc', 'passwd'), [base]), false);
  assert.equal(validateFilePath(`${base}/../secrets.txt`, [base]), false);
});

test('rejects empty and non-string input', () => {
  assert.equal(validateFilePath('', [base]), false);
  assert.equal(validateFilePath(null, [base]), false);
  assert.equal(validateFilePath({ path: inside }, [base]), false);
});

test('getFileSource prefers an uploaded file and validates its path', () => {
  assert.equal(getFileSource({ path: inside }, null, [base]), inside);
  assert.throws(() => getFileSource({ path: path.resolve('/etc/passwd') }, null, [base]), /Invalid file path/);
});

test('getFileSource rejects a crafted path field pointing outside the folder', () => {
  assert.throws(() => getFileSource(null, path.resolve('/etc/passwd'), [base]), /Invalid file path/);
  assert.equal(getFileSource(null, inside, [base]), inside);
  assert.equal(getFileSource(null, null, [base]), null);
});
