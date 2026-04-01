import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProgram } from "../index.js";

describe("createProgram", () => {
  it("creates a commander program with correct name", () => {
    const program = createProgram();
    expect(program.name()).toBe("papierklammer-orch");
  });

  it("has all expected commands registered", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("status");
    expect(commandNames).toContain("stale");
    expect(commandNames).toContain("create-issue");
    expect(commandNames).toContain("reprioritize");
    expect(commandNames).toContain("unblock");
    expect(commandNames).toContain("cleanup");
    expect(commandNames).toContain("nudge");
  });

  it("has global --url option", () => {
    const program = createProgram();
    const options = program.options.map((o) => o.long);
    expect(options).toContain("--url");
  });

  it("has global --api-key option", () => {
    const program = createProgram();
    const options = program.options.map((o) => o.long);
    expect(options).toContain("--api-key");
  });

  it("status command requires --company-id", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "status");
    expect(cmd).toBeDefined();
    const opts = cmd!.options.map((o) => o.long);
    expect(opts).toContain("--company-id");
  });

  it("create-issue command requires --title", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "create-issue");
    expect(cmd).toBeDefined();
    const opts = cmd!.options.map((o) => o.long);
    expect(opts).toContain("--title");
    expect(opts).toContain("--company-id");
  });

  it("create-issue command has --assignee and --project options", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "create-issue");
    const opts = cmd!.options.map((o) => o.long);
    expect(opts).toContain("--assignee");
    expect(opts).toContain("--project");
  });

  it("nudge command requires --agent-id", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "nudge");
    expect(cmd).toBeDefined();
    const opts = cmd!.options.map((o) => o.long);
    expect(opts).toContain("--agent-id");
  });

  it("reprioritize command requires --id and --priority", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "reprioritize");
    expect(cmd).toBeDefined();
    const opts = cmd!.options.map((o) => o.long);
    expect(opts).toContain("--id");
    expect(opts).toContain("--priority");
  });

  it("unblock command requires --id", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "unblock");
    expect(cmd).toBeDefined();
    const opts = cmd!.options.map((o) => o.long);
    expect(opts).toContain("--id");
  });
});
