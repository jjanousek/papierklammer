#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { App } from "./components/App.js";

interface CliFlags {
  url: string;
  apiKey: string;
  companyId: string;
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    url: "http://localhost:3100",
    apiKey: "",
    companyId: "",
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--url" && i + 1 < argv.length) {
      flags.url = argv[++i]!;
    } else if (arg === "--api-key" && i + 1 < argv.length) {
      flags.apiKey = argv[++i]!;
    } else if (arg === "--company-id" && i + 1 < argv.length) {
      flags.companyId = argv[++i]!;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: papierklammer-tui [options]

Options:
  --url <url>            Orchestrator API URL (default: http://localhost:3100)
  --api-key <key>        API key for authentication
  --company-id <id>      Company ID to connect to
  --help, -h             Show this help message`);
      process.exit(0);
    }
  }

  return flags;
}

const flags = parseArgs(process.argv);

render(
  <App url={flags.url} apiKey={flags.apiKey} companyId={flags.companyId} />,
);
