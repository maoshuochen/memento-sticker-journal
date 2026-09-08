// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../../src/app/AuthProvider";
import { AppDataProvider, useAppData } from "../../src/app/AppDataProvider";

const userIds = new Set<string>();
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear(); sessionStorage.clear();
  for (const id of userIds) await Dexie.delete(`memento-journal-react-user-${id}`);
  userIds.clear();
});
function DataProbe() {
  const data = useAppData();
  return <output data-testid="data">{data.snapshot.stickers.length}:{data.syncStatus}</output>;
}
function Probe() {
  const { user, login, loading } = useAuth();
  return <><output data-testid="user">{loading ? "loading" : user?.username ?? "signed out"}</output><button onClick={() => void login("second", "password")}>switch</button><AppDataProvider>{user ? <DataProbe /> : null}</AppDataProvider></>;
}
function sessionServer() {
  let user = { id: crypto.randomUUID(), username: "first" };
  userIds.add(user.id);
  const responder = async (url: string, init?: RequestInit) => {
    if (url.endsWith("session")) return Response.json({ user });
    if (url.endsWith("login")) { user = { id: crypto.randomUUID(), username: "second" }; userIds.add(user.id); return Response.json({ user }); }
    if (url.endsWith("snapshot")) return Response.json({ cursor: 0, entities: [] });
    if (url.includes("/pull?")) return Response.json({ cursor: Number(new URL(url, "http://test").searchParams.get("cursor")), entities: [] });
    if (url.endsWith("push")) {
      const { changes } = JSON.parse(String(init?.body));
      return Response.json({ cursor: 1, accepted: changes.map((entry: { entityType: string; entityId: string }) => `${entry.entityType}:${entry.entityId}`), entities: changes });
    }
    throw new Error("unexpected request");
  };
  return responder;
}
describe("account data lifecycle", () => {
  it("opens its local database under StrictMode and drains initialization without a sync loop", async () => {
    const fetcher = vi.fn(sessionServer()); vi.stubGlobal("fetch", fetcher);
    render(<StrictMode><AuthProvider><Probe /></AuthProvider></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("7:synced"));
    expect(fetcher.mock.calls.length).toBeLessThan(15);
    expect(screen.queryByText("无法打开本地数据")).not.toBeInTheDocument();
  });
  it("ignores an old account's late 401 after switching accounts", async () => {
    const responder = sessionServer();
    let resolveOld!: (value: Response) => void;
    let captured = false;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("snapshot") && !captured) { captured = true; return new Promise<Response>((resolve) => { resolveOld = resolve }); }
      return responder(url, init);
    }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("7:syncing"));
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("second"));
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("7:synced"));
    await act(async () => { resolveOld(Response.json({ error: "expired" }, { status: 401 })); await Promise.resolve(); });
    expect(screen.getByTestId("user")).toHaveTextContent("second");
  });
  it("restores a previously verified identity only when session verification is unavailable", async () => {
    const id = crypto.randomUUID(); userIds.add(id);
    localStorage.setItem("memento-auth-user", JSON.stringify({ id, username: "offline" }));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("7:offline"));
    expect(screen.getByTestId("user")).toHaveTextContent("offline");
  });
});
