import { afterEach, describe, expect, it, vi } from "vitest";

describe("CMS account changes across tabs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("publishes a non-identifying revision and handles duplicate browser signals once", async () => {
    let storageListener: ((event: StorageEvent) => void) | undefined;
    let channelListener: ((event: MessageEvent) => void) | undefined;
    const postMessage = vi.fn();
    vi.stubGlobal("BroadcastChannel", class {
      postMessage = postMessage;
      addEventListener(_name: string, listener: (event: MessageEvent) => void) { channelListener = listener; }
      removeEventListener = vi.fn();
    });
    const setItem = vi.fn((_key: string, _value: string) => undefined);
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", {
      localStorage: { setItem },
      addEventListener: vi.fn((_name: string, listener: (event: StorageEvent) => void) => { storageListener = listener; }),
      removeEventListener,
    });
    const { announceAuthContextChange, subscribeToAuthContextChanges } = await import("./authTabSync");
    const onChange = vi.fn();
    const unsubscribe = subscribeToAuthContextChanges(onChange);

    announceAuthContextChange();
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem.mock.calls[0]![0]).toBe("darshan-cms:auth-context-change");
    expect(setItem.mock.calls[0]![1]).not.toContain("@example");
    expect(postMessage).toHaveBeenCalledWith(setItem.mock.calls[0]![1]);
    storageListener?.({ key: "another-app", newValue: "revision" } as StorageEvent);
    storageListener?.({ key: "darshan-cms:auth-context-change", newValue: null } as StorageEvent);
    expect(onChange).not.toHaveBeenCalled();
    storageListener?.({ key: "darshan-cms:auth-context-change", newValue: "new-revision" } as StorageEvent);
    channelListener?.({ data: "new-revision" } as MessageEvent);
    expect(onChange).toHaveBeenCalledOnce();

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("storage", storageListener);
  });

  it("uses the channel when browser storage is unavailable", async () => {
    const postMessage = vi.fn();
    let channelListener: ((event: MessageEvent) => void) | undefined;
    vi.stubGlobal("BroadcastChannel", class {
      postMessage = postMessage;
      addEventListener(_name: string, listener: (event: MessageEvent) => void) { channelListener = listener; }
      removeEventListener = vi.fn();
    });
    vi.stubGlobal("window", {
      localStorage: { setItem: () => { throw new Error("storage blocked"); } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { announceAuthContextChange, subscribeToAuthContextChanges } = await import("./authTabSync");
    const onChange = vi.fn();
    const unsubscribe = subscribeToAuthContextChanges(onChange);
    expect(announceAuthContextChange).not.toThrow();
    expect(postMessage).toHaveBeenCalledOnce();
    channelListener?.({ data: postMessage.mock.calls[0]![0] } as MessageEvent);
    expect(onChange).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
