import { expect, it } from "vitest";
import { parseHostAppearanceSettings } from "../../../shared/sidechat/appearance";
import {
  clearThreadQueue,
  deriveQueuedMessageLabel,
  enqueueThreadMessage,
  prependThreadMessage,
  removeThreadMessageById,
  resolveActiveSendBehavior,
  resolveAlternateSendAction,
  resolveSubmitAction,
  type QueuedSidechatMessage,
} from "../../../shared/sidechat/queue";

function makeQueued(id: string, text: string): QueuedSidechatMessage {
  return {
    id,
    text,
    attachments: [],
    quotedSelection: null,
    attachMainContext: false,
  };
}

it("parseHostAppearanceSettings + resolveActiveSendBehavior match Paseo queue & permission behavior", () => {
  const queuePrefs = parseHostAppearanceSettings({ sendBehavior: "queue" });
  expect(queuePrefs.sendBehavior).toBe("queue");
  expect(resolveActiveSendBehavior(queuePrefs.sendBehavior, false)).toBe("queue");
  expect(resolveActiveSendBehavior(queuePrefs.sendBehavior, true)).toBe("interrupt");

  const steerPrefs = parseHostAppearanceSettings({ sendBehavior: "steer" });
  expect(resolveActiveSendBehavior(steerPrefs.sendBehavior, true)).toBe("steer");

  const interruptPrefs = parseHostAppearanceSettings({ sendBehavior: "interrupt" });
  expect(resolveActiveSendBehavior(interruptPrefs.sendBehavior, false)).toBe("interrupt");
});

it("resolveSubmitAction & resolveAlternateSendAction match Paseo Send vs Queue semantics", () => {
  // Idle agent always sends directly regardless of queue/steer/interrupt setting
  expect(resolveSubmitAction({
      hasSendableContent: true,
      isAgentRunning: false,
      defaultSendBehavior: "queue",
      canQueue: true,
    })).toStrictEqual({ kind: "send" });

  // Running agent in queue mode -> default queues, alternate (Cmd+Enter / long press) interrupts immediately
  expect(resolveSubmitAction({
      hasSendableContent: true,
      isAgentRunning: true,
      defaultSendBehavior: "queue",
      canQueue: true,
    })).toStrictEqual({ kind: "queue" });
  expect(resolveSubmitAction({
      hasSendableContent: true,
      isAgentRunning: true,
      defaultSendBehavior: "queue",
      canQueue: true,
      alternate: true,
    })).toStrictEqual({ kind: "send", activeTurnBehavior: "interrupt" });
  expect(resolveAlternateSendAction({
      defaultSendBehavior: "queue",
      isAgentRunning: true,
      canQueue: true,
    })).toBe("send");

  // Running agent in steer mode -> default steers, alternate queues
  expect(resolveSubmitAction({
      hasSendableContent: true,
      isAgentRunning: true,
      defaultSendBehavior: "steer",
      canQueue: true,
    })).toStrictEqual({ kind: "send", activeTurnBehavior: "steer" });
  expect(resolveSubmitAction({
      hasSendableContent: true,
      isAgentRunning: true,
      defaultSendBehavior: "steer",
      canQueue: true,
      alternate: true,
    })).toStrictEqual({ kind: "queue" });
  expect(resolveAlternateSendAction({
      defaultSendBehavior: "steer",
      isAgentRunning: true,
      canQueue: true,
    })).toBe("queue");
});

it("per-thread queue helpers enqueue, edit/remove, prepend rollback, and clear cleanly", () => {
  let map = new Map<string, QueuedSidechatMessage[]>();
  const m1 = makeQueued("m1", "First follow-up");
  const m2 = makeQueued("m2", "Second follow-up");

  map = enqueueThreadMessage(map, "thread-a", m1);
  map = enqueueThreadMessage(map, "thread-a", m2);
  map = enqueueThreadMessage(map, "thread-b", makeQueued("m3", "Other thread"));

  expect(map.get("thread-a")?.length).toBe(2);
  expect(deriveQueuedMessageLabel(m1)).toBe("First follow-up");

  // Edit / remove first item
  const popped = removeThreadMessageById(map, "thread-a", "m1");
  map = popped.next;
  expect(popped.removed?.id).toBe("m1");
  expect(map.get("thread-a")?.map((x) => x.id)).toStrictEqual(["m2"]);

  // Rollback prepend restores item to head without duplicating
  map = prependThreadMessage(map, "thread-a", m1);
  map = prependThreadMessage(map, "thread-a", m1);
  expect(map.get("thread-a")?.map((x) => x.id)).toStrictEqual(["m1", "m2"]);

  map = clearThreadQueue(map, "thread-a");
  expect(map.has("thread-a")).toBe(false);
  expect(map.get("thread-b")?.length).toBe(1);
});
