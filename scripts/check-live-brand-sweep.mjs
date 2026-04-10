#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const includedRoots = [
  "package.json",
  "cli",
  "server",
  "ui",
  "packages",
  "skills",
  ".factory/skills",
  "scripts",
];

const excludedDirNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "doc",
  "docs",
  "tests",
  "__tests__",
]);

const excludedBasenames = new Set([
  "README.md",
  "CHANGELOG.md",
]);

const excludedExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".svg",
  ".map",
]);

const forbiddenPatterns = [
  { label: "paperclipai", pattern: /paperclipai/g },
  { label: "Paperclip", pattern: /Paperclip/g },
  { label: "X-Paperclip", pattern: /X-Paperclip/g },
  { label: "/api/skills/paperclip", pattern: /\/api\/skills\/paperclip/g },
  { label: "skills/paperclip", pattern: /skills\/paperclip/g },
  { label: "paperclip-create-agent", pattern: /paperclip-create-agent/g },
  { label: "paperclip-create-plugin", pattern: /paperclip-create-plugin/g },
  { label: "paperclip_required", pattern: /paperclip_required/g },
  { label: "isPaperclipManaged", pattern: /isPaperclipManaged/g },
  { label: "paperclipApiUrl", pattern: /paperclipApiUrl/g },
  { label: "paperclipRuntimeSkills", pattern: /paperclipRuntimeSkills/g },
  { label: "paperclipSkillSync", pattern: /paperclipSkillSync/g },
  { label: "paperclipSkillKey", pattern: /paperclipSkillKey/g },
  { label: "[paperclip]", pattern: /\[paperclip\]/g },
];

function shouldSkip(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  const parts = normalized.split("/");

  if (normalized === "scripts/check-live-brand-sweep.mjs") return true;

  if (parts.some((part) => excludedDirNames.has(part))) return true;
  if (excludedExtensions.has(path.extname(normalized))) return true;

  const basename = path.basename(normalized);
  if (!normalized.startsWith("skills/") && !normalized.startsWith(".factory/skills/") && excludedBasenames.has(basename)) {
    return true;
  }

  return false;
}

function collectFiles(targetPath, relBase = "") {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [relBase || path.basename(targetPath)];
  }

  const results = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const childRel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (shouldSkip(childRel)) continue;
      results.push(...collectFiles(path.join(targetPath, entry.name), childRel));
      continue;
    }
    if (shouldSkip(childRel)) continue;
    results.push(childRel);
  }
  return results;
}

function scanFile(relPath) {
  const absPath = path.join(repoRoot, relPath);
  const content = fs.readFileSync(absPath, "utf8");
  const matches = [];

  content.split(/\r?\n/).forEach((line, index) => {
    for (const entry of forbiddenPatterns) {
      if (entry.pattern.test(line)) {
        matches.push({
          file: relPath.split(path.sep).join("/"),
          line: index + 1,
          label: entry.label,
          text: line.trim(),
        });
      }
      entry.pattern.lastIndex = 0;
    }
  });

  return matches;
}

function main() {
  const files = includedRoots.flatMap((root) => collectFiles(path.join(repoRoot, root), root));
  const matches = files.flatMap((file) => scanFile(file));

  if (matches.length > 0) {
    console.error("Residual live-surface legacy-brand matches found:");
    for (const match of matches) {
      console.error(`${match.file}:${match.line}: [${match.label}] ${match.text}`);
    }
    process.exit(1);
  }

  console.log("Live-surface rename sweep is clean.");
}

main();
