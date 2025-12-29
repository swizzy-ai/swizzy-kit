import { Provider, MultiProvider, SwizzyProvider } from './providers';

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  constructor() {
    this.registerDefaultProviders();
  }

  private registerDefaultProviders() {
    const hasAnyMultiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.XAI_API_KEY);
    if (hasAnyMultiKey) {
      this.providers.set('multi', new MultiProvider());
    }
    if (process.env.SWIZZY_API_KEY) {
      this.providers.set('swizzy', new SwizzyProvider({ apiKey: process.env.SWIZZY_API_KEY }));
    }
  }

  registerProvider(name: string, provider: Provider) {
    this.providers.set(name, provider);
  }

  getProviderForModel(model: string): Provider {
    for (const provider of this.providers.values()) {
      if (provider.supportsModel(model)) {
        return provider;
      }
    }
    throw new Error(`No provider registered for model: ${model}`);
  }

  getAllProviders(): Provider[] {
    return Array.from(this.providers.values());
  }

  hasProviderForModel(model: string): boolean {
    try {
      this.getProviderForModel(model);
      return true;
    } catch {
      return false;
    }
  }
}