async function analyzeText() {
  const text = document.getElementById('inputText').value;
  if (!text) {
    alert('Please enter some text to analyze.');
    return;
  }

  const analyzeButton = document.getElementById('analyzeButton');
  const loadingSpinner = document.getElementById('loadingSpinner');
  analyzeButton.querySelector('span').textContent = 'Analyzing...';
  loadingSpinner.classList.remove('hidden');
  analyzeButton.disabled = true;

  document.getElementById('results').classList.remove('hidden');
  document.getElementById('metrics').innerHTML = '<p class="text-gray-500">Loading...</p>';
  document.getElementById('keywords').innerHTML = '';
  document.getElementById('preview').innerText = text;

  try {
    const response = await fetch('http://localhost:3000/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    displayResults(data);
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to analyze text. Please check the server and try again.');
  } finally {
    analyzeButton.querySelector('span').textContent = 'Analyze';
    loadingSpinner.classList.add('hidden');
    analyzeButton.disabled = false;
  }
}

function displayResults(data) {
  const metricsDiv = document.getElementById('metrics');
  const keywordsDiv = document.getElementById('keywords');
  const previewDiv = document.getElementById('preview');

  // Determine readability color based on score
  let readabilityColor = 'text-gray-500';
  if (data.readability >= 60) readabilityColor = 'text-green-600';
  else if (data.readability >= 30) readabilityColor = 'text-yellow-600';
  else readabilityColor = 'text-red-600';

  // Determine sentiment color based on tone
  let sentimentColor = 'text-gray-500';
  if (data.sentiment.tone === 'Positive') sentimentColor = 'text-green-600';
  else if (data.sentiment.tone === 'Negative') sentimentColor = 'text-red-600';
  else sentimentColor = 'text-blue-600';

  metricsDiv.innerHTML = `
    <div class="flex items-center mb-2">
      <p class="text-sm mr-2"><strong class="text-indigo-700">Readability Score:</strong> <span class="${readabilityColor}">${data.readability || 'N/A'}</span></p>
      <div class="w-32 h-2 bg-gray-200 rounded-full">
        <div class="h-full rounded-full ${data.readability >= 60 ? 'bg-green-500' : data.readability >= 30 ? 'bg-yellow-500' : 'bg-red-500'}" style="width: ${data.readability || 0}%"></div>
      </div>
    </div>
    <p class="text-sm mb-2"><strong class="text-indigo-700">Sentiment Tone:</strong> <span class="${sentimentColor}">${data.sentiment.tone || 'N/A'}</span></p>
    <p class="text-sm"><strong class="text-indigo-700">Sentiment Suggestion:</strong> ${data.sentiment.suggestion || 'N/A'}</p>
    <p class="text-sm"><strong class="text-indigo-700">Optimization Suggestions:</strong> ${data.suggestions || 'N/A'}</p>
  `;

  keywordsDiv.innerHTML = data.keywords.map(keyword => `
    <button
      class="insert-btn bg-indigo-100 text-indigo-800 px-4 py-1 rounded-full text-sm font-medium hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition duration-200"
      data-keyword="${keyword.replace(/"/g, '"')}"
      aria-label="Insert keyword ${keyword} into the text"
    >
      ${keyword}
    </button>
  `).join('');

  const buttons = document.querySelectorAll('.insert-btn');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const keyword = button.getAttribute('data-keyword');
      insertKeyword(keyword);
    });
  });

  previewDiv.innerHTML = data.updatedText || document.getElementById('inputText').value;
  // Show Copy to Clipboard button if preview has content
  document.getElementById('copyButton').classList.remove('hidden');
}

async function insertKeyword(keyword) {
  const text = document.getElementById('inputText').value;
  if (!text || !keyword) {
    alert('Text and keyword are required.');
    return;
  }

  const buttons = document.querySelectorAll('.insert-btn');
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
  });
  document.getElementById('preview').innerHTML = 'Inserting keyword...';

  try {
    const response = await fetch('http://localhost:3000/insert-keyword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, keyword })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    const { updatedText, insertedAt, keywordLength } = data;
    if (insertedAt !== -1 && keywordLength) {
      const before = updatedText.slice(0, insertedAt);
      const inserted = updatedText.slice(insertedAt, insertedAt + keywordLength);
      const after = updatedText.slice(insertedAt + keywordLength);
      document.getElementById('preview').innerHTML = `${before}<span class="highlighted bg-yellow-200 px-1 rounded">${inserted}</span>${after}`;
    } else {
      document.getElementById('preview').innerHTML = updatedText;
    }
    document.getElementById('copyButton').classList.remove('hidden');
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to insert keyword. Please check the server and try again.');
    document.getElementById('preview').innerText = text;
    document.getElementById('copyButton').classList.add('hidden');
  } finally {
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    });
  }
}

function clearText() {
  const inputText = document.getElementById('inputText');
  inputText.value = '';
  document.getElementById('results').classList.add('hidden');
  document.getElementById('preview').innerText = '';
  document.getElementById('wordCount').textContent = 'Words: 0';
  document.getElementById('copyButton').classList.add('hidden');
  inputText.focus();
}

function copyToClipboard() {
  const previewText = document.getElementById('preview').innerText; // Use innerText to exclude HTML tags
  navigator.clipboard.writeText(previewText).then(() => {
    const copyButton = document.getElementById('copyButton');
    copyButton.querySelector('span').textContent = 'Copied!';
    setTimeout(() => {
      copyButton.querySelector('span').textContent = 'Copy Text';
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
    alert('Failed to copy text. Please copy manually.');
  });
}

document.getElementById('themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const icon = document.getElementById('themeIcon');
  if (document.body.classList.contains('dark')) {
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />`;
  } else {
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />`;
  }
});

const inputText = document.getElementById('inputText');
inputText.addEventListener('input', () => {
  const words = inputText.value.trim().split(/\s+/).filter(word => word.length > 0);
  document.getElementById('wordCount').textContent = `Words: ${words.length}`;
  document.getElementById('analyzeButton').disabled = words.length < 50;
});