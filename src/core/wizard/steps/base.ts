import { z } from 'zod';
import { LLMClient } from '../../../services/client';

import { BungeeBuilder } from '../bungee/builder';

export interface WizardActions {
  updateContext: (updates: Record<string, any>) => void;
  llmClient: LLMClient;
  goto: (stepId: string) => FlowControlSignal;
  next: () => FlowControlSignal;
  stop: () => FlowControlSignal;
  retry: () => FlowControlSignal;
  wait: () => FlowControlSignal;
  bungee: {
    init: () => BungeeBuilder;
  };
}

import { BungeePlan } from '../bungee/types';

export type FlowControlSignal =
  | 'NEXT'
  | 'STOP'
  | 'RETRY'
  | 'WAIT'
  | string
  | { type: 'BUNGEE_JUMP'; plan: BungeePlan };

export type ContextFunction = (workflowContext: any) => any;

export type ContextType = 'xml' | 'template' | 'both';

export interface StepConfig<T = any> {
  id: string;
  instruction: string;
  schema: z.ZodType<T>;
  update: (result: T, workflowContext: Record<string, any>, actions: WizardActions) => Promise<FlowControlSignal>;
  contextFunction?: ContextFunction;
  contextType?: ContextType;
  beforeRun?: () => Promise<void> | void;
  afterRun?: (result: T) => Promise<void> | void;
  model: string;
}

export class Step<T = any> {
  public readonly id: string;
  public readonly instruction: string;
  public readonly schema: z.ZodType<T>;
  public readonly update: (result: T, workflowContext: Record<string, any>, actions: WizardActions) => Promise<FlowControlSignal>;
  public readonly contextFunction?: ContextFunction;
  public readonly contextType?: ContextType;
  public readonly beforeRun?: () => Promise<void> | void;
  public readonly afterRun?: (result: T) => Promise<void> | void;
  public readonly model: string;

  constructor(config: StepConfig<T>) {
    this.id = config.id;
    this.instruction = config.instruction;
    this.schema = config.schema;
    this.update = config.update;
    this.contextFunction = config.contextFunction;
    this.contextType = config.contextType || 'xml'; // Default to xml
    this.beforeRun = config.beforeRun;
    this.afterRun = config.afterRun;
    this.model = config.model;
  }

  validate(data: unknown): T {
    const result = this.schema.safeParse(data);
    if (!result.success) {
      throw new Error(`Step "${this.id}" validation failed: ${result.error.message}`);
    }
    return result.data;
  }

  getContext(workflowContext: any): any {
    return this.contextFunction ? this.contextFunction(workflowContext) : workflowContext;
  }
}