import dns from 'dns';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

// Downloads a user-supplied link to a file, safely:
//   - only to public internet addresses. A link to localhost, the private
//     network or the cloud's metadata address (169.254.169.254) is refused -
//     otherwise anyone could use the server to reach places only it can
//     (SSRF). The check runs when each connection is made, on the address
//     actually connected to, so a domain can't pass the check and then point
//     somewhere private; each redirect is checked the same way.
//   - capped in size (MAX_URL_DOWNLOAD_GB, default 2), so one link can't
//     fill the disk.
//   - written with backpressure and finished before it returns.

const GB = 1024 ** 3;
export const MAX_DOWNLOAD_BYTES = (Number(process.env.MAX_URL_DOWNLOAD_GB) || 2) * GB;
const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT_MS = 30_000;

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, 'ipv6'));

// An IPv6 address carrying an IPv4 one (::ffff:10.0.0.1, or NAT64's
// 64:ff9b::a00:1) is judged by the IPv4 address inside it.
function embeddedIpv4(address) {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return null;
}

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) {
    const v4 = embeddedIpv4(address);
    return v4 ? !blocked.check(v4, 'ipv4') : !blocked.check(address, 'ipv6');
  }
  return false;
}

export class DownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DownloadError';
    this.userFacing = true;
  }
}

const privateAddressError = () => new DownloadError('That link points to a private or local network address, which isn\'t allowed.');
const tooBigError = (maxBytes) => new DownloadError(maxBytes >= GB
  ? `That file is larger than the ${Math.round(maxBytes / GB)} GB limit for links.`
  : `That file is larger than the ${Math.round(maxBytes / 1024 ** 2)} MB limit for links.`);

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return callback(privateAddressError());
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new DownloadError('That isn\'t a valid link.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new DownloadError('Links must start with http:// or https://');
  }
  // A link written as an IP address connects without a DNS lookup, so it's
  // checked here instead.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) throw privateAddressError();
  return url;
}

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { headers, lookup: safeLookup, timeout: CONNECT_TIMEOUT_MS }, resolve);
    req.on('timeout', () => req.destroy(new DownloadError('The link took too long to respond.')));
    req.on('error', reject);
  });
}

function statusError(status) {
  if (status === 401 || status === 403) return new DownloadError('Access denied. The URL may be private or require authentication.');
  if (status === 404) return new DownloadError('URL not found (404). Please check the link.');
  return new DownloadError(`The link returned an error (HTTP ${status}).`);
}

// onProgress(receivedBytes, totalBytes or 0 when unknown)
export async function downloadToFile(rawUrl, outputPath, { headers = {}, maxBytes = MAX_DOWNLOAD_BYTES, onProgress } = {}) {
  let url = checkUrl(rawUrl);
  for (let hop = 0; ; hop += 1) {
    const response = await request(url, headers);
    const status = response.statusCode || 0;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.resume();
      if (hop >= MAX_REDIRECTS) throw new DownloadError('The link redirects too many times.');
      url = checkUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw statusError(status);
    }
    const total = Number(response.headers['content-length']) || 0;
    if (total > maxBytes) {
      response.destroy();
      throw tooBigError(maxBytes);
    }
    let received = 0;
    const counter = new Transform({
      transform(chunk, _encoding, done) {
        received += chunk.length;
        if (received > maxBytes) {
          done(tooBigError(maxBytes));
          return;
        }
        onProgress?.(received, total);
        done(null, chunk);
      },
    });
    try {
      await pipeline(response, counter, fs.createWriteStream(outputPath));
    } catch (err) {
      await fs.promises.rm(outputPath, { force: true });
      throw err;
    }
    return { bytes: received };
  }
}

// What to show the user for a failed download: our own messages as they
// are, anything else (network internals) as a plain sentence.
export function downloadErrorMessage(err) {
  if (err?.userFacing) return err.message;
  if (err?.code === 'ENOTFOUND') return 'Invalid domain or network error.';
  return 'Could not download that link - check that it opens in a browser.';
}
