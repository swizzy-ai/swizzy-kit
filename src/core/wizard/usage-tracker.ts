export interface UsageCallback {
  (usage: { promptTokens: number; completionTokens: number; totalTokens: number }, provider: string): void;
}

export class UsageTracker {
  private totalTokens: number = 0;
  private stepTokens: number = 0;
  private onUsage?: UsageCallback;

  constructor(onUsage?: UsageCallback) {
    this.onUsage = onUsage;
    if (onUsage) {
      const originalOnUsage = onUsage;
      this.onUsage = (usage, provider) => {
        this.totalTokens += usage.totalTokens;
        this.stepTokens = usage.totalTokens; // Last step tokens
        originalOnUsage(usage, provider);
      };
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
    }
  }
}