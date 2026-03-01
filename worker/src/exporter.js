/**
 * Generates trimmed + gzipped search JSON and writes to R2.
 */

/**
 * Fields to keep in the search JSON (frontend needs these).
 */
const SEARCH_FIELDS = [
  'filename',
  'year',
  'month',
  'day',
  'image_url',
  'thumbnail_url',
  'source_page',
  'ai_analysis',
];

/**
 * Trim metadata to only fields needed by the frontend.
 */
function trimForSearch(metadata) {
  return metadata
    .filter((item) => item.ai_analysis && !item.ai_analysis.error)
    .map((item) => {
      const trimmed = {};
      for (const field of SEARCH_FIELDS) {
        if (item[field] !== undefined) {
          trimmed[field] = item[field];
        }
      }
      return trimmed;
    });
}

/**
 * Gzip compress a string using CompressionStream API (available in Workers).
 */
async function gzipCompress(text) {
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });

  const compressedStream = readableStream.pipeThrough(new CompressionStream('gzip'));
  const reader = compressedStream.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Concatenate all chunks into a single Uint8Array
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Export search JSON (trimmed + gzipped) and full metadata to R2.
 */
export async function exportSearchJSON(fullMetadata, env) {
  const searchData = trimForSearch(fullMetadata);
  const searchJson = JSON.stringify(searchData);
  const fullJson = JSON.stringify(fullMetadata, null, 2);

  console.log(`Exporting: ${searchData.length} search records, ${fullMetadata.length} total records`);

  // Gzip the search JSON
  const gzippedSearch = await gzipCompress(searchJson);
  console.log(`Search JSON: ${searchJson.length} bytes -> ${gzippedSearch.length} bytes gzipped`);

  // Write both to R2
  await Promise.all([
    env.METADATA_BUCKET.put('image_metadata_search.json', gzippedSearch, {
      httpMetadata: {
        contentType: 'application/json',
        contentEncoding: 'gzip',
      },
    }),
    env.METADATA_BUCKET.put('image_metadata.json', fullJson, {
      httpMetadata: {
        contentType: 'application/json',
      },
    }),
  ]);

  console.log('Exported search JSON and full metadata to R2');
  return { searchRecords: searchData.length, totalRecords: fullMetadata.length };
}
