import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapState, speedFromHomeKit } from "../dist/wac.js";

describe("WAC fan mapping", () => {
  it("maps dynamic state to HomeKit values", () => {
    assert.deepEqual(mapState({
      clientId: "MF_1",
      fanOn: true,
      fanSpeed: 3,
      fanDirection: "reverse",
      lightOn: true,
      lightBrightness: 83
    }), {
      active: 1,
      speed: 50,
      direction: 1,
      lightOn: true,
      brightness: 83
    });
  });

  it("maps HomeKit percentages to six speed steps", () => {
    assert.equal(speedFromHomeKit(1), 1);
    assert.equal(speedFromHomeKit(50), 3);
    assert.equal(speedFromHomeKit(100), 6);
  });
});
