export interface UsageCallback {
  (usage: { promptTokens: number; completionTokens: number; totalTokens: number }, provider: string): void;
}

export class UsageTracker {
  private totalTokens: number = 0;
  private stepTokens: number = 0;
  private onUsage?: UsageCallback;
  private onUpdate?: (totalTokens: number, rate: number) => void;
  private startTime?: number;

  constructor(onUsage?: UsageCallback, onUpdate?: (totalTokens: number, rate: number) => void) {
    this.onUsage = onUsage;
    this.onUpdate = onUpdate;
    if (onUsage) {
      const originalOnUsage = onUsage;
      this.onUsage = (usage, provider) => {
        this.totalTokens += usage.totalTokens;
        this.stepTokens = usage.totalTokens; // Last step tokens
        originalOnUsage(usage, provider);
        this.notifyUpdate();
      };
    }
  }

  setStartTime(time: number): void {
    this.startTime = time;
  }

  private notifyUpdate(): void {
    if (this.onUpdate && this.startTime) {
      const elapsed = (Date.now() - this.startTime) / 1000; // seconds
      const rate = elapsed > 0 ? this.totalTokens / elapsed : 0;
      this.onUpdate(this.totalTokens, rate);
    }
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  getStepTokens(): number {
    return this.stepTokens;
  }

  updateUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number }, provider: string): void {
    if (this.onUsage) {
      this.onUsage(usage, provider);
    } else {
      // If no onUsage, still update totals and notify
      this.totalTokens += usage.totalTokens;
      this.stepTokens = usage.totalTokens;
      this.notifyUpdate();
    }
  }
}