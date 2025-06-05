// Analyzes the input text by sending it to the backend for SEO analysis
async function analyzeText() {
  // Get the text from the input textarea
  const text = document.getElementById('inputText').value;
  
  // Validate that text is provided
  if (!text) {
    alert('Please enter some text to analyze.');
    return;
  }

  // Update UI to show loading state
  const analyzeButton = document.getElementById('analyzeButton');
  const loadingSpinner = document.getElementById('loadingSpinner');
  analyzeButton.querySelector('span').textContent = 'Analyzing...';
  loadingSpinner.classList.remove('hidden');
  analyzeButton.disabled = true;

  // Show results section with a loading placeholder
  document.getElementById('results').classList.remove('hidden');
  document.getElementById('metrics').innerHTML = '<p class="text-gray-500">Loading...</p>';
  document.getElementById('keywords').innerHTML = '';
  document.getElementById('preview').innerText = text;

  try {
    // Send the text to the backend for analysis
    const response = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      mode: 'cors' // Enable CORS for cross-origin requests
    });

    // Check if the response is successful
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Parse and display the analysis results
    const data = await response.json();
    displayResults(data);
  } catch (error) {
    // Show error message if the request fails
    alert(`Failed to analyze text: ${error.message}`);
  } finally {
    // Reset UI state after the request completes
    analyzeButton.querySelector('span').textContent = 'Analyze';
    loadingSpinner.classList.add('hidden');
    analyzeButton.disabled = false;
  }
}

// Displays the SEO analysis results in the UI
function displayResults(data) {
  // Get the DOM elements for updating results
  const metricsDiv = document.getElementById('metrics');
  const keywordsDiv = document.getElementById('keywords');
  const previewDiv = document.getElementById('preview');

  // Determine color for readability score based on value
  let readabilityColor = 'text-gray-500';
  if (data.readability >= 15) readabilityColor = 'text-green-600';
  else if (data.readability >= 11) readabilityColor = 'text-yellow-600';
  else readabilityColor = 'text-red-600';

  // Determine color for sentiment tone
  let sentimentColor = 'text-gray-500';
  if (data.sentiment.tone === 'Positive') sentimentColor = 'text-green-600';
  else if (data.sentiment.tone === 'Negative') sentimentColor = 'text-red-600';
  else sentimentColor = 'text-blue-600';

  // Update metrics section with analysis results
  metricsDiv.innerHTML = `
    <div class="flex items-center mb-2">
      <p class="text-sm mr-2"><strong class="text-indigo-700">Readability Score:</strong> <span class="${readabilityColor}">${data.readability || 'N/A'}</span></p>
      <div class="w-32 h-2 bg-gray-200 rounded-full">
        <div class="h-full rounded-full ${data.readability >= 15 ? 'bg-green-500' : data.readability >= 11 ? 'bg-yellow-500' : 'bg-red-500'}" style="width: ${data.readability || 0}%"></div>
      </div>
    </div>
    <p class="text-sm mb-2"><strong class="text-indigo-700">Sentiment Tone:</strong> <span class="${sentimentColor}">${data.sentiment.tone || 'N/A'}</span></p>
    <p class="text-sm"><strong class="text-indigo-700">Sentiment Suggestion:</strong> ${data.sentiment.suggestion || 'N/A'}</p>
    <p class="text-sm"><strong class="text-indigo-700">Optimization Suggestions:</strong> ${data.suggestions || 'N/A'}</p>
  `;

  // Display recommended keywords as clickable buttons
  keywordsDiv.innerHTML = data.keywords.map(keyword => `
    <button
      class="insert-btn bg-indigo-100 text-indigo-800 px-4 py-1 rounded-full text-sm font-medium hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition duration-200"
      data-keyword="${keyword.replace(/"/g, '"')}"
      aria-label="Insert keyword ${keyword} into the text"
    >
      ${keyword}
    </button>
  `).join('');

  // Add click event listeners to keyword buttons for insertion
  const buttons = document.querySelectorAll('.insert-btn');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const keyword = button.getAttribute('data-keyword');
      insertKeyword(keyword);
    });
  });

  // Update the preview with the analyzed text
  previewDiv.innerHTML = data.updatedText || document.getElementById('inputText').value;
  document.getElementById('copyButton').classList.remove('hidden');
}

// Inserts a keyword into the text by calling the backend
async function insertKeyword(keyword) {
  // Get the current text and validate inputs
  const text = document.getElementById('inputText').value;
  if (!text || !keyword) {
    alert('Text and keyword are required.');
    return;
  }

  // Disable keyword buttons during the request
  const buttons = document.querySelectorAll('.insert-btn');
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
  });

  // Show loading state in the preview
  document.getElementById('preview').innerHTML = 'Inserting keyword...';

  try {
    // Send the text and keyword to the backend for insertion
    const response = await fetch('/insert-keyword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, keyword }),
      mode: 'cors' // Enable CORS for cross-origin requests
    });

    // Check if the response is successful
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Parse the response and update the preview
    const data = await response.json();
    const { updatedText, insertedAt, keywordLength } = data;

    // Highlight the inserted keyword in the preview
    if (insertedAt !== -1 && keywordLength) {
      const keywordWithHashtags = updatedText.slice(insertedAt).match(new RegExp(`${keyword}( \\([^)]+\\))?`))?.[0] || keyword;
      const before = updatedText.slice(0, insertedAt);
      const inserted = keywordWithHashtags;
      const after = updatedText.slice(insertedAt + inserted.length);
      document.getElementById('preview').innerHTML = `${before}<span class="highlighted bg-yellow-200 px-1 rounded">${inserted}</span>${after}`;
    } else {
      document.getElementById('preview').innerHTML = updatedText;
    }

    // Show the copy button
    document.getElementById('copyButton').style.display = 'inline-block';
  } catch (error) {
    // Show error message and reset preview if the request fails
    alert(`Failed to insert keyword: ${error.message}`);
    document.getElementById('preview').innerText = text;
    document.getElementById('copyButton').style.display = 'none';
  } finally {
    // Re-enable keyword buttons after the request completes
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    });
  }
}

// Clears the input textarea and resets the UI
function clearText() {
  const inputText = document.getElementById('inputText');
  inputText.value = '';
  document.getElementById('results').style.display = 'none';
  document.getElementById('preview').innerText = '';
  document.getElementById('wordCount').textContent = 'Words: 0';
  document.getElementById('copyButton').style.display = 'none';
  inputText.focus();
}

// Copies the preview text to the clipboard
function copyToClipboard() {
  const previewText = document.getElementById('preview').innerText;
  navigator.clipboard.writeText(previewText).then(() => {
    const copyButton = document.getElementById('copyButton');
    copyButton.querySelector('span').textContent = 'Copied!';
    setTimeout(() => {
      copyButton.querySelector('span').textContent = 'Copy Text';
    }, 2000);
  }).catch(() => {
    alert('Failed to copy text. Please copy manually.');
  });
}

// Event listeners for UI interactions
// Triggers text analysis when the Analyze button is clicked
document.getElementById('analyzeButton').addEventListener('click', analyzeText);
// Clears the input when the Clear button is clicked
document.getElementById('clearButton').addEventListener('click', clearText);
// Copies the preview text when the Copy button is clicked
document.getElementById('copyButton').addEventListener('click', copyToClipboard);

// Toggles between light and dark theme
if (document.getElementById('themeToggle')) {
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const icon = document.getElementById('themeIcon');
    if (icon) {
      if (document.body.classList.contains('dark')) {
        // Sun icon for dark mode
        icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1 M0 16v1 M21 12h-1 M4 12H3 M15.364 6.364l-.707-.707 M6.343 6.343l-.707-.707 M15.364 17.657l-.707.707 M6.343 17.657l-.707.707 M16 12a4 4 0 11-8 0 4 4 0 018 0z" />`;
      } else {
        // Moon icon for light mode
        icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />`;
      }
    }
  });
}

// Updates word count and enables/disables Analyze button based on input
const inputText = document.getElementById('inputText');
if (inputText) {
  inputText.addEventListener('input', () => {
    const words = inputText.value.trim().split(/\s+/).filter(word => word.length > 0);
    document.getElementById('wordCount').textContent = `Words: ${words.length}`;
    document.getElementById('analyzeButton').disabled = words.length < 50;
  });
}