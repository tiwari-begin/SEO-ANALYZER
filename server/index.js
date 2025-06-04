const express = require('express');
const axios = require('axios');
const cors = require('cors');
const natural = require('natural');
const nlp = require('compromise');
const app = express();

app.use(cors());
app.use(express.json());

// Cache for similarity scores to improve performance
const similarityCache = new Map();

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
        'x-textrazor-key': '7db0569552b7fd0aa65c18e404880ab9abc6a352f67d92388ca634db',
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

    // Add Sentiment Analysis
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

  const tokenizer = new natural.WordTokenizer();
  const distance = natural.JaroWinklerDistance;
  const words = tokenizer.tokenize(text.replace(/([.,!?])/g, ' $1'));
  const doc = nlp(text);
  const candidates = [];
  const nouns = doc.nouns().out('array');
  const verbs = doc.verbs().out('array');
  let taggedWords = words.map(word => {
    const isNoun = nouns.includes(word);
    const isVerb = verbs.includes(word);
    return { value: word, tag: isNoun ? 'noun' : isVerb ? 'verb' : 'unknown' };
  });

  taggedWords.forEach((taggedWord, index) => {
    if (['noun', 'verb'].includes(taggedWord.tag) && !/^[.,!?]$/.test(taggedWord.value)) {
      candidates.push({ ...taggedWord, originalIndex: index });
    }
  });

  try {
    const threshold = keyword.length <= 3 ? 0.6 : 0.45;
    let bestMatch = null;
    let bestMatchIndex = -1;
    let bestScore = 0;
    let insertionPosition = -1;

    console.log('Tagged words:', taggedWords);
    console.log('Candidates for matching:', candidates);
    
    for (const candidate of candidates) {
      const word = candidate.value.toLowerCase();
      const cacheKey = `${word}:${keyword.toLowerCase()}`;
      let score;
      if (similarityCache.has(cacheKey)) {
        score = similarityCache.get(cacheKey);
      } else {
        score = distance(word, keyword.toLowerCase());
        similarityCache.set(cacheKey, score);
      }
      console.log(`Comparing "${word}" with "${keyword.toLowerCase()}": Score = ${score}, Tag = ${candidate.tag}`);
      if (score > bestScore && score > threshold) {
        bestScore = score;
        bestMatch = candidate.value;
        bestMatchIndex = candidate.originalIndex;
      }
    }

    let updatedText = text;
    if (bestMatchIndex !== -1) {
      console.log(`Best match found: "${bestMatch}" with score ${bestScore}`);
      const textLower = text.toLowerCase();
      const bestMatchLower = bestMatch.toLowerCase();
      let position = -1;
      let currentIndex = 0;
      for (let i = 0; i < words.length; i++) {
        if (i === bestMatchIndex) {
          const wordInText = textLower.substr(currentIndex);
          const wordIndex = wordInText.indexOf(bestMatchLower);
          if (wordIndex !== -1) {
            position = currentIndex + wordIndex + bestMatch.length;
            break;
          }
        }
        currentIndex += words[i].length + (text[currentIndex + words[i].length] === ' ' ? 1 : 0);
      }

      if (position !== -1) {
        let inQuotes = false;
        for (let i = 0; i < position; i++) {
          if (text[i] === '"') inQuotes = !inQuotes;
        }
        if (inQuotes) {
          const closingQuote = text.indexOf('"', position);
          if (closingQuote !== -1) {
            position = closingQuote + 1;
          }
        }
        insertionPosition = position + 1;
        const nextChar = text[position];
        if (nextChar && /[,.!?]/.test(nextChar)) {
          updatedText = text.slice(0, position) + ' ' + keyword + text.slice(position);
        } else {
          updatedText = text.slice(0, position) + ' ' + keyword + (text[position] ? ' ' : '') + text.slice(position);
        }
      } else {
        console.log('Position not found, falling back to original logic');
        throw new Error('Best match position not found in text');
      }
    } else {
      console.log('No similar word found, falling back to original logic');
      const sentences = text.split(/[.!?]/).filter(s => s.trim());
      if (sentences.length > 0) {
        const firstSentence = sentences[0].trim();
        const firstSentenceEnd = text.indexOf(firstSentence) + firstSentence.length;
        const punctuationMatch = text.slice(firstSentenceEnd).match(/[.!?]/);
        const insertPoint = punctuationMatch
          ? firstSentenceEnd + punctuationMatch.index + 1
          : firstSentenceEnd;
        insertionPosition = insertPoint + 1;
        updatedText = text.slice(0, insertPoint) + ' ' + keyword + text.slice(insertPoint);
      } else {
        updatedText = text.trim() + (text.trim() ? ' ' : '') + keyword;
        insertionPosition = text.trim().length + 1;
      }
    }

    res.json({ updatedText, insertedAt: insertionPosition, keywordLength: keyword.length });
  } catch (error) {
    console.error('NLP Error:', error.message);
    console.log('Falling back to original logic due to error');
    let updatedText = text;
    let insertionPosition = -1;
    const sentences = text.split(/[.!?]/).filter(s => s.trim());
    if (sentences.length > 0) {
      const firstSentence = sentences[0].trim();
      const firstSentenceEnd = text.indexOf(firstSentence) + firstSentence.length;
      const punctuationMatch = text.slice(firstSentenceEnd).match(/[.!?]/);
      const insertPoint = punctuationMatch
        ? firstSentenceEnd + punctuationMatch.index + 1
        : firstSentenceEnd;
      insertionPosition = insertPoint + 1;
      updatedText = text.slice(0, insertPoint) + ' ' + keyword + text.slice(insertPoint);
    } else {
      updatedText = text.trim() + (text.trim() ? ' ' : '') + keyword;
      insertionPosition = text.trim().length + 1;
    }
    res.json({ updatedText, insertedAt: insertionPosition, keywordLength: keyword.length });
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