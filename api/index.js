// api/index.js
const express = require('express');
const { html } = require('satori-html');
const satori = require('satori');
const sharp = require('sharp');
const fetch = require('node-fetch'); // Make sure it's node-fetch@2
const fs = require('fs');
const path = require('path');

console.log("Function starting..."); // Log: Function cold start

const app = express();
app.use(express.json());

const fontPath = path.join(process.cwd(), 'public', 'inter.ttf');
let fontData;
try {
    console.log("Attempting to load font from:", fontPath); // Log: Font load attempt
    fontData = fs.readFileSync(fontPath);
    console.log("Font loaded successfully. Size:", fontData.length); // Log: Font load success
} catch (error) {
    console.error("CRITICAL: Error loading font:", error); // Log: Font load failure
    // If font fails to load, satori might still work with a default font, or crash.
    // Forcing undefined so satori definitely tries its default if our font fails.
    fontData = undefined;
}

const FARCASTER_ID = 'aminphantom.eth';
const FARCASTER_PROFILE_URL = `https://warpcast.com/${FARCASTER_ID}`;
const APP_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
console.log("APP_URL:", APP_URL); // Log: App URL

async function generateImage(text, error = false) {
    console.log(`generateImage called with text: "${text}", error: ${error}`); // Log: generateImage entry
    const template = html(`
    <div style="display: flex; flex-direction: column; width: 600px; height: 315px; background-color: ${error ? '#ffebee' : '#e3f2fd'}; color: ${error ? '#c62828' : '#0d47a1'}; padding: 30px; justify-content: center; align-items: center; text-align: center; border: 5px solid ${error ? '#c62828' : '#0d47a1'}; font-size: 24px; line-height: 1.5;">
      <p>${text}</p>
    </div>
  `);

    try {
        console.log("Calling satori..."); // Log: Before satori
        const svg = await satori(template, {
            width: 600,
            height: 315,
            fonts: fontData ? [{ name: 'Inter', data: fontData, weight: 400, style: 'normal' }] : [],
        });
        console.log("satori finished. SVG length:", svg.length); // Log: After satori

        console.log("Calling sharp to convert SVG to PNG..."); // Log: Before sharp
        const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
        console.log("sharp finished. PNG buffer length:", pngBuffer.length); // Log: After sharp
        return pngBuffer;
    } catch (e) {
        console.error("Error in generateImage (satori or sharp):", e); // Log: satori/sharp error
        throw e; // Re-throw to be caught by the route handler
    }
}

async function getWikipediaSummary(searchTerm) {
    console.log(`getWikipediaSummary called with searchTerm: "${searchTerm}"`); // Log: getWikipediaSummary entry
    if (!searchTerm || searchTerm.trim() === "") {
        console.log("Search term is empty.");
        return "Please enter a search term.";
    }
    const WIKIPEDIA_API_URL = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=true&explaintext=true&redirects=1&titles=${encodeURIComponent(searchTerm)}`;
    console.log("Fetching from Wikipedia URL:", WIKIPEDIA_API_URL); // Log: Wikipedia URL
    try {
        const response = await fetch(WIKIPEDIA_API_URL);
        console.log(`Wikipedia response status: ${response.status}`); // Log: Wikipedia status
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Wikipedia API request failed: ${response.statusText}`, errorText);
            return `Error fetching data: ${response.statusText}`;
        }
        const data = await response.json();
        // console.log("Wikipedia data received:", JSON.stringify(data).substring(0, 200)); // Log: Wikipedia data (partial)
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];

        if (pageId === "-1" || !pages[pageId].extract) {
            console.log(`No Wikipedia results for "${searchTerm}"`);
            return `Sorry, no results found for "${searchTerm}".`;
        }

        let summary = pages[pageId].extract;
        const sentences = summary.split('. ').filter(s => s.trim() !== "");
        summary = sentences.slice(0, 2).join('. ') + (sentences.length > 1 ? '.' : '');
        if (summary.length > 250) {
            summary = summary.substring(0, 247) + "...";
        }
        console.log(`Wikipedia summary for "${searchTerm}": ${summary}`);
        return summary;
    } catch (error) {
        console.error("Error in getWikipediaSummary (fetch or processing):", error); // Log: Wikipedia function error
        return "Error connecting to Wikipedia or processing data.";
    }
}

app.post('/api', async (req, res) => {
    console.log("POST /api hit. Request body:", JSON.stringify(req.body).substring(0, 200)); // Log: POST /api entry
    try {
        const frameMessage = req.body;
        let searchText = "";
        let action = "initial";

        if (frameMessage && frameMessage.untrustedData) {
            searchText = frameMessage.untrustedData.inputText || "";
            console.log(`Input text: "${searchText}", Button index: ${frameMessage.untrustedData.buttonIndex}`); // Log: Frame data
            if (frameMessage.untrustedData.buttonIndex === 1 && searchText.trim() !== "") {
                action = "search";
            }
        } else {
            console.log("No untrustedData in frameMessage or empty frameMessage.");
        }

        console.log(`Action determined: ${action}`); // Log: Action

        let imageUrl;
        let responseText;

        if (action === "search") {
            responseText = await getWikipediaSummary(searchText);
            const isError = responseText.startsWith("Error") || responseText.startsWith("Sorry") || responseText.startsWith("Please");
            imageUrl = `${APP_URL}/api/image?text=${encodeURIComponent(responseText)}&error=${isError}`;
        } else {
            responseText = "Search for anything!";
            imageUrl = `${APP_URL}/api/image?text=${encodeURIComponent(responseText)}`;
        }
        console.log(`Response text: "${responseText}", Image URL: ${imageUrl}`); // Log: Response details

        const htmlResponse = `
        <!DOCTYPE html><html><head>
          <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta property="og:title" content="SearchCast-01" />
          <meta property="og:image" content="${imageUrl}" />
          <meta property="fc:frame" content="vNext" />
          <meta property="fc:frame:image" content="${imageUrl}" />
          <meta property="fc:frame:image:aspect_ratio" content="1.91:1" />
          <meta property="fc:frame:input:text" content="Enter search term..." />
          <meta property="fc:frame:button:1" content="Search 🔍" /><meta property="fc:frame:button:1:action" content="post" />
          <meta property="fc:frame:button:2" content="Profile: ${FARCASTER_ID}" /><meta property="fc:frame:button:2:action" content="link" /><meta property="fc:frame:button:2:target" content="${FARCASTER_PROFILE_URL}" />
          <meta property="fc:frame:post_url" content="${APP_URL}/api" />
        </head><body>Frame content for ${action}. Image: <img src="${imageUrl}" /></body></html>`;
        
        console.log("Sending HTML response for POST /api"); // Log: Sending HTML
        res.setHeader('Content-Type', 'text/html').status(200).send(htmlResponse);
    } catch (e) {
        console.error("CRITICAL ERROR in POST /api handler:", e); // Log: Error in POST /api
        const errorImageUrl = `${APP_URL}/api/image?text=${encodeURIComponent("An internal error occurred.")}&error=true`;
        const errorHtmlResponse = `
        <!DOCTYPE html><html><head>
          <meta property="fc:frame" content="vNext" />
          <meta property="fc:frame:image" content="${errorImageUrl}" />
          <meta property="fc:frame:post_url" content="${APP_URL}/api" />
          <meta property="fc:frame:button:1" content="Try again" />
        </head><body>Error</body></html>`;
        res.setHeader('Content-Type', 'text/html').status(500).send(errorHtmlResponse);
    }
});

app.get('/api/image', async (req, res) => {
    console.log("GET /api/image hit. Query:", req.query); // Log: GET /api/image entry
    try {
        const { text, error } = req.query;
        const imageBuffer = await generateImage(decodeURIComponent(text || "SearchCast"), error === 'true');
        console.log("Sending image response for GET /api/image"); // Log: Sending image
        res.setHeader('Content-Type', 'image/png').setHeader('Cache-Control', 'public, max-age=10').send(imageBuffer); // Reduced cache for debugging
    } catch (e) {
        console.error("CRITICAL ERROR in GET /api/image handler:", e); // Log: Error in GET /api/image
        // Fallback if image generation itself fails
        const fallbackIconPath = path.join(process.cwd(), 'public', 'icon.png');
        if (fs.existsSync(fallbackIconPath)) {
            console.log("Sending fallback icon.png");
            res.sendFile(fallbackIconPath);
        } else {
            console.error("Fallback icon.png not found at", fallbackIconPath);
            res.status(500).send("Error generating image and fallback icon not found.");
        }
    }
});

app.get('/', (req, res) => {
    console.log("GET / hit"); // Log: GET / entry
    try {
        const initialImageUrl = `${APP_URL}/icon.png`;
        console.log("Initial image URL for GET /:", initialImageUrl); // Log: Initial image URL

        const htmlResponse = `
        <!DOCTYPE html><html><head>
          <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>SearchCast-01 Frame</title>
          <meta property="og:title" content="SearchCast-01" /><meta property="og:image" content="${initialImageUrl}" /> 
          <meta property="fc:frame" content="vNext" /><meta property="fc:frame:image" content="${initialImageUrl}" />
          <meta property="fc:frame:image:aspect_ratio" content="1.91:1" />
          <meta property="fc:frame:input:text" content="Enter search term..." />
          <meta property="fc:frame:button:1" content="Search 🔍" /><meta property="fc:frame:button:1:action" content="post" />
          <meta property="fc:frame:button:2" content="Profile: ${FARCASTER_ID}" /><meta property="fc:frame:button:2:action" content="link" /><meta property="fc:frame:button:2:target" content="${FARCASTER_PROFILE_URL}" />
          <meta property="fc:frame:post_url" content="${APP_URL}/api" />
        </head><body>Welcome to SearchCast-01. Initial image: <img src="${initialImageUrl}" /></body></html>`;
        
        console.log("Sending HTML response for GET /"); // Log: Sending HTML for GET /
        res.setHeader('Content-Type', 'text/html').status(200).send(htmlResponse);
    } catch (e) {
        console.error("CRITICAL ERROR in GET / handler:", e); // Log: Error in GET /
        res.status(500).send("An error occurred loading the initial frame.");
    }
});

console.log("Function setup complete. Exporting app."); // Log: End of file
module.exports = app;