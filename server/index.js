require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const natural = require('natural');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const app = express();

app.use(cors());
app.use(express.json());

const TEXTRAZOR_API_KEY = process.env.TEXTRAZOR_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

app.post('/analyze', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    const params = new URLSearchParams();
    params.append('text', text);
    params.append('extractors', 'topics,words');
    const apiResponse = await axios.post('https://api.textrazor.com', params, {
      headers: {
        'x-textrazor-key': TEXTRAZOR_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    console.log('TextRazor Response:', JSON.stringify(apiResponse.data, null, 2));
    let keywords = apiResponse.data.response.topics?.map(t => t.label) || [];
    if (!keywords.length && apiResponse.data.response.sentences) {
      const stopWords = new Set(['this', 'is', 'a', 'an', 'the', 'about', 'in', 'on', 'at', 'to']);
      const words = apiResponse.data.response.sentences.flatMap(sentence => sentence.words);
      keywords = words
        .filter(word => 
          (word.partOfSpeech === 'NN' || word.partOfSpeech === 'NNP') && 
          !stopWords.has(word.lemma.toLowerCase())
        )
        .map(word => word.token)
        .filter((value, index, self) => self.indexOf(value) === index);
    }
    const readability = calculateReadability(text);
    const suggestions = keywords.length ? `Consider adding keywords: ${keywords.join(', ')}` : 'No suggestions available.';

    const sentimentAnalyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
    const tokenizer = new natural.WordTokenizer();
    const tokens = tokenizer.tokenize(text);
    const sentimentScore = sentimentAnalyzer.getSentiment(tokens);
    let sentimentTone = 'Neutral';
    if (sentimentScore > 0) sentimentTone = 'Positive';
    else if (sentimentScore < 0) sentimentTone = 'Negative';
    const sentimentSuggestion = sentimentScore < 0 ? 'Consider using more positive language to improve engagement.' : 'Your tone is engaging!';

    res.json({
      keywords: keywords.slice(0, 5),
      readability,
      suggestions,
      sentiment: { score: sentimentScore, tone: sentimentTone, suggestion: sentimentSuggestion },
      updatedText: text
    });
  } catch (error) {
    console.error('TextRazor Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to analyze text' });
  }
});

app.post('/insert-keyword', async (req, res) => {
  const { text, keyword } = req.body;
  if (!text || !keyword) {
    return res.status(400).json({ error: 'Text and keyword are required' });
  }

  try {
    const prompt = `Insert the keyword "${keyword}" into the following text naturally, ensuring grammatical correctness and contextual relevance. The keyword must be inserted at least once. If you cannot find a natural insertion point, append the keyword at the end of the text. If the keyword is SEO-related (e.g., contains "SEO", "marketing", "keyword", "optimization"), append relevant hashtags (e.g., #SEO, #DigitalMarketing) after the keyword in parentheses. Preserve all whitespace, newlines, and formatting in the original text. Return only the modified text without any additional explanation.\n\nText: ${text}`;

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7
      }
    });

    let updatedText = result.response.text();
    let insertedAt = updatedText.toLowerCase().indexOf(keyword.toLowerCase());
    let keywordLength = keyword.length;

    // Fallback: If keyword isn't inserted, append it manually with hashtags
    const seoRelatedKeywords = ['seo', 'digital marketing', 'keyword', 'optimization', 'search engine'];
    let keywordWithHashtags = keyword;
    if (seoRelatedKeywords.some(k => keyword.toLowerCase().includes(k))) {
      const seoHashtags = ['#SEO', '#DigitalMarketing', '#ContentMarketing', '#SearchEngineOptimization', '#KeywordResearch'];
      const trendyHashtags = ['#MarketingTrends2025', '#GrowYourBusiness', '#SocialMediaMarketing'];
      const selectedTrendyHashtags = trendyHashtags.slice(0, 2); // Pick 2 trendy hashtags
      const allHashtags = [...seoHashtags, ...selectedTrendyHashtags].join(' ');
      keywordWithHashtags = `${keyword} (${allHashtags})`;
    }

    if (insertedAt === -1) {
      console.log('Gemini API failed to insert keyword; using fallback mechanism.');
      updatedText = text + (text.endsWith(' ') || text.endsWith('\n') ? '' : ' ') + keywordWithHashtags;
      insertedAt = text.length + (text.endsWith(' ') || text.endsWith('\n') ? 0 : 1);
    }

    res.json({ updatedText, insertedAt, keywordLength });
  } catch (error) {
    console.error('Gemini API Error:', error.message);
    res.status(500).json({ error: 'Failed to insert keyword' });
  }
});

function calculateReadability(text) {
  const words = text.split(/\s+/).length;
  const sentences = text.split(/[.!?]/).length || 1;
  const syllables = text.split(/[aeiouy]+/i).length;
  return Math.round(206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words));
}

module.exports = { app, calculateReadability };

if (require.main === module) {
  app.listen(3000, () => console.log('Server running on port 3000'));
}