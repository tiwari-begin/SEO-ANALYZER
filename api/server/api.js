const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const natural = require('natural');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const serverless = require('serverless-http');

// Load environment variables
dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize APIs
const TEXTRAZOR_API_KEY = process.env.TEXTRAZOR_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Timeout helper function
const timeoutPromise = (promise, time) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), time))
  ]);
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'Backend is running',
    textrazorKeySet: !!TEXTRAZOR_API_KEY,
    geminiKeySet: !!GEMINI_API_KEY
  });
});

// Analyze endpoint
app.post('/analyze', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    // Parallelize TextRazor and Gemini API calls with timeouts
    const [textrazorResponse, geminiResult] = await Promise.all([
      timeoutPromise(
        axios.post(
          'https://api.textrazor.com',
          `text=${encodeURIComponent(text)}&extractors=entities,topics`,
          {
            headers: {
              'X-TextRazor-Key': TEXTRAZOR_API_KEY,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        ),
        20000 // 20-second timeout for TextRazor
      ).catch(err => {
        console.error('TextRazor timeout or error:', err.message);
        return { data: { response: { entities: [] } } }; // Fallback response
      }),
      timeoutPromise(
        (async () => {
          const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
          const prompt = `Analyze the sentiment of the following text and return a JSON object with "tone" (Positive, Negative, or Neutral) and a "suggestion" for improvement: "${text}"`;
          const result = await model.generateContent(prompt);
          return JSON.parse(result.response.text());
        })(),
        20000 // 20-second timeout for Gemini
      ).catch(err => {
        console.error('Gemini timeout or error:', err.message);
        return { tone: 'Neutral', suggestion: 'Unable to analyze sentiment due to timeout.' }; // Fallback response
      })
    ]);

    // Process TextRazor response
    const keywords = textrazorResponse.data.response.entities
      ? textrazorResponse.data.response.entities.map(entity => entity.entityId)
      : [];

    // Readability calculation using Flesch-Kincaid (via natural)
    const tokenizer = new natural.SentenceTokenizer();
    const sentences = tokenizer.tokenize(text);
    const wordTokenizer = new natural.WordTokenizer();
    const words = wordTokenizer.tokenize(text);
    const syllables = words.reduce((acc, word) => acc + (natural.SyllableCounter(word) || 1), 0);

    const readability = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);

    // Process Gemini response
    const sentiment = geminiResult;

    // Suggestions
    const suggestions = keywords.length
      ? `Consider adding keywords: ${keywords.join(', ')}`
      : 'No keywords extracted. Consider simplifying the text.';

    res.status(200).json({
      keywords,
      readability: Math.round(readability),
      suggestions,
      sentiment,
      updatedText: text
    });
  } catch (error) {
    console.error('Error in /analyze:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Insert keyword endpoint
app.post('/insert-keyword', async (req, res) => {
  const { text, keyword } = req.body;
  if (!text || !keyword) {
    return res.status(400).json({ error: 'Text and keyword are required' });
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const prompt = `Insert the keyword "${keyword}" into the following text naturally, and append relevant hashtags (e.g., #SEO #Keyword) at the end of the text. Return the updated text: "${text}"`;
    const result = await timeoutPromise(
      model.generateContent(prompt),
      20000 // 20-second timeout
    ).catch(err => {
      console.error('Gemini timeout or error in /insert-keyword:', err.message);
      return { response: { text: `${text} (Keyword "${keyword}" could not be inserted due to timeout.) #SEO #${keyword}` } };
    });

    const updatedText = result.response.text();
    const insertedAt = updatedText.indexOf(keyword);
    const keywordLength = keyword.length;

    res.status(200).json({
      updatedText,
      insertedAt,
      keywordLength
    });
  } catch (error) {
    console.error('Error in /insert-keyword:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export the app for Vercel
module.exports = serverless(app);