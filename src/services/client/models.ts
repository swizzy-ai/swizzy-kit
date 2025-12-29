export enum Models {
  GPT4 = 'gpt-4',
  GPT35_TURBO = 'gpt-3.5-turbo',
  CLAUDE3_SONNET = 'claude-3-sonnet-20240229',
  CLAUDE3_HAIKU = 'claude-3-haiku-20240307',
  GEMINI_PRO = 'gemini-pro',
  GEMINI_PRO_VISION = 'gemini-pro-vision',
  GROK_BETA = 'grok-beta',
  SWIZZY_DEFAULT = 'swizzy-default',
}

export class Model {
  public readonly provider: string;
  public readonly model: string;

  constructor(modelEnum: Models) {
    this.model = modelEnum;
    this.provider = this.getProviderFromModel(modelEnum);
  }

  private getProviderFromModel(model: Models): string {
    switch (model) {
      case Models.GPT4:
      case Models.GPT35_TURBO:
        return 'openai';
      case Models.CLAUDE3_SONNET:
      case Models.CLAUDE3_HAIKU:
        return 'anthropic';
      case Models.GEMINI_PRO:
      case Models.GEMINI_PRO_VISION:
        return 'google';
      case Models.GROK_BETA:
        return 'grok';
      case Models.SWIZZY_DEFAULT:
        return 'swizzy';
      default:
        console.error("Unknown error defaulting to SWIZZY", )
        return 'swizzy';
    }
  }
}