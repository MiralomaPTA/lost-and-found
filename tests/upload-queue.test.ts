import { describe, expect, it } from "vitest";
import type { ItemUpload, UploadResult } from "@/lib/upload";
import { UploadQueue, type ChangeAnswer, type QueueDeps } from "@/lib/upload-queue";

/** A promise to settle later, from the test. */
function later<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

/** Each upload waits until the test answers it; everything else is recorded. */
function harness() {
  const uploads: { input: ItemUpload; progress: (f: number) => void; answer: (r: UploadResult) => void }[] = [];
  const calls: string[] = [];
  const answers = { changeTags: { ok: true } as ChangeAnswer, undoAdd: { ok: true } as ChangeAnswer, undoUpload: { ok: true } as ChangeAnswer };
  const released: string[] = [];
  const deps: QueueDeps = {
    upload: (input, progress) => {
      const pending = later<UploadResult>();
      uploads.push({ input, progress, answer: pending.settle });
      return pending.promise;
    },
    changeTags: async (itemId, tags) => {
      calls.push(`changeTags ${itemId} ${tags.type}/${tags.color}/${tags.has_name}`);
      return answers.changeTags;
    },
    undoAdd: async (itemId) => {
      calls.push(`undoAdd ${itemId}`);
      return answers.undoAdd;
    },
    undoUpload: async (ref) => {
      calls.push(`undoUpload ${ref}`);
      return answers.undoUpload;
    },
    preview: () => `blob:${released.length}-${Math.random()}`,
    release: (preview) => void released.push(preview),
  };
  const queue = new UploadQueue(deps);
  const images = { photo: new Blob(["p"]), thumb: new Blob(["t"]) };
  const tags = (type = "Jacket", color = "Navy", hasName = false) => ({ type, color, hasName });
  const state = (key: string) => queue.getSnapshot().find((e) => e.key === key)!;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { queue, uploads, calls, answers, released, images, tags, state, tick };
}

const REF = (n: number) => n.toString(16).padStart(32, "0");

describe("the upload queue", () => {
  it("uploads one at a time, in order, with progress", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags("Jacket"), REF(1));
    h.queue.add(h.images, h.tags("Hoodie"), REF(2));
    await h.tick();
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].input).toMatchObject({ type: "Jacket", clientRef: REF(1) });
    h.uploads[0].progress(0.5);
    expect(h.state(REF(1))).toMatchObject({ state: "uploading", progress: 0.5 });
    expect(h.state(REF(2)).state).toBe("waiting");
    expect(h.queue.unsaved).toBe(true);
    h.uploads[0].answer({ ok: true, id: "L-0001" });
    await h.tick();
    expect(h.state(REF(1))).toMatchObject({ state: "saved", itemId: "L-0001" });
    expect(h.uploads[1].input.type).toBe("Hoodie");
    h.uploads[1].answer({ ok: true, id: "L-0002" });
    await h.queue.idle();
    expect(h.queue.unsaved).toBe(false);
  });

  it("keeps a failed upload for Retry, which sends the current tags", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags("Jacket"), REF(1));
    await h.tick();
    h.uploads[0].answer({ ok: false, message: "Offline", retry: true });
    await h.tick();
    expect(h.state(REF(1))).toMatchObject({ state: "failed", message: "Offline", retryable: true });
    await h.queue.setTags(REF(1), h.tags("Hoodie"));
    expect(h.calls).toEqual([]);
    h.queue.retry(REF(1));
    await h.tick();
    expect(h.uploads[1].input).toMatchObject({ type: "Hoodie", clientRef: REF(1) });
  });

  it("doesn't offer Retry for an upload the server refused as it is", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags(), REF(1));
    await h.tick();
    h.uploads[0].answer({ ok: false, message: "Pick a type from the list.", retry: false });
    await h.tick();
    h.queue.retry(REF(1));
    await h.tick();
    expect(h.uploads).toHaveLength(1);
    expect(h.state(REF(1))).toMatchObject({ state: "failed", retryable: false });
  });

  it("drops a waiting upload on Undo without sending it", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags(), REF(1));
    h.queue.add(h.images, h.tags(), REF(2));
    await h.tick();
    await h.queue.undo(REF(2));
    expect(h.state(REF(2)).state).toBe("undone");
    h.uploads[0].answer({ ok: true, id: "L-0001" });
    await h.queue.idle();
    expect(h.uploads).toHaveLength(1);
  });

  it("takes back a failed upload by its reference, since the server may have saved it", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags(), REF(1));
    await h.tick();
    h.uploads[0].answer({ ok: false, message: "Timed out", retry: true });
    await h.tick();
    h.answers.undoUpload = { ok: false, message: "Offline." };
    await h.queue.undo(REF(1));
    expect(h.state(REF(1))).toMatchObject({ state: "failed", retryable: false, message: expect.stringMatching(/Couldn't undo/) });
    h.answers.undoUpload = { ok: true };
    await h.queue.undo(REF(1));
    expect(h.state(REF(1)).state).toBe("undone");
    expect(h.calls).toEqual([`undoUpload ${REF(1)}`, `undoUpload ${REF(1)}`]);
  });

  it("finishes an Undo tapped mid-upload, whether the upload worked or not", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags(), REF(1));
    h.queue.add(h.images, h.tags(), REF(2));
    await h.tick();
    await h.queue.undo(REF(1));
    h.uploads[0].answer({ ok: true, id: "L-0001" });
    await h.tick();
    expect(h.state(REF(1)).state).toBe("undone");
    await h.queue.undo(REF(2));
    h.uploads[1].answer({ ok: false, message: "Timed out", retry: true });
    await h.queue.idle();
    await h.tick();
    expect(h.state(REF(2)).state).toBe("undone");
    expect(h.calls).toEqual(["undoAdd L-0001", `undoUpload ${REF(2)}`]);
  });

  it("sends tags changed during the upload once it's saved, and shows the server's tags if that fails", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags("Jacket"), REF(1));
    await h.tick();
    await h.queue.setTags(REF(1), h.tags("Hoodie", "Gray", true));
    h.answers.changeTags = { ok: false, message: "Try again." };
    h.uploads[0].answer({ ok: true, id: "L-0001" });
    await h.queue.idle();
    await h.tick();
    expect(h.calls).toEqual(["changeTags L-0001 Hoodie/Gray/true"]);
    // Back to what the server has, so changing them again sends the change.
    expect(h.state(REF(1))).toMatchObject({ tags: h.tags("Jacket"), message: expect.stringMatching(/weren't saved/) });
    h.answers.changeTags = { ok: true };
    await h.queue.setTags(REF(1), h.tags("Hoodie", "Gray", true));
    expect(h.state(REF(1))).toMatchObject({ tags: h.tags("Hoodie", "Gray", true), message: null });
  });

  it("undoes a saved item, and fixes its tags", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags(), REF(1));
    await h.tick();
    h.uploads[0].answer({ ok: true, id: "L-0001" });
    await h.queue.idle();
    await h.queue.setTags(REF(1), h.tags("Shirt"));
    await h.queue.undo(REF(1));
    expect(h.calls).toEqual(["changeTags L-0001 Shirt/Navy/false", "undoAdd L-0001"]);
    expect(h.state(REF(1)).state).toBe("undone");
  });

  it("starts a new bulk add session with only what's still unsaved", async () => {
    const h = harness();
    h.queue.add(h.images, h.tags(), REF(1));
    h.queue.add(h.images, h.tags(), REF(2));
    await h.tick();
    h.uploads[0].answer({ ok: true, id: "L-0001" });
    await h.tick();
    h.uploads[1].answer({ ok: false, message: "Offline", retry: true });
    await h.queue.idle();
    await h.tick();
    h.queue.startSession();
    expect(h.queue.getSnapshot().map((e) => [e.key, e.state])).toEqual([[REF(2), "failed"]]);
    expect(h.released).toHaveLength(1);
  });

  it("tells subscribers about every change, with a new snapshot each time", async () => {
    const h = harness();
    const seen: unknown[] = [];
    const stop = h.queue.subscribe(() => seen.push(h.queue.getSnapshot()));
    h.queue.add(h.images, h.tags(), REF(1));
    await h.tick();
    stop();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
