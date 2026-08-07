// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

function ExampleDialog() {
  const [open, setOpen] = useState(true)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Sticker details</DialogTitle>
        <DialogDescription>Edit this sticker.</DialogDescription>
        <button>Save changes</button>
      </DialogContent>
    </Dialog>
  )
}

describe("Memento dialogs", () => {
  it("moves focus inside and closes with Escape", async () => {
    const user = userEvent.setup()
    render(<ExampleDialog />)
    const dialog = await screen.findByRole("dialog", { name: "Sticker details" })
    expect(dialog).toBeVisible()
    expect(dialog).toContainElement(document.activeElement)
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog", { name: "Sticker details" })).not.toBeInTheDocument()
  })
})
