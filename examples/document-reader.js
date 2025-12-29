require('dotenv').config();

const { Wizard, Models } = require('@swizzy/kit');
const { z } = require('zod');

const wizard = new Wizard({
  id: 'document-reader-wizard',
  onUsage: (usage, provider) => {
    console.log(`Tokens used: ${usage.totalTokens} (${provider})`);
  }
});

// Sample document content - in a real scenario, this would be loaded from a file
const sampleDocument = `
This is a sample document that we want to process. It contains multiple pages of content that need to be analyzed separately.

Page 1: Introduction
Welcome to our comprehensive guide on artificial intelligence. This document covers various aspects of AI technology, including machine learning, neural networks, and their applications in modern computing.

Page 2: Machine Learning Basics
Machine learning is a subset of artificial intelligence that enables computers to learn without being explicitly programmed. It involves algorithms that can identify patterns in data and make predictions or decisions based on those patterns.

Page 3: Neural Networks
Neural networks are computing systems inspired by biological neural networks. They consist of interconnected nodes or neurons that process and transmit information. Deep learning uses multi-layered neural networks for complex pattern recognition.

Page 4: Applications
AI has numerous applications across various industries:
- Healthcare: Disease diagnosis, drug discovery
- Finance: Fraud detection, algorithmic trading
- Transportation: Autonomous vehicles, route optimization
- Entertainment: Content recommendation, game AI

Page 5: Future of AI
The future of artificial intelligence looks promising with ongoing research in areas like quantum computing, explainable AI, and artificial general intelligence. Ethical considerations and responsible development will be crucial as AI continues to advance.
`;

// Pre-split document into pages for this example
const documentPages = [
  { pageNumber: 1, content: "Page 1: Introduction\nWelcome to our comprehensive guide on artificial intelligence. This document covers various aspects of AI technology, including machine learning, neural networks, and their applications in modern computing." },
  { pageNumber: 2, content: "Page 2: Machine Learning Basics\nMachine learning is a subset of artificial intelligence that enables computers to learn without being explicitly programmed. It involves algorithms that can identify patterns in data and make predictions or decisions based on those patterns." },
  { pageNumber: 3, content: "Page 3: Neural Networks\nNeural networks are computing systems inspired by biological neural networks. They consist of interconnected nodes or neurons that process and transmit information. Deep learning uses multi-layered neural networks for complex pattern recognition." },
  { pageNumber: 4, content: "Page 4: Applications\nAI has numerous applications across various industries:\n- Healthcare: Disease diagnosis, drug discovery\n- Finance: Fraud detection, algorithmic trading\n- Transportation: Autonomous vehicles, route optimization\n- Entertainment: Content recommendation, game AI" },
  { pageNumber: 5, content: "Page 5: Future of AI\nThe future of artificial intelligence looks promising with ongoing research in areas like quantum computing, explainable AI, and artificial general intelligence. Ethical considerations and responsible development will be crucial as AI continues to advance." }
];

// Step 1: Ask a question
wizard.addTextStep({
  id: 'ask_question',
  instruction: 'Generate an interesting question about artificial intelligence based on the document content. Make it something that would require searching through multiple sections to answer fully.',
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log('Question generated:', result);
    actions.updateContext({ currentQuestion: result });
    return actions.next();
  }
});

// Step 2: Compute step to initiate bungee search
wizard.addComputeStep({
  id: 'initiate_search',
  instruction: 'Initiate parallel search across document pages',
  update: (result, context, actions) => {
    // Check if search has already been completed
    const searchResults = Object.keys(context).filter(key => key.startsWith('search_result_page_'));
    if (searchResults.length > 0) {
      console.log('Search already completed, moving to synthesis');
      return actions.goto('synthesize_results');
    }

    console.log('Initiating parallel search for:', context.currentQuestion);

    // Launch bungee jump with search workers for each page
    return actions.bungee.init()
      .batch('search_page', documentPages.length, (index) => ({
        pageData: documentPages[index],
        question: context.currentQuestion
      }))
      .config({ concurrency: 3 }) // Process up to 3 pages concurrently
      .jump();
  }
});

// Step 3: Search step that runs in parallel on each page
wizard.addTextStep({
  id: 'search_page',
  instruction: `Search this document page for content related to the question: "{{question}}"

Page {{pageData.pageNumber}} content:
{{pageData.content}}

If you find relevant information, return:
- The page number
- A relevant quote from the content
- The paragraph containing the information

If no relevant information is found, return "No relevant content found on this page."`,
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log(`Search completed on page ${context.pageData.pageNumber}`);

    if (result && result !== "No relevant content found on this page.") {
      // Store search results
      actions.updateContext({
        [`search_result_page_${context.pageData.pageNumber}`]: {
          pageNumber: context.pageData.pageNumber,
          quote: result,
          question: context.question
        }
      });
    }

    return actions.next();
  }
});

// Step 4: Synthesize results
wizard.addTextStep({
  id: 'synthesize_results',
  instruction: `Based on all the search results found across the document pages, provide a comprehensive answer to the question: "{{currentQuestion}}"

Search Results:
{{context}}

Please synthesize all relevant information into a coherent answer.`,
  model: Models.SWIZZY_DEFAULT,
  update: (result, context, actions) => {
    console.log('Search synthesis completed');
    actions.updateContext({ finalAnswer: result });
    return actions.stop();
  }
});

async function runDocumentReader() {
  try {
    // Set initial context with document pages
    wizard.setContext({
      documentPages: documentPages
    });

    console.log('📄 Document Search Wizard');
    console.log('========================');
    console.log(`Document split into ${documentPages.length} pages for parallel search`);

    // Run the wizard
    await wizard.run();

    console.log('Document search completed');
    console.log('Final answer:', wizard.getContext().finalAnswer);

  } catch (error) {
    console.error('Document reader error:', error);
  }
}

runDocumentReader();