export class ContextManager {
  private workflowContext: any = {};

  setContext(context: any): void {
    this.workflowContext = { ...this.workflowContext, ...context };
  }

  getContext(): any {
    return this.workflowContext;
  }

  updateContext(updates: any): void {
    this.workflowContext = { ...this.workflowContext, ...updates };
  }

  getWorkflowContext(): any {
    return this.workflowContext;
  }

  setWorkflowContext(context: any): void {
    this.workflowContext = context;
  }
}