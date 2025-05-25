// api/index.js
const express = require('express');
const { html } = require('satori-html');
const satori = require('satori');
const sharp = require('sharp');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json()); // To read POST request bodies

// Font path - change here if you use a different font
const fontPath = path.join(process.cwd(), 'public', 'inter.ttf');
let fontData;
try {
    fontData = fs.readFileSync(fontPath);
} catch (error) {
    console.error("Error loading font:", error);
    fontData = undefined; // Satori might error or use a default font
}

const FARCASTER_ID = 'aminphantom.eth';
const FARCASTER_PROFILE_URL = `https://warpcast.com/${FARCASTER_ID}`;
const APP_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

// --- Helper Functions ---

// Function to generate image with text
async function generateImage(text, error = false) {
    const template = html(`
    <div style="display: flex; flex-direction: column; width: 600px; height: 315px; background-color: ${error ? '#ffebee' : '#e3f2fd'}; color: ${error ? '#c62828' : '#0d47a1'}; padding: 30px; justify-content: center; align-items: center; text-align: center; border: 5px solid ${error ? '#c62828' : '#0d47a1'}; font-size: 24px; line-height: 1.5;">
      <p>${text}</p>
    </div>
  `);

    const svg = await satori(template, {
        width: 600,
        height: 315,
        fonts: fontData ? [{
            name: 'Inter',
            data: fontData,
            weight: 400,
            style: 'normal',
        }] : [],
    });

    return sharp(Buffer.from(svg)).png().toBuffer();
}

// Function to get summary from Wikipedia
async function getWikipediaSummary(searchTerm) {
    if (!searchTerm || searchTerm.trim() === "") {
        return "Please enter a search term.";
    }
    // Use English Wikipedia API
    const WIKIPEDIA_API_URL = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=true&explaintext=true&redirects=1&titles=${encodeURIComponent(searchTerm)}`;
    try {
        const response = await fetch(WIKIPEDIA_API_URL);
        const data = await response.json();
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];

        if (pageId === "-1" || !pages[pageId].extract) {
            return `Sorry, no results found for "${searchTerm}".`;
        }

        let summary = pages[pageId].extract;
        // Summarize to about two sentences
        const sentences = summary.split('. ').filter(s => s.trim() !== "");
        
        summary = sentences.slice(0, 2).join('. ') + (sentences.length > 1 ? '.' : '');
        if (summary.length > 250) { // Limit length for better display in image
            summary = summary.substring(0, 247) + "...";
        }
        return summary;
    } catch (error) {
        console.error("Wikipedia API Error:", error);
        return "Error connecting to Wikipedia.";
    }
}

// --- App Routes ---

// Main route for the initial frame and search processing
app.post('/api', async (req, res) => {
    const frameMessage = req.body;
    let searchText = "";
    let action = "initial"; // 'initial', 'search'

    if (frameMessage && frameMessage.untrustedData) {
        searchText = frameMessage.untrustedData.inputText || "";
        // Button 1 is for search
        if (frameMessage.untrustedData.buttonIndex === 1 && searchText.trim() !== "") {
            action = "search";
        }
    }

    let imageUrl;
    let responseText;

    if (action === "search") {
        responseText = await getWikipediaSummary(searchText);
        const isError = responseText.startsWith("Error") || responseText.startsWith("Sorry") || responseText.startsWith("Please");
        imageUrl = `${APP_URL}/api/image?text=${encodeURIComponent(responseText)}&error=${isError}`;
    } else {
        // Initial frame or when search text is empty
        responseText = "Search for anything!";
        imageUrl = `${APP_URL}/api/image?text=${encodeURIComponent(responseText)}`;
    }

    const htmlResponse = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta property="og:title" content="SearchCast-01" />
      <meta property="og:image" content="${imageUrl}" />
      <meta property="fc:frame" content="vNext" />
      <meta property="fc:frame:image" content="${imageUrl}" />
      <meta property="fc:frame:image:aspect_ratio" content="1.91:1" />
      <meta property="fc:frame:input:text" content="Enter search term..." />
      <meta property="fc:frame:button:1" content="Search 🔍" />
      <meta property="fc:frame:button:1:action" content="post" />
      <meta property="fc:frame:button:2" content="Profile: ${FARCASTER_ID}" />
      <meta property="fc:frame:button:2:action" content="link" />
      <meta property="fc:frame:button:2:target" content="${FARCASTER_PROFILE_URL}" />
      <meta property="fc:frame:post_url" content="${APP_URL}/api" />
    </head>
    <body>
      <h1>SearchCast-01 Frame</h1>
      <p>This is a Farcaster Frame. View it in a Farcaster client.</p>
      <p>Current search: ${searchText}</p>
      <p>Result: ${action === 'search' ? responseText : 'Awaiting search...'}</p>
      <img src="${imageUrl}" alt="Frame Image" />
    </body>
    </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(htmlResponse);
});

// Route for serving the dynamic image
app.get('/api/image', async (req, res) => {
    const { text, error } = req.query;
    try {
        const imageBuffer = await generateImage(decodeURIComponent(text || "SearchCast"), error === 'true');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache image for 1 hour
        res.send(imageBuffer);
    } catch (e) {
        console.error("Image generation error:", e);
        const fallbackIconPath = path.join(process.cwd(), 'public', 'icon.png');
        if (fs.existsSync(fallbackIconPath)) {
            res.sendFile(fallbackIconPath);
        } else {
            res.status(500).send("Error generating image");
        }
    }
});

// Route for the initial frame display (when accessing the root URL)
app.get('/', (req, res) => {
    // For the very first load of the frame or when accessing the base URL
    // It's good practice for og:image to point to a static, predictable image.
    const initialImageUrl = `${APP_URL}/public/icon.png`; // Your app's icon

    const htmlResponse = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>SearchCast-01 Frame</title>
      <meta property="og:title" content="SearchCast-01" />
      <meta property="og:image" content="${initialImageUrl}" /> 
      <meta property="fc:frame" content="vNext" />
      <meta property="fc:frame:image" content="${initialImageUrl}" />
      <meta property="fc:frame:image:aspect_ratio" content="1.91:1" />
      <meta property="fc:frame:input:text" content="Enter search term..." />
      <meta property="fc:frame:button:1" content="Search 🔍" />
      <meta property="fc:frame:button:1:action" content="post" />
      <meta property="fc:frame:button:2" content="Profile: ${FARCASTER_ID}" />
      <meta property="fc:frame:button:2:action" content="link" />
      <meta property="fc:frame:button:2:target" content="${FARCASTER_PROFILE_URL}" />
      <meta property="fc:frame:post_url" content="${APP_URL}/api" />
    </head>
    <body>
      <h1>SearchCast-01 Frame</h1>
      <p>Welcome to SearchCast-01. Cast this URL in a Farcaster client to use the frame.</p>
      <p>Or, paste this URL into a Farcaster frame validator.</p>
      <p>Your frame should show an input field and two buttons.</p>
      <img src="${initialImageUrl}" alt="Initial Frame Image" />
    </body>
    </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(htmlResponse);
});


// Vercel needs us to export the app
module.exports = app;