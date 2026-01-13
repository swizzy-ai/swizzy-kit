import { z } from 'zod';

export class SchemaUtils {
  private static schemaDescriptions: Map<string, string> = new Map();
  private static readonly maxCacheSize = 100;

  static describeSchema(schema: z.ZodType<any>, stepId?: string): string {
    if (stepId && this.schemaDescriptions.has(stepId)) {
      return this.schemaDescriptions.get(stepId)!;
    }

    let description: string;
    if (schema instanceof z.ZodObject) {
      const shape = schema._def.shape();
      const fields = Object.entries(shape).map(([key, fieldSchema]: [string, any]) => {
        const type = this.getSchemaType(fieldSchema);
        const xmlExample = this.getXmlExample(key, type);
        return `${key}: ${type}`;
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

  static getSchemaType(schema: z.ZodType<any>): string {
    if (schema instanceof z.ZodOptional) return this.getSchemaType(schema._def.innerType);
    if (schema instanceof z.ZodString) return 'string';
    if (schema instanceof z.ZodNumber) return 'number';
    if (schema instanceof z.ZodBoolean) return 'boolean';
    if (schema instanceof z.ZodArray) return 'array';
    if (schema instanceof z.ZodEnum) return `enum: ${schema._def.values.join(', ')}`;
    return 'object';
  }

  static extractSchemaFields(schema: z.ZodType<any>): Array<{ key: string, type: string, enumValues?: string[] }> {
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

  static getXmlExample(key: string, type: string): string {
    switch (type) {
      case 'string': return `<${key} tag-category="wizard" type="string">[your text should be here]`;
      case 'number': return `<${key} tag-category="wizard" type="number">[number should be here]`;
      case 'boolean': return `<${key} tag-category="wizard" type="boolean">true`;
      case 'array': return `<${key} tag-category="wizard" type="array">["item1", "item2"]`;
      default:
        if (type.startsWith('enum:')) {
          const values = type.split(': ')[1].split(', ');
          return `<${key} tag-category="wizard" type="string">${values[0]}`;
        }
        return `<${key} tag-category="wizard" type="object"><subfield type="string">[text value should be here]</subfield>`;
    }
  }

  static objectToXml(obj: any, rootName: string = 'context'): string {
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

  static escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, "'");
  }
}