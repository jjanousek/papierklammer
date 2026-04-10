import fs from "node:fs";
import { paperclipConfigSchema, type PapierklammerConfig } from "@papierklammer/shared";
import { resolvePapierklammerConfigPath } from "./paths.js";

export function readConfigFile(): PapierklammerConfig | null {
  const configPath = resolvePapierklammerConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return paperclipConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
