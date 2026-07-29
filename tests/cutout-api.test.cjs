const assert = require('node:assert/strict');
const test = require('node:test');
const handler = require('../api/cutout.js');

const helpers = handler.__private;
const requestFor = (ip = '203.0.113.7') => ({ headers: { 'x-forwarded-for': ip } });

test('accepts a signed JPEG data URL and rejects mismatched image bytes', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  assert.deepEqual(helpers.readImage(`data:image/jpeg;base64,${jpeg.toString('base64')}`), jpeg);
  assert.throws(
    () => helpers.readImage(`data:image/png;base64,${jpeg.toString('base64')}`),
    (error) => error instanceof helpers.RequestError && error.status === 422
  );
});

test('rejects oversized cutout payloads before Alibaba Cloud is called', () => {
  const oversized = `data:image/jpeg;base64,${'A'.repeat(helpers.MAX_REQUEST_BYTES)}`;
  assert.throws(
    () => helpers.readImage(oversized),
    (error) => error instanceof helpers.RequestError && error.status === 413
  );
});

test('limits one client after eight cutout attempts in a minute', () => {
  helpers.requestWindows.clear();
  const request = requestFor();
  for (let attempt = 0; attempt < helpers.RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
    assert.equal(helpers.checkMemoryRateLimit(request), 0);
  }
  assert.ok(helpers.checkMemoryRateLimit(request) >= 1);
  helpers.requestWindows.clear();
});

test('returns an explicit unavailable response when cloud credentials are absent', async () => {
  helpers.requestWindows.clear();
  const response = {
    code: null,
    payload: null,
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader() {}
  };
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '2', 'x-forwarded-for': '198.51.100.20' },
    body: {}
  }, response);
  assert.equal(response.code, 503);
  assert.equal(response.payload.error, 'Cloud cutout is not configured yet.');
  helpers.requestWindows.clear();
});
