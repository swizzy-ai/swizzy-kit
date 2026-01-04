# Streaming in Wizard.ts

## Overview

The Wizard class implements a streaming XML parsing mechanism for processing LLM responses in real-time. This allows for incremental data extraction and UI updates during step execution, providing a responsive user experience.

## How Streaming Works

### 1. Streaming Initiation

Streaming is initiated in the [`generateStepData`](src/core/wizard/wizard.ts:607) method for regular steps (not TextStep or ComputeStep). The LLM client is called with `stream: true`:

```typescript
const llmResult = await this.llmClient.complete({
  prompt,
  model: step.model,
  maxTokens: 1000,
  temperature: 0.3,
  stream: true,
  onChunk: (chunk: string) => {
    const parseResult = parser.push(chunk);
    if (parseResult && !parseResult.done) {
      latestResult = parseResult.result;
      // Send partial results to UI
      this.visualizationManager.sendStepUpdate({
        stepId: step.id,
        status: 'streaming',
        data: latestResult
      });
    } else if (parseResult?.done) {
      latestResult = parseResult.result;
    }
  },
  onUsage: this.usageTracker.updateUsage.bind(this.usageTracker)
});
```

### 2. Streaming XML Parser

The core of the streaming mechanism is the [`createStreamingXmlParser`](src/core/wizard/wizard.ts:773) method, which creates an incremental parser that processes XML chunks as they arrive.

#### Parser Structure

```typescript
private createStreamingXmlParser() {
  let buffer = '';
  let inResponse = false;
  const result: any = {};
  let currentField: { name: string; type: string; content: string } | null = null;

  return {
    push: (chunk: string) => {
      // ... parsing logic
    }
  };
}
```

#### Key Components

- **Buffer**: Accumulates incoming text chunks
- **inResponse**: Tracks whether we've entered the `<response>` tag
- **result**: The parsed JSON object being built
- **currentField**: Currently parsing field metadata

### 3. Incremental Parsing Process

#### Step 1: Response Detection
The parser waits for the `<response>` tag to start processing:

```typescript
if (!inResponse && buffer.includes('<response>')) {
  inResponse = true;
  buffer = buffer.slice(buffer.indexOf('<response>') + 10);
}
```

#### Step 2: Field Detection
Uses regex to find wizard-tagged fields:

```typescript
const tagMatch = buffer.match(Wizard.WIZARD_TAG_PATTERN);
```

Where `WIZARD_TAG_PATTERN` is:
```typescript
private static readonly WIZARD_TAG_PATTERN = /<(\w+)\s+([^>]*tag-category=["']wizard["'][^>]*)>/gi;
```

#### Step 3: Content Accumulation
For each field, content is accumulated until the next wizard field or `</response>`:

```typescript
if (currentField) {
  const nextTagIndex = buffer.search(/<\w+\s+[^>]*tag-category=["']wizard["']/);
  if (nextTagIndex !== -1) {
    currentField.content += buffer.slice(0, nextTagIndex);
    buffer = buffer.slice(nextTagIndex);
  } else if (buffer.includes('</response>')) {
    // Finalize parsing
  }
}
```

#### Step 4: Type-Based Parsing
When a field is complete, its content is parsed based on the `type` attribute:

```typescript
result[currentField.name] = this.parseValueByType(
  currentField.content.trim(),
  currentField.type
);
```

### 4. UI Integration

During streaming, partial results are sent to the visualization manager:

```typescript
this.visualizationManager.sendStepUpdate({
  stepId: step.id,
  status: 'streaming',
  data: latestResult
});
```

This allows the UI to display real-time progress and partial data as it's being generated.

### 5. Streaming Data Output

The wizard streams parsed data out through multiple channels:

#### WebSocket Broadcasting

Streaming data is broadcast to connected WebSocket clients via the [`VisualizationManager`](src/core/wizard/visualization-manager.ts):

```typescript
// In VisualizationManager.sendStepUpdate()
sendStepUpdate(update: any): void {
  this.sendToClients({ type: 'step_update', ...update });
}

// In VisualizationManager.sendToClients()
public sendToClients(message: WebSocketMessage): void {
  const messageStr = JSON.stringify(message);
  this.connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}
```

**Message Format:**
```json
{
  "type": "step_update",
  "stepId": "step_1",
  "status": "streaming",
  "data": {
    "name": "John Smith",
    "age": 25
  }
}
```

#### WebSocket Server Setup

The wizard exposes streaming data through a WebSocket server started via [`visualize()`](src/core/wizard/wizard.ts:1186):

```typescript
async visualize(port: number = 3000): Promise<{ server: any; url: string }> {
  return this.visualizationManager.visualize(port);
}
```

This creates:
- HTTP server on `http://localhost:{port}`
- WebSocket server for real-time communication
- Web UI at the root URL for visualization

#### Connecting to Streaming Data

External applications can connect to receive streaming updates. See [`examples/streaming-consumer.js`](examples/streaming-consumer.js) for a complete example:

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  if (message.type === 'step_update' && message.status === 'streaming') {
    console.log('Streaming data:', message.data);
  }
});
```

#### Alternative: Direct LLM Streaming

For lower-level access, the underlying [`LLMClient`](src/services/client/index.ts) supports direct streaming:

```typescript
const result = await client.complete({
  prompt: 'Generate data...',
  stream: true,
  onChunk: (chunk) => {
    console.log('Raw chunk:', chunk);
  }
});
```

### 6. Completion Handling

When the `</response>` tag is detected, the parser returns `{ done: true, result }`, signaling completion.

### 7. Error Handling and Validation

After streaming completes, the parsed data is validated against the step's schema. If validation fails, a repair process is attempted using another LLM call.

## XML Format Requirements

The streaming parser expects XML with specific formatting:

- Root element: `<response>`
- Fields with `tag-category="wizard"` attribute
- Type attributes: `type="string"`, `type="number"`, etc.
- Self-closing or content-ending tags

Example:
```xml
<response>
  <name tag-category="wizard" type="string">John Smith
  <age tag-category="wizard" type="number">25
  <tags tag-category="wizard" type="array">["a", "b", "c"]
</response>
```

## Benefits

1. **Real-time Updates**: UI can show progress as data streams in
2. **Incremental Parsing**: No need to wait for complete response
3. **Memory Efficient**: Processes data in chunks
4. **Responsive UX**: Users see partial results immediately

## Limitations

1. **XML Dependency**: Requires specific XML structure with wizard tags
2. **Type Hints Required**: Fields must include type attributes
3. **Sequential Processing**: Fields must be processed in order