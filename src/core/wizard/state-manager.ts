export class StateManager {
  private state: any = {};

  constructor(private events: { emit: (event: string, data?: any) => void }) {}

  setState(updates: Partial<any> | ((prevState: any) => Partial<any>)): void {
    let newUpdates: Partial<any>;

    if (typeof updates === 'function') {
      // Higher-order function pattern like React setState
      newUpdates = updates(this.state);
    } else {
      // Object pattern
      newUpdates = updates;
    }

    const previousState = { ...this.state };
    this.state = { ...this.state, ...newUpdates };

    // Emit state update event
    this.events.emit('state:update', {
      previousState,
      newState: this.state,
      updates: newUpdates,
      timestamp: Date.now()
    });
  }

  getState(): any {
    return this.state;
  }

  // Legacy methods for backward compatibility
  setContext(context: any): void {
    this.setState(context);
  }

  getContext(): any {
    return this.getState();
  }

  updateContext(updates: any): void {
    this.setState(updates);
  }

  getWorkflowContext(): any {
    return this.getState();
  }

  setWorkflowContext(state: any): void {
    this.state = state;
  }
}