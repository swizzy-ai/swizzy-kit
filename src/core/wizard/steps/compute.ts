import { z } from 'zod';
import { Step, Context, ContextType } from './base';

export interface ComputeStepConfig {
  id: string;
  instruction: string;
  update: (result: any, workflowContext: Record<string, any>, actions: import('./base').WizardActions) => Promise<import('./base').FlowControlSignal>;
  context?: Context;
  contextType?: ContextType;
  beforeRun?: () => Promise<void> | void;
  afterRun?: (result: any) => Promise<void> | void;
}

export class ComputeStep extends Step<any> {
  public readonly isComputeStep: boolean = true;

  constructor(config: ComputeStepConfig) {
    // Use a permissive schema that accepts any data
    const permissiveSchema = z.any();
    super({
      ...config,
      schema: permissiveSchema,
      model: '', // No model needed for compute steps
    });
  }

  validate(data: unknown): any {
    // For compute steps, accept any data without validation
    return data;
  }
}