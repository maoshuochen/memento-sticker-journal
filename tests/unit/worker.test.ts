import { describe, expect, it } from "vitest"

import { createRateLimitKey, hasExpectedSignature, signRpcParameters } from "../../worker/index.ts"

describe("cutout worker", () => {
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
})
