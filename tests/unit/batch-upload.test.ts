import { describe, expect, it } from "vitest"

import { BATCH_MAX_IN_FLIGHT_REQUESTS, BATCH_REQUEST_START_INTERVAL_MS, BatchRequestStartGate } from "@/data/batchUploads"

describe("batch upload request pacing", () => {
  it("caps the worker pool at two concurrent cutouts", () => {
    expect(BATCH_MAX_IN_FLIGHT_REQUESTS).toBe(2)
  })

  it("spaces all request starts below the 2 QPS ceiling", () => {
    const gate = new BatchRequestStartGate()
    const starts = Array.from({ length: 50 }, () => gate.reserve(10_000))

    expect(starts[0]).toBe(10_000)
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBe(BATCH_REQUEST_START_INTERVAL_MS)
    }
    expect(starts.at(-1)! - starts[0]!).toBe((starts.length - 1) * BATCH_REQUEST_START_INTERVAL_MS)
  })
})
