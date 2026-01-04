/**
 * Example: Consuming streaming data from a Wizard
 *
 * This example shows how to connect to a running wizard's WebSocket server
 * and receive real-time streaming updates during step execution.
 */

const WebSocket = require('ws');

async function consumeStreamingData(port = 3000) {
  const ws = new WebSocket(`ws://localhost:${port}`);

  ws.on('open', () => {
    console.log('🔗 Connected to wizard streaming server');
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'step_update':
          if (message.status === 'streaming') {
            console.log(`📡 Streaming update for step ${message.stepId}:`);
            console.log(JSON.stringify(message.data, null, 2));
            console.log('---');
          } else if (message.status === 'completed') {
            console.log(`✅ Step ${message.stepId} completed with final data:`);
            console.log(JSON.stringify(message.data, null, 2));
          }
          break;

        case 'wizard_start':
          console.log(`🚀 Wizard started with ${message.steps.length} steps`);
          break;

        case 'status_update':
          console.log(`📊 Status update:`, message.status);
          break;

        default:
          console.log(`📨 Other message: ${message.type}`);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Disconnected from wizard server');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Keep the connection alive
  return new Promise((resolve) => {
    ws.on('close', resolve);
  });
}

// Usage:
// 1. Start a wizard with visualization: await wizard.visualize(3000);
// 2. Run the consumer: consumeStreamingData(3000);
// 3. Execute the wizard: await wizard.run();

if (require.main === module) {
  consumeStreamingData().catch(console.error);
}