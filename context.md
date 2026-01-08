const fs = require('fs').promises;
const path = require('path');
const { Wizard, Model, Models } = require('@swizzy/kit');
const { z } = require('zod');

// ============================================================================
// TEMPLATES
// ============================================================================

const TEMPLATES = {
  viteConfig: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})`,

  tsconfig: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}`,

  mainTsx: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`,

  appTsx: (name, description) => `function App() {
  return (
    <div>
      <h1>${name}</h1>
      <p>${description}</p>
    </div>
  )
}

export default App`,

  indexHtml: (name) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,

  packageJson: (name) => ({
    name: name.toLowerCase().replace(/\s+/g, '-'),
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview'
    },
    dependencies: {
      'react': '^18.2.0',
      'react-dom': '^18.2.0'
    },
    devDependencies: {
      '@types/react': '^18.2.43',
      '@types/react-dom': '^18.2.17',
      '@vitejs/plugin-react': '^4.2.1',
      'typescript': '^5.2.2',
      'vite': '^5.0.8'
    }
  })
};

// ============================================================================
// QUESTION STRUCTURE
// ============================================================================

const QUESTION_CATEGORIES = {
  foundation: {
    order: 1,
    questions: [
      {
        id: 'styling_foundation',
        question: 'What are the foundational styling files needed?',
        focusAreas: ['styling'],
        mustCreate: true,
        examples: [
          'theme.css with CSS custom properties',
          'global.css with reset and base styles',
          'variables.css with design tokens'
        ],
        requiredContext: ['styling plan color system', 'spacing system', 'typography']
      },
      {
        id: 'config_foundation',
        question: 'What configuration files are required for the build system and tooling?',
        focusAreas: ['dependencies', 'architecture'],
        mustCreate: true,
        examples: [
          'tailwind.config.js if using Tailwind',
          'postcss.config.js for CSS processing',
          '.eslintrc for linting rules'
        ],
        requiredContext: ['dependencies plan styling approach', 'development tools']
      }
    ]
  },

  coreComponents: {
    order: 2,
    questions: [
      {
        id: 'ui_primitives',
        question: 'What primitive/atomic UI components are needed based on the design system?',
        focusAreas: ['styling', 'features', 'architecture'],
        mustCreate: true,
        examples: [
          'Button component with all variants',
          'Input component with validation states',
          'Card/Container components'
        ],
        requiredContext: ['styling component guidelines', 'features core interactions', 'architecture reusable components']
      },
      {
        id: 'feature_components',
        question: 'What feature-specific components implement the core functionality?',
        focusAreas: ['features', 'architecture'],
        mustCreate: true,
        examples: [
          'Calculator display component',
          'Keypad component',
          'History display component'
        ],
        requiredContext: ['features UI components', 'architecture component organization']
      }
    ]
  },

  stateAndLogic: {
    order: 3,
    questions: [
      {
        id: 'state_management',
        question: 'What state management files (contexts, reducers, hooks) are needed?',
        focusAreas: ['architecture', 'features'],
        mustCreate: true,
        examples: [
          'CalculatorContext.tsx for global state',
          'useCalculator.ts custom hook',
          'calculatorReducer.ts for state logic'
        ],
        requiredContext: ['architecture state architecture', 'features data management']
      },
      {
        id: 'business_logic',
        question: 'What utility/helper files contain the core business logic?',
        focusAreas: ['features', 'architecture'],
        mustCreate: true,
        examples: [
          'calculate.ts with arithmetic functions',
          'validators.ts for input validation',
          'formatters.ts for display formatting'
        ],
        requiredContext: ['features data validation', 'architecture code organization']
      }
    ]
  },

  integration: {
    order: 4,
    questions: [
      {
        id: 'layout_composition',
        question: 'What layout and page composition files are needed?',
        focusAreas: ['architecture', 'features', 'styling'],
        mustCreate: true,
        examples: [
          'Layout.tsx wrapper component',
          'pages/Calculator.tsx main page',
          'pages/History.tsx if routing exists'
        ],
        requiredContext: ['architecture component organization', 'features navigation patterns']
      },
      {
        id: 'app_integration',
        question: 'What changes are needed to integrate everything into App.tsx?',
        focusAreas: ['architecture', 'dependencies'],
        mustCreate: false, // This might be ADD_TO_FILE
        examples: [
          'Import and wrap with providers',
          'Set up routing structure',
          'Apply global styles'
        ],
        requiredContext: ['architecture state architecture', 'dependencies routing']
      }
    ]
  },

  polish: {
    order: 5,
    questions: [
      {
        id: 'accessibility',
        question: 'What accessibility enhancements are missing?',
        focusAreas: ['features'],
        mustCreate: false,
        examples: [
          'aria-labels in components',
          'keyboard navigation hooks',
          'focus management utilities'
        ],
        requiredContext: ['features accessibility features']
      },
      {
        id: 'error_handling',
        question: 'What error handling and edge case files are needed?',
        focusAreas: ['features', 'architecture'],
        mustCreate: false,
        examples: [
          'ErrorBoundary.tsx component',
          'error.ts error classes/handlers',
          'toast/notification system'
        ],
        requiredContext: ['features error handling', 'architecture error handling strategy']
      }
    ]
  }
};

// Flatten into sequential array
const QUESTIONS = Object.values(QUESTION_CATEGORIES)
  .sort((a, b) => a.order - b.order)
  .flatMap(category => category.questions);

const PLANNING_ASPECTS = ['styling', 'features', 'dependencies', 'architecture'];

// ============================================================================
// UTILITIES
// ============================================================================

async function createDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function createFile(basePath, filePath, content) {
  const fullPath = path.join(basePath, filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}

async function appendToFile(basePath, filePath, content) {
  const fullPath = path.join(basePath, filePath);
  await fs.appendFile(fullPath, '\n' + content, 'utf8');
}

async function getFileTree(dir) {
  const walk = async (currentDir, prefix = '') => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    let tree = '';
    for (const entry of entries) {
      tree += prefix + '├─ ' + entry.name + '\n';
      if (entry.isDirectory()) {
        tree += await walk(path.join(currentDir, entry.name), prefix + '│  ');
      }
    }
    return tree;
  };
  return walk(dir);
}

function resolveFilePath(basePath, relativePath) {
  return path.join(basePath, relativePath);
}

function getAspectInstruction(aspect) {
  const instructions = {
    styling: `INSTRUCTION: Plan the styling and visual design system for this web application.

REQUIRED MARKDOWN STRUCTURE:
# Styling Planning

## Color System
- Primary colors and their usage
- Secondary/accent colors
- Neutral colors (grays, whites, blacks)
- Semantic colors (success, warning, error, info)

## Typography
- Font families to use
- Font sizes scale (heading sizes, body text, captions)
- Font weights available
- Line heights and letter spacing

## Spacing System
- Base spacing unit
- Spacing scale (4px, 8px, 16px, 24px, 32px, etc.)
- How spacing is applied to components

## Component Styling Guidelines
- Button variants and states
- Form input styling
- Card and container styling
- Navigation and layout styling

## Responsive Design
- Breakpoints for different screen sizes
- How components adapt to different screens
- Mobile-first or desktop-first approach

## Theme System
- Light/dark mode support
- How themes are implemented
- Customizable theme options

## Design Tokens
- CSS custom properties for colors, spacing, typography
- How design tokens are organized and used`,

    features: `INSTRUCTION: Plan the features and functionality for this web application.

REQUIRED MARKDOWN STRUCTURE:
# Features Planning

## Core User Interactions
- Primary actions users can take
- How users interact with the main functionality
- User workflows and journeys

## Data Management
- What data needs to be displayed
- What data needs to be collected from users
- How data flows through the application
- Data validation requirements

## User Interface Components
- What UI components are needed
- How components interact with each other
- Component state management
- Component communication patterns

## User Experience Flow
- Step-by-step user journeys
- Error handling and edge cases
- Loading states and feedback
- Navigation patterns

## Accessibility Features
- Keyboard navigation support
- Screen reader compatibility
- Color contrast requirements
- Focus management

## Performance Considerations
- Loading speed requirements
- Bundle size optimization
- Runtime performance needs`,

    dependencies: `INSTRUCTION: Plan the technical dependencies and libraries for this web application.

REQUIRED MARKDOWN STRUCTURE:
# Dependencies Planning

## Core Framework
- React version and setup
- Build tools (Vite, Webpack, etc.)
- TypeScript configuration

## UI Component Library
- Which component library to use
- Version and compatibility
- Customization approach

## State Management
- State management solution needed
- Complexity level required
- Data flow patterns

## Routing
- Routing library selection
- Route structure planning
- Navigation guards and middleware

## Data Fetching
- HTTP client library
- API integration approach
- Caching strategy

## Form Handling
- Form library selection
- Validation approach
- Complex form requirements

## Styling Approach
- CSS framework or library
- Styling methodology (CSS modules, styled-components, etc.)
- Theme system implementation

## Development Tools
- Linters and formatters
- Testing framework
- Development server setup

## Build and Deployment
- Build optimization tools
- Deployment platform
- CI/CD requirements`,

    architecture: `INSTRUCTION: Plan the application architecture and code organization for this web application.

REQUIRED MARKDOWN STRUCTURE:
# Architecture Planning

## Component Organization
- How components are structured
- Component composition patterns
- Reusable component strategy

## File Structure
- Folder organization
- File naming conventions
- Import/export patterns

## State Architecture
- Global state management
- Local component state
- State synchronization

## Data Flow
- Data flow patterns
- Props drilling solutions
- Context usage

## Code Splitting
- Bundle splitting strategy
- Lazy loading implementation
- Performance optimization

## Scalability Considerations
- How the app will grow
- Modular architecture
- Future feature integration

## Code Quality
- TypeScript usage patterns
- Error handling strategy
- Code organization principles

## Performance Architecture
- Rendering optimization
- Memory management
- Bundle size management`
  };

  return instructions[aspect] || `INSTRUCTION: Plan the ${aspect} aspect for this web application.

REQUIRED MARKDOWN STRUCTURE:
# ${aspect} Planning

## Key Requirements
- List the main requirements for this aspect

## Implementation Approach
- How this aspect should be implemented

## Integration Points
- How this connects with other aspects`;
}

function parseActionSheets(actionSheetsText, outputPath) {
  const operations = [];
  const sheets = actionSheetsText.split(/ACTION_SHEET_\d+:/).slice(1); // Split and remove first empty element

  for (const sheet of sheets) {
    const trimmed = sheet.trim();
    if (!trimmed) continue;

    // Extract ACTION, FILE, INSTRUCTION from the code block
    const actionMatch = trimmed.match(/ACTION:\s*(.+)/i);
    const fileMatch = trimmed.match(/FILE:\s*(.+)/i);
    const instructionMatch = trimmed.match(/INSTRUCTION:\s*(.+)/i);

    if (actionMatch && fileMatch && instructionMatch) {
      let filePath = fileMatch[1].trim();

      // Prepend outputPath if not already absolute
      if (!path.isAbsolute(filePath)) {
        filePath = path.join(outputPath, filePath);
      }

      operations.push({
        action: actionMatch[1].trim(),
        file: filePath,
        instruction: instructionMatch[1].trim()
      });
    }
  }

  return operations;
}

// ============================================================================
// MAIN WIZARD FACTORY
// ============================================================================

function createUIGeneratorWizard() {
  const wizard = new Wizard({
    id: 'ui-generator-wizard',
    logging: true,
    onUsage: (usage, provider) => {
      console.log(`📊 ${provider}: ${usage.totalTokens} tokens`);
    }
  });

  // ============================================================================
  // STEP 1: PARALLEL_PLANNING
  // ============================================================================

  wizard.addComputeStep({
    id: 'parallel_planning',
    update: (result, context, actions) => {
      // Check if planning is already complete
      const hasPlanning = PLANNING_ASPECTS.every(aspect => context[`plan_${aspect}`]);

      if (hasPlanning) {
        console.log('📋 Planning already complete, proceeding...');
        return actions.next();
      }

      console.log('📋 Planning project...');
      return actions.bungee.init()
        .batch('plan_aspect', 4, (index) => ({
          aspect: PLANNING_ASPECTS[index],
          userRequest: context.userRequest,
          aspectInstruction: getAspectInstruction(PLANNING_ASPECTS[index])
        }))
        .config({
          concurrency: 4,
          returnToAnchor: true  // Allow re-planning if needed
        })
        .onComplete((wizard) => {
          const ctx = wizard.getContext();
          const hasPlanning = PLANNING_ASPECTS.every(aspect => ctx[`plan_${aspect}`]);
          if (hasPlanning) {
            return wizard.goto('init_project');
          } else {
            return wizard.retry();
          }
        })
        .jump();
    }
  });

  wizard.addTextStep({
    id: 'plan_aspect',
    model: Models.SWIZZY_DEFAULT,

    instruction: `Given web request: "{{userRequest}}"

Plan the content for the aspect: {{aspect}}

{{aspectInstruction}}

Return the planning as a markdown document following the exact structure specified in the instruction.

YOU MUST NOT PROVIDE ANY GENERIC PIECE OF INFORMATION - be specific to the "{{userRequest}}" project.`,
    update: (data, ctx, actions) => {
      actions.updateContext({ [`plan_${ctx.aspect}`]: data });
      return actions.next();
    }
  });

  // ============================================================================
  // STEP 2: INIT_PROJECT
  // ============================================================================

  wizard.addComputeStep({
    id: 'init_project',
    update: async (result, context, actions) => {
      console.log('📦 Initializing project...');

      const projectName = 'generated-app';
      const outputPath = path.join(process.cwd(), 'projects', projectName);

      await createDirectory(outputPath);
      await createDirectory(path.join(outputPath, 'src'));
      await createDirectory(path.join(outputPath, 'public'));

      await createFile(outputPath, 'package.json', JSON.stringify(TEMPLATES.packageJson(projectName), null, 2));
      await createFile(outputPath, 'vite.config.ts', TEMPLATES.viteConfig);
      await createFile(outputPath, 'index.html', TEMPLATES.indexHtml(projectName));
      await createFile(outputPath, 'tsconfig.json', TEMPLATES.tsconfig);
      await createFile(outputPath, 'src/main.tsx', TEMPLATES.mainTsx);
      await createFile(outputPath, 'src/App.tsx', TEMPLATES.appTsx(projectName, context.userRequest));

      const fileTree = await getFileTree(outputPath);

      actions.updateContext({
        outputPath,
        projectName,
        fullPlan: {
          styling: context.plan_styling || 'No styling plan available',
          features: context.plan_features || 'No features plan available',
          dependencies: context.plan_dependencies || 'No dependencies plan available',
          architecture: context.plan_architecture || 'No architecture plan available'
        },
        currentFiles: fileTree,
        createdFiles: ['package.json', 'vite.config.ts', 'index.html', 'tsconfig.json', 'src/main.tsx', 'src/App.tsx'],
        currentQuestionIndex: 0,
        roundNumber: 1
      });

      console.log('✓ Project initialized');
      return actions.next();
    }
  });

  // ============================================================================
  // STEP 3: ASSESS_QUESTION
  // ============================================================================

  wizard.addTextStep({
    id: 'assess_question',
    model: Models.SWIZZY_DEFAULT,
    instruction: `You are building: "{{userRequest}}"

CURRENT FILE TREE:
{{fileStructure}}

FILES ALREADY CREATED:
{{createdFiles}}

=== QUESTION {{questionNumber}}/{{totalQuestions}} ===
CATEGORY: {{questionCategory}}
FOCUS: {{questionFocus}}

{{currentQuestion}}

MUST CREATE FILES: {{mustCreate}}

EXAMPLES OF WHAT TO CREATE:
{{examples}}

RELEVANT PLANNING CONTEXT:
{{relevantPlanContext}}

=== YOUR TASK ===
Analyze the planning context and current files. Create 3 ACTION_SHEETS for missing files that implement the plans.

{{mustCreateWarning}}

WHAT IS AN ACTION SHEET?
An ACTION_SHEET is a specification for creating or modifying a file. It contains:
- ACTION: Either "CREATE" (for new files) or "ADD_TO_FILE" (for modifying existing files)
- FILE: The full path to the file
- INSTRUCTION: Detailed description of what to implement, referencing specific plan details

Each ACTION_SHEET must:
1. Reference specific details from the planning context
2. Use concrete values (colors, spacing, component names) from the plans
3. Be essential to implementing the described functionality

FORMAT (exactly 3 action sheets):

ACTION_SHEET_1:
\`\`\`
ACTION: CREATE
FILE: src/path/to/file.tsx
INSTRUCTION: [Detailed instruction referencing specific plan details. Example: "Based on the styling plan's color system (primary: #3498db, secondary: #f1c40f) and spacing scale (8px base unit), create a Button component with..."]
\`\`\`

ACTION_SHEET_2:
\`\`\`
ACTION: CREATE
FILE: src/path/to/file.tsx
INSTRUCTION: [Detailed instruction...]
\`\`\`

ACTION_SHEET_3:
\`\`\`
ACTION: CREATE
FILE: src/path/to/file.tsx
INSTRUCTION: [Detailed instruction...]
\`\`\`

Respond with N if you think there are no files to create for this question.`,
    context: (ctx) => {
      const currentQ = QUESTIONS[ctx.currentQuestionIndex];

      // Get relevant plan sections
      const relevantSections = currentQ.focusAreas.map(area => {
        return `${area.toUpperCase()} PLAN:\n${ctx.fullPlan[area] || 'No plan available'}`;
      }).join('\n\n');

      // Extract specific context from plans
      let specificContext = relevantSections;
      const hasRequiredContext = currentQ.requiredContext && currentQ.requiredContext.length > 0;
      const contextDetails = hasRequiredContext
        ? `\n\nKEY DETAILS TO REFERENCE:\n${currentQ.requiredContext.map(detail => `- ${detail}`).join('\n')}`
        : '';
      specificContext += contextDetails;

      // Determine category name
      const categoryEntry = Object.entries(QUESTION_CATEGORIES).find(([name, cat]) =>
        cat.questions.some(q => q.id === currentQ.id)
      );
      const categoryName = categoryEntry ? categoryEntry[0] : 'general';

      // Must create warning
      const mustCreateWarning = currentQ.mustCreate
        ? '⚠️ This is a MUST CREATE category - you should only respond N/A if ALL required files already exist.'
        : '';

      return {
        fileStructure: ctx.currentFiles,
        createdFiles: ctx.createdFiles.join('\n'),
        questionNumber: ctx.currentQuestionIndex + 1,
        totalQuestions: QUESTIONS.length,
        questionCategory: categoryName.toUpperCase(),
        questionFocus: currentQ.focusAreas.join(', '),
        currentQuestion: currentQ.question,
        mustCreate: currentQ.mustCreate ? 'YES' : 'NO',
        examples: currentQ.examples.map((ex, i) => `${i + 1}. ${ex}`).join('\n'),
        relevantPlanContext: specificContext,
        outputPath: ctx.outputPath,
        mustCreateWarning: mustCreateWarning
      };
    },
    update: (data, ctx, actions) => {
      actions.updateContext({ [`q${ctx.currentQuestionIndex}_result`]: data });

      const isNone = data.trim() === 'N';
      const nextIndex = ctx.currentQuestionIndex + 1;
      const hasMoreQuestions = nextIndex < QUESTIONS.length;

      const operations = isNone ? [] : parseActionSheets(data, ctx.outputPath);
      console.log("operations ===>", operations)
      const hasOperations = operations.length > 0;

      const shouldContinueQuestions = hasMoreQuestions;
      const shouldVerify = hasOperations;
      const shouldComplete = !hasMoreQuestions;

      const nextStep = shouldVerify
        ? 'verify_action_sheet'
        : shouldContinueQuestions
          ? 'assess_question'
          : 'evaluate_completion';

      const contextUpdates = shouldVerify
        ? { currentOperations: operations }
        : shouldContinueQuestions
          ? { currentQuestionIndex: nextIndex }
          : {};

      actions.updateContext(contextUpdates);
      return actions.goto(nextStep);
    }
  });

  // ============================================================================
  // STEP 4: VERIFY_ACTION_SHEET
  // ============================================================================

  wizard.addStep({
    id: 'verify_action_sheet',
    model: Models.SWIZZY_DEFAULT,

    instruction: `Verify operations:

{{operations}}

FILE TREE:
{{fileTree}}

For each: Y or N`,
    schema: z.object({
      operation1: z.enum(['Y', 'N']),
      operation2: z.enum(['Y', 'N']),
      operation3: z.enum(['Y', 'N'])
    }),
    context: (ctx) => ({
      operations: ctx.currentOperations.map((op, i) => `${i + 1}. ${op.action} ${op.file}\n   ${op.instruction}`).join('\n\n'),
      fileTree: ctx.currentFiles
    }),
    update: (data, ctx, actions) => {
      const failures = [data.operation1, data.operation2, data.operation3].filter(v => v === 'N').length;

      if (failures > 0) {
        console.log(`⚠️ ${failures} rejected, regenerating`);
        return actions.goto('assess_question');
      }

      return actions.next();
    }
  });

  // ============================================================================
  // STEP 5: GENERATE_CODE
  // ============================================================================

  wizard.addComputeStep({
    id: 'generate_code',
    update: (result, context, actions) => {
      console.log('🔧 Generating code for operations...');

      return actions.bungee.init()
        .batch('generate_operation_code', context.currentOperations.length, (index) => {
          const op = context.currentOperations[index];
          console.log("bungeed operation", index, op)
          return {
            operation_action: op.action,
            operation_file: op.file,
            operation_instruction: op.instruction,
            index: index
          };
        })
        .config({
          concurrency: 3
        })
        .onComplete((wizard) => {
          const ctx = wizard.getContext();
          const generatedCode = [];
          for (let i = 0; i < context.currentOperations.length; i++) {
            const code = ctx[`generated_code_${i}`];
            if (code) {
              generatedCode.push({
                file: context.currentOperations[i].file,
                code: code,
                action: context.currentOperations[i].action
              });
            }
          }
          wizard.updateContext({ generatedCode });
          return wizard.next();
        })
        .jump();
    }
  });

  wizard.addTextStep({
    id: 'generate_operation_code',
    model: Models.SWIZZY_DEFAULT,
    instruction: `You are generating production-ready code for a calculator app.

OPERATION DETAILS:
Action: {{operation.action}}
File: {{operation.file}}
Instruction: {{operation.instruction}}

CONTEXT YOU MUST USE:
{{relevantContext}}

CRITICAL REQUIREMENTS:
1. Generate COMPLETE, WORKING code - not stubs or placeholders
2. Follow React best practices and TypeScript strict mode
3. Use proper imports from the project structure
4. Match the styling plan exactly (colors, spacing from theme.css)
5. Integrate with existing context/state management
6. Include proper error handling
7. Add accessibility attributes (aria-labels, roles)
8. Use semantic HTML

FILE STRUCTURE FOR IMPORTS:
{{fileStructure}}

CREATED FILES:
{{createdFiles}}

EXISTING CODE TO INTEGRATE WITH:
{{existingRelevantCode}}

EXAMPLE OUTPUT for a Display component:
\`\`\`typescript
import React from 'react';
import { useCalculator } from '../contexts/CalculatorContext';

const Display: React.FC = () => {
  const { state } = useCalculator();

  return (
    <div
      className="display"
      role="textbox"
      aria-label="Calculator display"
      aria-live="polite"
    >
      {state.display || '0'}
    </div>
  );
};

export default Display;
\`\`\`

Now generate code for: {{operation.file}}
Return ONLY the complete code content - no explanations, no markdown, no preamble.`,
    context: (ctx) => {
      const op = {
        action: ctx.operation_action,
        file: ctx.operation_file,
        instruction: ctx.operation_instruction
      };

      console.log("operation ctx", ctx)

      // Extract relevant context based on the file being generated
      let relevantContext = '';
      if (op.file.includes('components')) {
        relevantContext = `
STYLING CONTEXT:
${ctx.fullPlan.styling}

COMPONENT GUIDELINES:
${ctx.fullPlan.architecture}
`;
      } else if (op.file.includes('contexts') || op.file.includes('reducers')) {
        relevantContext = `
STATE MANAGEMENT PLAN:
${ctx.fullPlan.architecture}

FEATURES REQUIRING STATE:
${ctx.fullPlan.features}
`;
      } else if (op.file.includes('utils')) {
        relevantContext = `
BUSINESS LOGIC REQUIREMENTS:
${ctx.fullPlan.features}
`;
      }

      // Get existing code that this file should integrate with
      let existingRelevantCode = '';
      if (op.file.includes('Keypad') && ctx.generatedCode) {
        const contextCode = ctx.generatedCode.find(c =>
          c.file.includes('CalculatorContext')
        );
        if (contextCode) {
          existingRelevantCode = `CALCULATOR CONTEXT:\n${contextCode.code}`;
        }
      }

      return {
        operation: op,
        relevantContext,
        fileStructure: ctx.currentFiles,
        createdFiles: ctx.createdFiles.join('\n'),
        existingRelevantCode
      };
    },
    update: (data, ctx, actions) => {
      actions.updateContext({ [`generated_code_${ctx.index}`]: data });
      return actions.next();
    }
  });

  // ============================================================================
  // STEP 5.5: VERIFY_GENERATED_CODE
  // ============================================================================

  wizard.addStep({
    id: 'verify_generated_code',
    model: Models.SWIZZY_DEFAULT,
    instruction: `Review this generated code for quality:

FILE: {{file}}
CODE:
{{code}}

Check for:
1. No placeholder comments or TODOs
2. Proper TypeScript types
3. Correct imports
4. Integration with context/state
5. Follows the styling plan
6. Has error handling

Respond with:
- "PASS" if code is production-ready
- "FAIL: [reason]" if issues found`,

    schema: z.object({
      status: z.enum(['PASS', 'FAIL']),
      reason: z.string().optional()
    }),

    context: (ctx) => ({
      file: ctx.currentFile,
      code: ctx.currentCode
    }),

    update: (data, ctx, actions) => {
      if (data.status === 'FAIL') {
        console.log(`⚠️ Code quality issue: ${data.reason}`);
        // Regenerate this specific file
        return actions.goto('generate_operation_code');
      }
      return actions.next();
    }
  });

  // ============================================================================
  // STEP 6: EXECUTE_OPERATIONS
  // ============================================================================

  wizard.addComputeStep({
    id: 'execute_operations',
    model: Models.SWIZZY_DEFAULT,

    update: async (result, context, actions) => {
      console.log('🔨 Executing operations...');

      for (const op of context.generatedCode) {
        const relativePath = op.file.replace(context.outputPath + '/', '');

        if (op.action === 'CREATE') {
          await createFile(context.outputPath, relativePath, op.code);
          console.log(`  ✓ Created ${relativePath}`);
        } else if (op.action === 'ADD_TO_FILE') {
          await appendToFile(context.outputPath, relativePath, op.code);
          console.log(`  ✓ Added to ${relativePath}`);
        }
        context.createdFiles.push(relativePath);
      }

      const fileTree = await getFileTree(context.outputPath);
      actions.updateContext({ currentFiles: fileTree });

      const nextIndex = context.currentQuestionIndex + 1;
      if (nextIndex < QUESTIONS.length) {
        actions.updateContext({ currentQuestionIndex: nextIndex });
        return actions.goto('assess_question');
      }

      return actions.goto('evaluate_completion');
    }
  });

  // ============================================================================
  // STEP 7: EVALUATE_COMPLETION
  // ============================================================================

  wizard.addStep({
    id: 'evaluate_completion',
    model: Models.SWIZZY_DEFAULT,
    instruction: `Is project complete?

FILE TREE:
{{fileTree}}

BUILD PLAN:
{{buildInstructions}}

ROUND: {{roundNumber}}`,
    schema: z.object({
      complete: z.boolean(),
      reasoning: z.string()
    }),
    context: (ctx) => ({
      fileTree: ctx.currentFiles,
      buildInstructions: JSON.stringify(ctx.fullPlan, null, 2),
      roundNumber: ctx.roundNumber
    }),
    update: (data, ctx, actions) => {
      if (data.complete) {
        console.log('✅ Complete!');
        return actions.goto('save_manifest');
      }

      console.log(`🔄 Round ${ctx.roundNumber + 1}`);
      actions.updateContext({ currentQuestionIndex: 0, roundNumber: ctx.roundNumber + 1 });
      return actions.goto('assess_question');
    }
  });

  // ============================================================================
  // STEP 8: SAVE_MANIFEST
  // ============================================================================

  wizard.addComputeStep({
    id: 'save_manifest',
    update: async (result, context, actions) => {
      const manifest = {
        projectName: context.projectName,
        createdAt: new Date().toISOString(),
        rounds: context.roundNumber,
        plan: context.fullPlan,
        files: context.createdFiles
      };

      await createFile(context.outputPath, '.wizard-manifest.json', JSON.stringify(manifest, null, 2));
      console.log('💾 Saved manifest');

      return actions.stop();
    }
  });

  return wizard;
}

module.exports = { createUIGeneratorWizard };