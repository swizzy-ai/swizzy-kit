require('dotenv').config();

const { Wizard, Models, ComputeStep } = require('@swizzy/kit');
const { z } = require('zod');

const wizard = new Wizard({
  id: 'compute-step-test',
  onUsage: (usage, provider) => {
    console.log(`Tokens used: ${usage.totalTokens} (${provider})`);
  }
});

// Step 1: Compute step to calculate totals from initial context
wizard.addComputeStep({
  id: 'calculate_totals',
  instruction: 'Calculate the total price of all items from initial context',
  update: (result, context, actions) => {
    console.log('🧮 COMPUTE STEP EXECUTING');
    console.log('Computing totals for items:', context.items);
    const total = context.items.reduce((sum, item) => sum + item.price, 0);
    const itemCount = context.items.length;
    const averagePrice = total / itemCount;

    const results = {
      total,
      itemCount,
      averagePrice,
      items: context.items
    };

    actions.updateContext(results);
    console.log('Calculated results:', results);
    return actions.stop();
  }
});

console.log('Steps added to wizard:', wizard.steps?.length || 'unknown');

async function runComputeTest() {
  try {
    // Set initial test data
    wizard.setContext({
      items: [
        { name: 'Widget A', price: 10.99 },
        { name: 'Widget B', price: 15.50 },
        { name: 'Widget C', price: 8.75 }
      ]
    });

    console.log('🧮 Testing Compute Step Implementation');
    console.log('=====================================');
    console.log('Initial context:', wizard.getContext());

    // Run the wizard
    await wizard.run();

    console.log('Compute step test completed successfully!');
    console.log('Final context:', JSON.stringify(wizard.getContext(), null, 2));

  } catch (error) {
    console.error('Compute step test error:', error);
  }
}

runComputeTest();