require('dotenv').config();
const { Wizard, Models } = require('@swizzy/kit');
const { z } = require('zod');
const puppeteer = require('puppeteer');
const fs = require('fs');
const http = require('http');

async function postDataToBackend(data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      teamId: "arsenal",
      season: "2024-25",
      data: data
    });
    const options = {
      hostname: '127.0.0.1',
      port: 8787,
      path: '/data/stats',
      method: 'POST',
      headers: {
        'X-API-Key': '7383f34ef9afe72be95cfab5c12e9a2950d2313214a4c9bd625b90297cabf86a',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        console.log(`POST Response: ${res.statusCode} ${body}`);
        resolve();
      });
    });
    req.on('error', (e) => {
      console.error('POST Error:', e);
      reject(e);
    });
    req.write(postData);
    req.end();
  });
}

const wizard = new Wizard({ id: 'simple-scraper' });
let browser, page;

// ============================================================================
// STEP 1: LOAD & SCAN (The "Eyes")
// ============================================================================
wizard.addComputeStep({
  id: 'init',
  update: async (result, context, actions) => {
     browser = await puppeteer.launch({ 
        headless: false, 
        defaultViewport: null, // 👈 KEY: Disables internal 800x600 limit
        args: [
            '--window-size=1600,900', // 👈 KEY: Sets actual window UI size
            '--no-sandbox'
        ]
    });

    // 2. Fix the "Blank Page" issue
    // Don't use browser.newPage(); use the existing one.
    const pages = await browser.pages();
    page = pages.length > 0 ? pages[0] : await browser.newPage();
    
    // Optional: Ensure viewport matches window
    await page.setViewport({ width: 1600, height: 900 });

    await page.goto(context.url, { waitUntil: 'domcontentloaded' });

    await page.goto(context.url, { waitUntil: 'domcontentloaded' });

    // 1. Reveal Hidden FBref Tables (Required)
    await page.evaluate(() => {
        const comments = document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT);
        let node;
        while(node = comments.nextNode()) {
            if(node.nodeValue.includes('<table')) {
                const div = document.createElement('div');
                div.innerHTML = node.nodeValue;
                node.parentNode.insertBefore(div, node);
            }
        }
    });

    // 2. Simple Scan: Just get ID and Title
    const tables = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('table')).map(t => 
            `ID: #${t.id || 'no-id'} | Name: ${t.querySelector('caption')?.innerText || 'Unknown'}`
        );
    });

    context.tableList = tables.join('\n');
    return actions.goto('decide_mode');
  }
});

// ============================================================================
// STEP 2: DECIDE EXTRACTION MODE
// ============================================================================
wizard.addStep({
  id: 'decide_mode',
  model: Models.SWIZZY_DEFAULT,
  instruction: `
    GOAL: {{goal}}

    Decide the extraction mode based on the goal.
    - If the goal requires extracting all tables or mentions "all", choose 'all'.
    - Otherwise, choose 'pick' to select specific tables.
  `,
  schema: z.object({
    mode: z.enum(['pick', 'all']).describe("Extraction mode: 'pick' for specific tables, 'all' for all tables")
  }),
  contextType: "template",
  context: async (context) => ({ goal: context.goal }),
  update: async (data, context, actions) => {
    if (data.mode === 'pick') {
      return actions.goto('pick_tables');
    } else {
      // Extract all table selectors
      const allSelectors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('table')).map(t => `#${t.id}`).filter(id => id !== '#');
      });
      context.targets = allSelectors;
      console.log(`🎯 Extracting all tables: ${allSelectors.join(', ')}`);
      return actions.goto('extract');
    }
  }
});

// ============================================================================
// STEP 3: LLM DECISION (The "Brain")
// ============================================================================
// SUPER SIMPLE SCHEMA: Just an array of strings.
wizard.addStep({
  id: 'pick_tables',
  model: Models.SWIZZY_DEFAULT,
  instruction: `
    GOAL: {{goal}}
    
    AVAILABLE TABLES:
    {{tables}}

    INSTRUCTION:
    Return the CSS selectors (IDs) for the tables that best match the goal.
  `,
  schema: z.object({
    selectors: z.array(z.string()).describe("Array of CSS selectors, e.g. ['#match_logs_for', '#stats_standard_9']")
  }),
  contextType: "template",
  context: async (context) => {
    return {
      goal: context.goal,
      tables: context.tableList
    };
  },
  update: async (data, context, actions) => {
    console.log(`🎯 Target Tables: ${data.selectors.join(', ')}`);
    context.targets = data.selectors;
    return actions.goto('extract');
  }
});

// ============================================================================
// STEP 3: EXTRACT (The "Hands")
// ============================================================================
wizard.addComputeStep({
  id: 'extract',
  update: async (result, context, actions) => {
    const data = await page.evaluate((selectors) => {
        const results = {};
        selectors.forEach(sel => {
            const table = document.querySelector(sel);
            if (table) {
                // Simple extraction logic
                const rows = [];
                const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
                
                table.querySelectorAll('tbody tr').forEach(tr => {
                    if (tr.classList.contains('thead')) return; // skip sub-headers
                    const row = {};
                    tr.querySelectorAll('td, th').forEach((cell, i) => {
                        // Use data-stat if available (cleaner), else use header index
                        const key = cell.getAttribute('data-stat') || headers[i] || `col_${i}`;
                        row[key] = cell.innerText.trim();
                    });
                    if (Object.keys(row).length > 0) rows.push(row);
                });
                results[sel] = rows;
            }
        });
        return results;
    }, context.targets);

    context.extractedData = data;

    // Save
    fs.writeFileSync('scraped_data.json', JSON.stringify(data, null, 2));
    console.log("✅ Data Saved to scraped_data.json");

    // Post to backend
    try {
      await postDataToBackend(data);
      console.log("✅ Data posted to backend");
    } catch (error) {
      console.error("❌ Failed to post data:", error);
    }

    return actions.goto('generate_report');
  }
});

// ============================================================================
// STEP 4: GENERATE TEXT REPORT
// ============================================================================
wizard.addStep({
  id: 'generate_report',
  model: Models.SWIZZY_DEFAULT,
  instruction: `
    Based on the extracted data from the tables, generate a comprehensive textual summary report.

    Summarize key information, statistics, and insights from the data.
    Present it in a readable text format.
  `,
  schema: z.object({
    report: z.string().describe("Textual summary report of the extracted data")
  }),
  contextType: "template",
  context: async (context) => ({ data: JSON.stringify(context.extractedData) }),
  update: async (data, context, actions) => {
    fs.writeFileSync('report.txt', data.report);
    console.log("✅ Text report saved to report.txt");

    await browser.close();
    return actions.stop();
  }
});

// RUN
wizard.setContext({
    url: 'https://fbref.com/en/comps/9/Premier-League-Stats',
    goal: 'Get ALL TABLES related to the premier league ensuere the club id is included'
});
wizard.run();