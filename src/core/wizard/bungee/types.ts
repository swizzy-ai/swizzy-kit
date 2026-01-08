export interface BungeeDestination {
  type: 'step';
  targetId: string;
  config?: Record<string, any>;
}

import { FlowControlSignal } from '../steps/base';

export interface BungeePlan {
  id: string;
  anchorId: string;
  destinations: BungeeDestination[];
  concurrency: number;
  optimistic?: boolean; // If true, don't wait for completion, proceed immediately
  returnToAnchor?: boolean; // If true, return to anchor after completion
  failWizardOnFailure?: boolean; // If true, stop wizard on any worker failure
  onComplete?: (wizard: any) => FlowControlSignal;
}