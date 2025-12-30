export interface LLMConfig {
  baseURL?: string;
  apiKey?: string;
}

export interface CompletionOptions {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  onChunk?: (chunk: string) => void;
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }, provider: string) => void;
}

export interface CompletionResult {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

import { ProviderRegistry } from './registry';

export class LLMClient {
  constructor(private registry: ProviderRegistry) {}

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const model = options.model;
    if (!model) {
      throw new Error('Model must be specified in CompletionOptions');
    }
    const provider = this.registry.getProviderForModel(model);
    return provider.complete(options);
  }
}

export * from './models';
export * from './providers';
export * from './registry';
