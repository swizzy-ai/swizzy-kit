import * as http from 'http';
import * as WebSocket from 'ws';
import * as path from 'path';
import * as fs from 'fs';

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export class VisualizationManager {
  public visualizationServer?: http.Server;
  private wss?: WebSocket.Server;
  private visualizationPort?: number;
  private connectedClients: Set<WebSocket> = new Set();
  private readonly maxWebSocketConnections = 10;
  private wsIntervals: WeakMap<WebSocket, NodeJS.Timeout> = new WeakMap();

  private runResolver?: () => void;
  private pauseResolver?: () => void;

  constructor(private wizard: any) {} // Wizard instance for callbacks

  async visualize(port: number = 3000): Promise<{ server: http.Server; url: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this.getVisualizationHtml());
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      this.wss = new WebSocket.Server({ server });
      this.setupWebSocketHandlers();

      server.listen(port, 'localhost', () => {
        this.visualizationPort = port;
        this.visualizationServer = server;
        const url = `http://localhost:${port}`;
        console.log(`🎯 Wizard visualization available at: ${url}`);
        resolve({ server, url });
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          this.visualize(port + 1).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket) => {
      if (this.connectedClients.size >= this.maxWebSocketConnections) {
        console.log('🔗 WebSocket connection rejected: max connections reached');
        ws.close(1008, 'Max connections reached');
        return;
      }

      console.log('🔗 WebSocket client connected');
      this.connectedClients.add(ws);

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

      this.wsIntervals.set(ws, pingInterval);

      ws.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleWebSocketMessage(data, ws);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        this.connectedClients.delete(ws);
        const interval = this.wsIntervals.get(ws);
        if (interval) {
          clearInterval(interval);
          this.wsIntervals.delete(ws);
        }
      });

      ws.on('error', () => {
        this.connectedClients.delete(ws);
        const interval = this.wsIntervals.get(ws);
        if (interval) {
          clearInterval(interval);
          this.wsIntervals.delete(ws);
        }
      });

      this.sendToClients({ type: 'status_update', status: { waitingForStart: true, isRunning: false, isPaused: false } });
    });
  }

  private handleWebSocketMessage(data: any, ws: WebSocket): void {
    switch (data.type) {
      case 'control':
        switch (data.action) {
          case 'start':
            console.log('🚀 Starting wizard execution from UI');
            this.wizard.isRunning = true;
            this.sendToClients({ type: 'status_update', status: { isRunning: true, isPaused: false, isStepMode: false } });
            if (this.runResolver) {
              this.runResolver();
              this.runResolver = undefined;
            }
            break;

          case 'pause':
            this.wizard.isPaused = true;
            console.log('⏸️ Wizard execution paused');
            this.sendToClients({ type: 'status_update', status: { isPaused: true, isStepMode: this.wizard.isStepMode } });
            break;

          case 'resume':
            this.wizard.isPaused = false;
            this.wizard.isStepMode = false;
            console.log('▶️ Wizard execution resumed');
            if (this.pauseResolver) {
              this.pauseResolver();
              this.pauseResolver = undefined;
            }
            this.sendToClients({ type: 'status_update', status: { isPaused: false, isStepMode: false } });
            break;

          case 'step_forward':
            if (this.wizard.isPaused) {
              this.wizard.isStepMode = true;
              console.log('⏭️ Stepping forward');
              if (this.pauseResolver) {
                this.pauseResolver();
                this.pauseResolver = undefined;
              }
              this.sendToClients({ type: 'status_update', status: { isPaused: true, isStepMode: true } });
            }
            break;

          case 'stop':
            console.log('🛑 Stopping wizard execution');
            this.wizard.isRunning = false;
            this.wizard.isPaused = false;
            this.wizard.isStepMode = false;
            this.sendToClients({ type: 'status_update', status: { isRunning: false, isPaused: false, isStepMode: false } });
            break;

          case 'replay':
            console.log('🔄 Replaying wizard - resetting state');
            this.wizard.isRunning = false;
            this.wizard.isPaused = false;
            this.wizard.workflowContext = {};
            this.sendToClients({ type: 'status_update', status: { isRunning: false, isPaused: false, waitingForStart: true } });
            break;
        }
        break;

      case 'run':
        console.log('🚀 Starting wizard execution from UI (run command)');
        this.wizard.isRunning = true;
        this.sendToClients({ type: 'status_update', status: { isRunning: true, isPaused: false } });
        if (this.runResolver) {
          this.runResolver();
          this.runResolver = undefined;
        }
        break;

      case 'form_submit':
        this.wizard.userOverrideData = data.data;
        console.log('📝 User override data received:', data.data);
        if (this.pauseResolver) {
          this.pauseResolver();
          this.pauseResolver = undefined;
        }
        break;

      case 'update_step_data':
        this.wizard.updateContext(data.data);
        console.log('📝 Step data updated:', data.data);
        break;

      case 'goto':
        const index = this.wizard.findStepIndex(data.stepId);
        if (index !== -1) {
          this.wizard.currentStepIndex = index;
          this.wizard.isRunning = true;
          this.wizard.isPaused = false;
          this.wizard.isStepMode = false;
          console.log(`🔄 Going to step ${data.stepId}`);
          this.sendToClients({ type: 'status_update', status: { isRunning: true, isPaused: false, isStepMode: false } });
        }
        break;
    }
  }

  public sendToClients(message: WebSocketMessage): void {
    const messageStr = JSON.stringify(message);
    this.connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  async waitForRunCommand(): Promise<void> {
    return new Promise(resolve => {
      this.runResolver = resolve;
    });
  }

  async waitForResume(): Promise<void> {
    return new Promise(resolve => {
      this.pauseResolver = resolve;
    });
  }

  sendStatusUpdate(status: any): void {
    this.sendToClients({ type: 'status_update', status });
  }

  sendWizardStart(steps: any[]): void {
    this.sendToClients({ type: 'wizard_start', steps });
  }

  sendStepUpdate(update: any): void {
    this.sendToClients({ type: 'step_update', ...update });
  }

  sendContextUpdate(context: any): void {
    this.sendToClients({ type: 'context_update', context });
  }

  sendTokenUpdate(totalTokens: number, stepTokens: number): void {
    this.sendToClients({
      type: 'token_update',
      totalTokens,
      stepTokens
    });
  }

  private getVisualizationHtml(): string {
    const fs = require('fs');
    const path = require('path');

    // Read the HTML file (now self-contained with inline CSS and JS)
    const htmlPath = path.join(__dirname, 'ui/wizard-visualizer.html');
    return fs.readFileSync(htmlPath, 'utf-8');
  }
}