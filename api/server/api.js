// Load environment variables from .env file for local development
require('dotenv').config();

// Import required modules
const express = require('express'); // Framework for building the API
const axios = require('axios'); // For making HTTP requests to TextRazor API
const cors = require('cors'); // To handle CORS for cross-origin requests
const natural = require('natural'); // For sentiment analysis and tokenization
const { GoogleGenerativeAI } = require('@google/generative-ai'); // For keyword insertion using Gemini API
const serverless = require('serverless-http'); // For Vercel serverless deployment

// Initialize Express app
const app = express();

// Middleware setup
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse incoming JSON requests

// Load API keys from environment variables
const TEXTRAZOR_API_KEY = process.env.TEXTRAZOR_API_KEY; // TextRazor API key for keyword extraction
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Gemini API key for keyword insertion

// Debug: Log whether API keys are loaded (helps in debugging environment issues)
console.log('TEXTRAZOR_API_KEY:', TEXTRAZOR_API_KEY ? 'Set' : 'Not Set');
console.log('GEMINI_API_KEY:', GEMINI_API_KEY ? 'Set' : 'Not Set');

// Health check endpoint to verify backend is running and API keys are set
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'Backend is running',
    textrazorKeySet: !!TEXTRAZOR_API_KEY,
    geminiKeySet: !!GEMINI_API_KEY
  });
});
export const config = {
  maxDuration: 60, // increase from default 10s to 300s (5 minutes)
};

// Initialize Gemini AI for keyword insertion
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// POST endpoint to analyze text for SEO metrics
app.post('/analyze', async (req, res) => {
  try {
    // Log the incoming request for debugging
    console.log('Received /analyze request with body:', req.body);

    // Extract text from request body
    const { text } = req.body;

    // Validate that text is provided
    if (!text) {
      console.log('Text is missing in request body');
      return res.status(400).json({ error: 'Text is required' });
    }

    // Check if TextRazor API key is set
    if (!TEXTRAZOR_API_KEY) {
      console.error('TEXTRAZOR_API_KEY is not set');
      return res.status(500).json({ error: 'Server configuration error: TextRazor API key is missing' });
    }

    // Initialize keywords array
    let keywords = [];

    // Try to extract keywords using TextRazor API
    try {
      // Prepare parameters for TextRazor API request
      const params = new URLSearchParams();
      params.append('text', text);
      params.append('extractors', 'topics,words'); // Extract topics and words

      console.log('Sending request to TextRazor API');
      const apiResponse = await axios.post('https://api.textrazor.com', params, {
        headers: {
          'x-textrazor-key': TEXTRAZOR_API_KEY,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 6000 // 6-second timeout to prevent Vercel timeout issues
      });

      // Log the TextRazor response for debugging
      console.log('TextRazor Response:', JSON.stringify(apiResponse.data, null, 2));

      // Extract topics as keywords
      keywords = apiResponse.data.response.topics?.map(t => t.label) || [];

      // Fallback: If no topics, extract nouns (NN/NNP) from sentences
      if (!keywords.length && apiResponse.data.response.sentences) {
        const stopWords = new Set(['this', 'is', 'a', 'an', 'the', 'about', 'in', 'on', 'at', 'to']);
        const words = apiResponse.data.response.sentences.flatMap(sentence => sentence.words);
        keywords = words
          .filter(word => 
            (word.partOfSpeech === 'NN' || word.partOfSpeech === 'NNP') && 
            !stopWords.has(word.lemma.toLowerCase())
          )
          .map(word => word.token)
          .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates
      }
    } catch (error) {
      // Log TextRazor API errors
      console.error('TextRazor Error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        stack: error.stack
      });

      // Fallback: Manual keyword extraction if TextRazor fails
      console.log('Falling back to manual keyword extraction');
      const stopWords = new Set(['this', 'is', 'a', 'an', 'the', 'about', 'in', 'on', 'at', 'to']);
      keywords = text
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.has(word.toLowerCase()))
        .slice(0, 5); // Take up to 5 keywords
    }

    // Calculate readability using Flesch-Kincaid formula
    console.log('Calculating readability');
    const readability = calculateReadability(text);

    // Generate suggestions based on extracted keywords
    const suggestions = keywords.length ? `Consider adding keywords: ${keywords.join(', ')}` : 'No suggestions available.';

    // Perform sentiment analysis using natural library
    console.log('Performing sentiment analysis');
    const sentimentAnalyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
    const tokenizer = new natural.WordTokenizer();
    const tokens = tokenizer.tokenize(text);
    const sentimentScore = sentimentAnalyzer.getSentiment(tokens);
    let sentimentTone = 'Neutral';
    if (sentimentScore > 0) sentimentTone = 'Positive';
    else if (sentimentScore < 0) sentimentTone = 'Negative';
    const sentimentSuggestion = sentimentScore < 0 ? 'Consider using more positive language to improve engagement.' : 'Your tone is engaging!';

    // Log the response before sending
    console.log('Sending response:', {
      keywords: keywords.slice(0, 5),
      readability,
      suggestions,
      sentiment: { score: sentimentScore, tone: sentimentTone, suggestion: sentimentSuggestion },
      updatedText: text
    });

    // Send the analysis results
    res.status(200).json({
      keywords: keywords.slice(0, 5),
      readability,
      suggestions,
      sentiment: { score: sentimentScore, tone: sentimentTone, suggestion: sentimentSuggestion },
      updatedText: text
    });
  } catch (error) {
    // Catch any unexpected errors in the endpoint
    console.error('Unexpected error in /analyze:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      error: 'Failed to analyze text',
      details: error.message || 'Unknown error'
    });
  }
});

// POST endpoint to insert a keyword into the text using Gemini API
app.post('/insert-keyword', async (req, res) => {
  try {
    // Log the incoming request for debugging
    console.log('Received /insert-keyword request with body:', req.body);

    // Extract text and keyword from request body
    const { text, keyword } = req.body;

    // Validate that both text and keyword are provided
    if (!text || !keyword) {
      console.log('Text or keyword missing in request body');
      return res.status(400).json({ error: 'Text and keyword are required' });
    }

    // Check if Gemini API key is set
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is not set');
      return res.status(500).json({ error: 'Server configuration error: Gemini API key is missing' });
    }

    // Create a prompt for Gemini API to insert the keyword naturally
    const prompt = `Insert the keyword "${keyword}" into the following text naturally, ensuring grammatical correctness and contextual relevance. The keyword must be inserted at least once. If you cannot find a natural insertion point, append the keyword at the end of the text. If the keyword is SEO-related (e.g., contains "SEO", "marketing", "keyword", "optimization"), append relevant hashtags (e.g., #SEO, #DigitalMarketing) after the keyword in parentheses. Preserve all whitespace, newlines, and formatting in the original text. Return only the modified text without any additional explanation.\n\nText: ${text}`;

    console.log('Sending request to Gemini API');
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7 // Control creativity of the response
      }
    });

    // Extract the updated text from Gemini response
    let updatedText = result.response.text();
    let insertedAt = updatedText.toLowerCase().indexOf(keyword.toLowerCase());
    let keywordLength = keyword.length;

    // Add hashtags if the keyword is SEO-related
    const seoRelatedKeywords = ['seo', 'digital marketing', 'keyword', 'optimization', 'search engine'];
    let keywordWithHashtags = keyword;
    if (seoRelatedKeywords.some(k => keyword.toLowerCase().includes(k))) {
      const seoHashtags = ['#SEO', '#DigitalMarketing', '#ContentMarketing', '#SearchEngineOptimization', '#KeywordResearch'];
      const trendyHashtags = ['#MarketingTrends2025', '#GrowYourBusiness', '#SocialMediaMarketing'];
      const selectedTrendyHashtags = trendyHashtags.slice(0, 2);
      const allHashtags = [...seoHashtags, ...selectedTrendyHashtags].join(' ');
      keywordWithHashtags = `${keyword} (${allHashtags})`;
    }

    // Fallback: If Gemini fails to insert the keyword, append it manually
    if (insertedAt === -1) {
      console.log('Gemini API failed to insert keyword; using fallback mechanism.');
      updatedText = text + (text.endsWith(' ') || text.endsWith('\n') ? '' : ' ') + keywordWithHashtags;
      insertedAt = text.length + (text.endsWith(' ') || text.endsWith('\n') ? 0 : 1);
    }

    // Log the response before sending
    console.log('Sending response:', { updatedText, insertedAt, keywordLength });

    // Send the updated text with insertion details
    res.status(200).json({ updatedText, insertedAt, keywordLength });
  } catch (error) {
    // Catch any unexpected errors in the endpoint
    console.error('Unexpected error in /insert-keyword:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      error: 'Failed to insert keyword',
      details: error.message || 'Unknown error'
    });
  }
});

// Function to calculate readability using Flesch-Kincaid formula
function calculateReadability(text) {
  const words = text.split(/\s+/).length; // Count words
  const sentences = text.split(/[.!?]/).length || 1; // Count sentences, default to 1
  const syllables = text.split(/[aeiouy]+/i).length; // Count syllables
  return Math.round(206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words)); // Flesch-Kincaid formula
}

// Global error handler for uncaught errors
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path
  });
  res.status(500).json({
    error: 'Internal server error',
    details: err.message || 'Unknown error'
  });
});

// Export for Vercel serverless deployment
module.exports = serverless(app);



// For local development, start the Express server
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running locally on http://localhost:${PORT}`);
  });
}