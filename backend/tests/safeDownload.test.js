import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPublicAddress, downloadToFile, downloadErrorMessage } from '../services/safeDownload.js';

test('private, local and special addresses are not public', () => {
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', 'not-an-ip',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('ordinary internet addresses are public', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test('downloads to localhost are refused without contacting it', async (t) => {
  let contacted = 0;
  const server = http.createServer((req, res) => { contacted += 1; res.end('secret'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const out = path.join(os.tmpdir(), `safe-download-test-${process.pid}`);

  for (const url of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::1]:${port}/`, `http://0x7f000001:${port}/`]) {
    await assert.rejects(downloadToFile(url, out), (err) => {
      assert.match(downloadErrorMessage(err), /private or local network|valid link|Could not download/, url);
      return true;
    });
  }
  assert.equal(contacted, 0);
  assert.equal(fs.existsSync(out), false);
});

test('only http and https links are accepted', async () => {
  await assert.rejects(downloadToFile('file:///etc/passwd', 'unused'), /http:\/\/ or https:\/\//);
  await assert.rejects(downloadToFile('not a url', 'unused'), /valid link/);
});
