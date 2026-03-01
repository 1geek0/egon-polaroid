/**
 * Sends images to Gemini API for OCR, visual description, and keyword extraction.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const MODEL_NAME = 'gemini-2.5-flash';
const PER_REQUEST_DELAY_MS = 1000;
const RATE_LIMIT_WAIT_MS = 60000;
const INCREMENTAL_SAVE_INTERVAL = 10;
const MAX_IMAGES_PER_RUN = 200;

const ANALYSIS_PROMPT = `Analyze the attached image, which is a sketch. Provide the following information in a valid JSON object format:
1. "ocr_text": Extract all text, including handwritten and sketched text. If no text is present, this should be an empty string. The artist often signs as "Egon", "Egon Zippel", or "Egon NYC" write similar text as this signature.
2. "visual_description": A concise visual description of the sketch, focusing on the main subjects, style, and any prominent visual elements. Do not give general descriptions like "sketch with a blue ink", "drawing", "painting", etc..
3. "keywords": A list of 3-7 relevant keywords or short phrases that categorize or describe the main themes, objects, or concepts in the sketch. These should be strings in a list.

Example JSON output format:
{
  "ocr_text": "Some extracted text here...",
  "visual_description": "A sketch depicting a distorted face with an abstract background.",
  "keywords": ["portrait", "abstract", "face", "monochrome sketch"]
}

If the image cannot be processed or is unclear, return a JSON object with empty strings for "ocr_text" and "visual_description", and an empty list for "keywords".`;

/**
 * Fetch an image and convert to base64.
 */
async function fetchImageAsBase64(imageUrl) {
  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; EgonArchiveBot/1.0)',
      'Referer': 'https://egonzippel.com/',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch image ${imageUrl}: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Convert to base64 using btoa (available in Workers runtime)
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Determine MIME type from URL.
 */
function getMimeType(url) {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  return 'image/jpeg';
}

/**
 * Call Gemini API for a single image analysis.
 */
async function analyzeOneImage(imageUrl, apiKey) {
  const base64Data = await fetchImageAsBase64(imageUrl);
  const mimeType = getMimeType(imageUrl);

  const requestBody = {
    model: MODEL_NAME,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: ANALYSIS_PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Data}` },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 4096,
  };

  const response = await fetch(`${GEMINI_BASE_URL}chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const isRateLimit =
      response.status === 429 ||
      response.status === 503 ||
      errorText.toLowerCase().includes('rate limit') ||
      errorText.toLowerCase().includes('quota');
    throw { isRateLimit, status: response.status, message: errorText };
  }

  const data = await response.json();

  if (!data.choices?.[0]?.message?.content) {
    throw new Error('No content in Gemini response');
  }

  let rawContent = data.choices[0].message.content.trim();
  // Strip markdown code fences if present
  if (rawContent.startsWith('```json') && rawContent.endsWith('```')) {
    rawContent = rawContent.slice(7, -3).trim();
  } else if (rawContent.startsWith('```') && rawContent.endsWith('```')) {
    rawContent = rawContent.slice(3, -3).trim();
  }

  const parsed = JSON.parse(rawContent);
  if (!parsed.ocr_text === undefined || !parsed.visual_description === undefined || !parsed.keywords === undefined) {
    throw new Error(`Missing required keys in Gemini response: ${rawContent}`);
  }

  return parsed;
}

/**
 * Sleep helper.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Save metadata to R2 (incremental save).
 */
async function saveMetadataToR2(metadata, env) {
  await env.METADATA_BUCKET.put('image_metadata.json', JSON.stringify(metadata, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * Analyze an array of new image records.
 * Processes sequentially with delay between requests.
 * Returns the updated full metadata array.
 */
export async function analyzeImages(newImages, existingMetadata, env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY secret not configured');
  }

  // Cap at MAX_IMAGES_PER_RUN
  const imagesToProcess = newImages.slice(0, MAX_IMAGES_PER_RUN);
  if (newImages.length > MAX_IMAGES_PER_RUN) {
    console.log(`Capping at ${MAX_IMAGES_PER_RUN} images (${newImages.length} found). Remaining will be picked up next run.`);
  }

  const fullMetadata = [...existingMetadata];
  let successCount = 0;
  let failCount = 0;
  let firstError = null;

  for (let i = 0; i < imagesToProcess.length; i++) {
    const image = imagesToProcess[i];
    console.log(`[${i + 1}/${imagesToProcess.length}] Analyzing ${image.filename}...`);

    try {
      const analysis = await analyzeOneImage(image.image_url, apiKey);
      image.ai_analysis = analysis;
      fullMetadata.push(image);
      successCount++;

      const ocrSnippet = (analysis.ocr_text || '').substring(0, 30).replace(/\n/g, ' ');
      console.log(`  OK: OCR="${ocrSnippet}..." Keywords=[${(analysis.keywords || []).join(', ')}]`);
    } catch (err) {
      const errMsg = err.message || JSON.stringify(err);
      if (!firstError) firstError = errMsg;

      if (err.isRateLimit) {
        console.log(`  Rate limited on ${image.filename}. Waiting ${RATE_LIMIT_WAIT_MS / 1000}s and retrying once...`);
        await sleep(RATE_LIMIT_WAIT_MS);

        // Retry once
        try {
          const analysis = await analyzeOneImage(image.image_url, apiKey);
          image.ai_analysis = analysis;
          fullMetadata.push(image);
          successCount++;
          console.log(`  Retry OK for ${image.filename}`);
        } catch (retryErr) {
          console.log(`  Retry failed for ${image.filename}: ${retryErr.message || retryErr}. Skipping.`);
          failCount++;
        }
      } else {
        console.log(`  Failed ${image.filename}: ${errMsg}`);
        failCount++;
      }
    }

    // Incremental save every N images
    if (successCount > 0 && successCount % INCREMENTAL_SAVE_INTERVAL === 0) {
      console.log(`  Incremental save (${successCount} processed so far)...`);
      await saveMetadataToR2(fullMetadata, env);
    }

    // Delay between requests
    if (i < imagesToProcess.length - 1) {
      await sleep(PER_REQUEST_DELAY_MS);
    }
  }

  console.log(`Analysis complete: ${successCount} succeeded, ${failCount} failed`);
  return { fullMetadata, successCount, failCount, firstError };
}
