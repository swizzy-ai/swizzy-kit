require('dotenv').config();
const { Wizard, Models } = require('@swizzy/kit');
const puppeteer = require('puppeteer');

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  width: 1366,
  height: 768,
  typingSpeedMin: 50,
  typingSpeedMax: 150,
};

let browser;
let page;

const wizard = new Wizard({
  id: 'ghost-agent',
  onUsage: (usage, provider) => console.log(`[Tokens] ${usage.totalTokens} (${provider})`)
});

// ============================================================================
// 1. THE EYES (Clean Vision)
// ============================================================================
async function getCleanPageSnapshot() {
  return await page.evaluate(() => {
    // 1. Select only actionable elements
    const selectors = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'textarea',
      'select',
      '[role="button"]',
      '[tabindex]:not([tabindex="-1"])'
    ];

    const elements = document.querySelectorAll(selectors.join(','));
    const items = [];

    // 2. Filter & Map
    elements.forEach((el, index) => {
      const rect = el.getBoundingClientRect();

      // Filter: Must be visible and have size
      const isVisible = rect.width > 0 &&
        rect.height > 0 &&
        window.getComputedStyle(el).visibility !== 'hidden' &&
        window.getComputedStyle(el).display !== 'none';

      if (!isVisible) return;

      // Filter: Must be within viewport (roughly) to be relevant
      if (rect.top > window.innerHeight * 2) return; 

      // Generate Clean Label
      let label = el.innerText || el.placeholder || el.getAttribute('aria-label') || el.name || '';
      label = label.replace(/\s+/g, ' ').trim().substring(0, 40);

      if (!label && el.tagName === 'INPUT') label = 'Input Field';
      if (!label && el.tagName === 'A') label = 'Link';

      // Assign ID for the agent to use
      el.setAttribute('data-agent-id', index);

      items.push({
        id: index,
        tag: el.tagName,
        label: label,
        x: Math.floor(rect.x + rect.width / 2),
        y: Math.floor(rect.y + rect.height / 2)
      });
    });

    // 3. Format as a strict data table for the LLM
    const domList = items.map(i =>
      `ID:${i.id} | ${i.tag} | "${i.label}" | Loc:(${i.x},${i.y})`
    ).join('\n');

    return {
      domList,
      url: window.location.href,
      title: document.title
    };
  });
}

// ============================================================================
// 2. THE HANDS (Human Simulation)
// ============================================================================
async function humanMove(x, y) {
  // Move in steps to simulate a hand, not teleportation
  if (!x || !y) return;
  await page.mouse.move(x, y, { steps: 15 });
}

async function humanType(text) {
  for (const char of text) {
    await page.keyboard.type(char);
    // Random delay between keystrokes
    const delay = Math.floor(Math.random() * (CONFIG.typingSpeedMax - CONFIG.typingSpeedMin) + CONFIG.typingSpeedMin);
    await new Promise(r => setTimeout(r, delay));
  }
}

// ============================================================================
// 3. WIZARD STEPS
// ============================================================================

// STEP 1: INITIALIZE
wizard.addComputeStep({
  id: 'init',
  instruction: '',
  update: async (result, context, actions) => {
    console.log('🚀 Booting Stealth Browser...');

    browser = await puppeteer.launch({
      headless: false, // Set to true if you don't want to see the browser
      defaultViewport: null,
      args: [`--window-size=${CONFIG.width},${CONFIG.height}`, '--no-sandbox']
    });

    const pages = await browser.pages();
    page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.setViewport({ width: CONFIG.width, height: CONFIG.height });

    console.log(`🌐 Navigating to: ${context.startUrl}`);
    await page.goto(context.startUrl, { waitUntil: 'domcontentloaded' });

    return actions.goto('agent_loop');
  }
});

// STEP 2: AGENT DECISION (Strict Command Mode)
wizard.addTextStep({
  id: 'agent_loop',
  instruction: `
SYSTEM: HEADLESS_BROWSER_CONTROLLER
OBJECTIVE: {{goal}}
CURRENT URL: {{url}}

[ INTERACTIVE ELEMENTS DETECTED ]
{{dom}}

INSTRUCTIONS:
1. Analyze the OBJECTIVE and the interactive elements list above.
2. Return ONLY the command that achieves the OBJECTIVE. No thinking, no talking.

COMMAND SYNTAX:
- CLICK [ID]         -> Clicks an element. ID must be an INTEGER.
- TYPE [ID] "text"   -> Clicks input, clears it, types text. ID must be an INTEGER.
- SCROLL             -> Scrolls down one page.
- FINISH "summary"   -> Task complete.
- DESCRIBE "summary" -> Describes the page.

EXAMPLE RESPONSE:
TYPE 42 "Python Tutorials"
`,
  contextType: 'template',
  context: async (context) => {
    // Fresh vision every time
    const snapshot = await getCleanPageSnapshot();

    return {
      goal: context.goal,
      url: snapshot.url,
      dom: snapshot.domList || "No interactive elements found. Try SCROLL."
    };
  },
  model: Models.SWIZZY_DEFAULT,
  update: async (response, context, actions) => {
    // 1. Clean response
    const cleanResponse = response.replace(/```/g, '').trim();
    const lines = cleanResponse.split('\n');
    const commandLine = lines.find(l => /^(CLICK|TYPE|SCROLL|FINISH)/i.test(l)) || lines[0];

    console.log(`🤖 CMD: ${commandLine}`);

    if (!commandLine) return actions.goto('agent_loop');

    // 2. ROBUST PARSING (Fixes the syntax error issue)
    // We look for: COMMAND + (optional numeric ID) + (optional text in quotes)
    const match = commandLine.match(/^(CLICK|TYPE|SCROLL|FINISH|DESCRIBE)\s*(\d+)?\s*(?:"([^"]+)"|(.+))?/i);
    
    if (!match) {
        console.log("⚠️ Invalid Command Format. Retrying...");
        return actions.goto('agent_loop');
    }

    const action = match[1].toUpperCase();
    const targetId = match[2]; // Captures the digits only
    const textContent = match[3] || match[4]; // Captures text inside OR outside quotes

    try {
      // --- ACTION: FINISH ---
      if (action === 'FINISH') {
        const summary = textContent || "Task Completed";
        console.log(`\n✅ MISSION ACCOMPLISHED: ${summary}`);
        if (browser) await browser.close();
        return actions.stop();
      }

      // --- ACTION: DESCRIBE ---
      if (action === 'DESCRIBE') {
        console.log(`📝 Page Description: ${textContent}`);
        if (browser) await browser.close();
        return actions.stop();
      }

      // --- ACTION: SCROLL ---
      if (action === 'SCROLL') {
        await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
        await new Promise(r => setTimeout(r, 1500));
        return actions.goto('agent_loop');
      }

      // --- ACTION: CLICK / TYPE ---
      // Validation: Ensure ID is actually a number before putting it in a selector
      if (!targetId || !/^\d+$/.test(targetId)) {
          console.log(`⚠️ Invalid or missing ID: "${targetId}". Retrying...`);
          return actions.goto('agent_loop');
      }

      // Get Coordinates from DOM
      const coords = await page.evaluate((id) => {
        const el = document.querySelector(`[data-agent-id="${id}"]`);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, targetId);

      if (!coords) {
        console.log(`⚠️ Element ID ${targetId} not found or moved.`);
        return actions.goto('agent_loop');
      }

      // 1. Move Mouse
      await humanMove(coords.x, coords.y);

      // 2. Click
      await page.mouse.down();
      await new Promise(r => setTimeout(r, 60)); 
      await page.mouse.up();

      // 3. Type
      if (action === 'TYPE' && textContent) {
        // Clear field first
        await page.evaluate((id) => {
          const el = document.querySelector(`[data-agent-id="${id}"]`);
          if (el) el.value = '';
        }, targetId);

        await humanType(textContent);
        await page.keyboard.press('Enter');
      }

      // Wait for navigation
      try {
          // A small wait is usually better than waitForNavigation which can timeout if no nav happens
          await new Promise(r => setTimeout(r, 3000));
      } catch(e) {}

    } catch (err) {
      console.error(`❌ Execution Error: ${err.message}`);
    }

    return actions.goto('agent_loop');
  }
});

// ============================================================================
// START WITH VISUALIZATION
// ============================================================================
async function runBrowserAgent() {
  // Start visualization server
  const { server, url } = await wizard.visualize(3001);
  console.log(`🎨 Browser Agent Visualization: ${url}`);

  wizard.setContext({
    startUrl: 'https://en.wikipedia.org/wiki/Main_Page',
    goal: 'Describe the page you are on and what\'s going on there.'
  });

  await wizard.run();
}

if (require.main === module) {
  runBrowserAgent().catch(console.error);
}

module.exports = { wizard, runBrowserAgent };