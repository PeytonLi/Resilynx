import { describe, expect, it } from "bun:test";
import { Healer, type FailureEvent } from "./index";

describe("Healer stub", () => {
  it("emits healing then restored for a failure event", async () => {
    const healer = new Healer();
    const order: string[] = [];
    healer.on("healing", () => order.push("healing"));
    healer.on("restored", () => order.push("restored"));

    const failure: FailureEvent = {
      providerId: "mock-carbon-registry",
      errorLog: "connection refused",
      consecutiveFailures: 3,
      timestamp: new Date().toISOString(),
    };

    await healer.heal(failure);

    expect(order).toEqual(["healing", "restored"]);
  });
});
