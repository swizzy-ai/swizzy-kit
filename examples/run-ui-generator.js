require('dotenv').config();
const readline = require('readline');

const { createUIGeneratorWizard } = require('./code-assistant');

async function runUIGenerator() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Prompt for user request
  const userRequest = await new Promise((resolve) => {
    console.log('🤖 UI Generator Wizard');
    console.log('======================');
    console.log('');
    console.log('Describe the application you want to build:');
    console.log('Example: "Create a task management app with dashboard, task list, add/edit/delete tasks, and dark mode support"');
    console.log('');

    rl.question('What would you like to build? ', (input) => {
      resolve(input.trim());
    });
  });

  if (!userRequest || userRequest.toLowerCase() === 'exit') {
    console.log('Goodbye! 👋');
    rl.close();
    return;
  }

  console.log('');
  console.log('🚀 Starting UI Generator Wizard...');
  console.log('=====================================');
  console.log(`Request: "${userRequest}"`);
  console.log('');

  // Create and configure wizard
  const wizard = createUIGeneratorWizard();

  // Set user request
  wizard.setContext({
    userRequest: userRequest
  });

  // Set up comprehensive event logging
  wizard.on('step:start', (data) => {
    console.log(`▶️  Starting step: ${data.stepId}`);
  });

  wizard.on('step:complete', (data) => {
    console.log(`✅ Completed step: ${data.stepId}`);
  });

  wizard.on('step:error', (data) => {
    console.log(`❌ Error in step ${data.stepId}: ${data.error}`);
  });

  wizard.on('step:chunk', (data) => {
    // Log streaming chunks for text generation steps
    if (data.stepId.includes('generate_') || data.stepId.includes('plan_')) {
      process.stdout.write('.');
    }
  });

  wizard.on('complete', (data) => {
    console.log('');
    console.log('🎉 Wizard completed successfully!');
    console.log(`Duration: ${data.duration}ms`);
  });

  try {
    // Run the wizard
    await wizard.run();

    console.log('');
    console.log('📁 Generated project details:');
    const context = wizard.getContext();
    if (context.workDir) {
      console.log(`Location: ${context.workDir}`);
    }
    if (context.displayTitle) {
      console.log(`Title: ${context.displayTitle}`);
    }
    if (context.projectName) {
      console.log(`Project: ${context.projectName}`);
    }
    if (context.completionStats) {
      console.log(`Files Generated: ${context.completionStats.totalFiles}`);
    }

  } catch (error) {
    console.error('');
    console.error('💥 Wizard failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    rl.close();
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Wizard interrupted by user');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the generator
runUIGenerator().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});