We just finished designing the wizard and i have to pen down why the wizard is important and why the thing we built matters first i would have to talk about the current state of llm orchestration i think that the current state is a bit broken and the mental models for LLM agents are all wrong the current opinion is that the LLM itself is the agent or the intelligent entity and handing a toolkit is the way to work. This opinion has its strengths because we can see the success of claude code it turns out that if you put a sufficiently intelligent enough model in the right environment and the right tools it can do magic but this paradigm has also failed in the real world where the environment isnt quite right and the cost of mistakes or hallucinations from the model is detrimental. Also there is the huge problem of context. There is only a finite amount of information a model can see on any turn and each turn different from the next, like summoning a new spirit per turn. This means that LLMs are largely limited by how much informaion they can take in at once. Well at least not with wizards

Wizards break the core premise of todays agent design. It stands with the opinon that real agency and intelligence are emergent products of process and design and our goal is to design somehting like agentic lego bricks for to be used.

Wizards let the developer present the user with a bunch of infromsion and collect the right or specific piece of incionaltion needed this makes the developer the orchestrator and the dwesigner and the llm the User. the User uses its expertise to guide the LLM on each step so the llm sticks to the job of generating the best plausible text for each scenario

Core Components of the Wizard: The Steps

The step is the core building block of the wizard the developer defines each step specifying what should be asked of the llm and then what piece of context or state should be updated and then what step should be done next.

Componenents of the step

1 The Step Variants.
There are three variants of steps the Normal Step which is a step tht provides the llm with an insturcion and a schema and then tells the llm to generate an object or data structure that matches that schema

2 the text step is a step that collects a sngle text back from the llm no schema is needed

3 the compute step this is the step that is used for non llm process and compute based operations ie run some calcualtion fetch some data etc this step handles it

Steps Part 2: The Context Function
The context function is a function tht lets you to define what to show the LLM. The context funcion allows you to drill down the context to be shown to the agent. when its making its run

Steps Part 3: The Instruction
The instucion is the contxt thext to be shown to the agent or the llm when we run it the instion is a template engine that can be used to process the context funcion at run replacing dummy data with real data

Steps Part 4: The Update function
The update function is a step created to be able to udpate the context state with the new informaion generated afterr a step runs it also used to run the actions needed ie the next action or the next step

Steps Part 5: The Control Actions
These are the cions used to control the flow of the operison and to control what step runs next we can also use the goto action to go to a specific step the retry to retry a specific step the next to go to the next sequential step

Steps Part 5: The Bungee action
The bungee acion is an advanced step action used to navigate to a step and thenreturn back to the anchor step the bungee acion has an anchor step and a bunch of desinaions each desinson can run parallel and then run back the anchor will run again. The bungee can also be used to telescope unique informson to the same step as it runs allowing each stpe run to see multiple things this letsus to implrment complex acion patterns and to make parallel runs