import { GoogleGenAI, Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

// Load .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

const apiKey = process.env.GEMINI_API_KEY;
const model = 'gemini-1.5-flash';

console.log('GEMINI_API_KEY configured:', !!apiKey);
console.log('Gemini model:', model);

if (!apiKey) {
  console.error('No API key found in .env.local!');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function test() {
  try {
    console.log('Sending test request with gemini-3.5-flash...');
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Hello, respond with {"status": "ok"}' }] }],
      config: {
        responseMimeType: 'application/json',
      },
    });
    console.log('Gemini response received! Text length:', response.text?.length);
    console.log('Response text:', response.text);
  } catch (err) {
    console.error('Test error caught!');
    console.error('Error message:', err?.message);
  }
}

test();
