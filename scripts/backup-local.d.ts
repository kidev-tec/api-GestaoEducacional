/** Declarações para os scripts .mjs de backup/restore (RF-021). */
export function parseLocalDsn(dsn: string): {
  host: string; port: string; user: string; database: string; env: Record<string, string>;
};
export function assertRestoreConfirmed(argv: string[]): void;
export function pgDumpArgs(dsn: unknown, outFile: string): string[];
export function pgRestoreArgs(dsn: unknown, inFile: string): string[];
export function runLocal(tool: string, args: string[], env: Record<string, string>): void;
