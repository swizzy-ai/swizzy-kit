require('dotenv').config();

const { createUIGeneratorWizard } = require('./code-assistant');

async function runCodeAssistant() {
  const wizard = createUIGeneratorWizard();

  // Set up user request
  wizard.setContext({
    userRequest: 'Create a task management app with a dashboard, task list, and ability to add/edit/delete tasks. Include dark mode support.'
  });

  // Listen to events for progress
  wizard.on('step:start', (data) => {
    console.log(`\n🚀 Starting step: ${data.stepId}`);
  });

  wizard.on('step:complete', (data) => {
    console.log(`✅ Completed step: ${data.stepId}`);
  });

  wizard.on('step:error', (data) => {
    console.log(`❌ Error in step ${data.stepId}: ${data.error}`);
  });

  wizard.on('complete', (data) => {
    console.log(`\n🎉 Wizard completed in ${data.duration}ms`);
  });

  try {
    // Start visualization server
    const { server, url } = await wizard.visualize(3001);
    console.log(`📊 Visualization available at: ${url}`);

    // Run the wizard
    await wizard.run();

    console.log('\n✨ UI Generation Wizard completed successfully!');
    console.log('Check the generated project in the projects/ directory');

  } catch (error) {
    console.error('Wizard failed:', error);
  }
}

runCodeAssistant().catch(console.error);