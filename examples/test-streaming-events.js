require('dotenv').config();

const { Wizard, Models } = require('@swizzy/kit');

async function testStreamingEvents() {
  const wizard = new Wizard({
    id: 'test-streaming',
    maxRetries: 3,
    logging: true
  });

  // Listen for streaming events
  wizard.on('step:chunk', (data) => {
    console.log(`📡 RAW CHUNK for ${data.stepId}: "${data.chunk}"`);
  });

  wizard.on('step:streaming', (data) => {
    console.log(`🔄 STREAMING DATA for ${data.stepId}:`, JSON.stringify(data.data, null, 2));
  });

  wizard.on('step:start', (data) => {
    console.log(`🚀 Step ${data.stepId} started`);
  });

  wizard.on('step:complete', (data) => {
    console.log(`✅ Step ${data.stepId} completed:`, data.data);
  });

  // Add a text step
  wizard.addTextStep({
    id: 'text-step',
    instruction: 'Write a short poem about programming.',
    update: (result, _, actions) => {
      console.log("complete result =====>", result)
      actions.stop()
    },
    model: Models.SWIZZY_DEFAULT
  });

  console.log('Starting wizard execution...\n');

  try {
    await wizard.run();
    console.log('\n🎉 Wizard completed successfully!');
  } catch (error) {
    console.error('❌ Wizard failed:', error.message);
  }
}

if (require.main === module) {
  testStreamingEvents();
}