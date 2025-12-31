import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private logFilePath: string | undefined;

  constructor(id: string) {
    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), '.wizard');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    this.logFilePath = path.join(logsDir, `${id}.log`);
  }

  log(messageOrFn: string | (() => string)): void {
    if (!this.logFilePath) return; // Early exit if logging disabled
    const message = typeof messageOrFn === 'function' ? messageOrFn() : messageOrFn;
    const content = `${new Date().toISOString()}: ${message}\n`;
    this.appendToFile(content);
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
    if (!this.logFilePath || !fs.existsSync(this.logFilePath)) return '';
    try {
      return await fs.promises.readFile(this.logFilePath, 'utf8');
    } catch {
      return '';
    }
  }
}