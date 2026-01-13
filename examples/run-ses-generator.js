require('dotenv').config();
const { Wizard, Models } = require('@swizzy/kit');

// ============================================================================
// CONFIGURATION & INPUTS
// ============================================================================

// Pre-defined design questions (we do not generate these, we feed them in)
const DESIGN_QUESTIONS = [
  "Who are the specific Actors (System vs AI) and what are their responsibilities?",
  "What is the exact data structure of the inputs and outputs?",
  "What are the critical 'Red Flags' that should cause the process to stop immediately?",
  "Does this require parallel processing (Bungee Pattern) or a linear flow?"
];

// Helper to parse JSON from LLM output safely
function parseJsonSafe(text) {
  try {
    const jsonMatch = text.match(/\[.*\]/s) || text.match(/{.*}/s);
    const cleaned = jsonMatch ? jsonMatch[0] : text;
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse Error:", text.substring(0, 100) + "...");
    return null;
  }
}

// ============================================================================
// MAIN WIZARD
// ============================================================================

async function runSesArchitect() {
  const wizard = new Wizard({ id: 'ses-architect' });

  // Input Data
  const userGoal = "I want a tool that can rephrase generate a shakespare poem"
  console.log('🏗️  Station Architect Initialized');
  console.log(`🎯 User Goal: "${userGoal}"\n`);

  // -----------------------------------------------------------------------
  // STEP 1: VALIDATE INTENT
  // -----------------------------------------------------------------------
  wizard.addTextStep({
    id: 'validate_intent',
    instruction: `
You are a Senior Product Manager evaluating a user request for a Station (deterministic AI workflow).

USER REQUEST: "{{theUserGoal}}"

EVALUATE VALIDITY:
- Can this be solved with a deterministic workflow (not open-ended conversation)?
- Does it have clear inputs and outputs?
- Is it a practical, solvable problem?
- Does it fit the Station model (input → process → output)?

VALID REQUESTS EXAMPLES:
✅ "Extract action items from meeting transcripts"
✅ "Generate code documentation from source files"
✅ "Summarize legal contracts into key terms"
✅ "Convert CSV data to structured JSON"

INVALID REQUESTS EXAMPLES:
❌ "Help me with my homework" (too vague)
❌ "Write a novel" (creative, not deterministic)
❌ "Chat about life" (conversational)

RESPONSE: Return only "VALID" or "INVALID - [brief reason]"
    `,
    context: (ctx) => ({ theUserGoal: ctx.theUserGoal }),
    model: Models.SWIZZY_DEFAULT,
    update: async (result, ctx, actions) => {
      if (result.includes('INVALID')) {
        console.log('❌ Invalid Request');
        return actions.stop();
      }
      console.log('✅ Intent Validated');
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 2: DESIGN DEEP DIVE (BUNGEE ANCHOR)
  // -----------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'design_anchor',
    instruction: '',
    update: async (result, ctx, actions) => {
      
      // Check if all questions have been answered
      const allAnswered = ctx.theDesignQuestions.every((_, i) => ctx[`design_answer_${i}`]);

      if (allAnswered) {
        // Aggregate answers into notes
        let notes = "";
        ctx.theDesignQuestions.forEach((q, i) => {
          notes += `Q: ${q}\nA: ${ctx[`design_answer_${i}`]}\n---\n`;
        });
        actions.updateContext({ theDesignNotes: notes });
        console.log('📘 Design Notes Aggregated');
        return actions.goto('define_inventory');
      }

      console.log('🧠 Launching Design Deep Dive...');
      
      // Launch Workers
      return actions.bungee.init()
        .batch(
          'answer_question',
          ctx.theDesignQuestions.length,
          (index) => ({
            question: ctx.theDesignQuestions[index],
            index: index
          })
        )
        .jump();
    }
  });

  // Worker: Answer Question
  wizard.addTextStep({
    id: 'answer_question',
    instruction: `
      You are a Senior Architect.
      User Goal: "{{theUserGoal}}"
      Question: "{{question}}"

      Provide a strict technical answer to this question to help build the specification.
    `,
    context: (ctx) => ({ 
      theUserGoal: ctx.theUserGoal,
      question: ctx.question 
    }),
    model: Models.SWIZZY_DEFAULT,
    update: async (result, ctx, actions) => {
      actions.updateContext({ [`design_answer_${ctx.index}`]: result });
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 3: DEFINE INFORMATION INVENTORY (SEPARATE SECTION)
  // -----------------------------------------------------------------------
  wizard.addTextStep({
    id: 'define_inventory',
    instruction: `
      Based on the Goal and Design Notes, define the "Information Inventory".
      
      Goal: {{theUserGoal}}
      Notes: {{theDesignNotes}}

      Rules:
      1. Create a Bulleted List of every global variable needed.
      2. Format: * **[Friendly Name]**: [Description]
      3. Include inputs, intermediate processing states, and final outputs.

      Return ONLY the Markdown list.
    `,
    context: (ctx) => ({
      theUserGoal: ctx.theUserGoal,
      theDesignNotes: ctx.theDesignNotes
    }),
    model: Models.SWIZZY_DEFAULT,
    update: async (result, ctx, actions) => {
      actions.updateContext({ theInventorySection: result });
      console.log('📦 Information Inventory Defined');
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 4: GENERATE STEP OUTLINE (SCHEMA)
  // -----------------------------------------------------------------------
  wizard.addTextStep({
    id: 'generate_outline',
    instruction: `
      Create a structural outline of the workflow steps.

      Goal: {{theUserGoal}}
      Inventory: {{theInventorySection}}

      Return a JSON Array of objects.
      Schema: 
      [
        { "step_number": 1, "title": "Name", "intent": "One sentence on what it does" },
        ...
      ]

      Rules:
      1. Step 1 MUST be validation.
      2. Use logical flow (Linear or Loop).
      3. Do not write full details, just the schema.
    `,
    context: (ctx) => ({
      theUserGoal: ctx.theUserGoal,
      theInventorySection: ctx.theInventorySection
    }),
    model: Models.SWIZZY_DEFAULT,
    update: async (result, ctx, actions) => {
      const outline = parseJsonSafe(result);
      if (!outline || !Array.isArray(outline)) return actions.retry();

      actions.updateContext({ theStepSchema: outline });
      console.log(`📐 Outline Created (${outline.length} steps)`);
      return actions.goto('expand_steps_anchor');
    }
  });

  // -----------------------------------------------------------------------
  // STEP 5: EXPAND STEPS (BUNGEE ANCHOR)
  // -----------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'expand_steps_anchor',
    instruction: '',
    update: async (result, ctx, actions) => {
      
      // Check if all steps are generated
      const allStepsDone = ctx.theStepSchema.every((_, i) => ctx[`full_step_md_${i}`]);

      if (allStepsDone) {
        console.log('✅ All Steps Expanded');
        return actions.goto('assemble_document');
      }

      console.log('✍️  Writing Full Step Details (Parallel)...');

      return actions.bungee.init()
        .batch(
          'write_step_detail',
          ctx.theStepSchema.length,
          (index) => ({
            stepInfo: ctx.theStepSchema[index],
            inventory: ctx.theInventorySection,
            index: index
          })
        )
        .jump();
    }
  });

  // Worker: Write Full Markdown for ONE Step
  wizard.addTextStep({
    id: 'write_step_detail',
    instruction: `
      Write the SES Markdown for this specific step.

      Step Info: {{stepInfo}}
      Available Inventory:
      {{inventory}}

      Format:
      ### Step [Number]: [Name]
      **Actor**: [AI or System]
      **Reads**: [List variables from Inventory]
      **Does**: [Detailed instructions]
      **Updates**: [List variables updated]
      **Next Step**: [Flow control]

      Rules:
      1. Use "Actor: System" for saving/logic, "Actor: AI" for thinking/writing.
      2. Only use variables listed in Inventory.
      3. Return ONLY the Markdown for this step.
    `,
    context: (ctx) => ({
      stepInfo: JSON.stringify(ctx.stepInfo),
      inventory: ctx.inventory
    }),
    model: Models.SWIZZY_DEFAULT,
    update: async (result, ctx, actions) => {
      actions.updateContext({ [`full_step_md_${ctx.index}`]: result });
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 6: ASSEMBLE DOCUMENT
  // -----------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'assemble_document',
    instruction: '',
    update: async (result, ctx, actions) => {
      
      const header = `# Station: Generated Station\n\n`;
      const invHeader = `## Information Inventory\n${ctx.theInventorySection}\n\n---\n\n`;
      
      let stepsBody = "";
      // Loop through schema to ensure correct order (0, 1, 2...)
      for(let i=0; i < ctx.theStepSchema.length; i++) {
        stepsBody += ctx[`full_step_md_${i}`] + "\n\n";
      }

      const fullDocument = header + invHeader + stepsBody;
      
      actions.updateContext({ finalSes: fullDocument });
      console.log('🏁 Document Assembled');
      return actions.next();
    }
  });

  // -----------------------------------------------------------------------
  // STEP 7: FINAL OUTPUT
  // -----------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'print_result',
    instruction: '',
    update: async (result, ctx, actions) => {
      console.log('\n════════════════ FINAL SES ════════════════\n');
      console.log(ctx.finalSes);
      console.log('\n═══════════════════════════════════════════\n');
      return actions.stop();
    }
  });

  // ============================================================================
  // EXECUTION
  // ============================================================================
  
  // 1. Set the initial context
  wizard.setContext({
    theUserGoal: userGoal,
    theDesignQuestions: DESIGN_QUESTIONS
  });

  // 2. Run the wizard
  await wizard.run();
}

runSesArchitect().catch(console.error);