/**
 * Egon Polaroid Pipeline Worker
 *
 * Cron trigger (daily): scrapes egonzippel.com for new images,
 * sends them to Gemini for AI analysis, and updates R2-hosted search JSON.
 *
 * HTTP endpoint: manual trigger via curl or browser.
 */

import { scrapeNewImages } from './scraper.js';
import { analyzeImages } from './analyzer.js';
import { exportSearchJSON } from './exporter.js';

/**
 * Run the full pipeline: scrape → analyze → export.
 */
async function runPipeline(env, { limit } = {}) {
  const startTime = Date.now();
  const result = {
    status: 'ok',
    newImagesFound: 0,
    imagesProcessed: 0,
    searchRecords: 0,
    totalRecords: 0,
    durationMs: 0,
    errors: [],
  };

  try {
    // Step 1: Scrape for new images
    console.log('Step 1: Scraping for new images...');
    const { newImages, existingMetadata } = await scrapeNewImages(env);
    result.newImagesFound = newImages.length;

    if (newImages.length === 0) {
      console.log('No new images found. Skipping analysis and export.');
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Step 2: Analyze new images with Gemini
    const imagesToAnalyze = limit ? newImages.slice(0, limit) : newImages;
    console.log(`Step 2: Analyzing ${imagesToAnalyze.length} new images...`);
    const { fullMetadata, successCount, failCount, firstError } = await analyzeImages(imagesToAnalyze, existingMetadata, env);
    result.imagesProcessed = successCount;
    result.imagesFailed = failCount;
    if (firstError) result.firstAnalysisError = firstError;

    // Step 3: Export search JSON to R2
    console.log('Step 3: Exporting search JSON to R2...');
    const exportResult = await exportSearchJSON(fullMetadata, env);
    result.searchRecords = exportResult.searchRecords;
    result.totalRecords = exportResult.totalRecords;
  } catch (err) {
    console.error('Pipeline error:', err);
    result.status = 'error';
    result.errors.push(err.message || String(err));
  }

  result.durationMs = Date.now() - startTime;
  console.log(`Pipeline complete in ${result.durationMs}ms:`, JSON.stringify(result));
  return result;
}

export default {
  /**
   * Cron trigger handler — runs daily.
   */
  async scheduled(event, env, ctx) {
    console.log(`Cron triggered at ${new Date().toISOString()}`);
    ctx.waitUntil(runPipeline(env));
  },

  /**
   * HTTP handler — manual trigger.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const limit = parseInt(url.searchParams.get('limit')) || undefined;
    const result = await runPipeline(env, { limit });
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
