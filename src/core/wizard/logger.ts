import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private logFilePath: string | undefined;
  private isFileSystemAvailable: boolean = false;

  constructor(id: string) {
    // Try to set up file logging, but gracefully handle environments without file system
    try {
      const logsDir = path.join(process.cwd(), '.wizard');

      // Check if we can access the directory
      try {
        fs.accessSync(logsDir, fs.constants.F_OK);
      } catch {
        // Directory doesn't exist, try to create it
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // If we get here, file system is available
      this.isFileSystemAvailable = true;
      this.logFilePath = path.join(logsDir, `${id}.log`);
    } catch (error) {
      // File system operations failed (e.g., Cloudflare Workers, restricted environments)
      this.isFileSystemAvailable = false;
      // Don't log here to avoid recursion - console logging will be used as fallback
    }
  }

  log(messageOrFn: string | (() => string)): void {
    const message = typeof messageOrFn === 'function' ? messageOrFn() : messageOrFn;
    const content = `${new Date().toISOString()}: ${message}\n`;

    if (this.isFileSystemAvailable && this.logFilePath) {
      this.appendToFile(content);
    } else {
      // Fallback to console logging when file system is not available
      console.log('Wizard log:', content.trim());
    }
  }

  private appendToFile(content: string): void {
    if (!this.logFilePath) return;
    try {
      fs.appendFileSync(this.logFilePath, content, 'utf8');
    } catch (error) {
      console.log('Wizard log:', content.trim());
    }
  }

  async getLog(): Promise<string> {
    if (!this.isFileSystemAvailable || !this.logFilePath || !fs.existsSync(this.logFilePath)) return '';
    try {
      return await fs.promises.readFile(this.logFilePath, 'utf8');
    } catch {
      return '';
    }
  }
}