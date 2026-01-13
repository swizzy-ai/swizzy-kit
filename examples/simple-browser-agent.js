require('dotenv').config();
const { Wizard, Models } = require('@swizzy/kit');
const { z } = require('zod');
const puppeteer = require('puppeteer');
const fs = require('fs');

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
    return actions.goto('pick_tables');
  }
});

// ============================================================================
// STEP 2: LLM DECISION (The "Brain")
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

    // Save
    fs.writeFileSync('scraped_data.json', JSON.stringify(data, null, 2));
    console.log("✅ Data Saved to scraped_data.json");
    
    await browser.close();
    return actions.stop();
  }
});

// RUN
wizard.setContext({
    url: 'https://fbref.com/en/squads/18bb7c10/Arsenal-Stats',
    goal: 'Get ALL TABLES related to arsenal and the players all tables should be extracted'
});
wizard.run();