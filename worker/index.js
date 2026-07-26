const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_CUTOUT_BYTES = 6 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_REQUEST_BYTES = MAX_BASE64_CHARS + 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const requestWindows = new Map();

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonError(status, message, headers = {}) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...headers
      }
    }
  );
}

function checkRateLimit(request) {
  const now = Date.now();
  if (requestWindows.size > 1_000) {
    for (const [key, value] of requestWindows) {
      if (now >= value.resetAt) requestWindows.delete(key);
    }
  }

  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown';
  const entry = requestWindows.get(ip);
  if (!entry || now >= entry.resetAt) {
    requestWindows.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return 0;
  }

  entry.count += 1;
  if (entry.count <= RATE_LIMIT_MAX_REQUESTS) return 0;
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_REQUEST_BYTES) {
    throw new RequestError(413, 'Please choose a photo smaller than 3 MB.');
  }

  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match || match[2].length > MAX_BASE64_CHARS) {
    throw new RequestError(422, 'Please upload a JPEG, PNG, or WebP image.');
  }

  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    throw new RequestError(422, 'The uploaded file is not a valid image.');
  }
  if (!binary.length || binary.length > MAX_IMAGE_BYTES) {
    throw new RequestError(413, 'Please choose a photo smaller than 3 MB.');
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (!hasExpectedSignature(bytes, match[1])) {
    throw new RequestError(422, 'The uploaded file is not a valid image.');
  }

  return {
    bytes,
    contentType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1]
  };
}

function hasExpectedSignature(bytes, mimeType) {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  );
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmacSha1Base64(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${secret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signedRpcFetch({ endpoint, method, action, version, params, accessKeyId, accessKeySecret }) {
  const signedParams = {
    Action: action,
    Format: 'json',
    Version: version,
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureNonce: crypto.randomUUID(),
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    AccessKeyId: accessKeyId,
    ...params
  };
  const canonicalQuery = Object.keys(signedParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(signedParams[key])}`)
    .join('&');
  const stringToSign = `${method}&${percentEncode('/')}&${percentEncode(canonicalQuery)}`;
  signedParams.Signature = await hmacSha1Base64(stringToSign, accessKeySecret);

  const query = Object.keys(signedParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(signedParams[key])}`)
    .join('&');
  const response = await fetch(`https://${endpoint}/?${query}`, {
    method,
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.Code) {
    const code = payload.Code || `HTTP_${response.status}`;
    throw new Error(`Alibaba Cloud request failed (${code}).`);
  }
  return payload;
}

async function uploadTemporaryImage(image, credentials) {
  const authorization = await signedRpcFetch({
    endpoint: 'openplatform.aliyuncs.com',
    method: 'GET',
    action: 'AuthorizeFileUpload',
    version: '2019-12-19',
    params: { Product: 'imageseg' },
    ...credentials
  });

  const requiredFields = [
    'Bucket',
    'Endpoint',
    'AccessKeyId',
    'EncodedPolicy',
    'Signature',
    'ObjectKey'
  ];
  if (!requiredFields.every((field) => authorization[field])) {
    throw new Error('Alibaba Cloud did not authorize the temporary upload.');
  }

  const form = new FormData();
  form.set('OSSAccessKeyId', authorization.AccessKeyId);
  form.set('policy', authorization.EncodedPolicy);
  form.set('Signature', authorization.Signature);
  form.set('key', authorization.ObjectKey);
  form.set('success_action_status', '201');
  form.set(
    'file',
    new Blob([image.bytes], { type: image.contentType }),
    authorization.ObjectKey
  );

  const upload = await fetch(`https://${authorization.Bucket}.${authorization.Endpoint}/`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20_000)
  });
  if (!upload.ok) {
    throw new Error(`Alibaba Cloud upload failed (HTTP_${upload.status}).`);
  }

  return `http://${authorization.Bucket}.${authorization.Endpoint}/${authorization.ObjectKey}`;
}

async function readResponseBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestError(502, 'The cutout image is too large.');
  }
  if (!response.body) throw new RequestError(502, 'The cutout image was empty.');

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RequestError(502, 'The cutout image is too large.');
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
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
  if (url.protocol !== 'https:') {
    throw new RequestError(502, 'Cloud cutout returned an invalid download URL.');
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.toLowerCase().startsWith('image/')) {
    throw new RequestError(502, 'Could not retrieve the cutout image.');
  }
  const image = await readResponseBody(response, MAX_CUTOUT_BYTES);
  if (!hasExpectedSignature(image, 'image/png')) {
    throw new RequestError(502, 'Cloud cutout returned an invalid image.');
  }
  return image;
}

async function cutout(request, env) {
  if (request.method !== 'POST') return jsonError(405, 'Method not allowed.');

  const retryAfter = checkRateLimit(request);
  if (retryAfter) {
    return jsonError(
      429,
      'Too many cutout requests. Please try again shortly.',
      { 'Retry-After': String(retryAfter) }
    );
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError(413, 'Please choose a photo smaller than 3 MB.');
  }
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return jsonError(415, 'Content-Type must be application/json.');
  }

  const accessKeyId = env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    return jsonError(503, 'Cloud cutout is not configured yet.');
  }

  try {
    const body = await request.json();
    const image = decodeImage(body?.image);
    const credentials = { accessKeyId, accessKeySecret };
    const imageUrl = await uploadTemporaryImage(image, credentials);
    const result = await signedRpcFetch({
      endpoint: 'imageseg.cn-shanghai.aliyuncs.com',
      method: 'POST',
      action: 'SegmentCommonImage',
      version: '2019-12-30',
      params: {
        ImageURL: imageUrl,
        ReturnForm: 'crop'
      },
      ...credentials
    });
    const resultUrl = result?.Data?.ImageURL;
    if (!resultUrl) throw new Error('Alibaba Cloud did not return a cutout image.');

    const png = await downloadCutout(resultUrl);
    return new Response(png, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength)
      }
    });
  } catch (error) {
    console.error('Aliyun cutout failed', error);
    if (error instanceof RequestError) return jsonError(error.status, error.message);
    if (error instanceof SyntaxError) return jsonError(400, 'The request body is invalid.');
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return jsonError(504, 'The cutout request timed out.');
    }
    return jsonError(502, 'Cloud cutout failed.');
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/cutout') return cutout(request, env);
    return env.ASSETS.fetch(request);
  }
};

export default worker;
