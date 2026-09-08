import { afterEach, describe, expect, it, vi } from "vitest"

import { handleMementoApi, shouldAcceptSyncChange } from "../../worker/auth.ts"
import worker, { createRateLimitKey, hasExpectedSignature, signRpcParameters } from "../../worker/index.ts"

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
])

type FetchCall = { url: string; init?: RequestInit }

function createCutoutEnv(options: { dashscopeApiKey?: string } = {}): Env {
  const session = {
    id: "user-1",
    username: "tester",
    expires_at: Date.now() + 60_000,
  }
  const database = {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => session),
      })),
    })),
  }
  return {
    MEMENTO_DB: database,
    MEMENTO_ASSETS: {} as R2Bucket,
    CUTOUT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit,
    AUTH_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit,
    ASSETS: {} as Fetcher,
    ALIBABA_CLOUD_ACCESS_KEY_ID: "access-key-id",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "access-key-secret",
    APP_SECRET: "app-secret",
    BAILIAN_BASE_URL: "https://bailian.test/compatible-mode/v1",
    ...(options.dashscopeApiKey ? { DASHSCOPE_API_KEY: options.dashscopeApiKey } : {}),
  } as unknown as Env
}

function createMultipartRequest(): Request {
  const form = new FormData()
  form.set("image", new File([PNG_BYTES], "photo.png", { type: "image/png" }))
  return new Request("https://memento.test/api/cutout", {
    method: "POST",
    body: form,
    headers: {
      Cookie: "__Host-memento_session=session-token",
      "CF-Connecting-IP": "203.0.113.7",
    },
  })
}

function mockAlibabaAndBailian(options: {
  recognition?: { name: string; confidence: "high" | "low" }
  recognitionFailure?: boolean
} = {}): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = []
  const mockedFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })

    if (url.includes("openplatform.aliyuncs.com")) {
      return Response.json({
        Bucket: "memento-test",
        Endpoint: "oss-cn-shanghai.aliyuncs.com",
        AccessKeyId: "temporary-access-key",
        EncodedPolicy: "encoded-policy",
        Signature: "upload-signature",
        ObjectKey: "uploads/photo.png",
      })
    }
    if (url.includes("imageseg.cn-shanghai.aliyuncs.com")) {
      return Response.json({ Data: { ImageURL: "https://memento.test/cutout.png" } })
    }
    if (url.includes("memento-test.oss-cn-shanghai.aliyuncs.com")) return new Response(null, { status: 201 })
    if (url === "https://memento.test/cutout.png") {
      return new Response(new Blob([PNG_BYTES], { type: "image/png" }), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(PNG_BYTES.byteLength) },
      })
    }
    if (url.includes("/chat/completions")) {
      if (options.recognitionFailure) throw new Error("Bailian unavailable")
      const recognition = options.recognition ?? { name: "圣诞雨靴", confidence: "high" as const }
      return Response.json({
        choices: [{ message: { content: JSON.stringify(recognition) } }],
      })
    }
    throw new Error(`Unexpected mocked upstream URL: ${url}`)
  })
  return { calls, restore: () => mockedFetch.mockRestore() }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("cutout worker", () => {
  it("rejects a delayed sync write so it cannot reset newer canvas typography", () => {
    expect(shouldAcceptSyncChange({ revision: 8, updated_at: 20_000 }, { revision: 7, changedAt: 19_000 })).toBe(false)
    expect(shouldAcceptSyncChange({ revision: 8, updated_at: 20_000 }, { revision: 9, changedAt: 20_000 })).toBe(true)
  })

  it("validates JPEG, PNG, and WebP signatures", () => {
    expect(hasExpectedSignature(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(true)
    expect(hasExpectedSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true)
    expect(hasExpectedSignature(new TextEncoder().encode("RIFF0000WEBP"), "image/webp")).toBe(true)
    expect(hasExpectedSignature(new TextEncoder().encode("not an image"), "image/png")).toBe(false)
  })

  it("hashes the client IP with a private salt", async () => {
    const first = await createRateLimitKey(new Request("https://memento.test", { headers: { "CF-Connecting-IP": "203.0.113.7" } }), "salt-one")
    const second = await createRateLimitKey(new Request("https://memento.test", { headers: { "CF-Connecting-IP": "203.0.113.7" } }), "salt-two")
    expect(first).toHaveLength(64)
    expect(first).not.toContain("203.0.113.7")
    expect(first).not.toBe(second)
  })

  it("creates an Alibaba RPC signature with Web Crypto", async () => {
    const signed = await signRpcParameters("POST", "SegmentCommonImage", "2019-12-30", { ImageURL: "https://example.test/image.png" }, { accessKeyId: "key", accessKeySecret: "secret" })
    expect(signed.Action).toBe("SegmentCommonImage")
    expect(typeof signed.Signature).toBe("string")
    expect(String(signed.Signature).length).toBeGreaterThan(10)
  })

  it("keeps session discovery public but protects sync and asset routes", async () => {
    const env = {} as Env
    const session = await handleMementoApi(new Request("https://memento.test/api/auth/session"), env)
    expect(session?.status).toBe(200)
    await expect(session?.json()).resolves.toEqual({ user: null })

    const asset = await handleMementoApi(new Request("https://memento.test/api/assets/asset-one"), env)
    expect(asset?.status).toBe(401)
    await expect(asset?.json()).resolves.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
  })

  it("returns a URL-encoded Bailian sticker name with a successful PNG cutout", async () => {
    const { calls } = mockAlibabaAndBailian()
    const response = await worker.fetch(createMultipartRequest(), createCutoutEnv({ dashscopeApiKey: "dashscope-test-key" }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("image/png")
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'self' blob:")
    expect(response.headers.get("X-Cutout-Source")).toBe("alibaba-cloud")
    expect(response.headers.get("X-Sticker-Name")).toBe(encodeURIComponent("圣诞雨靴"))
    expect(response.headers.get("X-Sticker-Recognition-Source")).toBe("bailian")
    expect(response.headers.get("X-Sticker-Recognition-Status")).toBe("recognised")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    const recognitionCall = calls.find(({ url }) => url.includes("/chat/completions"))
    expect(recognitionCall).toBeDefined()
    expect(JSON.parse(String(recognitionCall?.init?.body))).toMatchObject({ enable_thinking: false, max_tokens: 160 })
  })

  it("keeps the cutout working without a Bailian API key and omits recognition headers", async () => {
    const { calls } = mockAlibabaAndBailian()
    const response = await worker.fetch(createMultipartRequest(), createCutoutEnv())

    expect(response.status, await response.clone().text()).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("image/png")
    expect(response.headers.get("X-Sticker-Name")).toBeNull()
    expect(response.headers.get("X-Sticker-Recognition-Source")).toBeNull()
    expect(calls.some(({ url }) => url.includes("/chat/completions"))).toBe(false)
  })

  it("does not block the cutout when Bailian recognition fails", async () => {
    const { calls } = mockAlibabaAndBailian({ recognitionFailure: true })
    const response = await worker.fetch(createMultipartRequest(), createCutoutEnv({ dashscopeApiKey: "dashscope-test-key" }))

    expect(response.status, await response.clone().text()).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    expect(response.headers.get("X-Sticker-Name")).toBeNull()
    expect(response.headers.get("X-Sticker-Recognition-Source")).toBeNull()
    expect(calls.some(({ url }) => url.includes("/chat/completions"))).toBe(true)
  })

  it("does not return a name for low-confidence Bailian recognition", async () => {
    const { calls } = mockAlibabaAndBailian({ recognition: { name: "圣诞雨靴", confidence: "low" } })
    const response = await worker.fetch(createMultipartRequest(), createCutoutEnv({ dashscopeApiKey: "dashscope-test-key" }))

    expect(response.status, await response.clone().text()).toBe(200)
    expect(response.headers.get("X-Sticker-Name")).toBeNull()
    expect(response.headers.get("X-Sticker-Recognition-Source")).toBeNull()
    expect(calls.some(({ url }) => url.includes("/chat/completions"))).toBe(true)
  })

  it("returns stable, editable group suggestions for a batch and preserves an existing group name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({
        suggestions: [
          { id: "drink", group: "food+drink" },
          { id: "cat", group: "萌宠日常" },
        ],
      }) } }],
    }))
    const request = new Request("https://memento.test/api/stickers/group-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "__Host-memento_session=session-token", "CF-Connecting-IP": "203.0.113.7" },
      body: JSON.stringify({
        items: [{ id: "drink", name: "冰柠檬茶" }, { id: "cat", name: "两只小猫" }],
        groupHints: ["food + drink", "旅途印记"],
      }),
    })

    const response = await worker.fetch(request, createCutoutEnv({ dashscopeApiKey: "dashscope-test-key" }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      suggestions: [{ id: "drink", group: "food + drink" }, { id: "cat", group: "萌宠日常" }],
      source: "bailian",
    })
  })
})
