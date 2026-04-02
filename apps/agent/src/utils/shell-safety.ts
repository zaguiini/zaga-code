const CONFIRM_PATTERNS = [
  /\brm\s+(-\w*\s+)*-r/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-f/,
  /\bgit\s+push\s+.*--force/,
  /\bdrop\s+table/i,
  /\btruncate\s+table/i,
  /\bdelete\s+from\b/i,
  /\bnpm\s+publish\b/,
  /\bpnpm\s+publish\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
]

const BLOCK_PATTERNS = [/rm\s+(-\w*\s+)*-rf\s+\/(?:\s|$)/, /:\(\)\s*\{.*\}/]

export function checkShellSafety(command: string): 'allow' | 'confirm' | 'block' {
  if (BLOCK_PATTERNS.some(p => p.test(command))) return 'block'
  if (CONFIRM_PATTERNS.some(p => p.test(command))) return 'confirm'
  return 'allow'
}
