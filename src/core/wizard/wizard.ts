import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as WebSocket from 'ws';
import { z } from 'zod';
import { Step, StepConfig, FlowControlSignal, WizardActions } from './steps/base';
import { TextStep, TextStepConfig } from './steps/text';
import { ComputeStep, ComputeStepConfig } from './steps/compute';
import { LLMClient } from '../../services/client/index';
import { ProviderRegistry } from '../../services/client/registry';
import { BungeeBuilder } from './bungee/builder';
import { BungeePlan } from './bungee/types';

export interface WizardConfig {
  id: string;
  systemPrompt?: string;
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }, provider: string) => void;
}

export interface WizardContext {
  updateContext: (updates: any) => void;
  llmClient: LLMClient;
  goto: (stepId: string) => FlowControlSignal;
  next: () => FlowControlSignal;
  stop: () => FlowControlSignal;
  retry: () => FlowControlSignal;
}

export class Wizard {
  private static readonly TEMPLATE_REGEX = /\{\{(\w+(?:\.\w+)*)\}\}/g;
  private static readonly WIZARD_TAG_PATTERN = /<(\w+)\s+([^>]*tag-category=["']wizard["'][^>]*)>/gi;

  private id: string;
  private llmClient: LLMClient;
  private systemPrompt?: string;
  private steps: Array<Step | Step[]> = [];
  private workflowContext: any = {};
  private logFilePath: string | undefined;

  // Bungee state tracking
  private bungeeWorkers: Map<string, Map<string, {
    planId: string;
    workerId: string;
    promise: Promise<any>;
    telescope: Record<string, any>;
  }>> = new Map();
  private pendingReentry: Set<string> = new Set();

  // Performance optimizations
  private stepIndexMap: Map<string, number> = new Map();
  private schemaDescriptions: Map<string, string> = new Map();
  private readonly maxCacheSize = 100;

  // Visualization state
  private visualizationServer?: http.Server;
  private wss?: WebSocket.Server;
  private visualizationPort?: number;
  private connectedClients: Set<WebSocket> = new Set();
  private readonly maxWebSocketConnections = 10;
  private wsIntervals: WeakMap<WebSocket, NodeJS.Timeout> = new WeakMap();

  // WebSocket messages sent immediately for real-time UI updates

  // Token tracking
  private totalTokens: number = 0;
  private stepTokens: number = 0;

  private currentStepIndex: number = 0;
  private isPaused: boolean = false;
  private isRunning: boolean = false;
  private isStepMode: boolean = false;
  private pauseResolver?: () => void;
  private userOverrideData?: any;
  private runResolver?: () => void;

  constructor(config: WizardConfig) {
    this.id = config.id;
    const registry = new ProviderRegistry();
    this.llmClient = new LLMClient(registry);
    this.systemPrompt = config.systemPrompt;

    // Set up token tracking
    if (config.onUsage) {
      const originalOnUsage = config.onUsage;
      config.onUsage = (usage, provider) => {
        this.totalTokens += usage.totalTokens;
        this.stepTokens = usage.totalTokens; // Last step tokens
        this.sendToClients({
          type: 'token_update',
          totalTokens: this.totalTokens,
          stepTokens: this.stepTokens
        });
        originalOnUsage(usage, provider);
      };
    }

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), '.wizard');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    this.logFilePath = path.join(logsDir, `${this.id}.log`);
  }

  private log(messageOrFn: string | (() => string)): void {
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
  next(): FlowControlSignal { return 'NEXT'; }
  stop(): FlowControlSignal { return 'STOP'; }
  retry(): FlowControlSignal { return 'RETRY'; }
  wait(): FlowControlSignal { return 'WAIT'; }

  private clearStepError(stepId: string): void {
    delete this.workflowContext[`${stepId}_error`];
    delete this.workflowContext[`${stepId}_retryCount`];
  }

  private isStringSignal(signal: FlowControlSignal): signal is string {
    return typeof signal === 'string';
  }

  private isBungeeJumpSignal(signal: FlowControlSignal): signal is { type: 'BUNGEE_JUMP'; plan: BungeePlan } {
    return typeof signal === 'object' && signal !== null && signal.type === 'BUNGEE_JUMP';
  }

  private async executeBungeePlan(plan: BungeePlan): Promise<void> {
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

    // Wait for all workers to complete
    await Promise.all(activeWorkers);

    console.log(`✅ Bungee plan ${plan.id} completed, returning to anchor ${plan.anchorId}`);
  }

  private async launchBungeeWorker(plan: BungeePlan, index: number): Promise<void> {
    const destination = plan.destinations[index];
    const telescope = plan.configFn ? plan.configFn(index) : {};
    const workerId = `${plan.id}_${destination.targetId}_${index}_${Date.now()}`;
    const telescopeContext = this.createTelescopeContext(this.workflowContext, telescope);

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
    } catch (error: any) {
      console.error(`Bungee worker ${workerId} failed:`, error);
      this.workflowContext[`${workerId}_error`] = error.message;
    } finally {
      // Clean up
      const planWorkers = this.bungeeWorkers.get(plan.id);
      if (planWorkers) {
        planWorkers.delete(workerId);
        if (planWorkers.size === 0) {
          this.bungeeWorkers.delete(plan.id);
          // Trigger reentry to anchor
          this.pendingReentry.add(plan.anchorId);
        }
      }
    }
  }

  private createWizardActions(anchorStepId: string = ''): WizardActions {
    return {
      updateContext: (updates: Record<string, any>) => this.updateContext(updates),
      llmClient: this.llmClient,
      goto: (stepId: string) => this.goto(stepId),
      next: () => this.next(),
      stop: () => this.stop(),
      retry: () => this.retry(),
      wait: () => this.wait(),
      bungee: {
        init: () => new BungeeBuilder(anchorStepId)
      }
    };
  }

  private createWorkerActions(telescope: Record<string, any>): WizardActions {
    return {
      updateContext: (updates: Record<string, any>) => {
        this.mergeWorkerResults(updates, telescope);
      },
      llmClient: this.llmClient,
      goto: () => 'STOP',
      next: () => 'STOP',
      stop: () => 'STOP',
      retry: () => 'STOP',
      wait: () => 'STOP',
      bungee: {
        init: () => {
          throw new Error('Bungee not allowed in worker context');
        }
      }
    };
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
    const step = this.findStep(stepId);
    if (!step) return;

    const stepContext = step.getContext(telescopeContext);
    const stepData = await this.generateStepData(step, stepContext);
    const actions = this.createWorkerActions(telescopeContext._telescope);

    return await step.update(stepData, telescopeContext, actions);
  }

  private mergeWorkerResults(updates: Record<string, any>, telescope: Record<string, any>): void {
    Object.entries(updates).forEach(([key, value]) => {
      this.workflowContext[key] = value;
    });
  }

  private async retriggerAnchor(anchorId: string): Promise<void> {
    const anchorStep = this.findStep(anchorId);
    if (anchorStep) {
      await this.executeStep(anchorStep);
    }
  }

  private async processReentries(): Promise<void> {
    const anchorsToRetrigger = Array.from(this.pendingReentry);
    this.pendingReentry.clear();
    for (const anchorId of anchorsToRetrigger) {
      await this.retriggerAnchor(anchorId);
    }
  }


  public findStep(stepId: string): Step | null {
    for (const item of this.steps) {
      if (Array.isArray(item)) {
        const found = item.find(s => s.id === stepId);
        if (found) return found;
      } else {
        if (item.id === stepId) return item;
      }
    }
    return null;
  }

  private findStepIndex(stepId: string): number {
    return this.stepIndexMap.get(stepId) ?? -1;
  }

  private async executeStep(step: Step): Promise<FlowControlSignal> {
    console.log(`Starting step ${step.id}`);
    this.log(`Starting step ${step.id}`);

    const stepContext = step.getContext(this.workflowContext);
    let processedInstruction = step.instruction;
    if (step.contextType === 'template' || step.contextType === 'both') {
      processedInstruction = this.applyTemplate(step.instruction, stepContext);
    }
    this.sendToClients({
      type: 'step_update',
      stepId: step.id,
      status: 'current',
      instruction: processedInstruction,
      context: stepContext,
      fields: this.extractSchemaFields(step.schema)
    });
    this.sendToClients({
      type: 'context_update',
      context: this.workflowContext
    });

    try {
      if (step.beforeRun) {
        await step.beforeRun();
      }

      this.log(() => `Context for step ${step.id}: ${JSON.stringify(stepContext)}`);

      // Skip LLM data generation for compute steps
      const stepData = (step as any).isComputeStep ? null : await this.generateStepData(step, stepContext);

      if (this.isPaused) {
        console.log('⏸️ Paused before LLM call, waiting for user input...');
        await this.waitForResume();
        console.log('▶️ Resumed, checking for user override...');

        if (this.userOverrideData) {
          console.log('📝 Using user override data');
          try {
            const validatedData = step.validate(this.userOverrideData);
            this.sendToClients({
              type: 'step_update',
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
        return 'RETRY';
      }

      const actions = this.createWizardActions(step.id);
      const signal = await step.update(stepData, this.workflowContext, actions);

      this.sendToClients({
        type: 'step_update',
        stepId: step.id,
        status: 'completed',
        data: stepData
      });

      if (this.workflowContext[`${step.id}_error`]) {
        this.clearStepError(step.id);
      }

      if (step.afterRun) {
        await step.afterRun(stepData);
      }

      return signal;
    } catch (error: any) {
      console.log('Processing error', error);
      this.updateContext({
        [`${step.id}_error`]: error.message,
        [`${step.id}_retryCount`]: (this.workflowContext[`${step.id}_retryCount`] || 0) + 1
      });
      return 'RETRY';
    }
  }

  private async processStepResult(step: Step, stepData: any): Promise<FlowControlSignal> {
    const actions = this.createWizardActions(step.id);
    const signal = await step.update(stepData, this.workflowContext, actions);

    if (this.workflowContext[`${step.id}_error`]) {
      this.clearStepError(step.id);
    }

    if (step.afterRun) {
      await step.afterRun(stepData);
    }

    return signal;
  }

  setContext(context: any): this {
    this.workflowContext = { ...this.workflowContext, ...context };
    return this;
  }

  getContext(): any {
    return this.workflowContext;
  }

  updateContext(updates: any): this {
    this.workflowContext = { ...this.workflowContext, ...updates };
    return this;
  }

  async run(): Promise<void> {
    const startTime = Date.now();

    if (this.visualizationServer) {
      console.log('🎯 Waiting for UI to start wizard execution...');
      this.sendToClients({ type: 'status_update', status: { waitingForStart: true, isStepMode: false } });
      await this.waitForRunCommand();
      console.log('🚀 Starting wizard execution from UI command');

      // Send all steps info
      const stepsInfo = this.steps.map(item => {
        if (Array.isArray(item)) {
          return item.map(step => ({
            id: step.id,
            instruction: step.instruction,
            fields: this.extractSchemaFields(step.schema),
            status: 'pending'
          }));
        } else {
          return {
            id: item.id,
            instruction: item.instruction,
            fields: this.extractSchemaFields(item.schema),
            status: 'pending'
          };
        }
      }).flat();
      this.sendToClients({ type: 'wizard_start', steps: stepsInfo });
    }

    this.log('Wizard session started');
    this.currentStepIndex = 0;
    this.isRunning = true;

    while (this.currentStepIndex < this.steps.length && this.isRunning) {
      const item = this.steps[this.currentStepIndex];
      if (!item) break;

      if (Array.isArray(item)) {
        const parallelSteps = item;
        console.log(`Starting parallel steps: ${parallelSteps.map(s => s.id).join(', ')}`);
        this.log(`Starting parallel steps: ${parallelSteps.map(s => s.id).join(', ')}`);

        const promises = parallelSteps.map(step => this.executeStep(step));
        const signals = await Promise.all(promises);

        let nextSignal: FlowControlSignal = 'NEXT';
        for (const signal of signals) {
          if (signal === 'STOP') {
            return;
          }
          if (this.isStringSignal(signal) && signal.startsWith('GOTO ')) {
            nextSignal = signal;
            break;
          }
          if (signal === 'RETRY') {
            nextSignal = 'RETRY';
          }
        }

        if (nextSignal === 'NEXT') {
          this.currentStepIndex++;
        } else if (nextSignal === 'RETRY') {
          // Retry parallel steps
        } else if (this.isStringSignal(nextSignal) && nextSignal.startsWith('GOTO ')) {
          const targetStepId = nextSignal.substring(5);
          const targetIndex = this.findStepIndex(targetStepId);
          if (targetIndex !== -1) {
            this.currentStepIndex = targetIndex;
          } else {
            throw new Error(`Unknown step ID for GOTO: ${targetStepId}`);
          }
        }
      } else {
        const signal = await this.executeStep(item);

        switch (signal) {
          case 'NEXT':
            this.currentStepIndex++;
            break;
          case 'STOP':
            return;
          case 'RETRY':
            break;
          case 'WAIT':
            await new Promise(resolve => setTimeout(resolve, 10 * 1000));
            this.currentStepIndex++;
            break;
          default:
            if (this.isBungeeJumpSignal(signal)) {
              await this.executeBungeePlan(signal.plan);
            } else if (this.isStringSignal(signal) && signal.startsWith('GOTO ')) {
              const targetStepId = signal.substring(5);
              const targetIndex = this.findStepIndex(targetStepId);
              if (targetIndex !== -1) {
                this.currentStepIndex = targetIndex;
              } else {
                throw new Error(`Unknown step ID for GOTO: ${targetStepId}`);
              }
            }
        }
      }

    if (this.isStepMode) {
      this.isPaused = true;
      await this.waitForResume();
    }

    await this.processReentries();
  }

    const endTime = Date.now();
    const duration = endTime - startTime;

    this.isRunning = false;
    this.sendToClients({ type: 'status_update', status: { completed: true } });
    console.log(`✅ Wizard completed in ${duration}ms`);
  }

  private async waitForRunCommand(): Promise<void> {
    return new Promise(resolve => {
      this.runResolver = resolve;
    });
  }

  public async generateStepData(step: Step, stepContext: any): Promise<any> {
    const systemContext = this.systemPrompt ? `${this.systemPrompt}\n\n` : '';
    const errorContext = this.workflowContext[`${step.id}_error`] ?
      `\n\nPREVIOUS ERROR (attempt ${this.workflowContext[`${step.id}_retryCount`] || 1}):\n${this.workflowContext[`${step.id}_error`]}\nPlease fix this.` : '';

    let processedInstruction = step.instruction;
    if (step.contextType === 'template' || step.contextType === 'both') {
      processedInstruction = this.applyTemplate(step.instruction, stepContext);
    }
    this.log(() => `Processed instruction for step ${step.id}: ${processedInstruction}`);

    let contextSection = '';
    if (step.contextType === 'xml' || step.contextType === 'both' || !step.contextType) {
      contextSection = `\n\nSTEP CONTEXT:\n${this.objectToXml(stepContext)}`;
    }
    this.log(() => `Context section for step ${step.id}: ${contextSection}`);

    if (step instanceof TextStep) {
      const prompt = `${systemContext}You are executing a wizard step. Generate text for this step.

STEP: ${step.id}
INSTRUCTION: ${processedInstruction}${errorContext}${contextSection}

Generate the text response now.`;

      this.log(() => `Full prompt for step ${step.id}: ${prompt}`);

      const llmResult = await this.llmClient.complete({
        prompt,
        model: step.model,
        maxTokens: 1000,
        temperature: 0.3,
      });

      this.log(() => `LLM response for step ${step.id}: ${llmResult.text}`);
      console.log(`LLM response for step ${step.id}:`, llmResult.text);

      return llmResult.text;
    }

    const schemaDescription = this.describeSchema(step.schema, step.id);
    const prompt = `${systemContext}You are executing a wizard step. Generate data for this step.

STEP: ${step.id}
INSTRUCTION: ${processedInstruction}${errorContext}${contextSection}

SCHEMA REQUIREMENTS:
${schemaDescription}

REQUIRED OUTPUT FORMAT:
Return a plain XML response with a root <response> tag.
CRITICAL: Every field MUST include tag-category="wizard" attribute. This is MANDATORY.
Every field MUST also include a type attribute (e.g., type="string", type="number", type="boolean", type="array").

IMPORTANT PARSING RULES:
- Fields with tag-category="wizard" do NOT need closing tags
- Content ends when the next tag with tag-category="wizard" begins, OR when </response> is reached
- This means you can include ANY content (including code with <>, XML snippets, etc.) without worrying about breaking the parser
- Only fields marked with tag-category="wizard" will be parsed

Example:
<response>
  <name tag-category="wizard" type="string">John Smith
  <age tag-category="wizard" type="number">25
  <code tag-category="wizard" type="string">
    function example() {
      const x = <div>Hello</div>;
      return x;
    }
  <tags tag-category="wizard" type="array">["a", "b", "c"]
</response>

Notice: No closing tags needed for wizard fields! Content naturally ends at the next wizard field or </response>.

Generate the XML response now.`;

    this.log(() => `Full prompt for step ${step.id}: ${prompt}`);

    const llmResult = await this.llmClient.complete({
      prompt,
      model: step.model,
      maxTokens: 1000,
      temperature: 0.3,
    });

    this.log(() => `LLM response for step ${step.id}: ${llmResult.text}`);
    console.log(`LLM response for step ${step.id}:`, llmResult.text);

    const jsonData = this.parseXmlToJson(llmResult.text);

    this.log(() => `Parsed JSON data for step ${step.id}: ${JSON.stringify(jsonData)}`);
    try {
      return step.validate(jsonData);
    } catch (validationError: any) {
      this.log(() => `Validation failed for step ${step.id}: ${validationError.message}`);
      try {
        const repairedData = await this.repairSchemaData(jsonData, step.schema, validationError.message, step.id);
        this.log(() => `Repaired data for step ${step.id}: ${JSON.stringify(repairedData)}`);
        return step.validate(repairedData);
      } catch (repairError: any) {
        this.log(() => `Repair failed for step ${step.id}: ${repairError.message}`);
        return { __validationFailed: true, error: validationError.message };
      }
    }
  }

  private async repairSchemaData(invalidData: any, schema: z.ZodType<any>, validationError: string, stepId: string): Promise<any> {
    const step = this.findStep(stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);
    const schemaDescription = this.describeSchema(schema, stepId);

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

  private describeSchema(schema: z.ZodType<any>, stepId?: string): string {
    if (stepId && this.schemaDescriptions.has(stepId)) {
      return this.schemaDescriptions.get(stepId)!;
    }

    let description: string;
    if (schema instanceof z.ZodObject) {
      const shape = schema._def.shape();
      const fields = Object.entries(shape).map(([key, fieldSchema]: [string, any]) => {
        const type = this.getSchemaType(fieldSchema);
        const xmlExample = this.getXmlExample(key, type);
        return `${key}: ${type} - ${xmlExample}`;
      });
      description = `Object with fields:\n${fields.join('\n')}`;
    } else {
      description = 'Unknown schema type';
    }

    if (stepId) {
      // Implement simple cache eviction if needed
      if (this.schemaDescriptions.size >= this.maxCacheSize) {
        const firstKey = this.schemaDescriptions.keys().next().value;
        this.schemaDescriptions.delete(firstKey || '');
      }
      this.schemaDescriptions.set(stepId, description);
    }

    return description;
  }

  private getXmlExample(key: string, type: string): string {
    switch (type) {
      case 'string': return `<${key} tag-category="wizard" type="string">example`;
      case 'number': return `<${key} tag-category="wizard" type="number">123`;
      case 'boolean': return `<${key} tag-category="wizard" type="boolean">true`;
      case 'array': return `<${key} tag-category="wizard" type="array">["item1", "item2"]`;
      default:
        if (type.startsWith('enum:')) {
          const values = type.split(': ')[1].split(', ');
          return `<${key} tag-category="wizard" type="string">${values[0]}`;
        }
        return `<${key} tag-category="wizard" type="object"><subfield type="string">value</subfield>`;
    }
  }

  private getSchemaType(schema: z.ZodType<any>): string {
    if (schema instanceof z.ZodOptional) return this.getSchemaType(schema._def.innerType);
    if (schema instanceof z.ZodString) return 'string';
    if (schema instanceof z.ZodNumber) return 'number';
    if (schema instanceof z.ZodBoolean) return 'boolean';
    if (schema instanceof z.ZodArray) return 'array';
    if (schema instanceof z.ZodEnum) return `enum: ${schema._def.values.join(', ')}`;
    return 'object';
  }

  private extractSchemaFields(schema: z.ZodType<any>): Array<{ key: string, type: string, enumValues?: string[] }> {
    if (!(schema instanceof z.ZodObject)) return [];
    const shape = schema._def.shape();
    const fields: Array<{ key: string, type: string, enumValues?: string[] }> = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const type = this.getSchemaType(fieldSchema as z.ZodType<any>);
      const field: { key: string, type: string, enumValues?: string[] } = { key, type };
      if (type.startsWith('enum:')) {
        field.type = 'enum';
        field.enumValues = type.substring(5).split(', ');
      }
      fields.push(field);
    }
    return fields;
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
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        throw new Error('Parsed value is not an array');
      }
      return parsed;
    } catch (error) {
      throw new Error(`Invalid array JSON: "${value}"`);
    }
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

  async visualize(port: number = 3000): Promise<{ server: http.Server; url: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this.getVisualizationHtml());
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      this.wss = new WebSocket.Server({ server });
      this.setupWebSocketHandlers();

      server.listen(port, 'localhost', () => {
        this.visualizationPort = port;
        this.visualizationServer = server;
        const url = `http://localhost:${port}`;
        console.log(`🎯 Wizard visualization available at: ${url}`);
        resolve({ server, url });
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          this.visualize(port + 1).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket) => {
      if (this.connectedClients.size >= this.maxWebSocketConnections) {
        console.log('🔗 WebSocket connection rejected: max connections reached');
        ws.close(1008, 'Max connections reached');
        return;
      }

      console.log('🔗 WebSocket client connected');
      this.connectedClients.add(ws);

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

      this.wsIntervals.set(ws, pingInterval);

      ws.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleWebSocketMessage(data, ws);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        this.connectedClients.delete(ws);
        const interval = this.wsIntervals.get(ws);
        if (interval) {
          clearInterval(interval);
          this.wsIntervals.delete(ws);
        }
      });

      ws.on('error', () => {
        this.connectedClients.delete(ws);
        const interval = this.wsIntervals.get(ws);
        if (interval) {
          clearInterval(interval);
          this.wsIntervals.delete(ws);
        }
      });

      this.sendToClients({ type: 'status_update', status: { waitingForStart: true, isRunning: false, isPaused: false } });
    });
  }

  private handleWebSocketMessage(data: any, ws: WebSocket): void {
    switch (data.type) {
      case 'control':
        switch (data.action) {
          case 'start':
            console.log('🚀 Starting wizard execution from UI');
            this.isRunning = true;
            this.sendToClients({ type: 'status_update', status: { isRunning: true, isPaused: false, isStepMode: false } });
            if (this.runResolver) {
              this.runResolver();
              this.runResolver = undefined;
            }
            break;

          case 'pause':
            this.isPaused = true;
            console.log('⏸️ Wizard execution paused');
            this.sendToClients({ type: 'status_update', status: { isPaused: true, isStepMode: this.isStepMode } });
            break;

          case 'resume':
            this.isPaused = false;
            this.isStepMode = false;
            console.log('▶️ Wizard execution resumed');
            if (this.pauseResolver) {
              this.pauseResolver();
              this.pauseResolver = undefined;
            }
            this.sendToClients({ type: 'status_update', status: { isPaused: false, isStepMode: false } });
            break;

          case 'step_forward':
            if (this.isPaused) {
              this.isStepMode = true;
              console.log('⏭️ Stepping forward');
              if (this.pauseResolver) {
                this.pauseResolver();
                this.pauseResolver = undefined;
              }
              this.sendToClients({ type: 'status_update', status: { isPaused: true, isStepMode: true } });
            }
            break;

          case 'stop':
            console.log('🛑 Stopping wizard execution');
            this.isRunning = false;
            this.isPaused = false;
            this.isStepMode = false;
            this.sendToClients({ type: 'status_update', status: { isRunning: false, isPaused: false, isStepMode: false } });
            break;

          case 'replay':
            console.log('🔄 Replaying wizard - resetting state');
            this.isRunning = false;
            this.isPaused = false;
            this.workflowContext = {};
            this.sendToClients({ type: 'status_update', status: { isRunning: false, isPaused: false, waitingForStart: true } });
            break;
        }
        break;

      case 'run':
        console.log('🚀 Starting wizard execution from UI (run command)');
        this.isRunning = true;
        this.sendToClients({ type: 'status_update', status: { isRunning: true, isPaused: false } });
        if (this.runResolver) {
          this.runResolver();
          this.runResolver = undefined;
        }
        break;

      case 'form_submit':
        this.userOverrideData = data.data;
        console.log('📝 User override data received:', data.data);
        if (this.pauseResolver) {
          this.pauseResolver();
          this.pauseResolver = undefined;
        }
        break;

      case 'update_step_data':
        this.updateContext(data.data);
        console.log('📝 Step data updated:', data.data);
        break;

      case 'goto':
        const index = this.findStepIndex(data.stepId);
        if (index !== -1) {
          this.currentStepIndex = index;
          this.isRunning = true;
          this.isPaused = false;
          this.isStepMode = false;
          console.log(`🔄 Going to step ${data.stepId}`);
          this.sendToClients({ type: 'status_update', status: { isRunning: true, isPaused: false, isStepMode: false } });
        }
        break;
    }
  }

  private sendToClients(message: any): void {
    const messageStr = JSON.stringify(message);
    this.connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }


  private async waitForResume(): Promise<void> {
    return new Promise(resolve => {
      this.pauseResolver = resolve;
    });
  }

  private getVisualizationHtml(): string {
    const fs = require('fs');
    const path = require('path');

    // Read the HTML file (now self-contained with inline CSS and JS)
    const htmlPath = path.join(__dirname, 'ui/wizard-visualizer.html');
    return fs.readFileSync(htmlPath, 'utf-8');
  }
}