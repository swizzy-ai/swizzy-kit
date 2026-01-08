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
  public readonly add = (stepId: string, config?: Record<string, any>) => {
    this._plan.destinations.push({ type: 'step', targetId: stepId, config });
    return this;
  };

  /**
   * Add multiple executions based on count with config function.
   */
  public readonly batch = (
    stepId: string,
    count: number,
    configFn: (index: number) => Record<string, any>,
    options?: {
      optimistic?: boolean;
      returnToAnchor?: boolean;
      failWizardOnFailure?: boolean;
    }
  ) => {
    for (let i = 0; i < count; i++) {
      this._plan.destinations.push({ type: 'step', targetId: stepId, config: configFn(i) });
    }
    // Apply batch-specific options
    if (options?.optimistic !== undefined) {
      this._plan.optimistic = options.optimistic;
    }
    if (options?.returnToAnchor !== undefined) {
      this._plan.returnToAnchor = options.returnToAnchor;
    }
    if (options?.failWizardOnFailure !== undefined) {
      this._plan.failWizardOnFailure = options.failWizardOnFailure;
    }
    return this;
  };

  /**
   * Configure execution settings.
   */
  public readonly config = (options: {
    concurrency?: number;
    optimistic?: boolean;
    returnToAnchor?: boolean;
    failWizardOnFailure?: boolean;
  }) => {
    if (options.concurrency !== undefined) {
      this._plan.concurrency = options.concurrency;
    }
    if (options.optimistic !== undefined) {
      this._plan.optimistic = options.optimistic;
    }
    if (options.returnToAnchor !== undefined) {
      this._plan.returnToAnchor = options.returnToAnchor;
    }
    if (options.failWizardOnFailure !== undefined) {
      this._plan.failWizardOnFailure = options.failWizardOnFailure;
    }
    return this;
  };

  /**
   * Set completion callback.
   */
  public readonly onComplete = (callback: (wizard: any) => any) => {
    this._plan.onComplete = callback;
    return this;
  };

  /**
   * Trigger the Jump.
   */
  public readonly jump = (): { type: 'BUNGEE_JUMP'; plan: BungeePlan } => {
    return { type: 'BUNGEE_JUMP', plan: this._plan };
  };
}