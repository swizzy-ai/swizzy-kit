import { BungeePlan } from './types';
import { Step } from '../steps/base';

export class BungeeExecutor {
  private bungeeWorkers: Map<string, Map<string, {
    planId: string;
    workerId: string;
    promise: Promise<any>;
    telescope: Record<string, any>;
  }>> = new Map();
  private pendingReentry: Set<string> = new Set();

  constructor(private wizard: any) {} // Wizard instance

  async executeBungeePlan(plan: BungeePlan): Promise<any> {
    console.log(`🪂 Executing Bungee plan ${plan.id} with ${plan.destinations.length} destinations`);

    // Track active workers for this plan
    const activeWorkers = new Set<Promise<void>>();

    for (let i = 0; i < plan.destinations.length; i++) {
      // Launch worker
      const workerPromise = this.launchBungeeWorker(plan, i);
      activeWorkers.add(workerPromise);

      // Respect concurrency limit
      if (activeWorkers.size >= plan.concurrency) {
        await Promise.race(activeWorkers);
        // Clean up completed workers
        for (const promise of activeWorkers) {
          if (promise !== workerPromise) {
            activeWorkers.delete(promise);
          }
        }
      }
    }

    // Wait for all workers to complete unless optimistic
    if (!plan.optimistic) {
      try {
        await Promise.all(activeWorkers);
      } catch (error: any) {
        if (plan.failWizardOnFailure !== false) { // Default true
          throw error; // Re-throw to stop wizard
        }
        // If failWizardOnFailure is false, just log and continue
        console.error(`Bungee plan ${plan.id} had failures but continuing:`, error);
      }
    }

    if (plan.onComplete) {
      return plan.onComplete(this.wizard);
    }

    if (plan.returnToAnchor !== false) { // Default true
      console.log(`✅ Bungee plan ${plan.id} completed, returning to anchor ${plan.anchorId}`);
    } else {
      console.log(`✅ Bungee plan ${plan.id} completed, proceeding to next step`);
    }
  }

  private async launchBungeeWorker(plan: BungeePlan, index: number): Promise<void> {
    const destination = plan.destinations[index];
    const telescope = destination.config || {};
    const workerId = `${plan.id}_${destination.targetId}_${index}_${Date.now()}`;
    const telescopeContext = this.createTelescopeContext(this.wizard.workflowContext, telescope);

    const promise = this.executeWorkerStep(destination.targetId, telescopeContext);

    // Track this worker
    if (!this.bungeeWorkers.has(plan.id)) {
      this.bungeeWorkers.set(plan.id, new Map());
    }
    this.bungeeWorkers.get(plan.id)!.set(workerId, {
      planId: plan.id,
      workerId,
      promise,
      telescope
    });

    try {
      await promise;
    } finally {
      // Clean up
      const planWorkers = this.bungeeWorkers.get(plan.id);
      if (planWorkers) {
        planWorkers.delete(workerId);
        if (planWorkers.size === 0) {
          this.bungeeWorkers.delete(plan.id);
          // Trigger reentry to anchor if configured
          if (plan.returnToAnchor !== false) {
            this.pendingReentry.add(plan.anchorId);
          }
        }
      }
    }
  }

  private createTelescopeContext(baseContext: any, telescope: Record<string, any>): any {
    return {
      ...baseContext,
      ...telescope,
      _telescope: telescope,
      _anchorId: null
    };
  }

  private async executeWorkerStep(stepId: string, telescopeContext: any): Promise<any> {
    const step = this.wizard.findStep(stepId);
    if (!step) return;

    const stepContext = step.getContext(telescopeContext);
    const stepData = await this.wizard.generateStepData(step, stepContext);
    const actions = this.wizard.createWorkerActions(telescopeContext._telescope);

    return await step.update(stepData, telescopeContext, actions);
  }

  mergeWorkerResults(updates: Record<string, any>, telescope: Record<string, any>): void {
    this.wizard.updateContext(updates);
  }

  private async retriggerAnchor(anchorId: string): Promise<void> {
    const anchorStep = this.wizard.findStep(anchorId);
    if (anchorStep) {
      await this.wizard.executeStep(anchorStep);
    }
  }

  async processReentries(): Promise<void> {
    const anchorsToRetrigger = Array.from(this.pendingReentry);
    this.pendingReentry.clear();
    for (const anchorId of anchorsToRetrigger) {
      await this.retriggerAnchor(anchorId);
    }
  }
}