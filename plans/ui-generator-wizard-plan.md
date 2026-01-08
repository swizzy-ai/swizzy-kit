# UI Generator Wizard: Complete Architecture Plan

## Overview
A comprehensive Wizard Framework workflow that generates complete React/TypeScript UI projects with modern tooling (Vite, Tailwind, Shadcn, React Router).

## Context Schema

```typescript
interface UIGeneratorContext {
  // Input
  userRequest: string;

  // Section 1: Requirements & Foundation
  requirements: {
    appType: string;
    features: string[];
    styling: string;
    complexity: 'simple' | 'medium' | 'complex';
  };
  projectName: string;        // kebab-case
  displayTitle: string;       // Human readable
  stylingPlan: string;        // Detailed styling strategy

  // Section 2: Scaffold & Style Files
  workDir: string;            // Project directory path

  // Section 3: Shadcn Components
  shadcnActionSheet: string;  // Markdown list of components
  shadcnComponents: string[]; // Parsed array
  availableForImport: {
    shadcn: string[];         // Component names available for import
    utilities: string[];      // Utility function names
    components: string[];     // Reusable component names
    stores: string[];         // Store names
    layouts: string[];        // Layout names
  };

  // Section 4: Utilities
  utilitiesActionSheet: string; // Markdown OR "N/A"
  utilitiesArray: Array<{
    name: string;
    file: string;
    purpose: string;
  }>;

  // Section 5: Reusable Components
  reusableComponentsActionSheet: string;
  componentsArray: Array<{
    name: string;
    file: string;
    purpose: string;
    dependencies: string[];
  }>;

  // Section 6: Stores
  storesActionSheet: string; // Markdown OR "N/A"
  storesArray: Array<{
    name: string;
    file: string;
    purpose: string;
    dependencies: string[];
  }>;

  // Section 7: Layouts
  layoutsActionSheet: string;
  layoutsArray: Array<{
    name: string;
    file: string;
    purpose: string;
    dependencies: string[];
  }>;

  // Section 8: Pages
  pagesActionSheet: string;
  pagesArray: Array<{
    name: string;
    file: string;
    route: string;
    layout: string;
    purpose: string;
    dependencies: string[];
  }>;

  // Section 9: Routing
  routingActionSheet: string;

  // Section 10: Finalize
  completionStats: {
    totalFiles: number;
    sectionsCompleted: number;
    duration: number;
  };
}
```

## Wizard Configuration

```javascript
const wizard = new Wizard({
  id: 'ui-generator-wizard',
  onUsage: (usage, provider) => {
    console.log(`📊 ${provider}: ${usage.totalTokens} tokens`);
  }
});
```

## Section 1: Requirements & Foundation

### Step 1.1: read_requirements
- **Type**: Structured Step
- **Input**: `userRequest`
- **Instruction**: Parse user requirements into structured format
- **Schema**:
  ```typescript
  z.object({
    appType: z.string(),
    features: z.array(z.string()),
    styling: z.string(),
    complexity: z.enum(['simple', 'medium', 'complex'])
  })
  ```
- **Update**: Store `requirements` in context

### Step 1.2: plan_project_name
- **Type**: Structured Step
- **Input**: `requirements`
- **Instruction**: Generate project name and display title
- **Schema**:
  ```typescript
  z.object({
    projectName: z.string().regex(/^[a-z0-9-]+$/),
    displayTitle: z.string()
  })
  ```
- **Update**: Store `projectName`, `displayTitle`

### Step 1.3: plan_styling_approach
- **Type**: Text Step
- **Input**: `requirements`
- **Instruction**: Create detailed styling strategy
- **Update**: Store `stylingPlan`

## Section 2: Scaffold & Style Files

### Step 2.1: setup_scaffold
- **Type**: Compute Step
- **Input**: `projectName`
- **Logic**: Create project directory and copy template files
- **Update**: Set `workDir`, create base files

### Step 2.2: generate_tailwind_config
- **Type**: Text Step
- **Input**: `stylingPlan`, `projectName`
- **Instruction**: Generate tailwind.config.js
- **Update**: Write file to disk

### Step 2.3: generate_index_css
- **Type**: Text Step
- **Input**: `stylingPlan`
- **Instruction**: Generate src/index.css
- **Update**: Write file to disk

### Step 2.4: generate_components_json
- **Type**: Text Step
- **Input**: `projectName`
- **Instruction**: Generate components.json for shadcn
- **Update**: Write file to disk

## Section 3: Shadcn Components

### Step 3.1: plan_shadcn_components
- **Type**: Text Step
- **Input**: `requirements`, `stylingPlan`
- **Instruction**: Plan which shadcn components are needed
- **Update**: Store `shadcnActionSheet`

### Step 3.2: parse_shadcn_action_sheet
- **Type**: Compute Step
- **Input**: `shadcnActionSheet`
- **Logic**: Parse markdown into component array
- **Update**: Store `shadcnComponents`, update `availableForImport.shadcn`

### Step 3.3: bungee_generate_shadcn_files
- **Type**: Bungee Anchor (Compute Step)
- **Input**: `shadcnComponents`
- **Bungee Config**:
  - Batch: `generate_shadcn_component`
  - Count: `shadcnComponents.length`
  - Context: `(index) => ({ componentName: shadcnComponents[index] })`
  - Concurrency: 3

### Step 3.4: generate_shadcn_component (Bungee Worker)
- **Type**: Text Step
- **Input**: `componentName`, `stylingPlan`
- **Instruction**: Generate shadcn component file
- **Update**: Write component file to disk

## Section 4: Utilities

### Step 4.1: plan_utilities
- **Type**: Text Step
- **Input**: `requirements`
- **Instruction**: Plan utility functions needed
- **Update**: Store `utilitiesActionSheet`

### Step 4.2: check_if_utilities_needed
- **Type**: Compute Step
- **Input**: `utilitiesActionSheet`
- **Logic**: Check if "N/A" or has content
- **Update**: Branch to Section 5 if "N/A"

### Step 4.3: parse_utilities_action_sheet
- **Type**: Compute Step
- **Input**: `utilitiesActionSheet`
- **Logic**: Parse markdown into utilities array
- **Update**: Store `utilitiesArray`

### Step 4.4: bungee_generate_utility
- **Type**: Bungee Anchor (Compute Step)
- **Input**: `utilitiesArray`
- **Bungee Config**:
  - Batch: `generate_utility_file`
  - Count: `utilitiesArray.length`
  - Context: `(index) => ({ utilitySpec: utilitiesArray[index] })`

### Step 4.5: generate_utility_file (Bungee Worker)
- **Type**: Text Step
- **Input**: `utilitySpec`
- **Instruction**: Generate utility file code
- **Update**: Write file, add to `availableForImport.utilities`

## Section 5: Reusable Components

### Step 5.1: plan_reusable_components
- **Type**: Text Step
- **Input**: `requirements`, `stylingPlan`, `availableForImport`
- **Instruction**: Plan custom reusable components
- **Update**: Store `reusableComponentsActionSheet`

### Step 5.2: parse_reusable_action_sheet
- **Type**: Compute Step
- **Input**: `reusableComponentsActionSheet`
- **Logic**: Parse markdown into components array
- **Update**: Store `componentsArray`

### Step 5.3: bungee_generate_reusable_component
- **Type**: Bungee Anchor (Compute Step)
- **Input**: `componentsArray`, `availableForImport`
- **Bungee Config**:
  - Batch: `generate_reusable_component_file`
  - Count: `componentsArray.length`
  - Context: `(index) => ({
      componentSpec: componentsArray[index],
      availableForImport: context.availableForImport
    })`

### Step 5.4: generate_reusable_component_file (Bungee Worker)
- **Type**: Text Step
- **Input**: `componentSpec`, `availableForImport`
- **Instruction**: Generate component file with imports
- **Update**: Write file, add to `availableForImport.components`

## Section 6: Stores

### Step 6.1: plan_stores
- **Type**: Text Step
- **Input**: `requirements`
- **Instruction**: Plan state management stores
- **Update**: Store `storesActionSheet`

### Step 6.2: check_if_stores_needed
- **Type**: Compute Step
- **Input**: `storesActionSheet`
- **Logic**: Check if "N/A" or has content
- **Update**: Branch to Section 7 if "N/A"

### Step 6.3: parse_stores_action_sheet
- **Type**: Compute Step
- **Input**: `storesActionSheet`
- **Logic**: Parse markdown into stores array
- **Update**: Store `storesArray`

### Step 6.4: bungee_generate_store
- **Type**: Bungee Anchor (Compute Step)
- **Input**: `storesArray`, `availableForImport`
- **Bungee Config**:
  - Batch: `generate_store_file`
  - Count: `storesArray.length`
  - Context: `(index) => ({
      storeSpec: storesArray[index],
      availableForImport: context.availableForImport
    })`

### Step 6.5: generate_store_file (Bungee Worker)
- **Type**: Text Step
- **Input**: `storeSpec`, `availableForImport`
- **Instruction**: Generate store file
- **Update**: Write file, add to `availableForImport.stores`

## Section 7: Layouts

### Step 7.1: plan_layouts
- **Type**: Text Step
- **Input**: `requirements`, `stylingPlan`, `availableForImport`
- **Instruction**: Plan layout components
- **Update**: Store `layoutsActionSheet`

### Step 7.2: parse_layouts_action_sheet
- **Type**: Compute Step
- **Input**: `layoutsActionSheet`
- **Logic**: Parse markdown into layouts array
- **Update**: Store `layoutsArray`

### Step 7.3: bungee_generate_layout
- **Type**: Bungee Anchor (Compute Step)
- **Input**: `layoutsArray`, `availableForImport`
- **Bungee Config**:
  - Batch: `generate_layout_file`
  - Count: `layoutsArray.length`
  - Context: `(index) => ({
      layoutSpec: layoutsArray[index],
      availableForImport: context.availableForImport
    })`

### Step 7.4: generate_layout_file (Bungee Worker)
- **Type**: Text Step
- **Input**: `layoutSpec`, `availableForImport`
- **Instruction**: Generate layout component
- **Update**: Write file, add to `availableForImport.layouts`

## Section 8: Pages

### Step 8.1: plan_pages
- **Type**: Text Step
- **Input**: `requirements`, `stylingPlan`, `availableForImport`
- **Instruction**: Plan page components with routes
- **Update**: Store `pagesActionSheet`

### Step 8.2: parse_pages_action_sheet
- **Type**: Compute Step
- **Input**: `pagesActionSheet`
- **Logic**: Parse markdown into pages array
- **Update**: Store `pagesArray`

### Step 8.3: bungee_generate_page
- **Type**: Bungee Anchor (Compute Step)
- **Input**: `pagesArray`, `availableForImport`
- **Bungee Config**:
  - Batch: `generate_page_file`
  - Count: `pagesArray.length`
  - Context: `(index) => ({
      pageSpec: pagesArray[index],
      availableForImport: context.availableForImport
    })`

### Step 8.4: generate_page_file (Bungee Worker)
- **Type**: Text Step
- **Input**: `pageSpec`, `availableForImport`
- **Instruction**: Generate page component
- **Update**: Write file to disk

## Section 9: Routing

### Step 9.1: generate_routing_action_sheet
- **Type**: Text Step
- **Input**: `pagesArray`, `layoutsArray`
- **Instruction**: Create routing configuration plan
- **Update**: Store `routingActionSheet`

### Step 9.2: generate_app_tsx
- **Type**: Text Step
- **Input**: `routingActionSheet`, `pagesArray`, `layoutsArray`
- **Instruction**: Generate App.tsx with React Router
- **Update**: Write App.tsx file

### Step 9.3: generate_main_tsx
- **Type**: Text Step
- **Input**: `projectName`, `stylingPlan`
- **Instruction**: Generate main.tsx entry point
- **Update**: Write main.tsx file

## Section 10: Finalize

### Step 10.1: generate_readme
- **Type**: Text Step
- **Input**: `projectName`, `displayTitle`, `requirements`
- **Instruction**: Generate project README.md
- **Update**: Write README.md file

### Step 10.2: completion_summary
- **Type**: Compute Step
- **Input**: All context
- **Logic**: Calculate stats and log completion
- **Update**: Store `completionStats`, end workflow

## File Writing Utilities

### writeFile Utility
```javascript
// Compute step utility for writing files
const writeFile = async (filePath, content) => {
  const fullPath = path.join(context.workDir, filePath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content);
  console.log(`✅ Generated: ${filePath}`);
};
```

### Action Sheet Parsing Functions

```javascript
// Parse markdown action sheets into structured arrays
const parseActionSheet = (markdown, type) => {
  // Implementation for parsing different action sheet formats
  // Returns appropriate array structure based on type
};
```

## Error Handling & Validation

- File writing errors → retry with different approach
- Missing dependencies → log warnings but continue
- Invalid action sheets → retry parsing step
- Bungee timeouts → fallback to sequential processing

## Progress Tracking

- Event listeners for step completion
- Real-time progress updates
- Section completion summaries
- Final statistics reporting

## File Writing Utilities

### Core File Operations
```javascript
// Utility functions for file operations
const fileUtils = {
  // Write file with directory creation
  writeFile: async (workDir, relativePath, content) => {
    const fullPath = path.join(workDir, relativePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content);
    console.log(`✅ Generated: ${relativePath}`);
    return fullPath;
  },

  // Read template file
  readTemplate: async (templateName) => {
    const templatePath = path.join(__dirname, 'templates', templateName);
    return await fs.readFile(templatePath, 'utf-8');
  },

  // Copy template directory
  copyTemplateDir: async (templateDir, targetDir) => {
    await fs.copy(
      path.join(__dirname, 'templates', templateDir),
      targetDir
    );
    console.log(`✅ Copied template: ${templateDir}`);
  }
};
```

### Error Handling Strategy
```javascript
// Retry mechanism for file operations
const withRetry = async (operation, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.warn(`Attempt ${i + 1} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};
```

## Action Sheet Structures & Parsing

### What Are Action Sheets?

Action Sheets are **markdown-formatted planning documents** generated by LLMs that describe what needs to be built. They provide structured information that can be reliably parsed into arrays for Bungee parallel processing.

**Yes, this is absolutely possible and highly effective!** The markdown format provides:
- Human-readable structure
- Easy parsing with regex
- Flexible content organization
- Clear section separation

### Shadcn Components Action Sheet

**Generated by Step 3.1: plan_shadcn_components**

```
# Shadcn Components Plan

Based on the task management app requirements, here are the shadcn components needed:

- button (core interactive element for actions)
- card (container for task items and sections)
- dialog (modal for task creation/editing)
- input (form fields for task data)
- textarea (description fields)
- badge (status indicators)
- checkbox (task completion toggle)
- select (priority and category dropdowns)
- tabs (navigation between views)
- calendar (due date picker)
```

**Parsing Logic:**
```javascript
parseShadcnActionSheet: (markdown) => {
  const lines = markdown.split('\n').filter(line => line.trim());
  const components = [];

  for (const line of lines) {
    // Match: - button (core interactive element for actions)
    const match = line.match(/^\s*-\s*(\w+)/);
    if (match) {
      components.push(match[1]);
    }
  }

  return components; // ['button', 'card', 'dialog', ...]
}
```

### Utilities Action Sheet

**Generated by Step 4.1: plan_utilities**

```
# Utility Functions Plan

For the task management app, these utility functions are needed:

### formatDate
Format dates consistently across the app
Dependencies: date-fns

### validateTask
Validate task data before saving
Dependencies: zod

### generateId
Create unique IDs for tasks
Dependencies: nanoid

### debounce
Debounce search and filter inputs
Dependencies: None (custom implementation)
```

**Or for simple apps:**
```
N/A - No utilities needed for this simple app
```

**Parsing Logic:**
```javascript
parseUtilitiesActionSheet: (markdown) => {
  if (markdown.trim() === 'N/A') return [];

  const utilities = [];
  const sections = markdown.split(/^###?\s/m);

  for (const section of sections) {
    const lines = section.split('\n').filter(line => line.trim());
    if (lines.length < 2) continue;

    const nameMatch = lines[0].match(/^(\w+)\s*$/);
    if (nameMatch) {
      const name = nameMatch[1];
      const purpose = lines[1] || '';
      const dependencies = lines.find(l => l.includes('Dependencies:'))?.replace('Dependencies:', '').trim().split(',').map(d => d.trim()) || [];

      utilities.push({
        name,
        file: `src/utils/${name}.ts`,
        purpose,
        dependencies
      });
    }
  }

  return utilities;
}
```

### Reusable Components Action Sheet

**Generated by Step 5.1: plan_reusable_components**

```
# Reusable Components Plan

Custom components needed for the task management app:

### TaskCard
Purpose: Display individual task with actions
Dependencies: card, button, badge, checkbox

### TaskForm
Purpose: Form for creating/editing tasks
Dependencies: dialog, input, textarea, select, button

### TaskList
Purpose: Container for multiple task cards with filtering
Dependencies: TaskCard, input, select

### Header
Purpose: App header with navigation
Dependencies: button, tabs

### Sidebar
Purpose: Navigation sidebar
Dependencies: button, badge
```

**Parsing Logic:**
```javascript
parseComponentsActionSheet: (markdown) => {
  const components = [];
  const sections = markdown.split(/^###?\s/m);

  for (const section of sections) {
    const lines = section.split('\n').filter(line => line.trim());
    if (lines.length < 3) continue;

    const nameMatch = lines[0].match(/^(\w+)\s*$/);
    if (nameMatch) {
      const name = nameMatch[1];
      const purpose = lines.find(l => l.startsWith('Purpose:'))?.replace('Purpose:', '').trim() || '';
      const dependencies = lines.find(l => l.startsWith('Dependencies:'))?.replace('Dependencies:', '').trim().split(',').map(d => d.trim()) || [];

      components.push({
        name,
        file: `src/components/${name}.tsx`,
        purpose,
        dependencies
      });
    }
  }

  return components;
}
```

### Pages Action Sheet

**Generated by Step 8.1: plan_pages**

```
# Pages Plan

Application pages with routes:

### Dashboard
Route: /
Layout: MainLayout
Purpose: Overview of all tasks with statistics
Dependencies: TaskList, Header, Sidebar, card, badge

### TaskDetails
Route: /tasks/:id
Layout: MainLayout
Purpose: Detailed view of single task
Dependencies: TaskCard, TaskForm, button, dialog

### Settings
Route: /settings
Layout: MainLayout
Purpose: User preferences and configuration
Dependencies: input, select, button, card

### Login
Route: /login
Layout: AuthLayout
Purpose: User authentication
Dependencies: input, button, card
```

**Parsing Logic:**
```javascript
parsePagesActionSheet: (markdown) => {
  const pages = [];
  const sections = markdown.split(/^###?\s/m);

  for (const section of sections) {
    const lines = section.split('\n').filter(line => line.trim());
    if (lines.length < 4) continue;

    const nameMatch = lines[0].match(/^(\w+)\s*$/);
    if (nameMatch) {
      const name = nameMatch[1];
      const route = lines.find(l => l.startsWith('Route:'))?.replace('Route:', '').trim() || '';
      const layout = lines.find(l => l.startsWith('Layout:'))?.replace('Layout:', '').trim() || '';
      const purpose = lines.find(l => l.startsWith('Purpose:'))?.replace('Purpose:', '').trim() || '';
      const dependencies = lines.find(l => l.startsWith('Dependencies:'))?.replace('Dependencies:', '').trim().split(',').map(d => d.trim()) || [];

      pages.push({
        name,
        file: `src/pages/${name}.tsx`,
        route,
        layout,
        purpose,
        dependencies
      });
    }
  }

  return pages;
}
```

## Action Sheet Parsing Functions

### Complete Markdown Parsing Utilities
```javascript
const parseUtils = {
  // Parse shadcn action sheet
  parseShadcnActionSheet: (markdown) => {
    const lines = markdown.split('\n').filter(line => line.trim());
    const components = [];

    for (const line of lines) {
      // Match: - button (core interactive element for actions)
      const match = line.match(/^\s*-\s*(\w+)/);
      if (match) {
        components.push(match[1]);
      }
    }

    return components;
  },

  // Parse utilities action sheet
  parseUtilitiesActionSheet: (markdown) => {
    if (markdown.trim() === 'N/A') return [];

    const utilities = [];
    const sections = markdown.split(/^###?\s/m);

    for (const section of sections) {
      const lines = section.split('\n').filter(line => line.trim());
      if (lines.length < 2) continue;

      const nameMatch = lines[0].match(/^(\w+)\s*\(/);
      if (nameMatch) {
        const name = nameMatch[1];
        const purpose = lines.slice(1).join(' ').trim();
        const file = `src/utils/${name}.ts`;

        utilities.push({ name, file, purpose });
      }
    }

    return utilities;
  },

  // Parse components action sheet
  parseComponentsActionSheet: (markdown) => {
    const components = [];
    const sections = markdown.split(/^###?\s/m);

    for (const section of sections) {
      const lines = section.split('\n').filter(line => line.trim());
      if (lines.length < 3) continue;

      const nameMatch = lines[0].match(/^(\w+)\s*\(/);
      if (nameMatch) {
        const name = nameMatch[1];
        const file = `src/components/${name}.tsx`;
        const purpose = lines[1].replace(/^Purpose:\s*/, '');
        const dependencies = lines[2].replace(/^Dependencies:\s*/, '').split(',').map(d => d.trim());

        components.push({ name, file, purpose, dependencies });
      }
    }

    return components;
  },

  // Parse pages action sheet (similar pattern)
  parsePagesActionSheet: (markdown) => {
    const pages = [];
    const sections = markdown.split(/^###?\s/m);

    for (const section of sections) {
      const lines = section.split('\n').filter(line => line.trim());
      if (lines.length < 4) continue;

      const nameMatch = lines[0].match(/^(\w+)\s*\(/);
      if (nameMatch) {
        const name = nameMatch[1];
        const file = `src/pages/${name}.tsx`;
        const route = lines[1].replace(/^Route:\s*/, '');
        const layout = lines[2].replace(/^Layout:\s*/, '');
        const purpose = lines[3].replace(/^Purpose:\s*/, '');
        const dependencies = lines[4] ? lines[4].replace(/^Dependencies:\s*/, '').split(',').map(d => d.trim()) : [];

        pages.push({ name, file, route, layout, purpose, dependencies });
      }
    }

    return pages;
  }
};
```

## AvailableForImport Tracking System

### Import Registry
```javascript
// Initialize availableForImport structure
const initializeAvailableForImport = () => ({
  shadcn: [],
  utilities: [],
  components: [],
  stores: [],
  layouts: []
});

// Add imports to registry
const addToAvailableImports = (context, category, items) => {
  if (!context.availableForImport) {
    context.availableForImport = initializeAvailableForImport();
  }

  if (Array.isArray(items)) {
    context.availableForImport[category].push(...items);
  } else {
    context.availableForImport[category].push(items);
  }
};

// Generate import statements
const generateImports = (dependencies, availableForImport) => {
  const imports = [];

  for (const dep of dependencies) {
    // Check each category
    for (const [category, items] of Object.entries(availableForImport)) {
      if (items.includes(dep)) {
        const importPath = getImportPath(category, dep);
        imports.push(`import { ${dep} } from '${importPath}';`);
        break;
      }
    }
  }

  return imports.join('\n');
};

// Get import path for category
const getImportPath = (category, name) => {
  const pathMap = {
    shadcn: `../components/ui/${name}`,
    utilities: `../utils/${name}`,
    components: `../components/${name}`,
    stores: `../stores/${name}`,
    layouts: `../layouts/${name}`
  };

  return pathMap[category] || `../${category}/${name}`;
};
```

## Complete Wizard Implementation

### Main Wizard Factory Function
```javascript
function createUIGeneratorWizard() {
  const wizard = new Wizard({
    id: 'ui-generator-wizard',
    onUsage: (usage, provider) => {
      console.log(`📊 ${provider}: ${usage.totalTokens} tokens`);
    }
  });

  // Initialize context
  wizard.setContext({
    availableForImport: initializeAvailableForImport(),
    completionStats: {
      totalFiles: 0,
      sectionsCompleted: 0,
      duration: 0
    }
  });

  // Add all workflow steps (40+ steps total)
  addRequirementsSection(wizard);
  addScaffoldSection(wizard);
  addShadcnSection(wizard);
  addUtilitiesSection(wizard);
  addComponentsSection(wizard);
  addStoresSection(wizard);
  addLayoutsSection(wizard);
  addPagesSection(wizard);
  addRoutingSection(wizard);
  addFinalizeSection(wizard);

  return wizard;
}

// Section implementation functions
function addRequirementsSection(wizard) {
  // Step 1.1: read_requirements
  wizard.addStep({
    id: 'read_requirements',
    instruction: `Parse the user's request into structured requirements.

User Request: {{userRequest}}

Extract:
- appType: What kind of application (dashboard, blog, e-commerce, etc.)
- features: Array of key features needed
- styling: Preferred styling approach or theme
- complexity: simple/medium/complex based on feature count`,
    schema: z.object({
      appType: z.string(),
      features: z.array(z.string()),
      styling: z.string(),
      complexity: z.enum(['simple', 'medium', 'complex'])
    }),
    model: Models.SWIZZY_DEFAULT,
    update: (result, context, actions) => {
      actions.updateContext({ requirements: result });
      return actions.next();
    }
  });

  // Step 1.2: plan_project_name
  wizard.addStep({
    id: 'plan_project_name',
    instruction: `Generate a project name and display title based on requirements.

Requirements: {{requirements}}

Create:
- projectName: kebab-case, lowercase, no spaces or special chars
- displayTitle: Human-readable title case`,
    schema: z.object({
      projectName: z.string().regex(/^[a-z0-9-]+$/),
      displayTitle: z.string()
    }),
    model: Models.SWIZZY_DEFAULT,
    update: (result, context, actions) => {
      actions.updateContext({
        projectName: result.projectName,
        displayTitle: result.displayTitle
      });
      return actions.next();
    }
  });

  // Step 1.3: plan_styling_approach
  wizard.addTextStep({
    id: 'plan_styling_approach',
    instruction: `Create a detailed styling strategy for this project.

Requirements: {{requirements}}

Include:
- Color scheme and palette reasoning
- Typography choices (fonts, sizes, weights)
- Spacing system (margins, padding, gaps)
- Component styling approach
- Dark/light mode considerations
- Responsive design strategy
- Accessibility considerations`,
    model: Models.SWIZZY_DEFAULT,
    update: (result, context, actions) => {
      actions.updateContext({ stylingPlan: result });
      return actions.next();
    }
  });
}

// Additional section implementations follow the same pattern...
// (setup_scaffold, generate_tailwind_config, etc.)

module.exports = { createUIGeneratorWizard };
```

## Testing Strategy

- Unit tests for parsing functions
- Integration tests for complete workflows
- Mock LLM responses for deterministic testing
- File system validation after generation
- Template validation tests

## Performance Optimizations

- Bungee concurrency limits based on system resources
- File writing batching for I/O efficiency
- Context size management to prevent token limits
- Streaming responses for large file generations
- Parallel template processing where possible

## Error Recovery

- Automatic retry for transient failures
- Fallback to sequential processing if Bungee fails
- Partial completion handling (continue with available components)
- Detailed error logging with recovery suggestions
- Rollback mechanisms for failed file operations