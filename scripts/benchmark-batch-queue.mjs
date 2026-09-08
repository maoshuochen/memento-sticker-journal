#!/usr/bin/env node

const taskCount = Number(process.env.BATCH_BENCH_TASKS ?? 50)
const requestIntervalMs = Number(process.env.BATCH_BENCH_INTERVAL_MS ?? 550)
const maxInFlight = Number(process.env.BATCH_BENCH_CONCURRENCY ?? 2)
const simulatedLatencyMs = Number(process.env.BATCH_BENCH_LATENCY_MS ?? 900)

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
let nextStartAt = performance.now()
let cursor = 0
let active = 0
let maxActive = 0
const startTimes = []

async function reserveStart() {
  const now = performance.now()
  const startAt = Math.max(now, nextStartAt)
  nextStartAt = startAt + requestIntervalMs
  await sleep(Math.max(0, startAt - now))
  startTimes.push(performance.now())
}

async function worker() {
  while (cursor < taskCount) {
    cursor += 1
    await reserveStart()
    active += 1
    maxActive = Math.max(maxActive, active)
    await sleep(simulatedLatencyMs)
    active -= 1
  }
}

const beganAt = performance.now()
await Promise.all(Array.from({ length: maxInFlight }, worker))
const elapsedMs = performance.now() - beganAt
const intervals = startTimes.slice(1).map((start, index) => start - startTimes[index])
const minIntervalMs = Math.min(...intervals)
const measuredQps = taskCount / (elapsedMs / 1_000)

if (maxActive > maxInFlight) throw new Error(`Concurrency exceeded: ${maxActive} > ${maxInFlight}`)
if (minIntervalMs < requestIntervalMs - 15) throw new Error(`Request pace exceeded: ${minIntervalMs.toFixed(1)}ms < ${requestIntervalMs}ms`)

console.log(JSON.stringify({ taskCount, requestIntervalMs, maxInFlight, simulatedLatencyMs, elapsedMs: Math.round(elapsedMs), measuredQps: Number(measuredQps.toFixed(2)), maxActive, minIntervalMs: Number(minIntervalMs.toFixed(1)) }, null, 2))
