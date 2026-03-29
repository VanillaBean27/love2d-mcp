/**
 * Simple logger that writes to stderr (to avoid interfering with stdio MCP transport).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const extra = args.length > 0 ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${extra}`;
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      process.stderr.write(formatMessage('debug', message, ...args) + '\n');
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      process.stderr.write(formatMessage('info', message, ...args) + '\n');
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      process.stderr.write(formatMessage('warn', message, ...args) + '\n');
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      process.stderr.write(formatMessage('error', message, ...args) + '\n');
    }
  },
};
