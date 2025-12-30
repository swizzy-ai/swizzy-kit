import { z } from 'zod';
import { Step } from './steps/base';
import { TextStep } from './steps/text';
import { LLMClient } from '../../services/client/index';
import { Logger } from './logger';
import { SchemaUtils } from './schema-utils';

export class StepDataGenerator {
  private static readonly TEMPLATE_REGEX = /\{\{(\w+(?:\.\w+)*)\}\}/g;
  private static readonly WIZARD_TAG_PATTERN = /<(\w+)\s+([^>]*tag-category=["']wizard["'][^>]*)>/gi;

  constructor(private llmClient: LLMClient, private logger: Logger, private findStep: (id: string) => Step | null) {}

  private log = this.logger.log.bind(this.logger);

  async generateStepData(step: Step, stepContext: any, workflowContext: any): Promise<any> {
    const systemContext = step.instruction ? `${step.instruction}\n\n` : '';
    const errorContext = workflowContext[`${step.id}_error`] ?
      `\n\nPREVIOUS ERROR (attempt ${workflowContext[`${step.id}_retryCount`] || 1}):\n${workflowContext[`${step.id}_error`]}\nPlease fix this.` : '';

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
    const pattern = new RegExp(StepDataGenerator.WIZARD_TAG_PATTERN);
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
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, "'");
  }

  private applyTemplate(instruction: string, context: any): string {
    return instruction.replace(StepDataGenerator.TEMPLATE_REGEX, (match, path) => {
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
}