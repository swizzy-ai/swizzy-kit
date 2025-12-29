import { BungeePlan, BungeeDestination } from './types';

export class BungeeBuilder {
  private _plan: BungeePlan;

  constructor(currentStepId: string) {
    this._plan = {
      id: `bungee_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      anchorId: currentStepId,
      destinations: [],
      concurrency: 5
    };
  }

  /**
   * Add a single step execution.
   */
  public readonly add = (stepId: string) => {
    this._plan.destinations.push({ type: 'step', targetId: stepId });
    return this;
  };

  /**
   * Add multiple executions based on count with config function.
   */
  public readonly batch = (
    stepId: string,
    count: number,
    configFn: (index: number) => Record<string, any>
  ) => {
    for (let i = 0; i < count; i++) {
      this._plan.destinations.push({ type: 'step', targetId: stepId });
    }
    this._plan.configFn = configFn;
    return this;
  };

  /**
   * Configure execution settings.
   */
  public readonly config = (options: { concurrency?: number }) => {
    if (options.concurrency !== undefined) {
      this._plan.concurrency = options.concurrency;
    }
    return this;
  };

  /**
   * Trigger the Jump.
   */
  public readonly jump = (): { type: 'BUNGEE_JUMP'; plan: BungeePlan } => {
    return { type: 'BUNGEE_JUMP', plan: this._plan };
  };
}