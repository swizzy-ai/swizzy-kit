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

export interface WizardConfig {
  id: string;
  systemPrompt?: string;
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }, provider: string) => void;
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
  private pauseResolver?: () => void;
  private userOverrideData?: any;
  private runResolver?: () => void;

  // Managers
  private logger: Logger;
  private usageTracker: UsageTracker;
  private contextManager: ContextManager;
  private visualizationManager: VisualizationManager;
  private bungeeExecutor: BungeeExecutor;

  private isLoggingEnabled = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

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
    return this.isLoggingEnabled ? this.logger.log.bind(this.logger) : () => {};
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

    // Initialize managers
    this.logger = new Logger(this.id);
    this.usageTracker = new UsageTracker(config.onUsage);
    this.contextManager = new ContextManager();
    this.visualizationManager = new VisualizationManager(this);
    this.bungeeExecutor = new BungeeExecutor(this);
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
        return false;
      case Wizard.RETRY:
        return true;
      case Wizard.WAIT:
        await new Promise(resolve => setTimeout(resolve, 10 * 1000));
        this.currentStepIndex++;
        return true;
      default:
        if (this.isBungeeJumpSignal(signal)) {
          await this.bungeeExecutor.executeBungeePlan(signal.plan);
          return true;
        } else if (this.isStringSignal(signal) && signal.startsWith('GOTO ')) {
          const targetStepId = signal.substring(5);
          const targetIndex = this.findStepIndex(targetStepId);
          if (targetIndex !== -1) {
            this.currentStepIndex = targetIndex;
          } else {
            throw new Error(`Unknown step ID for GOTO: ${targetStepId}`);
          }
          return true;
        }
    }
    return true;
  }

  private async initializeRun(): Promise<void> {
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
    this.isRunning = true;
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

    const stepContext = step.getContext(this.contextManager.getContext());
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
        return 'RETRY';
      }

      const actions = this.createWizardActions(step.id);
      const signal = await step.update(stepData, this.workflowContext, actions);

      this.visualizationManager.sendStepUpdate({
        stepId: step.id,
        status: 'completed',
        data: stepData
      });

      return this.finalizeStepExecution(step, stepData, signal);
    } catch (error: any) {
      console.log('Processing error', error);
      this.updateContext({
        [`${step.id}_error`]: error.message,
        [`${step.id}_retryCount`]: (this.workflowContext[`${step.id}_retryCount`] || 0) + 1
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
        await this.visualizationManager.waitForResume();
      }

      await this.bungeeExecutor.processReentries();
    }

    this.finalizeRun(startTime);
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

    const schemaDescription = SchemaUtils.describeSchema(step.schema, step.id);
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

  async visualize(port: number = 3000): Promise<{ server: any; url: string }> {
    return this.visualizationManager.visualize(port);
  }
}