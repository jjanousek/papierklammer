import fs from "node:fs/promises";
import path from "node:path";
import { agentInstructionsService } from "./agent-instructions.js";

const AGENT_HOME_CONTEXT_FILE_NAMES = ["HEARTBEAT.md", "SOUL.md", "TOOLS.md"] as const;

type AgentLike = {
  id: string;
  companyId: string;
  name: string;
  adapterConfig: unknown;
};

type ExportBundleFiles = (agent: AgentLike) => Promise<{
  files: Record<string, string>;
  entryFile: string;
  warnings: string[];
}>;

async function pathExists(filePath: string) {
  return fs.stat(filePath).then(() => true).catch(() => false);
}

export async function seedAgentHomeContextFiles(input: {
  agent: AgentLike;
  agentHome: string;
  exportBundleFiles?: ExportBundleFiles;
}): Promise<string[]> {
  await fs.mkdir(input.agentHome, { recursive: true });

  const exportBundleFiles = input.exportBundleFiles ?? agentInstructionsService().exportFiles;

  let bundleFiles: Record<string, string>;
  try {
    const exported = await exportBundleFiles(input.agent);
    bundleFiles = exported.files;
  } catch {
    return [];
  }

  const seeded: string[] = [];
  for (const fileName of AGENT_HOME_CONTEXT_FILE_NAMES) {
    const content = bundleFiles[fileName];
    if (typeof content !== "string") continue;

    const targetPath = path.join(input.agentHome, fileName);
    if (await pathExists(targetPath)) continue;

    await fs.writeFile(targetPath, content, "utf8");
    seeded.push(fileName);
  }

  return seeded;
}
