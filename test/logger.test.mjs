import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Logger } from "../node_modules/homebridge/dist/logger.js";
import { withPluginPrefix } from "../dist/logger.js";

let lines;
let originalLog;
let originalError;

beforeEach(() => {
  lines = [];
  originalLog = console.log;
  originalError = console.error;
  console.log = (line) => lines.push(line);
  console.error = (line) => lines.push(line);
  Logger.setTimestampEnabled(false);
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  Logger.setTimestampEnabled(true);
});

describe("withPluginPrefix", () => {
  it("tags messages with the package name Homebridge uses for its own warnings", () => {
    const log = withPluginPrefix(Logger.withPrefix("GoWacFans"));

    log("started");
    log.info("info");
    log.warn("warn");
    log.error("error");

    assert.equal(log.prefix, "homebridge-go-wac-fans");
    assert.equal(lines.length, 4);
    for (const line of lines) {
      assert.match(line, /\[homebridge-go-wac-fans\]/);
      assert.doesNotMatch(line, /\[GoWacFans\]/);
    }
  });

  it("leaves the Homebridge logger it wraps unchanged", () => {
    const original = Logger.withPrefix("GoWacFans");
    withPluginPrefix(original);

    original.info("hello");

    assert.equal(original.prefix, "GoWacFans");
    assert.match(lines[0], /\[GoWacFans\]/);
  });
});
