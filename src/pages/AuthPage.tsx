import { useState, type FormEvent } from "react"
import { toast } from "sonner"

import { useAuth } from "@/app/AuthProvider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function formText(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === "string" ? value : ""
}

export function AuthPage() {
  const { login, register } = useAuth()
  const inviteFromLink = new URLSearchParams(window.location.search).get("invite")?.trim() ?? ""
  const [mode, setMode] = useState<"login" | "register">(inviteFromLink ? "register" : "login")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const username = formText(data, "username")
    const password = formText(data, "password")
    const inviteCode = formText(data, "inviteCode")
    setBusy(true)
    try {
      if (mode === "login") await login(username, password)
      else await register(username, password, inviteCode)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "无法完成登录。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="wordmark">memento</p>
        <p className="eyebrow">your private sticker journal</p>
        <h1 id="auth-title">{mode === "login" ? "Welcome back" : "Join your journal"}</h1>
        <p>{mode === "login" ? "登录后，在每台设备继续你的手帐。" : "使用一次性邀请码创建你的私人手帐。"}</p>
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <Label htmlFor="auth-username">Username</Label>
          <Input id="auth-username" name="username" autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" required />
          <Label htmlFor="auth-password">Password</Label>
          <Input id="auth-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} required />
          {mode === "register" ? <>
            <Label htmlFor="auth-invite">Invite code</Label>
            <Input id="auth-invite" name="inviteCode" autoComplete="off" defaultValue={inviteFromLink} required />
          </> : null}
          <Button type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</Button>
        </form>
        <button className="auth-switch" type="button" onClick={() => setMode((current) => current === "login" ? "register" : "login")}>{mode === "login" ? "Have an invite code? Create an account" : "Already have an account? Log in"}</button>
      </section>
    </main>
  )
}
