export interface BungeeDestination {
  type: 'step';
  targetId: string;
}

export interface BungeePlan {
  id: string;
  anchorId: string;
  destinations: BungeeDestination[];
  concurrency: number;
  configFn?: (index: number) => Record<string, any>;
}