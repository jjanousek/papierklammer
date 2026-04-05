import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedAgentHomeContextFiles } from "../services/agent-home-context.js";

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function buildAgent() {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "CEO",
    adapterConfig: {},
  };
}

describe("seedAgentHomeContextFiles", () => {
  it("seeds the onboarding context files into AGENT_HOME when present in the instructions bundle", async () => {
    const agentHome = await makeTempDir("paperclip-agent-home-context-");
    tempDirs.push(agentHome);

    const seeded = await seedAgentHomeContextFiles({
      agent: buildAgent(),
      agentHome,
      exportBundleFiles: async () => ({
        files: {
          "AGENTS.md": "# AGENTS\n",
          "HEARTBEAT.md": "# HEARTBEAT\n",
          "SOUL.md": "# SOUL\n",
          "TOOLS.md": "# TOOLS\n",
        },
        entryFile: "AGENTS.md",
        warnings: [],
      }),
    });

    expect(seeded).toEqual(["HEARTBEAT.md", "SOUL.md", "TOOLS.md"]);
    await expect(fs.readFile(path.join(agentHome, "HEARTBEAT.md"), "utf8")).resolves.toBe("# HEARTBEAT\n");
    await expect(fs.readFile(path.join(agentHome, "SOUL.md"), "utf8")).resolves.toBe("# SOUL\n");
    await expect(fs.readFile(path.join(agentHome, "TOOLS.md"), "utf8")).resolves.toBe("# TOOLS\n");
  });

  it("does not overwrite existing AGENT_HOME context files", async () => {
    const agentHome = await makeTempDir("paperclip-agent-home-context-existing-");
    tempDirs.push(agentHome);
    await fs.writeFile(path.join(agentHome, "TOOLS.md"), "# Existing tools\n", "utf8");

    const seeded = await seedAgentHomeContextFiles({
      agent: buildAgent(),
      agentHome,
      exportBundleFiles: async () => ({
        files: {
          "HEARTBEAT.md": "# HEARTBEAT\n",
          "SOUL.md": "# SOUL\n",
          "TOOLS.md": "# New tools\n",
        },
        entryFile: "AGENTS.md",
        warnings: [],
      }),
    });

    expect(seeded).toEqual(["HEARTBEAT.md", "SOUL.md"]);
    await expect(fs.readFile(path.join(agentHome, "TOOLS.md"), "utf8")).resolves.toBe("# Existing tools\n");
  });
});
