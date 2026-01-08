const readline = require('readline');
require('dotenv').config();

const { Wizard, Models } = require('@swizzy/kit');

async function createAssistantWizard() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const wizard = new Wizard({
    id: 'assistant-wizard',
    logging: false // Disable logging for cleaner output
  });

  // Helper function to format history for the prompt
  function formatHistory(history) {
    if (history.length === 0) return 'No previous conversation.';
    return history.map(entry => `User: ${entry.user}\nAssistant: ${entry.assistant}`).join('\n\n');
  }

  // Prompt for first message
  const firstMessage = await new Promise((resolve) => {
    rl.question('You: ', (input) => {
      resolve(input.trim());
    });
  });

  if (firstMessage.toLowerCase() === 'exit' || firstMessage.toLowerCase() === 'quit') {
    console.log('Goodbye! 👋');
    rl.close();
    return;
  }

  // Set initial context
  wizard.setContext({
    history: [],
    currentMessage: firstMessage,
    formattedHistory: 'No previous conversation.'
  });

  wizard.addTextStep({
    id: 'chat-step',
    instruction: `You are a helpful AI assistant. Respond to the user's message in a conversational way.

Conversation history:
{{formattedHistory}}

Current user message: {{currentMessage}}

Provide a helpful response.`,
    model: Models.SWIZZY_DEFAULT,
    contextType: 'template',
    update: async (result, context, actions) => {
      // The response is already streamed, so just add a newline
      console.log('\n' + '='.repeat(50));

      // Prompt for next user input
      const userInput = await new Promise((resolve) => {
        rl.question('You: ', (input) => {
          resolve(input.trim());
        });
      });

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        console.log('Goodbye! 👋');
        return actions.stop();
      }

      // Update context with conversation history
      context.history.push({
        user: context.currentMessage,
        assistant: result
      });
      context.currentMessage = userInput;

      // Update the formatted history for next run
      context.formattedHistory = formatHistory(context.history);

      // Continue to next iteration (same step)
      return actions.goto('chat-step');
    }
  });

  // Listen to streaming chunks for real-time display
  wizard.on('step:chunk', (data) => {
    if (data.stepId === 'chat-step') {
      process.stdout.write(data.chunk);
    }
  });

  console.log('🤖 AI Assistant started! Type your message or "exit" to quit.');
  console.log('='.repeat(50));

  try {
    await wizard.run();
  } catch (error) {
    console.error('Wizard error:', error);
  } finally {
    rl.close();
  }
}

// Run the assistant
createAssistantWizard().catch(console.error);