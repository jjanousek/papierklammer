export interface CliFlags {
  url: string;
  apiKey: string;
  companyId: string;
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
  --help, -h             Show this help message`;

/**
 * Parse CLI arguments and return flags + whether help was requested.
 * Does NOT call process.exit — the caller decides what to do.
 */
export function parseArgs(argv: string[]): ParseArgsResult {
  const flags: CliFlags = {
    url: "http://localhost:3100",
    apiKey: "",
    companyId: "",
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
    } else if (arg === "--help" || arg === "-h") {
      showHelp = true;
    }
  }

  return { flags, showHelp };
}
