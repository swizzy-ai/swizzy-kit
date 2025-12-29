import { CompletionOptions, CompletionResult, LLMClient, LLMConfig } from './index';
import { Models } from './models';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

export interface Provider {
  complete(options: CompletionOptions): Promise<CompletionResult>;
  supportsModel(model: string): boolean;
  getProviderName(): string;
}

export abstract class BaseProvider implements Provider {
  abstract complete(options: CompletionOptions): Promise<CompletionResult>;
  abstract supportsModel(model: string): boolean;
  abstract getProviderName(): string;
}

export class SwizzyProvider extends BaseProvider {
  private config: Required<LLMConfig>;

  constructor(config: LLMConfig) {
    super();
    const baseURL = config.baseURL || process.env.SWIZZY_BASE_URL || 'https://swizzy-kit.hello-ad4.workers.dev';
    const apiKey = config.apiKey || process.env.SWIZZY_API_KEY;
    if (!apiKey) {
      throw new Error('SWIZZY_API_KEY is required. Set it via environment variable SWIZZY_API_KEY or pass apiKey directly.');
    }
    this.config = { baseURL, apiKey };
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const endpoint = options.stream ? '/completions/stream' : '/completions';
    const response = await fetch(`${this.config.baseURL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        prompt: options.prompt,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7,
      }),
    });
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json() as { error?: string; message?: string };
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        const text = await response.text().catch(() => '');
        if (text) errorMessage = text;
      }
      throw new Error(`LLM API error: ${errorMessage}`);
    }
    if (options.stream) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body for streaming');
      let fullText = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        fullText += chunk;
      }
      return { text: fullText };
    } else {
      const data = await response.json() as { completion: string; fullResult?: any; usage?: any };
      let transformedUsage;
      const usageData = data.fullResult?.usage || data.usage;
      if (usageData) {
        transformedUsage = {
          promptTokens: usageData.prompt_tokens || 0,
          completionTokens: usageData.completion_tokens || 0,
          totalTokens: usageData.total_tokens || 0
        };
      }
      if (options.onUsage && transformedUsage) {
        options.onUsage(transformedUsage, this.getProviderName());
      }
      return {
        text: data.completion,
        usage: transformedUsage,
      };
    }
  }

  supportsModel(model: string): boolean {
    return model === Models.SWIZZY_DEFAULT;
  }

  getProviderName(): string {
    return 'swizzy';
  }
}

export class MultiProvider extends BaseProvider {
  private openaiKey?: string;
  private anthropicKey?: string;
  private googleKey?: string;
  private xaiKey?: string;

  constructor() {
    super();
    this.openaiKey = process.env.OPENAI_API_KEY;
    this.anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    this.xaiKey = process.env.XAI_API_KEY;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const model = options.model || Models.GPT4;
    let provider;
    switch (model) {
      case Models.GPT4:
      case Models.GPT35_TURBO:
        if (!this.openaiKey) throw new Error('OpenAI API key not available');
        provider = openai(model) as any;
        break;
      case Models.CLAUDE3_SONNET:
      case Models.CLAUDE3_HAIKU:
        if (!this.anthropicKey) throw new Error('Anthropic API key not available');
        provider = anthropic(model) as any;
        break;
      case Models.GEMINI_PRO:
      case Models.GEMINI_PRO_VISION:
        if (!this.googleKey) throw new Error('Google API key not available');
        provider = google(model) as any;
        break;
      case Models.GROK_BETA:
        if (!this.xaiKey) throw new Error('xAI API key not available');
        provider = xai(model) as any;
        break;
      default:
        throw new Error(`Unsupported model: ${model}`);
    }
    const result = await generateText({
      model: provider,
      prompt: options.prompt,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
    const usage = {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    };
    if (options.onUsage) {
      options.onUsage(usage, this.getProviderName());
    }
    return {
      text: result.text,
      usage,
    };
  }

  supportsModel(model: string): boolean {
    const m = model as Models;
    switch (m) {
      case Models.GPT4:
      case Models.GPT35_TURBO:
        return !!this.openaiKey;
      case Models.CLAUDE3_SONNET:
      case Models.CLAUDE3_HAIKU:
        return !!this.anthropicKey;
      case Models.GEMINI_PRO:
      case Models.GEMINI_PRO_VISION:
        return !!this.googleKey;
      case Models.GROK_BETA:
        return !!this.xaiKey;
      default:
        return false;
    }
  }

  getProviderName(): string {
    return 'multi';
  }
}