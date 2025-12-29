import { z } from 'zod';
import { Step, StepConfig, ContextFunction, ContextType } from './base';

export interface TextStepConfig {
  id: string;
  instruction: string;
  update: (result: string, workflowContext: Record<string, any>, actions: import('./base').WizardActions) => Promise<import('./base').FlowControlSignal>;
  contextFunction?: ContextFunction;
  contextType?: ContextType;
  beforeRun?: () => Promise<void> | void;
  afterRun?: (result: string) => Promise<void> | void;
  model: string;
}

export class TextStep extends Step<string> {
  constructor(config: TextStepConfig) {
    // Create a dummy schema for string
    const dummySchema = z.string();
    super({
      ...config,
      schema: dummySchema,
    });
  }

  validate(data: unknown): string {
    // For text steps, just return the data as string
    return typeof data === 'string' ? data : String(data);
  }
}