// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const auth = vi.hoisted(() => ({
  login: vi.fn().mockResolvedValue(undefined),
  register: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/app/AuthProvider", () => ({
  useAuth: () => auth,
}))

import { AuthPage } from "@/pages/AuthPage"

describe("AuthPage invite links", () => {
  beforeEach(() => {
    auth.login.mockReset().mockResolvedValue(undefined)
    auth.register.mockReset().mockResolvedValue(undefined)
    window.history.replaceState({}, "", "/")
  })

  afterEach(() => {
    cleanup()
  })

  it("opens registration with an invite code from the invite link", () => {
    window.history.replaceState({}, "", "/?invite=JOURNAL-ALPHA-42")

    render(<AuthPage />)

    expect(screen.getByRole("heading", { name: "Join your journal" })).toBeVisible()
    expect(screen.getByLabelText("Invite code")).toHaveValue("JOURNAL-ALPHA-42")
  })

  it("submits the prefilled invite code with registration details", async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, "", "/?invite=JOURNAL-ALPHA-42")

    render(<AuthPage />)
    await user.type(screen.getByLabelText("Username"), "memento_user")
    await user.type(screen.getByLabelText("Password"), "a-long-enough-password")
    await user.click(screen.getByRole("button", { name: "Create account" }))

    expect(auth.register).toHaveBeenCalledWith("memento_user", "a-long-enough-password", "JOURNAL-ALPHA-42")
  })
})
