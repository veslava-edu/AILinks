interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: string;
  message: string;
  data?: any;
}

class LoggerService {
  private logs: LogEntry[] = [];
  private maxLogs = 10000; // Límite de logs en memoria

  log(level: LogEntry['level'], category: string, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : undefined // Deep clone para evitar referencias
    };

    this.logs.push(entry);

    // Mantener solo los últimos maxLogs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // También loggear en consola
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    const prefix = `[${entry.timestamp}] [${category}]`;
    if (data) {
      console[consoleMethod](prefix, message, data);
    } else {
      console[consoleMethod](prefix, message);
    }
  }

  info(category: string, message: string, data?: any) {
    this.log('info', category, message, data);
  }

  warn(category: string, message: string, data?: any) {
    this.log('warn', category, message, data);
  }

  error(category: string, message: string, data?: any) {
    this.log('error', category, message, data);
  }

  debug(category: string, message: string, data?: any) {
    this.log('debug', category, message, data);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsAsText(): string {
    return this.logs.map(entry => {
      const dataStr = entry.data ? `\n  Data: ${JSON.stringify(entry.data, null, 2)}` : '';
      return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}${dataStr}`;
    }).join('\n\n');
  }

  getLogsAsJSON(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  downloadLogs(format: 'txt' | 'json' = 'txt') {
    const content = format === 'json' ? this.getLogsAsJSON() : this.getLogsAsText();
    const blob = new Blob([content], { 
      type: format === 'json' ? 'application/json' : 'text/plain' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-intelligence-logs-${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clear() {
    this.logs = [];
  }

  getErrorCount(): number {
    return this.logs.filter(log => log.level === 'error').length;
  }

  getRecentErrors(count: number = 10): LogEntry[] {
    return this.logs
      .filter(log => log.level === 'error')
      .slice(-count);
  }
}

// Singleton instance
export const logger = new LoggerService();

// Export convenience functions
export const logInfo = (category: string, message: string, data?: any) => logger.info(category, message, data);
export const logWarn = (category: string, message: string, data?: any) => logger.warn(category, message, data);
export const logError = (category: string, message: string, data?: any) => logger.error(category, message, data);
export const logDebug = (category: string, message: string, data?: any) => logger.debug(category, message, data);

