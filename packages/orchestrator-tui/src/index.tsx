#!/usr/bin/env node
import { spawn } from "node:child_process";
import { render } from "ink";
import React from "react";
import { App } from "./components/App.js";
import { parseArgs, HELP_TEXT } from "./cli.js";

const { flags, showHelp } = parseArgs(process.argv);

if (showHelp) {
  console.log(HELP_TEXT);
  process.exit(0);
}

render(
  <App
    url={flags.url}
    apiKey={flags.apiKey}
    companyId={flags.companyId}
    spawnFn={spawn}
    enableCodex
  />,
);
