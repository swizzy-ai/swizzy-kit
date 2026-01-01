require('dotenv').config();

const { Wizard, Models } = require('@swizzy/kit');
const { z } = require('zod');

const wizard = new Wizard({
  id: 'log-reader-wizard',
  onUsage: (usage, provider) => {
    console.log(`Tokens used: ${usage.totalTokens} (${provider})`);
  }
});

// Sample log content - system event log
const sampleLog = `
This is a system event log containing various entries from different components.

Page 1: System Startup
[2024-01-01 08:00:00] INFO: System startup initiated
[2024-01-01 08:00:05] INFO: Database connection established
[2024-01-01 08:00:10] INFO: Web server started on port 8080
[2024-01-01 08:00:15] INFO: Authentication service initialized

Page 2: User Activity
[2024-01-01 09:00:00] INFO: User login - username: admin
[2024-01-01 09:15:00] INFO: File upload - user: admin, file: report.pdf
[2024-01-01 09:30:00] INFO: Database query executed - table: users
[2024-01-01 09:45:00] INFO: User logout - username: admin

Page 3: Error Events
[2024-01-01 10:00:00] ERROR: Database connection timeout
[2024-01-01 10:05:00] WARN: High memory usage detected
[2024-01-01 10:10:00] ERROR: File upload failed - permission denied
[2024-01-01 10:15:00] INFO: Error recovery initiated

Page 4: Network Activity
[2024-01-01 11:00:00] INFO: Network interface eth0 up
[2024-01-01 11:05:00] INFO: Firewall rules updated
[2024-01-01 11:10:00] WARN: Unusual network traffic detected
[2024-01-01 11:15:00] INFO: VPN connection established

Page 5: System Maintenance
[2024-01-01 12:00:00] INFO: Backup process started
[2024-01-01 12:30:00] INFO: System update applied
[2024-01-01 13:00:00] INFO: Backup completed successfully
[2024-01-01 13:30:00] INFO: Maintenance window closed
`;

// Pre-split log into pages for this example
const logPages = [
  { pageNumber: 1, content: "Page 1: System Startup\n[2024-01-01 08:00:00] INFO: System startup initiated\n[2024-01-01 08:00:05] INFO: Database connection established\n[2024-01-01 08:00:10] INFO: Web server started on port 8080\n[2024-01-01 08:00:15] INFO: Authentication service initialized" },
  { pageNumber: 2, content: "Page 2: User Activity\n[2024-01-01 09:00:00] INFO: User login - username: admin\n[2024-01-01 09:15:00] INFO: File upload - user: admin, file: report.pdf\n[2024-01-01 09:30:00] INFO: Database query executed - table: users\n[2024-01-01 09:45:00] INFO: User logout - username: admin" },
  { pageNumber: 3, content: "Page 3: Error Events\n[2024-01-01 10:00:00] ERROR: Database connection timeout\n[2024-01-01 10:05:00] WARN: High memory usage detected\n[2024-01-01 10:10:00] ERROR: File upload failed - permission denied\n[2024-01-01 10:15:00] INFO: Error recovery initiated" },
  { pageNumber: 4, content: "Page 4: Network Activity\n[2024-01-01 11:00:00] INFO: Network interface eth0 up\n[2024-01-01 11:05:00] INFO: Firewall rules updated\n[2024-01-01 11:10:00] WARN: Unusual network traffic detected\n[2024-01-01 11:15:00] INFO: VPN connection established" },
  { pageNumber: 5, content: "Page 5: System Maintenance\n[2024-01-01 12:00:00] INFO: Backup process started\n[2024-01-01 12:30:00] INFO: System update applied\n[2024-01-01 13:00:00] INFO: Backup completed successfully\n[2024-01-01 13:30:00] INFO: Maintenance window closed" }
];

// Step 1: Assistant - responds and optionally searches
wizard.addTextStep({
  id: 'assistant',
  instruction: `You are a system administrator assistant. Answer the user's question: {{userQuestion}}

{{searchResultsText}}



If you need to search the logs for more specific information to provide a complete answer, include a SEARCH_RECORD line with a specific search term.

Format your response as:
RESPONSE: [your answer here]

If searching is needed:
SEARCH_RECORD: [specific search term for log entries]

If no search is needed, just provide the RESPONSE.`,
  contextType: 'template',
  context: (context) => {
    const searchResults = Object.keys(context).filter(key => key.startsWith('search_result_page_')).map(key => context[key]);
    return {
      userQuestion: context.userQuestion,
      searchResultsText: searchResults.length > 0 ? `Search results from log analysis:\n${searchResults.map(r => `Page ${r.pageNumber}: ${r.entries}`).join('\n\n')}` : ''
    };
  },
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    if (context.finalResponse) return actions.stop();

    console.log('Assistant response:', result);

    // Check if search results exist (second run after search)
    const searchResults = Object.keys(context).filter(key => key.startsWith('search_result_page_'));
    if (searchResults.length > 0) {
      // Second run: provide final response incorporating search results
      actions.updateContext({ finalResponse: result });
      return actions.stop();
    }

    // First run: check if search is requested
    if (result.includes('SEARCH_RECORD:')) {
      const searchRecordMatch = result.match(/SEARCH_RECORD:\s*(.+)/i);
      if (searchRecordMatch) {
        const searchRecord = searchRecordMatch[1].trim();
        console.log('Initiating search for:', searchRecord);

        actions.updateContext({
          initialResponse: result,
          searchRecord: searchRecord
        });

        // Launch bungee jump with search workers for each page
        return actions.bungee.init()
          .batch('search_page', logPages.length, (index) => ({
            pageData: logPages[index],
            searchRecord: searchRecord
          }))
          .config({ concurrency: 3 }) // Process up to 3 pages concurrently
          .jump();
      }
    }

    // No search needed, final response
    actions.updateContext({ finalResponse: result });
    return actions.stop();
  }
});

// Step 2: Search step that runs in parallel on each page
wizard.addTextStep({
  id: 'search_page',
  instruction: `Search this log page for entries related to: 
  
SEARCH RECORDS

{{searchRecord}}

Page {{pageData.pageNumber}} content:
{{pageData.content}}

If you find relevant log entries, return:
- The page number
- The relevant log entries
- A brief summary of what was found

If no relevant entries are found, return "No relevant log entries found on this page."`,
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log(`Search completed on page ${context.pageData.pageNumber}`);

    if (result && result !== "No relevant log entries found on this page.") {
      // Store search results
      actions.updateContext({
        [`search_result_page_${context.pageData.pageNumber}`]: {
          pageNumber: context.pageData.pageNumber,
          entries: result,
          searchRecord: context.searchRecord
        }
      });
    }

    return actions.next();
  }
});

async function runLogReader() {
  try {
    // Set initial context with user question and log pages
    wizard.setContext({
      userQuestion: "What database connection errors occurred on 2024-01-01?",
      logPages: logPages
    });

    console.log('📋 System Log Reader');
    console.log('====================');
    console.log(`Log split into ${logPages.length} pages for parallel search`);

    // Run the wizard
    await wizard.run();

    console.log('Log analysis completed');
    console.log('Final response:', wizard.getContext().finalResponse);

  } catch (error) {
    console.error('Log reader error:', error);
  }
}

runLogReader();