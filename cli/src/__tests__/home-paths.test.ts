import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalInstancePaths,
  expandHomePrefix,
  resolvePapierklammerHomeDir,
  resolvePapierklammerInstanceId,
} from "../config/home.js";

const ORIGINAL_ENV = { ...process.env };

describe("home path resolution", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to ~/.papierklammer and default instance", () => {
    delete process.env.PAPIERKLAMMER_HOME;
    delete process.env.PAPIERKLAMMER_INSTANCE_ID;

    const paths = describeLocalInstancePaths();
    expect(paths.homeDir).toBe(path.resolve(os.homedir(), ".papierklammer"));
    expect(paths.instanceId).toBe("default");
    expect(paths.configPath).toBe(path.resolve(os.homedir(), ".papierklammer", "instances", "default", "config.json"));
  });

  it("supports PAPIERKLAMMER_HOME and explicit instance ids", () => {
    process.env.PAPIERKLAMMER_HOME = "~/paperclip-home";

    const home = resolvePapierklammerHomeDir();
    expect(home).toBe(path.resolve(os.homedir(), "paperclip-home"));
    expect(resolvePapierklammerInstanceId("dev_1")).toBe("dev_1");
  });

  it("rejects invalid instance ids", () => {
    expect(() => resolvePapierklammerInstanceId("bad/id")).toThrow(/Invalid instance id/);
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePrefix("~")).toBe(os.homedir());
    expect(expandHomePrefix("~/x/y")).toBe(path.resolve(os.homedir(), "x/y"));
  });
});
