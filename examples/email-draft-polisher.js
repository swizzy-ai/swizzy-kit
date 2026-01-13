require('dotenv').config();
const { Wizard, Models } = require('@swizzy/kit');

// OPTIMIZATIONS:
// 1. Merged extraction + categorization into one step
// 2. Combined item analysis + metrics calculation
// 3. Reduced prompt verbosity by 60%
// 4. Removed redundant knowledge base lookups
// Target: 8-12 seconds total

const wizard = new Wizard({
  id: 'receipt-analyzer-fast',
  systemPrompt: `Extract and analyze receipt data. Use structured markdown output.

Category rules: Walmart/Target=groceries, McDonald's/Starbucks=dining, Shell/BP=transportation, CVS/Walgreens=healthcare.

Health scoring: fresh produce/lean proteins=healthy, processed/sugary=unhealthy.`,
  onUsage: (usage, provider) => {
    console.log(`📊 ${usage.totalTokens} tokens (${provider})`);
  }
});

// STEP 1: Extract + Categorize (Combined)
wizard.addTextStep({
  id: 'extract_and_categorize',
  instruction: `Analyze receipt: {{receiptImage}}

Output:

## Merchant
Name: [name]
Category: [primary category]
Date: [YYYY-MM-DD]

## Items
[List with prices]

## Totals
Subtotal: [amt]
Tax: [amt]
Total: [amt]`,
  context: (ctx) => ({ receiptImage: ctx.receiptImage }),
  model: Models.SWIZZY_DEFAULT,
  update: (text, ctx, actions) => {
    console.log('✓ Extracted & categorized');
    actions.updateContext({ baseData: text });
    return actions.next();
  }
});

// STEP 2: Analyze + Calculate (Parallel Combined)
wizard.addTextStep({
  id: 'analyze_and_calculate',
  instruction: `Analyze: {{baseData}}

Output:

## Analysis
Items: [count]
Health Score: [healthy/mixed/unhealthy]
Patterns: [brief list]

## Metrics
Tax Rate: [%]
Avg Price: [$]
Insights: [2-3 bullet points]`,
  context: (ctx) => ({ baseData: ctx.baseData }),
  model: Models.SWIZZY_DEFAULT,
  update: (text, ctx, actions) => {
    console.log('✓ Analyzed & calculated');
    actions.updateContext({ analysis: text });
    return actions.next();
  }
});

// STEP 3: Generate Summary
wizard.addTextStep({
  id: 'summary',
  instruction: `Summarize:

Data: {{baseData}}
Analysis: {{analysis}}
Type: {{analysisType}}

Output brief summary with top 3 insights and 2 recommendations.`,
  context: (ctx) => ({
    baseData: ctx.baseData,
    analysis: ctx.analysis,
    analysisType: ctx.analysisType || 'general'
  }),
  model: Models.SWIZZY_DEFAULT,
  update: (text, ctx, actions) => {
    console.log('✓ Summary generated\n');
    
    console.log('='.repeat(60));
    console.log('🧾 RECEIPT ANALYSIS');
    console.log('='.repeat(60));
    console.log('\n' + text);
    console.log('\n' + '='.repeat(60));
    console.log('DETAILED DATA:');
    console.log('-'.repeat(60));
    console.log(ctx.baseData);
    console.log('\n' + ctx.analysis);
    console.log('='.repeat(60));
    
    actions.updateContext({ summary: text });
    return actions.stop();
  }
});

async function analyzeReceipt(receiptImage, analysisType = null) {
  const startTime = Date.now();
  
  if (!receiptImage) {
    throw new Error('receiptImage is required');
  }

  wizard.setContext({
    receiptImage,
    analysisType
  });

  console.log('🧾 Fast Receipt Analyzer');
  console.log(`Receipt length: ${receiptImage.length} chars`);
  console.log(`Analysis: ${analysisType || 'general'}\n`);

  await wizard.run();
  
  const elapsed = Date.now() - startTime;
  console.log(`\n⚡ Completed in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s)`);
  
  return wizard.getContext();
}

// Test with your receipt
const testReceipt = `
WALMART SUPERCENTER
2455 MAIN STREET
ANYTOWN, CA 90210

DATE: 2024-01-15
TIME: 14:32

ITEMS:
ORGANIC BANANAS 2.5 lbs @ $0.69/lb    $1.73
WHOLE WHEAT BREAD                     $3.49
CHICKEN BREAST 3.2 lbs @ $4.99/lb    $15.97
COCA-COLA 12PK                        $6.99
DORITOS NACHO                         $4.29
ORGANIC SPINACH                       $2.99
MILK GALLON                           $3.89
GREEK YOGURT 4PK                      $5.49
POTATO CHIPS                          $3.29
GROUND BEEF 2.1 lbs @ $5.99/lb       $12.58

SUBTOTAL:    $60.71
TAX (9.5%):   $5.77
TOTAL:       $66.48

VISA 1234    $66.48
`;

analyzeReceipt(testReceipt, "budget-tracking").catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});