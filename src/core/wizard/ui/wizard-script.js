let ws;
let steps = [];
const workflowEl = document.getElementById('workflow-content');
const currentEl = document.getElementById('current-content');
const formsEl = document.getElementById('forms-container');
const instructionEl = document.getElementById('instruction-content');

function connectWebSocket() {
  ws = new WebSocket('ws://localhost:' + location.port);
  ws.onopen = () => console.log('🔗 Connected to wizard');
  ws.onmessage = handleMessage;
  ws.onclose = () => {
    console.log('🔌 Disconnected, reconnecting...');
    setTimeout(connectWebSocket, 1000);
  };
  ws.onerror = (error) => console.error('WebSocket error:', error);
}

function handleMessage(event) {
  const data = JSON.parse(event.data);

  // Handle batched messages
  if (data.type === 'batch' && data.messages) {
    data.messages.forEach(msg => processMessage(msg));
  } else {
    processMessage(data);
  }
}

function processMessage(data) {
  switch(data.type) {
    case 'wizard_start':
      initSteps(data.steps);
      break;
    case 'step_update':
      updateStep(data);
      break;
    case 'status_update':
      updateStatus(data.status);
      break;
  }
}

function initSteps(stepList) {
  steps = stepList;
  renderSteps();
}

function updateStep(update) {
  const step = steps.find(s => s.id === update.stepId);
  if (step) {
    step.status = update.status;
    if (update.data) step.data = update.data;
    if (update.instruction) step.instruction = update.instruction;
    if (update.context) step.context = update.context;
    if (update.fields) step.fields = update.fields;
    renderSteps();
    if (update.status === 'current') {
      showCurrentStep(step);
    }
  }
}

function renderSteps() {
  let html = '';
  steps.forEach(step => {
    html += '<div class="step-item status ' + step.status + '" id="step-' + step.id.replace(/"/g, '"') + '">';
    html += '<strong>' + step.id + '</strong> - ' + step.status;
    if (step.status === 'completed' && step.data) {
      html += '<div class="code">' + JSON.stringify(step.data, null, 2).replace(/</g, '<').replace(/>/g, '>') + '</div>';
      // Fix: Escape the quotes properly in the onclick attribute
      html += '<button data-step-id="' + step.id.replace(/"/g, '"') + '" onclick="editStepData(this.getAttribute(\'data-step-id\'))">Edit Data</button>';
    }
    html += '</div>';
  });
  workflowEl.innerHTML = html;
}

function showCurrentStep(step) {
  let html = '<div class="status current">▶️ Executing: ' + step.id + '</div>';
  if (step.context) {
    html += '<h4>Context:</h4><div class="code">' +
      JSON.stringify(step.context, null, 2).replace(/</g, '<').replace(/>/g, '>') + '</div>';
  }
  currentEl.innerHTML = html;
  generateForms(step.fields);

  // Show processed instruction in right panel
  instructionEl.innerHTML = '<div class="code">' + step.instruction.replace(/</g, '<').replace(/>/g, '>') + '</div>';
}

function updateStatus(status) {
  const runBtn = document.getElementById('run-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const resumeBtn = document.getElementById('resume-btn');
  const rewindBtn = document.getElementById('rewind-btn');
  const forwardBtn = document.getElementById('forward-btn');

  if (status.waitingForStart) {
    runBtn.style.display = 'inline-block';
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    rewindBtn.disabled = true;
    forwardBtn.disabled = true;
    currentEl.innerHTML = '<div class="code">Click "Run Wizard" to start execution...</div>';
    instructionEl.innerHTML = '<div class="code">Waiting for wizard to start...</div>';
  } else if (status.completed) {
    runBtn.style.display = 'none';
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    rewindBtn.disabled = false;
    forwardBtn.disabled = true;
    currentEl.innerHTML = '<div class="status">✅ Wizard completed!</div>';
    instructionEl.innerHTML = '<div class="code">Wizard completed</div>';
  } else if (status.isPaused) {
    runBtn.style.display = 'none';
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'inline-block';
    rewindBtn.disabled = false;
    forwardBtn.disabled = false;
  } else if (status.isRunning) {
    runBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-block';
    resumeBtn.style.display = 'none';
    rewindBtn.disabled = true;
    forwardBtn.disabled = true;
  }
}

function generateForms(fields) {
  if (!fields || fields.length === 0) {
    formsEl.innerHTML = '<p>No form required for this step</p>';
    return;
  }

  let html = '<h4>Override Response:</h4>';
  html += '<form id="override-form">';
  fields.forEach(field => {
    html += '<div class="form-group">';
    html += '<label>' + field.key + ' (' + field.type + '):</label>';
    if (field.type === 'string') {
      html += '<textarea name="' + field.key + '" rows="3"></textarea>';
    } else if (field.type === 'number') {
      html += '<input type="number" name="' + field.key + '" />';
    } else if (field.type === 'boolean') {
      html += '<select name="' + field.key + '"><option value="true">true</option><option value="false">false</option></select>';
    } else if (field.type === 'enum' && field.enumValues) {
      html += '<select name="' + field.key + '">';
      field.enumValues.forEach(val => {
        html += '<option value="' + val.replace(/"/g, '"') + '">' + val.replace(/</g, '<').replace(/>/g, '>') + '</option>';
      });
      html += '</select>';
    } else {
      html += '<textarea name="' + field.key + '" rows="3"></textarea>';
    }
    html += '</div>';
  });
  html += '<button type="button" onclick="submitOverride()">Submit Override</button>';
  html += '</form>';

  formsEl.innerHTML = html;
}

function editStepData(stepId) {
  const step = steps.find(s => s.id === stepId);
  if (!step || !step.fields) return;
  // Show edit form for this step
  let html = '<h4>Edit Data for ' + stepId + ':</h4>';
  html += '<form id="edit-form-' + stepId + '">';
  step.fields.forEach(field => {
    const value = step.data ? step.data[field.key] : '';
    html += '<div class="form-group">';
    html += '<label>' + field.key + ' (' + field.type + '):</label>';
    if (field.type === 'string') {
      html += '<textarea name="' + field.key + '" rows="3">' + (value || '').replace(/</g, '<').replace(/>/g, '>') + '</textarea>';
    } else if (field.type === 'number') {
      html += '<input type="number" name="' + field.key + '" value="' + (value || '').replace(/"/g, '"') + '" />';
    } else if (field.type === 'boolean') {
      html += '<select name="' + field.key + '">';
      html += '<option value="true"' + (value === true ? ' selected' : '') + '>true</option>';
      html += '<option value="false"' + (value === false ? ' selected' : '') + '>false</option>';
      html += '</select>';
    } else if (field.type === 'enum' && field.enumValues) {
      html += '<select name="' + field.key + '">';
      field.enumValues.forEach(val => {
        html += '<option value="' + val.replace(/"/g, '"') + '"' + (value === val ? ' selected' : '') + '>' + val.replace(/</g, '<').replace(/>/g, '>') + '</option>';
      });
      html += '</select>';
    } else {
      html += '<textarea name="' + field.key + '" rows="3">' + JSON.stringify(value || '').replace(/</g, '<').replace(/>/g, '>') + '</textarea>';
    }
    html += '</div>';
  });
  html += '<button type="button" onclick=\'submitEdit(' + JSON.stringify(stepId) + ')\'>Update Data</button>';
  html += '</form>';
  // Replace the step item with edit form
  const stepDiv = document.getElementById('step-' + stepId);
  stepDiv.innerHTML = html;
}

function submitEdit(stepId) {
  const form = document.getElementById('edit-form-' + stepId);
  const formData = new FormData(form);
  const data = {};
  for (let [key, value] of formData) {
    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else if (!isNaN(value) && value !== '') data[key] = Number(value);
    else data[key] = value;
  }
  sendMessage('update_step_data', { stepId, data });
  // Optimistically update
  const step = steps.find(s => s.id === stepId);
  if (step) step.data = data;
  renderSteps();
}

function sendMessage(type, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  } else {
    console.warn('WebSocket not connected');
  }
}

function submitOverride() {
  const form = document.getElementById('override-form');
  const formData = new FormData(form);
  const data = {};
  for (let [key, value] of formData) {
    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else if (!isNaN(value) && value !== '') data[key] = Number(value);
    else data[key] = value;
  }
  sendMessage('form_submit', data);
}

workflowEl.innerHTML = '<div class="code">Waiting for wizard to start...</div>';
currentEl.innerHTML = '<div class="code">Wizard will start soon...</div>';
instructionEl.innerHTML = '<div class="code">Waiting for wizard to start...</div>';
connectWebSocket();