require('dotenv').config();

const { Wizard, Models } = require('@swizzy/kit');

const wizard = new Wizard({ id: 'test-wizard' });

wizard.addTextStep({
  id: 'hello-step',
  instruction: 'Return the text "hello world"',
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log('Step result:', result);
    return actions.next();
  }
});


wizard.run().then(() => {
  console.log('Wizard completed');
});