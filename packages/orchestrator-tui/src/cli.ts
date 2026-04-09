export interface CliFlags {
  url: string;
  apiKey: string;
  companyId: string;
  companyName: string;
  model: string;
}

export interface ParseArgsResult {
  flags: CliFlags;
  showHelp: boolean;
}

export const HELP_TEXT = `Usage: papierklammer-tui [options]

Options:
  --url <url>            Orchestrator API URL (default: http://localhost:3100)
  --api-key <key>        API key for authentication
  --company-id <id>      Company ID to connect to
  --company-name <name>  Company name to display in the header
  --model <model>        Codex model to use (default: gpt-5.4)
  --help, -h             Show this help message`;

/**
 * Parse CLI arguments and return flags + whether help was requested.
 * Does NOT call process.exit — the caller decides what to do.
 */
export function parseArgs(argv: string[]): ParseArgsResult {
  const flags: CliFlags = {
    url:
      process.env.PAPIERKLAMMER_TUI_URL ||
      process.env.PAPIERKLAMMER_API_URL ||
      "http://localhost:3100",
    apiKey:
      process.env.PAPIERKLAMMER_TUI_API_KEY ||
      process.env.PAPIERKLAMMER_API_KEY ||
      "",
    companyId: process.env.PAPIERKLAMMER_TUI_COMPANY_ID || "",
    companyName: process.env.PAPIERKLAMMER_TUI_COMPANY_NAME || "",
    model: process.env.PAPIERKLAMMER_TUI_MODEL || "gpt-5.4",
  };

  let showHelp = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--url" && i + 1 < argv.length) {
      flags.url = argv[++i]!;
    } else if (arg === "--api-key" && i + 1 < argv.length) {
      flags.apiKey = argv[++i]!;
    } else if (arg === "--company-id" && i + 1 < argv.length) {
      flags.companyId = argv[++i]!;
    } else if (arg === "--company-name" && i + 1 < argv.length) {
      flags.companyName = argv[++i]!;
    } else if (arg === "--model" && i + 1 < argv.length) {
      flags.model = argv[++i]!;
    } else if (arg === "--help" || arg === "-h") {
      showHelp = true;
    }
  }

  return { flags, showHelp };
}
