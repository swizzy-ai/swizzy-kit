require('dotenv').config();

const { Wizard, Models } = require('@swizzy/kit');

const wizard = new Wizard({ id: 'visualize-test-wizard' });

wizard.addTextStep({
  id: 'greet-step',
  instruction: 'Return a friendly greeting message',
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log('Greeting result:', result);
    return actions.next();
  }
});

wizard.addTextStep({
  id: 'farewell-step',
  instruction: 'Return a farewell message',
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log('Farewell result:', result);
    return actions.next();
  }
});

async function runVisualization() {
  try {
    // Start visualization server
    const { server, url } = await wizard.visualize(3000);
    console.log(`🎯 Visualization server started at: ${url}`);
    console.log('Open the URL in your browser to see the wizard interface');

    // Run the wizard
    await wizard.run();

    console.log('Wizard execution completed');

    // Close the server after a short delay
    setTimeout(() => {
      server.close();
      console.log('Visualization server closed');
    }, 2000);

  } catch (error) {
    console.error('Error:', error);
  }
}

runVisualization();