import { z } from 'zod';
import { Step, StepConfig, FlowControlSignal, WizardActions } from './steps/base';
import { TextStep, TextStepConfig } from './steps/text';
import { ComputeStep, ComputeStepConfig } from './steps/compute';
import { LLMClient } from '../../services/client/index';
import { ProviderRegistry } from '../../services/client/registry';
import { BungeeBuilder } from './bungee/builder';
import { BungeePlan } from './bungee/types';
import { VisualizationManager } from './visualization-manager';
import { SchemaUtils } from './schema-utils';
import { BungeeExecutor } from './bungee/executor';
import { Logger } from './logger';
import { UsageTracker } from './usage-tracker';
import { ContextManager } from './context-manager';

// Simple EventEmitter for wizard events
class EventEmitter {
  private events: Map<string, Function[]> = new Map();

  on(event: string, callback: Function) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(callback);
  }

  emit(event: string, data?: any) {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }
}

export interface WizardConfig {
  id: string;
  systemPrompt?: string;
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }, provider: string) => void;
  maxRetries?: number;
  logging?: boolean;
}

export interface WizardContext {
  updateContext: (updates: ContextData) => void;
  llmClient: LLMClient;
  goto: (stepId: string) => FlowControlSignal;
  next: () => FlowControlSignal;
  stop: () => FlowControlSignal;
  retry: () => FlowControlSignal;
}

type ContextData = Record<string, any>;

export class Wizard {
  private static readonly TEMPLATE_REGEX = /\{\{(\w+(?:\.\w+)*)\}\}/g;

  /**
   * Regex pattern for matching wizard-tagged XML fields during streaming parsing.
   * Matches tags like: <fieldname tag-category="wizard" type="string">
   * Used by createStreamingXmlParser() to identify fields to extract from LLM responses.
   */
  private static readonly WIZARD_TAG_PATTERN = /<(\w+)\s+([^>]*tag-category=["']wizard["'][^>]*)>/gi;

  // Flow control signals
  private static readonly NEXT = 'NEXT';
  private static readonly STOP = 'STOP';
  private static readonly RETRY = 'RETRY';
  private static readonly WAIT = 'WAIT';

  private id: string;
  private llmClient: LLMClient;
  private systemPrompt?: string;
  private steps: Array<Step | Step[]> = [];
  private stepIndexMap: Map<string, number> = new Map();

  private currentStepIndex: number = 0;
  private isPaused: boolean = false;
  private isRunning: boolean = false;
  private isStepMode: boolean = false;
  private skipStartWait = false;
  private pauseResolver?: () => void;
  private userOverrideData?: any;

  // Configuration
  private maxRetries: number;
  private isLoggingEnabled: boolean;

  // Managers
  private logger: Logger;
  private usageTracker: UsageTracker;
  private contextManager: ContextManager;
  private visualizationManager: VisualizationManager;
  private bungeeExecutor: BungeeExecutor;
  private events: EventEmitter;

  private debounce(func: Function, wait: number) {
    let timeout: NodeJS.Timeout;
    return (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  private debouncedSendContextUpdate = this.debounce(() => {
    this.visualizationManager.sendContextUpdate(this.contextManager.getContext());
  }, 100);

  // Getters for manager methods
  private get workflowContext(): ContextData {
    return this.contextManager.getContext();
  }

  private set workflowContext(value: ContextData) {
    this.contextManager.setWorkflowContext(value);
  }

  private get log(): (message: string | (() => string)) => void {
    return this.isLoggingEnabled ? this.logger.log.bind(this.logger) : () => { };
  }

  private get sendToClients(): (message: any) => void {
    return this.visualizationManager.sendToClients.bind(this.visualizationManager);
  }

  private get visualizationServer(): any {
    return this.visualizationManager.visualizationServer;
  }

  constructor(config: WizardConfig) {
    this.id = config.id;
    const registry = new ProviderRegistry();
    this.llmClient = new LLMClient(registry);
    this.systemPrompt = config.systemPrompt;

    // Initialize configuration
    this.maxRetries = config.maxRetries ?? 3;
    this.isLoggingEnabled = config.logging ?? (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV);

    // Initialize managers
    this.logger = new Logger(this.id);
    this.contextManager = new ContextManager();
    this.visualizationManager = new VisualizationManager(this);
    this.usageTracker = new UsageTracker(config.onUsage, (totalTokens, rate) => {
      this.visualizationManager.sendTokenUpdate(totalTokens, rate);
    });
    this.bungeeExecutor = new BungeeExecutor(this);
    this.events = new EventEmitter();
  }


  addStep<T>(config: StepConfig<T>): this {
    const step = new Step(config);
    const index = this.steps.length;
    this.steps.push(step);
    this.stepIndexMap.set(step.id, index);
    return this;
  }

  addParallelSteps(callback: (addStep: <T>(config: StepConfig<T>) => void) => void): this {
    const configs: StepConfig[] = [];
    const addStep = <T>(config: StepConfig<T>) => configs.push(config);
    callback(addStep);

    const parallelSteps = configs.map(c => new Step(c));
    const index = this.steps.length;
    this.steps.push(parallelSteps);

    // Add all parallel steps to index with same position
    parallelSteps.forEach(step => this.stepIndexMap.set(step.id, index));

    return this;
  }

  addTextStep(config: TextStepConfig): this {
    const step = new TextStep(config);
    const index = this.steps.length;
    this.steps.push(step);
    this.stepIndexMap.set(step.id, index);
    return this;
  }

  addComputeStep(config: ComputeStepConfig): this {
    const step = new ComputeStep(config);
    const index = this.steps.length;
    this.steps.push(step);
    this.stepIndexMap.set(step.id, index);
    return this;
  }

  goto(stepId: string): FlowControlSignal { return `GOTO ${stepId}`; }
  next(): FlowControlSignal { return Wizard.NEXT; }
  stop(): FlowControlSignal { return Wizard.STOP; }
  retry(): FlowControlSignal { return Wizard.RETRY; }
  wait(): FlowControlSignal { return Wizard.WAIT; }

  on(event: string, callback: Function): this {
    this.events.on(event, callback);
    return this;
  }

  private clearStepError(stepId: string): void {
    const context = this.contextManager.getContext();
    delete context[`${stepId}_error`];
    delete context[`${stepId}_retryCount`];
    this.contextManager.setWorkflowContext(context);
  }

  private isStringSignal(signal: FlowControlSignal): signal is string {
    return typeof signal === 'string';
  }

  private isBungeeJumpSignal(signal: FlowControlSignal): signal is { type: 'BUNGEE_JUMP'; plan: BungeePlan } {
    return typeof signal === 'object' && signal !== null && signal.type === 'BUNGEE_JUMP';
  }

  private async handleFlowControlSignal(signal: FlowControlSignal): Promise<boolean> {
    switch (signal) {
      case Wizard.NEXT:
        this.currentStepIndex++;
        return true;
      case Wizard.STOP:
        this.isRunning = false; // Stop the entire wizard execution
        return false;
      case Wizard.RETRY:
        return true;
      case Wizard.WAIT:
        await new Promise(resolve => setTimeout(resolve, 10 * 1000));
        this.currentStepIndex++;
        return true;
      default:
        if (this.isStringSignal(signal) && signal.startsWith('GOTO ')) {
          const targetStepId = signal.substring(5);
          const targetIndex = this.findStepIndex(targetStepId);
          if (targetIndex !== -1) {
            this.currentStepIndex = targetIndex;
          } else {
            throw new Error(`Unknown step ID for GOTO: ${targetStepId}`);
          }
          return true;
        } else if (this.isBungeeJumpSignal(signal)) {
          try {
            const result = await this.bungeeExecutor.executeBungeePlan(signal.plan);
            if (result) {
              return await this.handleFlowControlSignal(result);
            }
            if (signal.plan.returnToAnchor === false) {
              this.currentStepIndex++; // Proceed to next step when not returning to anchor
            }
            return true;
          } catch (error: any) {
            console.error('Bungee plan failed:', error);
            this.workflowContext[`bungee_error`] = error.message;
            if (signal.plan.failWizardOnFailure !== false) { // Default true
              this.isRunning = false; // Stop the wizard on bungee failure
              return false;
            }
            // If failWizardOnFailure is false, continue
            return true;
          }
        }
    }
    return true;
  }

  private async initializeRun(): Promise<void> {
    // Only wait for UI command if visualization server is actually running
    if (this.visualizationServer) {
      console.log('🎯 Waiting for UI to start wizard execution...');
      this.sendToClients({ type: 'status_update', status: { waitingForStart: true, isStepMode: false } });
      await this.visualizationManager.waitForRunCommand();
      console.log('🚀 Starting wizard execution from UI command');

      // Send all steps info
      const stepsInfo = this.steps.map(item => {
        if (Array.isArray(item)) {
          return item.map(step => ({
            id: step.id,
            instruction: step.instruction,
            fields: SchemaUtils.extractSchemaFields(step.schema),
            status: 'pending'
          }));
        } else {
          return {
            id: item.id,
            instruction: item.instruction,
            fields: SchemaUtils.extractSchemaFields(item.schema),
            status: 'pending'
          };
        }
      }).flat();
      this.sendToClients({ type: 'wizard_start', steps: stepsInfo });
    }

    this.log('Wizard session started');
    this.currentStepIndex = 0;
    this.usageTracker.setStartTime(Date.now());
    this.isRunning = true;

    // Emit start event
    this.events.emit('start', {
      wizardId: this.id,
      timestamp: Date.now(),
      steps: this.steps.map(item => {
        if (Array.isArray(item)) {
          return item.map(step => ({
            id: step.id,
            instruction: step.instruction,
            fields: SchemaUtils.extractSchemaFields(step.schema)
          }));
        } else {
          return {
            id: item.id,
            instruction: item.instruction,
            fields: SchemaUtils.extractSchemaFields(item.schema)
          };
        }
      }).flat()
    });
  }

  private async executeParallelSteps(parallelSteps: Step[]): Promise<FlowControlSignal> {
    console.log(`Starting parallel steps: ${parallelSteps.map(s => s.id).join(', ')}`);
    this.log(`Starting parallel steps: ${parallelSteps.map(s => s.id).join(', ')}`);

    const promises = parallelSteps.map(step => this.executeStep(step));
    const signals = await Promise.all(promises);

    let nextSignal: FlowControlSignal = Wizard.NEXT;
    for (const signal of signals) {
      if (signal === Wizard.STOP) {
        return Wizard.STOP;
      }
      if (this.isStringSignal(signal) && signal.startsWith('GOTO ')) {
        nextSignal = signal;
        break;
      }
      if (signal === Wizard.RETRY) {
        nextSignal = Wizard.RETRY;
      }
    }

    return nextSignal;
  }

  private async executeSequentialStep(step: Step): Promise<void> {
    const signal = await this.executeStep(step);
    if (!(await this.handleFlowControlSignal(signal))) return;
  }

  private finalizeRun(startTime: number): void {
    const endTime = Date.now();
    const duration = endTime - startTime;

    this.isRunning = false;
    this.sendToClients({ type: 'status_update', status: { completed: true } });
    console.log(`✅ Wizard completed in ${duration}ms`);

    // Emit complete event
    this.events.emit('complete', {
      duration,
      totalSteps: this.steps.length,
      timestamp: endTime
    });
  }



  private createBaseActions(): Pick<WizardActions, 'updateContext' | 'llmClient' | 'goto' | 'next' | 'stop' | 'retry' | 'wait'> {
    return {
      updateContext: (updates: ContextData) => this.updateContext(updates),
      llmClient: this.llmClient,
      goto: (stepId: string) => this.goto(stepId),
      next: () => this.next(),
      stop: () => this.stop(),
      retry: () => this.retry(),
      wait: () => this.wait(),
    };
  }

  private createWizardActions(anchorStepId: string = ''): WizardActions {
    return {
      ...this.createBaseActions(),
      bungee: {
        init: () => new BungeeBuilder(anchorStepId)
      }
    };
  }

  private createWorkerActions(telescope: Record<string, any>): WizardActions {
    return {
      updateContext: (updates: ContextData) => {
        this.bungeeExecutor.mergeWorkerResults(updates, telescope);
      },
      llmClient: this.llmClient,
      goto: () => Wizard.STOP,
      next: () => Wizard.STOP,
      stop: () => Wizard.STOP,
      retry: () => Wizard.STOP,
      wait: () => Wizard.STOP,
      bungee: {
        init: () => {
          throw new Error('Bungee not allowed in worker context');
        }
      }
    };
  }






  public findStep(stepId: string): Step | null {
    const index = this.stepIndexMap.get(stepId);
    if (index === undefined) return null;
    const item = this.steps[index];
    if (Array.isArray(item)) {
      return item.find(s => s.id === stepId) || null;
    } else {
      return item.id === stepId ? item : null;
    }
  }

  private findStepIndex(stepId: string): number {
    return this.stepIndexMap.get(stepId) ?? -1;
  }

  private async executeStep(step: Step): Promise<FlowControlSignal> {
    console.log(`Starting step ${step.id}`);
    this.logger.log(`Starting step ${step.id}`);

    const stepStartTime = Date.now();

    // Emit step:start event
    this.events.emit('step:start', {
      stepId: step.id,
      instruction: step.instruction,
      timestamp: stepStartTime
    });

    const stepContext = await step.getContext(this.contextManager.getContext());
    let processedInstruction = step.instruction;
    if (step.contextType === 'template' || step.contextType === 'both') {
      processedInstruction = this.applyTemplate(step.instruction, stepContext);
    }
    this.visualizationManager.sendStepUpdate({
      stepId: step.id,
      status: 'current',
      instruction: processedInstruction,
      context: stepContext,
      fields: SchemaUtils.extractSchemaFields(step.schema)
    });
    this.debouncedSendContextUpdate();

    try {
      if (step.beforeRun) {
        await step.beforeRun();
      }

      this.logger.log(() => `Context for step ${step.id}: ${JSON.stringify(stepContext)}`);

      // Skip LLM data generation for compute steps
      const stepData = (step as any).isComputeStep ? null : await this.generateStepData(step, stepContext);

      if (this.isPaused) {
        console.log('⏸️ Paused before LLM call, waiting for user input...');
        await this.visualizationManager.waitForResume();
        console.log('▶️ Resumed, checking for user override...');

        if (this.userOverrideData) {
          console.log('📝 Using user override data');
          try {
            const validatedData = step.validate(this.userOverrideData);
            this.visualizationManager.sendStepUpdate({
              stepId: step.id,
              status: 'completed',
              data: validatedData
            });
            this.userOverrideData = undefined;
            return await this.processStepResult(step, validatedData);
          } catch (validationError: any) {
            console.error('User override validation failed:', validationError.message);
            this.userOverrideData = undefined;
          }
        }
      }

      if (stepData && stepData.__validationFailed) {
        console.log(`🔄 Validation failed for step ${step.id}, retrying...`, stepData);

        // Emit step:retry event
        this.events.emit('step:retry', {
          stepId: step.id,
          attempt: (this.workflowContext[`${step.id}_retryCount`] || 0) + 1,
          error: stepData.error,
          timestamp: Date.now()
        });

        return 'RETRY';
      }

      const actions = this.createWizardActions(step.id);
      const signal = await step.update(stepData, this.workflowContext, actions);

      this.visualizationManager.sendStepUpdate({
        stepId: step.id,
        status: 'completed',
        data: stepData
      });

      this.logger.log(() => `Step ${step.id} completed with data: ${JSON.stringify(stepData)}`);

      // Emit step:complete event
      this.events.emit('step:complete', {
        stepId: step.id,
        data: stepData,
        duration: Date.now() - stepStartTime,
        timestamp: Date.now()
      });

      return this.finalizeStepExecution(step, stepData, signal);
    } catch (error: any) {
      console.log('Processing error', error);

      const currentRetryCount = (this.workflowContext[`${step.id}_retryCount`] || 0) + 1;

      // Check if we've exceeded max retries
      if (currentRetryCount > this.maxRetries) {
        console.log(`Step ${step.id} failed after ${this.maxRetries} retries, stopping wizard`);

        // Emit step:failed event
        this.events.emit('step:failed', {
          stepId: step.id,
          error: error,
          retryCount: currentRetryCount,
          timestamp: Date.now()
        });

        // Stop the wizard
        return Wizard.STOP;
      }

      // Emit step:error event
      this.events.emit('step:error', {
        stepId: step.id,
        error: error,
        retryCount: currentRetryCount,
        timestamp: Date.now()
      });

      this.updateContext({
        [`${step.id}_error`]: error.message,
        [`${step.id}_retryCount`]: currentRetryCount
      });
      return 'RETRY';
    }
  }

  private async finalizeStepExecution(step: Step, stepData: any, signal: FlowControlSignal): Promise<FlowControlSignal> {
    if (this.workflowContext[`${step.id}_error`]) {
      this.clearStepError(step.id);
    }

    if (step.afterRun) {
      await step.afterRun(stepData);
    }

    return signal;
  }

  private async processStepResult(step: Step, stepData: any): Promise<FlowControlSignal> {
    const actions = this.createWizardActions(step.id);
    const signal = await step.update(stepData, this.workflowContext, actions);
    return this.finalizeStepExecution(step, stepData, signal);
  }

  setContext(context: ContextData): this {
    this.workflowContext = { ...this.workflowContext, ...context };
    return this;
  }

  getContext(): ContextData {
    return this.workflowContext;
  }

  updateContext(updates: ContextData): this {
    this.workflowContext = { ...this.workflowContext, ...updates };
    return this;
  }

  async run(): Promise<void> {
    const startTime = Date.now();

    await this.initializeRun();

    this.executionLoop();
  }

  public startFrom(stepId: string): void {
    const index = this.findStepIndex(stepId);
    if (index === -1) return;
    this.currentStepIndex = index;
    this.isRunning = true;
    this.isPaused = false;
    this.isStepMode = false;
    this.usageTracker.setStartTime(Date.now());
    this.events.emit('start', {
      wizardId: this.id,
      timestamp: Date.now(),
      steps: this.steps.map(item => {
        if (Array.isArray(item)) {
          return item.map(step => ({
            id: step.id,
            instruction: step.instruction,
            fields: SchemaUtils.extractSchemaFields(step.schema)
          }));
        } else {
          return {
            id: item.id,
            instruction: item.instruction,
            fields: SchemaUtils.extractSchemaFields(item.schema)
          };
        }
      }).flat()
    });
    this.executionLoop();
  }

  private async executionLoop(): Promise<void> {
    const startTime = Date.now();
    while (this.currentStepIndex < this.steps.length && this.isRunning) {
      const item = this.steps[this.currentStepIndex];
      if (!item) break;
      if (Array.isArray(item)) {
        const signal = await this.executeParallelSteps(item);
        if (!(await this.handleFlowControlSignal(signal))) return;
      } else {
        await this.executeSequentialStep(item);
      }
      if (this.isStepMode) {
        this.isPaused = true;
        this.events.emit('pause', {
          timestamp: Date.now(),
          currentStepId: (this.steps[this.currentStepIndex] as any)?.id
        });
        await this.visualizationManager.waitForResume();
        this.events.emit('resume', {
          timestamp: Date.now(),
          currentStepId: (this.steps[this.currentStepIndex] as any)?.id
        });
      }
      await this.bungeeExecutor.processReentries();
    }
    this.finalizeRun(startTime);
  }


  /**
   * Generates data for a wizard step by calling the LLM.
   * Uses streaming for regular steps to provide real-time parsing and UI updates.
   * TextStep and ComputeStep use different approaches (non-streaming).
   */
  /**
    * Generates data for a wizard step by calling the LLM.
    * CLEANED VERSION: Separates formatting rules from logic to prevent hallucination.
    */
  public async generateStepData(step: Step, stepContext: any): Promise<any> {
    const systemContext = this.systemPrompt ? `${this.systemPrompt}\n\n` : '';

    // Build context strings
    const errorContext = this.workflowContext[`${step.id}_error`] ?
      `\n\n!!! PREVIOUS ERROR (Attempt ${this.workflowContext[`${step.id}_retryCount`] || 1}) !!!\nThe previous output caused this error: ${this.workflowContext[`${step.id}_error`]}\nYOU MUST FIX THIS.` : '';

    let processedInstruction = step.instruction;
    if (step.contextType === 'template' || step.contextType === 'both') {
      processedInstruction = this.applyTemplate(step.instruction, stepContext);
    }

    let contextSection = '';
    if (step.contextType === 'xml' || step.contextType === 'both' || !step.contextType) {
      contextSection = `\n\n### CURRENT CONTEXT ###\n${this.objectToXml(stepContext)}`;
    }

    // --- Text Step Handling ---
    if (step instanceof TextStep) {
      const prompt = `${systemContext}
TASK: Generate content for step "${step.id}".

INSTRUCTION:
${processedInstruction}
${contextSection}
${errorContext}

OUTPUT:
Generate the text response now.`;

      let fullText = '';

      console.log("full prompt", prompt)
       const result  = await this.llmClient.complete({
        prompt,
        model: step.model,
        maxTokens: 1000,
        temperature: 0.3,
        stream: step.stream,
        onChunk: (chunk: string) => {
          fullText += chunk;
          this.events.emit('step:chunk', { stepId: step.id, chunk, timestamp: Date.now() });
        },
        onUsage: this.usageTracker.updateUsage.bind(this.usageTracker)
      });
      if(result.text){
        fullText = result.text
      }
      return fullText;
    }

    // --- Regular XML Step Handling ---
    const parser = this.createStreamingXmlParser();
    let latestResult: any = {};
    const schemaDescription = SchemaUtils.describeSchema(step.schema, step.id);

    // CLEANER PROMPT STRUCTURE
    const prompt = `${systemContext}
=== GOAL ===
You are an intelligent agent executing step: "${step.id}".
Your task is to generate data that satisfies the INSTRUCTION below based on the CONTEXT.

=== INSTRUCTION ===
${processedInstruction}
${contextSection}
${errorContext}

=== RESPONSE FORMAT ===
You must output a VALID XML object inside a <response> tag.
1. Every field must have: tag-category="wizard" and a type attribute (string, number, boolean, array).
2. Arrays must be single-line JSON: <tags tag-category="wizard" type="array">["a", "b"]

=== SCHEMA DEFINITION ===
${schemaDescription}

*** CRITICAL RULES ***
1. Do NOT copy values from the schema definition or examples above.
2. Generate NEW values based strictly on the "INSTRUCTION" and "CURRENT CONTEXT".
3. If the instruction implies a selection (like an ID), ensure the ID exists in the Context.

Generate the XML <response> now.`;

    // console.log(prompt); // Uncomment to debug the cleaner prompt

    const useStreaming = step.stream !== false;

    const result =  await this.llmClient.complete({
      prompt,
      model: step.model,
      maxTokens: 1000,
      temperature: 0.3, // Lower temp for precision
      stream: step.stream,
      onChunk: (chunk: string) => {
        this.events.emit('step:chunk', { stepId: step.id, chunk, timestamp: Date.now() });
        const parseResult = parser.push(chunk);
        if (parseResult && !parseResult.done) {
          latestResult = parseResult.result;
          this.events.emit('step:streaming', { stepId: step.id, data: latestResult, timestamp: Date.now() });
          this.visualizationManager.sendStepUpdate({ stepId: step.id, status: 'streaming', data: latestResult });
        } else if (parseResult?.done) {
          latestResult = parseResult.result;
        }
      },
      onUsage: this.usageTracker.updateUsage.bind(this.usageTracker)
    });

    if(result.text){
      latestResult = result.text
    }

    try {
      return step.validate(latestResult);
    } catch (validationError: any) {
      // Logic for repair remains the same...
      try {
        const repairedData = await this.repairSchemaData(latestResult, step.schema, validationError.message, step.id);
        return step.validate(repairedData);
      } catch (repairError: any) {
        return { __validationFailed: true, error: validationError.message };
      }
    }
  }

  private async repairSchemaData(invalidData: any, schema: z.ZodType<any>, validationError: string, stepId: string): Promise<any> {
    const step = this.findStep(stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);
    const schemaDescription = SchemaUtils.describeSchema(schema, stepId);

    const prompt = `You are repairing invalid data for a wizard step. The data failed validation and needs to be fixed to match the schema.

INVALID DATA: ${JSON.stringify(invalidData, null, 2)}
VALIDATION ERROR: ${validationError}

SCHEMA REQUIREMENTS:
${schemaDescription}

REQUIRED OUTPUT FORMAT:
Return a plain XML response with a root <response> tag.
CRITICAL: Every field MUST include tag-category="wizard" attribute. This is MANDATORY.
Every field MUST also include a type attribute (e.g., type="string", type="number", type="boolean", type="array").

IMPORTANT: Fields with tag-category="wizard" do NOT need closing tags. Content ends at the next wizard field or </response>.

Example:
<response>
  <name tag-category="wizard" type="string">John
  <age tag-category="wizard" type="number">25
  <tags tag-category="wizard" type="array">["a", "b"]
</response>

Fix the data to match the schema and generate the XML response now.`;

    const llmResult = await this.llmClient.complete({
      prompt,
      model: step.model,
      maxTokens: 10000,
      temperature: 0.3,
    });

    const repairedJsonData = this.parseXmlToJson(llmResult.text);
    return repairedJsonData;
  }


  /**
   * Creates an improved streaming XML parser for incremental processing of LLM responses.
   *
   * This parser is designed to handle partial chunks robustly and provides better error recovery.
   * It processes XML chunks as they arrive, extracting fields marked with tag-category="wizard".
   *
   * Key improvements:
   * - Better partial tag handling
   * - More robust regex matching
   * - Improved buffer management
   * - Better error recovery for malformed chunks
   * - State machine approach for parsing
   *
   * @returns An object with a push method that accepts text chunks and returns parse results
   */
  private createStreamingXmlParser() {
    let buffer = ''; // Accumulates incoming text chunks
    let inResponse = false; // Tracks if we've entered the <response> tag
    const result: any = {}; // The final parsed JSON object
    let currentField: { name: string; type: string; content: string } | null = null; // Currently parsing field
    let parseErrors = 0; // Track consecutive parse errors

    return {
      push: (chunk: string) => {
        try {
          buffer += chunk;

          // Wait for <response> tag to start parsing
          if (!inResponse) {
            const responseStart = buffer.indexOf('<response>');
            if (responseStart !== -1) {
              inResponse = true;
              buffer = buffer.slice(responseStart + 10); // Remove <response> from buffer
            } else {
              return null; // Still waiting for response start
            }
          }

          // Process buffer for wizard tags
          let processedSomething = false;

          // Continue processing while we have data
          while (buffer.length > 0) {
            // If we have a current field, try to accumulate content
            if (currentField) {
              // Look for the next wizard tag or end of response
              const nextWizardTag = buffer.match(/<\w+\s+[^>]*tag-category=["']wizard["'][^>]*>/);
              const responseEnd = buffer.indexOf('</response>');

              if (nextWizardTag && nextWizardTag.index !== undefined) {
                // Found next tag, finalize current field
                const contentEnd = nextWizardTag.index;
                currentField.content += buffer.slice(0, contentEnd);
                result[currentField.name] = this.parseValueByType(
                  currentField.content.trim(),
                  currentField.type
                );
                currentField = null;
                buffer = buffer.slice(contentEnd);
                processedSomething = true;
              } else if (responseEnd !== -1) {
                // End of response, finalize current field
                currentField.content += buffer.slice(0, responseEnd);
                result[currentField.name] = this.parseValueByType(
                  currentField.content.trim(),
                  currentField.type
                );
                return { done: true, result }; // Parsing complete
              } else {
                // No complete field yet, but we might have a partial tag at the end
                // Check if buffer ends with a partial wizard tag
                const partialTagMatch = buffer.match(/<\w+\s+[^>]*tag-category=["']wizard["'][^>]*$/);
                if (partialTagMatch) {
                  // Buffer ends with partial tag, keep it for next chunk
                  break;
                } else {
                  // Safe to accumulate entire buffer
                  currentField.content += buffer;
                  buffer = '';
                  processedSomething = true;
                }
              }
            } else {
              // No current field, look for a new wizard tag
              const tagMatch = buffer.match(Wizard.WIZARD_TAG_PATTERN);
              if (tagMatch && tagMatch.index === 0) {
                // Tag starts at beginning of buffer
                const typeMatch = tagMatch[2].match(/type=["']([^"']+)["']/);
                currentField = {
                  name: tagMatch[1],
                  type: typeMatch?.[1]?.toLowerCase() || 'string',
                  content: ''
                };
                buffer = buffer.slice(tagMatch[0].length);
                processedSomething = true;
              } else if (tagMatch && tagMatch.index !== undefined && tagMatch.index > 0) {
                // Tag exists but not at start - might be partial
                const partialTagMatch = buffer.match(/<\w+\s+[^>]*tag-category=["']wizard["'][^>]*$/);
                if (partialTagMatch) {
                  // Buffer ends with partial tag, wait for more data
                  break;
                } else {
                  // Tag is in middle, process up to it
                  // This shouldn't happen in well-formed XML, but handle gracefully
                  buffer = buffer.slice(tagMatch.index);
                  continue;
                }
              } else {
                // No wizard tag found
                if (buffer.includes('</response>')) {
                  // End of response without finalizing a field
                  return { done: true, result };
                }
                // Check for partial tag at end
                const partialTagMatch = buffer.match(/<\w+\s+[^>]*tag-category=["']wizard["'][^>]*$/);
                if (partialTagMatch) {
                  break; // Wait for more data
                }
                // No partial tag, buffer might contain non-wizard content
                // This is unusual but we'll keep it for now
                break;
              }
            }
          }

          // Reset error counter on successful processing
          if (processedSomething) {
            parseErrors = 0;
          }

          // Return partial result for UI updates
          return { done: false, result: { ...result } };

        } catch (error) {
          parseErrors++;
          console.warn(`Streaming XML parse error (attempt ${parseErrors}):`, error instanceof Error ? error.message : String(error));

          // If we have too many consecutive errors, try to recover
          if (parseErrors > 3) {
            console.error('Too many parse errors, attempting recovery');
            // Try to find next valid wizard tag and restart from there
            const recoveryMatch = buffer.match(/<\w+\s+[^>]*tag-category=["']wizard["'][^>]*>/);
            if (recoveryMatch && recoveryMatch.index !== undefined && recoveryMatch.index > 0) {
              buffer = buffer.slice(recoveryMatch.index);
              parseErrors = 0; // Reset error counter
              return { done: false, result: { ...result } };
            }
          }

          // Return current result even with errors
          return { done: false, result: { ...result } };
        }
      }
    };
  }

  private parseXmlToJson(xml: string): any {
    const responseMatch = xml.match(/<response\s*>([\s\S]*?)(?:<\/response\s*>|$)/i);
    if (!responseMatch) {
      throw new Error('Invalid XML response: missing <response> tag');
    }
    return this.parseXmlElementWithTagCategory(responseMatch[1]);
  }

  private parseXmlElementWithTagCategory(xmlContent: string): any {
    const result: any = {};
    const matches: Array<{ tagName: string, attributes: string, index: number, fullMatch: string }> = [];

    let match;
    const pattern = new RegExp(Wizard.WIZARD_TAG_PATTERN);
    while ((match = pattern.exec(xmlContent)) !== null) {
      matches.push({
        tagName: match[1],
        attributes: match[2],
        index: match.index,
        fullMatch: match[0]
      });
    }

    this.log(() => `Found ${matches.length} wizard-tagged fields`);

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];

      const typeMatch = current.attributes.match(/type=["']([^"']+)["']/);
      const typeHint = typeMatch ? typeMatch[1].toLowerCase() : null;

      const contentStart = current.index + current.fullMatch.length;
      let contentEnd: number;

      if (next) {
        contentEnd = next.index;
      } else {
        const responseCloseIndex = xmlContent.indexOf('</response', contentStart);
        contentEnd = responseCloseIndex !== -1 ? responseCloseIndex : xmlContent.length;
      }

      let rawContent = xmlContent.slice(contentStart, contentEnd);

      // Optimize: avoid double trimEnd
      const trimmed = rawContent.trimEnd();
      const closingTag = `</${current.tagName}>`;
      if (trimmed.endsWith(closingTag)) {
        rawContent = trimmed.slice(0, -closingTag.length);
      } else {
        rawContent = trimmed;
      }

      this.log(() => `Parsing field "${current.tagName}" with type="${typeHint}"`);
      this.log(() => `Raw content (first 200 chars): ${rawContent.substring(0, 200)}`);

      let value: any;

      if (typeHint === 'string') {
        value = rawContent;
      } else if (typeHint === 'number') {
        value = this.parseNumber(rawContent.trim());
      } else if (typeHint === 'boolean') {
        value = this.parseBoolean(rawContent.trim());
      } else if (typeHint === 'array') {
        value = this.parseArray(rawContent.trim());
      } else if (typeHint === 'object') {
        value = this.parseXmlElementWithTagCategory(rawContent);
      } else if (typeHint === 'null') {
        value = null;
      } else {
        value = this.inferAndParseValue(rawContent.trim());
      }

      if (result[current.tagName] !== undefined) {
        if (!Array.isArray(result[current.tagName])) {
          result[current.tagName] = [result[current.tagName]];
        }
        result[current.tagName].push(value);
      } else {
        result[current.tagName] = value;
      }

      this.log(() => `Parsed "${current.tagName}" = ${JSON.stringify(value).substring(0, 200)}`);
    }

    return result;
  }

  private parseValueByType(content: string, type: string): any {
    switch (type) {
      case 'string': return content;
      case 'number': return this.parseNumber(content);
      case 'boolean': return this.parseBoolean(content);
      case 'array': return this.parseArray(content);
      case 'object': return this.parseXmlElementWithTagCategory(content);
      case 'null': return null;
      default: return this.inferAndParseValue(content);
    }
  }

  private parseNumber(value: string): number {
    const num = Number(value);
    if (isNaN(num)) {
      throw new Error(`Invalid number value: "${value}"`);
    }
    return num;
  }

  private parseBoolean(value: string): boolean {
    const normalized = value.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`Invalid boolean value: "${value}" (expected "true" or "false")`);
  }

  private parseArray(value: string): any[] {
    const trimmed = value.trim();

    // Strategy 1: Try direct JSON parse
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // Continue to fallback strategies
    }

    // Strategy 2: Fix common JSON issues and retry
    try {
      let fixed = trimmed
        // Remove trailing commas before closing bracket
        .replace(/,(\s*[}\]])/g, '$1')
        // Normalize quotes (convert single to double)
        .replace(/'/g, '"')
        // Remove comments if any
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // Continue to manual parsing
    }

    // Strategy 3: Manual extraction (most robust)
    // Extract content between first [ and last ]
    const bracketMatch = trimmed.match(/\[([\s\S]*)\]/);
    if (bracketMatch) {
      const content = bracketMatch[1].trim();

      // Empty array
      if (!content) return [];

      // Try to parse as JSON array one more time
      try {
        const parsed = JSON.parse(`[${content}]`);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Fall through to string splitting
      }

      // Manual string splitting for simple arrays
      const items: any[] = [];
      let current = '';
      let inString = false;
      let escapeNext = false;
      let depth = 0;

      for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (escapeNext) {
          current += char;
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          current += char;
          continue;
        }

        if (char === '"' && depth === 0) {
          inString = !inString;
          current += char;
          continue;
        }

        if (inString) {
          current += char;
          continue;
        }

        // Track nested structures
        if (char === '{' || char === '[') {
          depth++;
          current += char;
          continue;
        }

        if (char === '}' || char === ']') {
          depth--;
          current += char;
          continue;
        }

        // Split on comma at depth 0
        if (char === ',' && depth === 0) {
          const item = current.trim();
          if (item) {
            items.push(this.parseArrayItem(item));
          }
          current = '';
          continue;
        }

        current += char;
      }

      // Don't forget the last item
      if (current.trim()) {
        items.push(this.parseArrayItem(current.trim()));
      }

      return items;
    }

    // Strategy 4: Newline-separated values (last resort)
    const lines = trimmed
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && l !== '[' && l !== ']');

    if (lines.length > 0) {
      return lines.map(line => {
        // Remove trailing comma
        const cleaned = line.replace(/,\s*$/, '');
        return this.parseArrayItem(cleaned);
      });
    }

    throw new Error(`Could not parse array from: "${value.substring(0, 100)}..."`);
  }

  private parseArrayItem(item: string): any {
    const trimmed = item.trim();

    // Try JSON parse first
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // Not valid JSON, continue
    }

    // Remove quotes if present
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    // Try as number
    if (!isNaN(Number(trimmed))) {
      return Number(trimmed);
    }

    // Boolean
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;

    // Return as string
    return trimmed;
  }

  private inferAndParseValue(content: string): any {
    const trimmed = content.trim();

    if (trimmed === '') return '';
    if (trimmed === 'null') return null;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    if (!isNaN(Number(trimmed)) && trimmed !== '') {
      return Number(trimmed);
    }

    if (/<\w+[^>]*tag-category=["']wizard["']/.test(trimmed)) {
      return this.parseXmlElementWithTagCategory(trimmed);
    }

    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  private objectToXml(obj: any, rootName: string = 'context'): string {
    const buildXml = (data: any, tagName: string): string => {
      let type: string = typeof data;
      if (data === null) type = 'null';
      else if (Array.isArray(data)) type = 'array';

      const attr = ` type="${type}"`;

      if (data === null || data === undefined) return `<${tagName}${attr}></${tagName}>`;
      if (type === 'string') return `<${tagName}${attr}>${this.escapeXml(data)}</${tagName}>`;
      if (type === 'number' || type === 'boolean') return `<${tagName}${attr}>${data}</${tagName}>`;
      if (type === 'array') return `<${tagName}${attr}>${JSON.stringify(data)}</${tagName}>`;
      if (type === 'object') {
        const children = Object.entries(data).map(([k, v]) => buildXml(v, k)).join('');
        return `<${tagName}${attr}>${children}</${tagName}>`;
      }
      return `<${tagName}${attr}>${String(data)}</${tagName}>`;
    };
    return buildXml(obj, rootName);
  }

  private escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private applyTemplate(instruction: string, context: any): string {
    return instruction.replace(Wizard.TEMPLATE_REGEX, (match, path) => {
      const keys = path.split('.');
      let value = context;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          return match;
        }
      }
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
  }

  /**
   * Starts the visualization server which enables streaming data output.
   * Creates a WebSocket server that broadcasts real-time streaming updates
   * to connected clients during step execution.
   *
   * @param port - Port number for the HTTP/WebSocket server (default: 3000)
   * @returns Promise resolving to server and URL information
   */
  async visualize(port: number = 3000): Promise<{ server: any; url: string }> {
    return this.visualizationManager.visualize(port);
  }
}