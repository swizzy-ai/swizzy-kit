const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const { Wizard, Model, Models } = require('@swizzy/kit');

// ============================================================================
// 1. STATIC TEMPLATES (The Rigid Skeleton)
// ============================================================================

const TEMPLATES = {
  packageJson: (name) => JSON.stringify({
    name: name,
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview' },
    dependencies: { 
      'react': '^18.2.0', 
      'react-dom': '^18.2.0',
      'react-router-dom': '^6.20.0',
      'lucide-react': '^0.300.0',
      'clsx': '^2.0.0',
      'tailwind-merge': '^2.0.0'
    },
    devDependencies: {
      '@types/react': '^18.2.43',
      '@types/react-dom': '^18.2.17',
      '@vitejs/plugin-react': '^4.2.1',
      'autoprefixer': '^10.4.16',
      'postcss': '^8.4.32',
      'tailwindcss': '^3.4.0',
      'typescript': '^5.2.2',
      'vite': '^5.0.8'
    }
  }, null, 2),

  viteConfig: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});`,

  tsconfig: JSON.stringify({
    compilerOptions: {
      target: "ES2020", useDefineForClassFields: true, lib: ["ES2020", "DOM", "DOM.Iterable"],
      module: "ESNext", skipLibCheck: true, moduleResolution: "bundler",
      allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true,
      noEmit: true, jsx: "react-jsx", strict: true, noUnusedLocals: true,
      noUnusedParameters: true, noFallthroughCasesInSwitch: true,
      baseUrl: ".", paths: { "@/*": ["src/*"] }
    },
    include: ["src"], references: [{ path: "./tsconfig.node.json" }]
  }, null, 2),

  indexHtml: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,

  mainTsx: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`
};

// ============================================================================
// 2. HELPERS
// ============================================================================

const BASE_OUTPUT_DIR = path.join(process.cwd(), 'output');

// Helper to generate generic names like path-skeleton-4921
function generateProjectName() {
  const timestamp = Math.floor(Math.random() * 100000);
  return `path-skeleton-${timestamp}`;
}

async function writeToProject(projectName, filePath, content) {
  if (!filePath || !content) return;
  // Clean up path to prevent traversal
  const safePath = filePath.replace(/^(\.\/|\/)/, ''); 
  const fullPath = path.join(BASE_OUTPUT_DIR, projectName, safePath);
  
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
  
  console.log(`   💾 Saved: ${safePath}`);
}

async function initBoilerplate(projectName) {
  console.log(`\n🏗️  Initializing Rigid Skeleton for ${projectName}...`);
  
  // 1. Create Core Configs
  await writeToProject(projectName, 'package.json', TEMPLATES.packageJson(projectName));
  await writeToProject(projectName, 'vite.config.ts', TEMPLATES.viteConfig);
  await writeToProject(projectName, 'tsconfig.json', TEMPLATES.tsconfig);
  await writeToProject(projectName, 'tsconfig.node.json', `{ "compilerOptions": { "composite": true, "skipLibCheck": true, "module": "ESNext", "moduleResolution": "bundler", "allowSyntheticDefaultImports": true } }`);
  await writeToProject(projectName, 'index.html', TEMPLATES.indexHtml);
  
  // 2. Create Source Structure (Empty Folders/Files to guide the AI)
  await writeToProject(projectName, 'src/main.tsx', TEMPLATES.mainTsx);
  await writeToProject(projectName, 'src/App.tsx', '// Placeholder App'); // Placeholder to be overwritten
  await writeToProject(projectName, 'src/index.css', '/* Tailwind directives will go here */'); // Placeholder
  await writeToProject(projectName, 'src/components/.gitkeep', '');
  await writeToProject(projectName, 'src/pages/.gitkeep', '');
  await writeToProject(projectName, 'src/hooks/.gitkeep', '');
  await writeToProject(projectName, 'src/utils/.gitkeep', '');
  
  console.log(`✅ Skeleton Complete. Project ready for AI injection.`);
}

function parseActionSheets(markdownText) {
  const actions = [];
  const regex = /### FILE:\s*(.*?)\nTYPE:\s*(.*?)\nINSTRUCTIONS:\s*([\s\S]*?)(?=(### FILE:|$))/g;
  
  let match;
  while ((match = regex.exec(markdownText)) !== null) {
    actions.push({
      path: match[1].trim(),
      type: match[2].trim().toUpperCase(), 
      instructions: match[3].trim()
    });
  }
  return actions;
}

// ============================================================================
// 3. WIZARD DNA
// ============================================================================

function createUIGeneratorWizard() {
  const wizard = new Wizard({
    id: 'hybrid-architect-wizard',
    logging: true,
    initialContext: {
      userRequest: "",
      projectPath: "", // Will be generated if empty
      prd: "",
      screenFlow: "",
      designSystem: "",
      architecturePlan: "",
      tasks: [],
      additionalDeps: []
    }
  });

  // --------------------------------------------------------------------------
  // STEP 0: INITIALIZE BOILERPLATE (The Skeleton)
  // --------------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'init_skeleton',
    update: async (result, state, actions) => {
      // GENERATE GENERIC NAME if not provided
      const safeName = state.projectPath || generateProjectName();
      
      console.log(`\n🚀 Starting Project: ${safeName}`);

      // Write the static files first
      await initBoilerplate(safeName);
      
      actions.updateContext({ projectPath: safeName });
      return actions.next();
    }
  });

  // --------------------------------------------------------------------------
  // STEP 1: PLANNING (PM & UX)
  // --------------------------------------------------------------------------
  wizard.addTextStep({
    id: 'product_manager',
    model: Models.SWIZZY_DEFAULT, 
    context: (state) => ({ request: state.userRequest }),
    instruction: `You are a Product Manager. Client Request: "{{request}}"
    Output a concise PRD. Define core features and user stories. Keep it tight.
    
    Your PRD should include
    - The user requirement documentation -> Each feature or capability. ie what a user can do or what a user can see.
    - The must haves
    - The not neededs.
    - The expected complexity of the project
    - Anticipated implementation mistakes
    `,
    update: (text, state, actions) => {
      console.log("\n📝 PRD Created.");
      actions.updateContext({ prd: text });
      return actions.next();
    }
  });

  wizard.addTextStep({
    id: 'ux_designer',
    model: Models.SWIZZY_DEFAULT,
    context: (state) => ({ prd: state.prd }),
    instruction: `You are a Lead UX Designer. PRD: {{prd}}
    Define the Screen Flow (Page 1, Page 2...).
    CRITICAL: Only define screens absolutely necessary for the features.`,
    update: (text, state, actions) => {
      console.log("\n🗺️ Flow Mapped.");
      actions.updateContext({ screenFlow: text });
      return actions.next();
    }
  });

  // --------------------------------------------------------------------------
  // STEP 1.5: UX VALIDATION (NEW)
  // --------------------------------------------------------------------------
  wizard.addTextStep({
    id: 'ux_validator',
    model: Models.SWIZZY_DEFAULT,
    context: (state) => ({
      prd: state.prd,
      flow: state.screenFlow
    }),
    instruction: `You are a Senior QA UX Researcher.

Review the proposed Screen Flow against the PRD.

CHECKLIST:
1. Are there redundant screens? (e.g., separate success screens that could be modals).
2. Is the flow logical?
3. Does it cover all "Must Haves" from the PRD?

TASK:
- If the flow is good, output it exactly as is.
- If there are issues, REWRITE the Screen Flow to be optimized.

Return ONLY the final valid Screen Flow text.`,
    update: (text, state, actions) => {
      console.log("\n✅ UX Flow Validated & Optimized.");
      actions.updateContext({ screenFlow: text });
      return actions.next();
    }
  });

  // --------------------------------------------------------------------------
  // STEP 2: DYNAMIC CONFIG GENERATION (Tailwind & CSS)
  // --------------------------------------------------------------------------
  wizard.addTextStep({
    id: 'style_architect',
    model: Models.SWIZZY_DEFAULT,
    context: (state) => ({ prd: state.prd }),
    instruction: `You are a Design Systems Engineer.
    
    TASK: Generate the specific configuration files for Tailwind and Global CSS.
    
    1. tailwind.config.js (Define colors/fonts based on PRD vibe).
    2. src/index.css (Define @tailwind directives and base layer).
    
    OUTPUT FORMAT:
    ### FILE: tailwind.config.js
    TYPE: CONFIG
    INSTRUCTIONS: [Content for tailwind config]
    
    ### FILE: src/index.css
    TYPE: CONFIG
    INSTRUCTIONS: [Content for css]`,
    update: (text, state, actions) => {
      console.log("\n🎨 Style Config Generated.");
      const tasks = parseActionSheets(text);
      actions.updateContext({ styleTasks: tasks, designSystem: text });
      return actions.next();
    }
  });

  // --------------------------------------------------------------------------
  // STEP 3: APP ARCHITECTURE (The "Flesh")
  // --------------------------------------------------------------------------
  wizard.addTextStep({
    id: 'tech_architect',
    model: Models.SWIZZY_DEFAULT,
    context: (state) => ({ 
      prd: state.prd,
      flow: state.screenFlow
    }),
    instruction: `You are the Lead React Architect.
    
    CONTEXT:
    - The project is ALREADY initialized with Vite + React + TypeScript + Tailwind.
    - Folder structure exists.
    
    TASK:
    1. Define the Component and Page files needed for the Screen Flow. Focus on the full instruction do not provide code.
    2. Define src/App.tsx (This is CRITICAL - it must set up the Routes).
    3. Instrucion must be a markdown content. it must have the following -> What should be done, how it should be done, bullet point of completions criteria i what must be done before the code is accepted.
    CONSTRAINTS:
    - DO NOT generate package.json, vite.config.ts, or index.html (They exist).
    - ONLY generate src/... files.
    
    OUTPUT FORMAT (Markdown Action Sheet):
    ### FILE: src/pages/Home.tsx
    TYPE: PAGE
    INSTRUCTIONS: [Logic...]
    `,
    update: (text, state, actions) => {
      console.log("\n🏗️ Architecture Plan Created.");
      actions.updateContext({ architecturePlan: text });
      return actions.next();
    }
  });

  // --------------------------------------------------------------------------
  // STEP 3.5: ARCHITECTURE VALIDATION (NEW)
  // --------------------------------------------------------------------------
  wizard.addTextStep({
    id: 'architecture_validator',
    model: Models.SWIZZY_DEFAULT,
    context: (state) => ({
      plan: state.architecturePlan,
      styles: state.designSystem
    }),
    instruction: `You are a Code Quality Assurance Lead.

Review the proposed Architecture Plan. You must fix the following specific issues often found in generated plans:

1. **Import Paths**: Check src/App.tsx. If it imports 'Dashboard' from './pages/Dashboard', ensure Dashboard is actually a Page. If Dashboard is defined as a Component (src/components/Dashboard.tsx), FIX the import path.
2. **Route Completeness**: Ensure every defined PAGE has a route in App.tsx.
3. **State Initialization**: Ensure instructions specify initial values for useState (e.g. useState<Task[]>([]) NOT useState<Task[]>()).
4. **Typos**: Check for obvious typo instructions.

TASK:
Rewrite the Architecture Plan (Markdown Action Sheets) correcting these errors.
Return the FULL corrected plan.`,
    update: (text, state, actions) => {
      console.log("\n🛡️ Architecture Validated & Patched.");
      // Overwrite the plan with the validated version
      actions.updateContext({ architecturePlan: text });
      return actions.next();
    }
  });

  // --------------------------------------------------------------------------
  // STEP 4: PREPARE FACTORY
  // --------------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'prep_factory',
    update: (result, state, actions) => {
      const featureTasks = parseActionSheets(state.architecturePlan);
      // Combine Style tasks + Feature tasks
      const allTasks = [...(state.styleTasks || []), ...featureTasks];
      
      console.log(`\n📋 Factory Orders: ${allTasks.length} files to generate.`);
      actions.updateContext({ tasks: allTasks });
      
      return actions.goto('factory_floor');
    }
  });

  // --------------------------------------------------------------------------
  // STEP 5: THE FACTORY (Direct Write Mode)
  // --------------------------------------------------------------------------
  wizard.addComputeStep({
    id: 'factory_floor',
    update: (result, state, actions) => {
      console.log('\n🏭 Spinning up Engineers...');

      return actions.bungee.init()
        .batch(
          'write_code_worker',
          state.tasks.length,
          (index) => ({
            targetFile: state.tasks[index].path,
            fileInstructions: state.tasks[index].instructions,
            fileType: state.tasks[index].type,
            designSystem: state.designSystem,
            projectPath: state.projectPath
          })
        )
        .config({ concurrency: 5 })
        .onComplete((wiz) => {
          console.log("\n✅ Generation Complete.");
          return wiz.stop();
        })
        .jump();
    }
  });

  // --------------------------------------------------------------------------
  // STEP 6: WORKER (Direct Write)
  // --------------------------------------------------------------------------
  wizard.addTextStep({
    id: 'write_code_worker',
    model: Models.SWIZZY_DEFAULT,

    context: (state) => ({
      file: state.targetFile,
      type: state.fileType,
      instructions: state.fileInstructions,
      design: state.designSystem
    }),

    instruction: `You are a Senior React Engineer.
    
    FILE: {{file}}
    TYPE: {{type}}
    
    INSTRUCTIONS:
    {{instructions}}
    
    DESIGN CONTEXT:
    {{design}}
    
    TASK:
    Write the code for this file. 
    - If it's src/App.tsx, ensure it sets up React Router.
    - Return ONLY valid code. No markdown fences if possible.`,

    update: async (codeText, state, actions) => {
      let cleanCode = codeText.replace(/```(typescript|tsx|ts|html|json|js|css|javascript)?/g, '').replace(/```/g, '').trim();
      await writeToProject(state.projectPath, state.targetFile, cleanCode);
      return actions.next();
    }
  });

  return wizard;
}

module.exports = { createUIGeneratorWizard };