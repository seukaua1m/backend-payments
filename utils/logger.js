class Logger {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message
    };

    if (data) {
      logEntry.data = data;
    }

    return logEntry;
  }

  info(message, data = null) {
    const logEntry = this.formatMessage('INFO', message, data);
    console.log(JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
  }

  error(message, data = null) {
    const logEntry = this.formatMessage('ERROR', message, data);
    console.error(JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
  }

  warn(message, data = null) {
    const logEntry = this.formatMessage('WARN', message, data);
    console.warn(JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
  }

  debug(message, data = null) {
    if (this.isDevelopment) {
      const logEntry = this.formatMessage('DEBUG', message, data);
      console.log(JSON.stringify(logEntry, null, 2));
    }
  }
}

module.exports = new Logger();