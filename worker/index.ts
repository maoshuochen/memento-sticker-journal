const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_CUTOUT_BYTES = 6 * 1024 * 1024
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

type RuntimeEnv = Env & {
  ALIBABA_CLOUD_ACCESS_KEY_ID?: string
  ALIBABA_CLOUD_ACCESS_KEY_SECRET?: string
  RATE_LIMIT_SALT?: string
}

type Credentials = {
  accessKeyId: string
  accessKeySecret: string
}

type RpcValue = string | number | boolean
type RpcParameters = Record<string, RpcValue>

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function jsonError(
  status: number,
  code: string,
  message: string,
  headers: HeadersInit = {},
): Response {
  return Response.json(
    { error: message, code },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...Object.fromEntries(new Headers(headers)),
      },
    },
  )
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY)
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("X-Frame-Options", "DENY")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function recordString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const result = value[key]
  return typeof result === "string" && result.length > 0 ? result : undefined
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.byteLength >= prefix.byteLength && prefix.every((byte, index) => bytes[index] === byte)
}

export function hasExpectedSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mimeType === "image/png") return hasPrefix(bytes, PNG_SIGNATURE)
  if (mimeType === "image/webp") {
    return (
      bytes.byteLength >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    )
  }
  return false
}

async function validateImage(file: File): Promise<{ bytes: Uint8Array; contentType: string }> {
  const contentType = file.type.toLowerCase()
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw new RequestError(415, "UNSUPPORTED_IMAGE_TYPE", "请上传 JPEG、PNG 或 WebP 图片。")
  }
  if (file.size === 0) {
    throw new RequestError(400, "EMPTY_IMAGE", "上传的图片是空文件。")
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new RequestError(413, "IMAGE_TOO_LARGE", "请选择小于 3 MiB 的图片。")
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!hasExpectedSignature(bytes, contentType)) {
    throw new RequestError(415, "INVALID_IMAGE_SIGNATURE", "上传的文件不是有效图片。")
  }
  return { bytes, contentType }
}

function percentEncode(value: RpcValue): string {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

async function hmacSha1Base64(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${secret}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  )
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))
  let binary = ""
  for (const byte of signature) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function signRpcParameters(
  method: "GET" | "POST",
  action: string,
  version: string,
  params: RpcParameters,
  credentials: Credentials,
): Promise<RpcParameters> {
  const signed: RpcParameters = {
    Action: action,
    Format: "json",
    Version: version,
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    SignatureNonce: crypto.randomUUID(),
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    AccessKeyId: credentials.accessKeyId,
    ...params,
  }
  const canonicalQuery = Object.keys(signed)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(signed[key] ?? "")}`)
    .join("&")
  const stringToSign = `${method}&${percentEncode("/")}&${percentEncode(canonicalQuery)}`
  signed.Signature = await hmacSha1Base64(stringToSign, credentials.accessKeySecret)
  return signed
}

async function signedRpcFetch(
  endpoint: string,
  method: "GET" | "POST",
  action: string,
  version: string,
  params: RpcParameters,
  credentials: Credentials,
): Promise<Record<string, unknown>> {
  const signed = await signRpcParameters(method, action, version, params, credentials)
  const query = Object.keys(signed)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(signed[key] ?? "")}`)
    .join("&")
  const response = await fetch(`https://${endpoint}/?${query}`, {
    method,
    signal: AbortSignal.timeout(20_000),
  })
  const payload: unknown = await response.json().catch(() => ({}))
  const upstreamCode = recordString(payload, "Code")
  if (!response.ok || upstreamCode) {
    throw new RequestError(
      502,
      "ALIBABA_RPC_FAILED",
      `阿里云图片服务请求失败（${upstreamCode ?? `HTTP_${response.status}`}）。`,
    )
  }
  if (!isRecord(payload)) {
    throw new RequestError(502, "ALIBABA_INVALID_RESPONSE", "阿里云图片服务返回了无效响应。")
  }
  return payload
}

async function uploadTemporaryImage(
  image: { bytes: Uint8Array; contentType: string },
  credentials: Credentials,
): Promise<string> {
  const authorization = await signedRpcFetch(
    "openplatform.aliyuncs.com",
    "GET",
    "AuthorizeFileUpload",
    "2019-12-19",
    { Product: "imageseg" },
    credentials,
  )
  const bucket = recordString(authorization, "Bucket")
  const endpoint = recordString(authorization, "Endpoint")
  const uploadAccessKey = recordString(authorization, "AccessKeyId")
  const policy = recordString(authorization, "EncodedPolicy")
  const signature = recordString(authorization, "Signature")
  const objectKey = recordString(authorization, "ObjectKey")
  if (!bucket || !endpoint || !uploadAccessKey || !policy || !signature || !objectKey) {
    throw new RequestError(502, "ALIBABA_UPLOAD_AUTH_INVALID", "阿里云未能授权临时图片上传。")
  }

  const form = new FormData()
  form.set("OSSAccessKeyId", uploadAccessKey)
  form.set("policy", policy)
  form.set("Signature", signature)
  form.set("key", objectKey)
  form.set("success_action_status", "201")
  const uploadBytes = new Uint8Array(image.bytes.byteLength)
  uploadBytes.set(image.bytes)
  form.set("file", new Blob([uploadBytes.buffer], { type: image.contentType }), objectKey)

  const upload = await fetch(`https://${bucket}.${endpoint}/`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  })
  if (!upload.ok) {
    throw new RequestError(502, "ALIBABA_UPLOAD_FAILED", `阿里云图片上传失败（HTTP_${upload.status}）。`)
  }
  return `http://${bucket}.${endpoint}/${objectKey}`
}

async function preparePngStream(
  response: Response,
): Promise<{ body: ReadableStream<Uint8Array>; contentLength?: string }> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CUTOUT_BYTES) {
    throw new RequestError(502, "CUTOUT_TOO_LARGE", "抠图结果超过 6 MiB。")
  }
  if (!response.body) throw new RequestError(502, "CUTOUT_EMPTY", "抠图结果为空。")

  const reader = response.body.getReader()
  const prefixChunks: Uint8Array[] = []
  let prefixLength = 0
  while (prefixLength < PNG_SIGNATURE.byteLength) {
    const { done, value } = await reader.read()
    if (done) break
    prefixChunks.push(value)
    prefixLength += value.byteLength
    if (prefixLength > MAX_CUTOUT_BYTES) {
      await reader.cancel()
      throw new RequestError(502, "CUTOUT_TOO_LARGE", "抠图结果超过 6 MiB。")
    }
  }

  const prefix = new Uint8Array(prefixLength)
  let offset = 0
  for (const chunk of prefixChunks) {
    prefix.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (!hasExpectedSignature(prefix, "image/png")) {
    await reader.cancel()
    throw new RequestError(502, "CUTOUT_INVALID_IMAGE", "云端抠图返回了无效图片。")
  }

  let totalBytes = prefixLength
  let prefixSent = false
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true
        controller.enqueue(prefix)
        return
      }
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      totalBytes += value.byteLength
      if (totalBytes > MAX_CUTOUT_BYTES) {
        await reader.cancel()
        controller.error(new Error("Cutout response exceeded the byte limit."))
        return
      }
      controller.enqueue(value)
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
  const contentLength = response.headers.get("content-length") ?? undefined
  return contentLength ? { body, contentLength } : { body }
}

async function downloadCutout(resultUrl: string): Promise<{ body: ReadableStream<Uint8Array>; contentLength?: string }> {
  let url: URL
  try {
    url = new URL(resultUrl)
  } catch {
    throw new RequestError(502, "CUTOUT_INVALID_URL", "云端抠图返回了无效下载地址。")
  }
  if (url.protocol === "http:" && url.hostname.endsWith(".aliyuncs.com")) url.protocol = "https:"
  if (url.protocol !== "https:") {
    throw new RequestError(502, "CUTOUT_INVALID_URL", "云端抠图返回了无效下载地址。")
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new RequestError(502, "CUTOUT_DOWNLOAD_FAILED", "无法下载抠图结果。")
  }
  return preparePngStream(response)
}

export async function createRateLimitKey(request: Request, salt: string): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "missing"
  const input = new TextEncoder().encode(`${salt}\u0000${ip}`)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function handleCutout(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method !== "POST") {
    return jsonError(405, "METHOD_NOT_ALLOWED", "仅支持 POST 请求。", { Allow: "POST" })
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? ""
  if (!contentType.startsWith("multipart/form-data;")) {
    return jsonError(415, "UNSUPPORTED_CONTENT_TYPE", "Content-Type 必须是 multipart/form-data。")
  }

  const accessKeyId = env.ALIBABA_CLOUD_ACCESS_KEY_ID
  const accessKeySecret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET
  const rateLimitSalt = env.RATE_LIMIT_SALT
  if (!accessKeyId || !accessKeySecret || !rateLimitSalt) {
    return jsonError(503, "CUTOUT_NOT_CONFIGURED", "云端抠图尚未配置。")
  }

  const rateKey = await createRateLimitKey(request, rateLimitSalt)
  const rateLimit = await env.CUTOUT_RATE_LIMITER.limit({ key: rateKey })
  if (!rateLimit.success) {
    return jsonError(429, "RATE_LIMITED", "抠图请求过于频繁，请稍后再试。", { "Retry-After": "60" })
  }

  try {
    const form = await request.formData()
    const file = form.get("image")
    if (!(file instanceof File)) {
      return jsonError(400, "IMAGE_REQUIRED", "请选择要处理的图片。")
    }
    const image = await validateImage(file)
    const credentials = { accessKeyId, accessKeySecret }
    const imageUrl = await uploadTemporaryImage(image, credentials)
    const result = await signedRpcFetch(
      "imageseg.cn-shanghai.aliyuncs.com",
      "POST",
      "SegmentCommonImage",
      "2019-12-30",
      { ImageURL: imageUrl, ReturnForm: "crop" },
      credentials,
    )
    const data = result.Data
    const resultUrl = recordString(data, "ImageURL")
    if (!resultUrl) {
      throw new RequestError(502, "ALIBABA_RESULT_MISSING", "阿里云未返回抠图结果。")
    }
    const png = await downloadCutout(resultUrl)
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "image/png",
      "X-Cutout-Source": "alibaba-cloud",
    })
    if (png.contentLength) headers.set("Content-Length", png.contentLength)
    return new Response(png.body, { status: 200, headers })
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.status, error.code, error.message)
    if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) {
      return jsonError(504, "UPSTREAM_TIMEOUT", "抠图请求超时，请稍后再试。")
    }
    return jsonError(502, "CUTOUT_FAILED", "云端抠图失败，请稍后再试。")
  }
}

async function route(request: Request, env: RuntimeEnv): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === "/api/cutout") return handleCutout(request, env)
  if (url.pathname.startsWith("/api/")) {
    return jsonError(404, "API_NOT_FOUND", "接口不存在。")
  }
  return env.ASSETS.fetch(request)
}

export default {
  async fetch(request, env): Promise<Response> {
    const requestId = request.headers.get("CF-Ray") ?? crypto.randomUUID()
    const startedAt = Date.now()
    let response: Response
    try {
      response = await route(request, env)
    } catch (error) {
      response = jsonError(503, "WORKER_UNAVAILABLE", "服务暂时不可用，请稍后再试。")
      console.error(JSON.stringify({ event: "worker_exception", requestId, error: String(error) }))
    }
    console.log(
      JSON.stringify({
        event: "request",
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
        inputBytes: Number(request.headers.get("content-length")) || null,
        outputBytes: Number(response.headers.get("content-length")) || null,
      }),
    )
    return withSecurityHeaders(response)
  },
} satisfies ExportedHandler<RuntimeEnv>
