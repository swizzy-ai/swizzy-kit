require('dotenv').config();

const { Wizard, Models } = require('@swizzy/kit');

// ============================================================================
// UTILITY: HTML Entity Decoder
// ============================================================================
function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#x27;': "'",
    '&#39;': "'",
    '&apos;': "'"
  };
  
  return text.replace(/&[#\w]+;/g, (entity) => entities[entity] || entity);
}

// ============================================================================
// CODE CLEANUP: Fix formatting issues
// ============================================================================
function cleanupGeneratedCode(code) {
  // Remove markdown code fences
  let cleaned = code.replace(/```(?:typescript|javascript|ts|js)?/g, '').trim();
  
  // Fix multi-line arrays - collapse them to single line
  cleaned = cleaned.replace(/\[\s*\n\s*"([^"]+)"\s*,?\s*\n/g, '["$1", ');
  cleaned = cleaned.replace(/,\s*\n\s*"([^"]+)"\s*\n\s*\]/g, ', "$1"]');
  
  // Remove inline comments that might break parsing
  cleaned = cleaned.replace(/\/\/[^\n]*/g, '');
  
  return cleaned;
}

// ============================================================================
// VALIDATION RULES
// ============================================================================
const VALIDATION_RULES = [
  {
    name: "Export Safety",
    description: "Must export createWizard function that returns wizard (not runs it)",
    check: (code) => {
      return code.includes('export function createWizard') && 
             code.includes('return wizard');
    }
  },
  {
    name: "Compute Steps Have Empty Instructions",
    description: "All addComputeStep calls must have instruction: ''",
    check: (code) => {
      const computeSteps = code.match(/addComputeStep\s*\({[^}]*}/gs) || [];
      return computeSteps.every(step => step.includes("instruction: ''") || step.includes('instruction: ""'));
    }
  },
  {
    name: "No Syntax Errors",
    description: "Code must have balanced braces and proper structure",
    check: (code) => {
      const openBraces = (code.match(/{/g) || []).length;
      const closeBraces = (code.match(/}/g) || []).length;
      const openParens = (code.match(/\(/g) || []).length;
      const closeParens = (code.match(/\)/g) || []).length;
      const openBrackets = (code.match(/\[/g) || []).length;
      const closeBrackets = (code.match(/\]/g) || []).length;
      
      return openBraces === closeBraces && 
             openParens === closeParens && 
             openBrackets === closeBrackets;
    }
  }
];

// ============================================================================
// KNOWLEDGE BASE
// ============================================================================
const WIZARD_DOCS = `
ANATOMY OF CONTEXT

Global Context is the shared state that flows through your workflow.
It is defined in the Information Inventory section of your SES.

Example Information Inventory:
- The Original Text: The raw text provided by the user
- The Axis List: A list of three perspectives
- The Draft Variations: Collection of rephrased versions

This becomes camelCase properties in DEFAULT_CONTEXT.

Local Context is the bridge between global context and instruction template.
The instruction template CANNOT see Global Context directly.
You must map Global Context to Local Variables using the context function.

Example:
context: (ctx) => ({
  userName: ctx.userFullName,
  docCount: ctx.documents.length
})

Then use in instruction:
instruction: 'Analyze {{userName}} who has {{docCount}} documents'

---

ANATOMY OF A STEP

TEXT STEP (Actor: AI)
When the step says "Actor: AI", use addTextStep.

wizard.addTextStep({
  id: 'step_id',
  instruction: 'Analyze {{localVar}}',
  context: (ctx) => ({ 
    localVar: ctx.globalVar
  }),
  model: Models.SWIZZY_DEFAULT,
  update: async (result, ctx, actions) => {
    actions.updateContext({ resultVar: result });
    return actions.next();
  }
});

COMPUTE STEP (Actor: System)
When the step says "Actor: System", use addComputeStep.
MUST have instruction: ''

wizard.addComputeStep({
  id: 'step_id',
  instruction: '',
  update: async (result, ctx, actions) => {
    actions.updateContext({ computed: ctx.value * 2 });
    return actions.next();
  }
});

---

THE BUNGEE PATTERN

When your SES says "Launch parallel processing" or "For each X in List":

ANCHOR STEP (Where Bungee Launches)
This is always a Compute Step. It handles BOTH launch AND return.

wizard.addComputeStep({
  id: 'distribute_work',
  instruction: '',
  update: async (result, ctx, actions) => {
    
    const allWorkersComplete = ctx.theItemList.every((_, i) => 
      ctx[\`result_\${i}\`] !== undefined
    );
    
    if (allWorkersComplete) {
      return actions.next();
    }
    
    return actions.bungee.init()
      .batch(
        'worker_step_id',
        ctx.theItemList.length,
        (index) => ({
          currentItem: ctx.theItemList[index],
          itemIndex: index
        })
      )
      .config({ concurrency: 3, timeout: 30000 })
      .jump();
  }
});

WORKER STEP (Runs N Times in Parallel)

wizard.addTextStep({
  id: 'worker_step_id',
  instruction: 'Process {{currentItem}}',
  context: (ctx) => ({
    currentItem: ctx.currentItem
  }),
  model: Models.SWIZZY_DEFAULT,
  update: async (result, ctx, actions) => {
    actions.updateContext({
      [\`result_\${ctx.itemIndex}\`]: result
    });
    return actions.next();
  }
});

---

FLOW CONTROL SIGNALS

Every update function MUST return a signal:

actions.next() - Go to next step
actions.stop() - End workflow
actions.goto('step_id') - Jump to specific step
actions.retry() - Re-run current step
actions.bungee.init()... - Parallel processing

---

CRITICAL RULES

1. Compute Steps MUST have instruction: ''
2. Context function is required for text steps
3. Bungee anchor runs twice: once to launch, once when workers finish
4. Use unique keys for parallel results: [\`result_\${index}\`]
5. Always return a signal from update function
6. Use camelCase for all variable names
`;

async function runWizard() {
  const sesMarkdown = `
Station: Tri-Axis Rephraser

Information Inventory
- The Original Text: The raw text provided by the user that needs rephrasing
- The Axis List: A list of the three perspectives we will use
- The Current Axis: The specific perspective being applied by a worker
- The Draft Variations: A collection of the three rephrased versions generated by the workers
- The Final Rephrase: The ultimate polished text that combines the best elements of all three

Step 1: Review Request
Actor: AI
Reads: The Original Text
Does: Check if the text is valid. If it is empty, gibberish, or violates safety policies, reject it.
Updates: None
Next Step: If valid go to Step 2. If invalid stop.

Step 2: Initialize Axes
Actor: System
Reads: None
Does: Create the list of perspectives to brainstorm against.
Updates: The Axis List
Next Step: Go to Step 3.

Step 3: Distribute Brainstorming
Actor: System
Reads: The Axis List
Does: Launch parallel processing. Assign one Worker for each item in The Axis List.
Updates: None
Next Step: Go to Step 4 for each axis.

Step 4: Generate Variation
Actor: AI
Reads: The Original Text, The Current Axis
Does: Rewrite the original text strictly adhering to the current axis style. Do not change the meaning.
Updates: The Draft Variations
Next Step: Go to Step 5.

Step 5: Synthesize Final Version
Actor: AI
Reads: The Original Text, The Draft Variations
Does: Analyze the three variations. Select the simplicity of the first, the authority of the second, and the flow of the third. Construct one final perfect paragraph.
Updates: The Final Rephrase
Next Step: Stop.
  `.trim();

  console.log('Initializing SES Compiler...\n');

  const wizard = new Wizard({ id: 'ses-compiler' });

  let session = { inputSes: sesMarkdown };

  // -----------------------------------------------------------------------
  // STEP 1: VALIDATE INPUT
  // -----------------------------------------------------------------------
  wizard.addTextStep({
    id: 'validate_ses',
    instruction: `
Analyze this SES document.

SES Content:
{{inputSes}}

Check if it contains:
1. Information Inventory section
2. Multiple Steps with Actor, Reads, Does, Updates, Next Step

If valid return: VALID
If invalid return: INVALID - reason
    `.trim(),
    context: (ctx) => ({ inputSes: session.inputSes }),
    model: Models.SWIZZY_DEFAULT,
    update: async (result, ctx, actions) => {
      const cleaned = decodeHtmlEntities(result);
      if (cleaned.includes("INVALID")) {
        console.error('❌ Validation Error:', cleaned);
        return actions.stop();
      }
      console.log('✅ SES Validated');
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 2: GENERATE ARCHITECTURE
  // -----------------------------------------------------------------------
  wizard.addTextStep({
    id: 'gen_architecture',
    instruction: `
Generate setup code from this SES.

SES Content:
{{inputSes}}

Generate two things:
1. const WIZARD_ID = "station-name-in-kebab-case";
2. const DEFAULT_CONTEXT with camelCase properties from Information Inventory

Rules:
- Each property on ONE line
- Arrays on ONE line with all elements
- Use camelCase for property names
- Appropriate default values (empty string, empty array, zero, false)

Return ONLY the two const declarations, no markdown, no explanations.
    `.trim(),
    context: (ctx) => ({ inputSes: session.inputSes }),
    model: Models.SWIZZY_DEFAULT,
    update: async (result, ctx, actions) => {
      let cleaned = decodeHtmlEntities(result);
      cleaned = cleanupGeneratedCode(cleaned);
      session.setupCode = cleaned;
      console.log('✅ Architecture Generated\n');
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 3: PARSE & BUNGEE ANCHOR
  // -----------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'parse_steps',
    instruction: '',
    update: async (result, ctx, actions) => {

      // RETURN HANDLER
      const allStepsCompiled = session.stepList && 
        session.stepList.every((_, i) => ctx[`code_step_${i + 1}`]);
      
      if (allStepsCompiled) {
        console.log('✅ All Steps Compiled\n');
        return actions.goto('assemble_file');
      }

      // LAUNCH: Parse steps
      const splitRegex = /(?:^|\n)(?:#+\s*)?Step\s+\d+(?:[:.]\s*|\s+)/i;
      const rawSteps = session.inputSes.split(splitRegex).slice(1);

      if (rawSteps.length === 0) {
        throw new Error("No steps found in SES");
      }

      session.stepList = rawSteps.map((s, i) => ({
        index: i + 1,
        content: `Step ${i + 1}\n${s.trim()}`
      }));

      console.log(`🚀 Compiling ${session.stepList.length} steps in parallel...\n`);

      return actions.bungee.init()
        .batch(
          'gen_step_code',
          session.stepList.length,
          (i) => ({
            stepData: session.stepList[i],
            setupCode: session.setupCode,
            documentation: WIZARD_DOCS
          })
        )
        .config({ concurrency: 5 })
        .jump();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 4: GENERATE STEP CODE (Worker)
  // -----------------------------------------------------------------------
  wizard.addTextStep({
    id: 'gen_step_code',
    instruction: `
Generate TypeScript code for this step.

Documentation:
{{documentation}}

Context Variables Available:
{{contextCode}}

Step to Generate:
{{stepContent}}

Rules:
1. If Actor is AI use wizard.addTextStep
2. If Actor is System use wizard.addComputeStep with instruction: ''
3. Define context function mapping global to local variables
4. Return ONLY the wizard.addXXXStep code, no markdown, no explanations

Return the code.
    `.trim(),
    context: (ctx) => ({
      documentation: ctx.documentation,
      contextCode: ctx.setupCode,
      stepContent: ctx.stepData.content
    }),
    model: Models.SWIZZY_DEFAULT,
    update: async (result, ctx, actions) => {
      let cleaned = decodeHtmlEntities(result);
      cleaned = cleanupGeneratedCode(cleaned);

      actions.updateContext({ 
        [`code_step_${ctx.stepData.index}`]: cleaned 
      });
      
      console.log(`⚡ Step ${ctx.stepData.index} compiled`);
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 5: ASSEMBLE MODULE
  // -----------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'assemble_file',
    instruction: '',
    update: async (result, ctx, actions) => {
      const header = `/** GENERATED WIZARD */\nimport { Wizard, Models } from '@swizzy_ai/kit';\n`;
      const setup = session.setupCode + '\n';
      const factoryStart = `\nexport function createWizard(runtimeState = {}) {\n  const wizard = new Wizard({ id: WIZARD_ID });\n\n`;

      let stepsCode = '';
      for (let i = 1; i <= session.stepList.length; i++) {
        const rawStep = ctx[`code_step_${i}`];
        if (!rawStep) continue;
        const indented = rawStep.split('\n').map(line => '  ' + line).join('\n');
        stepsCode += `  // Step ${i}\n${indented}\n\n`;
      }

      const factoryEnd = `  wizard.setContext({ ...DEFAULT_CONTEXT, ...runtimeState });\n  return wizard;\n}`;

      session.fullSource = header + setup + factoryStart + stepsCode + factoryEnd;

      console.log('📦 Module Assembled\n');
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 6: VALIDATE CODE
  // -----------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'validate_code',
    instruction: '',
    update: async (result, ctx, actions) => {
      console.log('🔍 Running Validation...\n');
      
      let allPassed = true;
      for (const rule of VALIDATION_RULES) {
        const passed = rule.check(session.fullSource);
        const status = passed ? '✅' : '❌';
        console.log(`${status} ${rule.name}`);
        if (!passed) {
          console.log(`   → ${rule.description}`);
          allPassed = false;
        }
      }
      
      if (!allPassed) {
        console.log('\n❌ Validation Failed\n');
        console.log('Generated Code:');
        console.log('─'.repeat(80));
        console.log(session.fullSource);
        console.log('─'.repeat(80));
        return actions.stop();
      }
      
      console.log('\n✨ All Validations Passed!\n');
      console.log('═'.repeat(80));
      console.log('FINAL CODE:');
      console.log('═'.repeat(80));
      console.log(session.fullSource);
      console.log('═'.repeat(80));
      
      return actions.stop();
    }
  });

  await wizard.run();
}

runWizard().catch(console.error);