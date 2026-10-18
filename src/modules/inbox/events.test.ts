import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus, type InboxEvent } from "./events.js";

test("assinantes recebem o que é publicado e podem cancelar", () => {
  const bus = createEventBus();
  const received: InboxEvent[] = [];
  const event: InboxEvent = { type: "connection.updated", state: "open", number: "1", qr: null };

  const unsubscribe = bus.subscribe((e) => received.push(e));
  assert.equal(bus.subscriberCount(), 1);
  bus.publish(event);
  unsubscribe();
  bus.publish(event);

  assert.deepEqual(received, [event]);
  assert.equal(bus.subscriberCount(), 0);
});
