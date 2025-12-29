require('dotenv').config();

const { Wizard, Models } = require('@swizzy/kit');
const { z } = require('zod');

const wizard = new Wizard({
  id: 'medical-prescription-wizard',
  onUsage: (usage, provider) => {
    console.log(`Tokens used: ${usage.totalTokens} (${provider})`);
  }
});

// Step 1: Collect patient information
wizard.addStep({
  id: 'patient_info',
  instruction: 'Collect basic patient information for medical diagnosis',
  schema: z.object({
    name: z.string().min(1, 'Name is required'),
    age: z.number().min(0).max(150),
    gender: z.enum(['male', 'female', 'other']),
    symptoms: z.string().min(1, 'Please describe symptoms'),
    medical_history: z.string().optional()
  }),
  model: Models.SWIZZY_DEFAULT,
  update: (data, context, actions) => {
    console.log('Patient info collected:', data);
    actions.updateContext({ patient: data });
    return actions.next();
  }
});

// Step 2: Initial assessment
wizard.addTextStep({
  id: 'initial_assessment',
  instruction: `Based on the patient's symptoms and information, provide an initial medical assessment.
  Patient: {{patient.name}}, Age: {{patient.age}}, Gender: {{patient.gender}}
  Symptoms: {{patient.symptoms}}
  Medical History: {{patient.medical_history}}

  Provide a brief assessment of possible conditions.`,
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log('Initial assessment:', result);
    actions.updateContext({ assessment: result });
    return actions.next();
  }
});

// Step 3: Diagnostic questions
wizard.addStep({
  id: 'diagnostic_questions',
  instruction: 'Ask specific diagnostic questions based on the initial assessment',
  schema: z.object({
    questions: z.array(z.string()).min(1, 'At least one question is required'),
    priority_level: z.enum(['low', 'medium', 'high', 'urgent'])
  }),
  model: Models.SWIZZY_DEFAULT,
  update: (data, context, actions) => {
    console.log('Diagnostic questions:', data);
    actions.updateContext({ diagnostics: data });
    return actions.next();
  }
});

// Step 4: Final diagnosis
wizard.addTextStep({
  id: 'final_diagnosis',
  instruction: `Based on all information collected, provide a final diagnosis and treatment plan.

  Patient Info: {{patient}}
  Initial Assessment: {{assessment}}
  Diagnostic Questions: {{diagnostics}}

  Provide:
  1. Final diagnosis
  2. Recommended treatment
  3. Medication prescription if needed
  4. Follow-up instructions`,
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log('Final diagnosis:', result);
    actions.updateContext({ diagnosis: result });
    return actions.next();
  }
});

// Step 5: Prescription details
wizard.addStep({
  id: 'prescription',
  instruction: 'Create prescription details based on the diagnosis',
  schema: z.object({
    medications: z.array(z.object({
      name: z.string(),
      dosage: z.string(),
      frequency: z.string(),
      duration: z.string()
    })).min(0),
    additional_instructions: z.string().optional(),
    follow_up_required: z.boolean()
  }),
  model: Models.SWIZZY_DEFAULT,
  update: (data, context, actions) => {
    console.log('Prescription created:', data);
    actions.updateContext({ prescription: data });
    return actions.stop();
  }
});

async function runMedicalWizard() {
  try {
    // Start visualization server
    const { server, url } = await wizard.visualize(3001);
    console.log(`🏥 Medical Prescription Wizard started at: ${url}`);
    console.log('Open the URL in your browser to interact with the medical diagnosis wizard');

    // Run the wizard
    await wizard.run();

    console.log('Medical diagnosis completed');
    console.log('Final context:', wizard.getContext());

    // Close the server after a delay
    setTimeout(() => {
      server.close();
      console.log('Medical wizard server closed');
    }, 5000);

  } catch (error) {
    console.error('Medical wizard error:', error);
  }
}

runMedicalWizard();