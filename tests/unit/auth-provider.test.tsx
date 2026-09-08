// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthProvider, useAuth } from "@/app/AuthProvider"

function Probe() {
  const { user, loading, sessionExpired } = useAuth()
  return <div>
    <output data-testid="auth-state">{loading ? "loading" : user?.id ?? "signed-out"}</output>
    <button type="button" onClick={sessionExpired}>Expire session</button>
  </div>
}

describe("AuthProvider", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("opens the cached local account when the session check is offline", async () => {
    localStorage.setItem("memento-auth-user", JSON.stringify({ id: "cached-user", username: "offline" }))
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))

    render(<AuthProvider><Probe /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("cached-user"))
  })

  it("clears the identity cache when the server confirms a signed-out session", async () => {
    localStorage.setItem("memento-auth-user", JSON.stringify({ id: "cached-user", username: "offline" }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: null }) }))

    render(<AuthProvider><Probe /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("signed-out"))
    expect(localStorage.getItem("memento-auth-user")).toBeNull()
  })

  it("clears the cached identity when the session expires", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: { id: "user-1", username: "memento" } }) }))
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("user-1"))
    localStorage.setItem("memento-auth-user", JSON.stringify({ id: "user-1", username: "memento" }))

    await userEvent.setup().click(screen.getByRole("button", { name: "Expire session" }))

    expect(screen.getByTestId("auth-state")).toHaveTextContent("signed-out")
    expect(localStorage.getItem("memento-auth-user")).toBeNull()
  })
})
