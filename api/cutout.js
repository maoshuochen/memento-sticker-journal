const { Readable } = require('node:stream');
const ImagesegClient = require('@alicloud/imageseg20191230');
const OpenapiClient = require('@alicloud/openapi-client');
const TeaUtil = require('@alicloud/tea-util');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_CUTOUT_BYTES = 6 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_REQUEST_BYTES = MAX_BASE64_CHARS + 1024;
const DOWNLOAD_TIMEOUT_MS = 12_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const requestWindows = new Map();

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return request.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(request) {
  const now = Date.now();
  if (requestWindows.size > 1_000) {
    for (const [key, value] of requestWindows) {
      if (now >= value.resetAt) requestWindows.delete(key);
    }
  }
  const ip = getClientIp(request);
  const entry = requestWindows.get(ip);
  if (!entry || now >= entry.resetAt) {
    requestWindows.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return 0;
  }
  entry.count += 1;
  if (entry.count <= RATE_LIMIT_MAX_REQUESTS) return 0;
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

function createClient() {
  const config = new OpenapiClient.Config({
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET
  });
  config.endpoint = 'imageseg.cn-shanghai.aliyuncs.com';
  return new ImagesegClient.default(config);
}

function readImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_REQUEST_BYTES) {
    throw new RequestError(413, 'Please choose a photo smaller than 3 MB.');
  }
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match || match[2].length > MAX_BASE64_CHARS) throw new RequestError(422, 'Please upload a JPEG, PNG, or WebP image.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new RequestError(413, 'Please choose a photo smaller than 3 MB.');
  if (!hasExpectedSignature(buffer, match[1])) throw new RequestError(422, 'The uploaded file is not a valid image.');
  return buffer;
}

function hasExpectedSignature(buffer, mimeType) {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

async function readResponseBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new RequestError(502, 'The cutout image is too large.');
  if (!response.body) throw new RequestError(502, 'The cutout image was empty.');

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RequestError(502, 'The cutout image is too large.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function downloadCutout(resultUrl) {
  let url;
  try {
    url = new URL(resultUrl);
  } catch {
    throw new RequestError(502, 'Cloud cutout returned an invalid download URL.');
  }
  if (url.protocol === 'http:' && url.hostname.endsWith('.aliyuncs.com')) {
    url.protocol = 'https:';
  }
  if (url.protocol !== 'https:') throw new RequestError(502, 'Cloud cutout returned an invalid download URL.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const imageResponse = await fetch(url, { signal: controller.signal });
    const contentType = imageResponse.headers.get('content-type') || '';
    if (!imageResponse.ok || !contentType.toLowerCase().startsWith('image/')) throw new RequestError(502, 'Could not retrieve the cutout image.');
    const image = await readResponseBody(imageResponse, MAX_CUTOUT_BYTES);
    if (!hasExpectedSignature(image, 'image/png')) throw new RequestError(502, 'Cloud cutout returned an invalid image.');
    return image;
  } catch (error) {
    if (error.name === 'AbortError') throw new RequestError(504, 'The cutout request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async (request, response) => {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const retryAfter = checkRateLimit(request);
  if (retryAfter) {
    response.setHeader('Retry-After', String(retryAfter));
    return response.status(429).json({ error: 'Too many cutout requests. Please try again shortly.' });
  }
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return response.status(413).json({ error: 'Please choose a photo smaller than 3 MB.' });
  if (!request.headers['content-type']?.toLowerCase().includes('application/json')) return response.status(415).json({ error: 'Content-Type must be application/json.' });
  if (!process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || !process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET) {
    return response.status(503).json({ error: 'Cloud cutout is not configured yet.' });
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    const image = readImage(body?.image);
    const cutoutRequest = new ImagesegClient.SegmentCommonImageAdvanceRequest({ returnForm: 'crop' });
    cutoutRequest.imageURLObject = Readable.from(image);

    const result = await createClient().segmentCommonImageAdvance(cutoutRequest, new TeaUtil.RuntimeOptions({ connectTimeout: 5_000, readTimeout: 20_000 }));
    const resultUrl = result?.body?.data?.imageURL;
    if (!resultUrl) throw new Error('Cloud cutout did not return an image.');

    const png = await downloadCutout(resultUrl);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'image/png');
    return response.status(200).send(png);
  } catch (error) {
    console.error('Aliyun cutout failed', error);
    const status = error instanceof RequestError ? error.status : 502;
    const message = error instanceof RequestError ? error.message : 'Cloud cutout failed.';
    return response.status(status).json({ error: message });
  }
};
