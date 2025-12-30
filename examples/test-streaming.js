require('dotenv').config();

const { LLMClient, ProviderRegistry, Models } = require('@swizzy/kit');

async function testStreaming() {
  const registry = new ProviderRegistry();
  const client = new LLMClient(registry);

  try {
    console.log('Testing non-streaming with SWIZZY API...');
    const result = await client.complete({
      model: Models.SWIZZY_DEFAULT,
      prompt: 'Say hello world.',
      maxTokens: 50,
      temperature: 0.7,
      stream: false,
    });
    console.log('Non-streaming result:', result);
  } catch (error) {
    console.error('Non-streaming error:', error.message);
  }

  try {
    console.log('\nTesting streaming with SWIZZY API...');
    const result = await client.complete({
      model: Models.SWIZZY_DEFAULT,
      prompt: 'Write a short poem about coding.',
      maxTokens: 200,
      temperature: 0.7,
      stream: true,
      onChunk: (chunk) => {
        process.stdout.write(chunk); // Write only the response text as it comes
      },
      onUsage: (usage, provider) => {
        console.log('\nUsage:', usage);
      },
    });
    console.log('\nStreaming completed. Full result:', result);
  } catch (error) {
    console.error('Streaming error:', error.message);
  }
}

testStreaming();