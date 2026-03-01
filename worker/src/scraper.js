/**
 * Scrapes egonzippel.com for polaroid image data.
 * Uses HTMLRewriter (Cloudflare's built-in HTML parser) to extract image containers.
 */

const BASE_URL = 'https://egonzippel.com/polaroids';

/**
 * Parse a date_title_raw string (e.g. "2024-03-15") into year/month/day components.
 */
function parseDateFromTitle(dateTitle) {
  const match = dateTitle.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return { year: match[1], month: match[2], day: match[3] };
  }
  return null;
}

/**
 * Normalize a URL: handle protocol-relative and relative URLs.
 */
function normalizeUrl(href) {
  if (!href) return '';
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return 'https://egonzippel.com' + href;
  return href;
}

/**
 * Scrapes a single year page and returns an array of image records.
 * Uses HTMLRewriter to parse the HTML stream, tracking state across element handlers.
 */
async function scrapeYear(year) {
  const url = `${BASE_URL}/${year}`;
  const response = await fetch(url);

  if (!response.ok) {
    console.log(`Failed to fetch ${url}: ${response.status}`);
    return [];
  }

  // Accumulate records using a class-based handler with state
  const records = [];
  let current = null;
  let containerIndex = 0;
  let inDimSpan = false;

  const rewriter = new HTMLRewriter()
    .on('div.imageItemContainer', {
      element() {
        // Starting a new container - save previous if exists
        if (current && current.image_url) {
          records.push({ ...current });
        }
        current = {
          image_url: '',
          thumbnail_url: '',
          date_title_raw: '',
          source_page: `${url}/1/${containerIndex}`,
        };
        containerIndex++;
      },
    })
    .on('a.thumb', {
      element(el) {
        if (current) {
          const href = el.getAttribute('href');
          current.image_url = normalizeUrl(href);
        }
      },
    })
    .on('a.thumb img', {
      element(el) {
        if (current) {
          const src = el.getAttribute('src');
          current.thumbnail_url = normalizeUrl(src);
        }
      },
    })
    .on('span.imageFrDimension', {
      element() {
        inDimSpan = true;
      },
      text(text) {
        if (current && inDimSpan) {
          current.date_title_raw += text.text;
        }
      },
    });

  const transformed = rewriter.transform(response);
  await transformed.text();

  // Push the last record
  if (current && current.image_url) {
    records.push({ ...current });
  }

  // Clean up date_title_raw and parse dates
  return records.map((record) => {
    record.date_title_raw = record.date_title_raw.trim();
    const parsed = parseDateFromTitle(record.date_title_raw);
    if (parsed) {
      record.year = parsed.year;
      record.month = parsed.month;
      record.day = parsed.day;
    } else {
      record.year = String(year);
      record.month = '';
      record.day = '';
    }
    // Derive filename from date_title_raw
    record.filename = record.date_title_raw
      ? `${record.date_title_raw}.jpg`
      : `unknown-${year}-${record.source_page.split('/').pop()}.jpg`;
    return record;
  });
}

/**
 * Scrapes current year and previous year pages.
 * Returns only new images not already in existing metadata.
 */
export async function scrapeNewImages(env) {
  const currentYear = new Date().getFullYear();
  const yearsToScrape = [currentYear - 1, currentYear];

  console.log(`Scraping years: ${yearsToScrape.join(', ')}`);

  // Load existing metadata from R2
  let existingMetadata = [];
  try {
    const obj = await env.METADATA_BUCKET.get('image_metadata.json');
    if (obj) {
      const text = await obj.text();
      existingMetadata = JSON.parse(text);
      console.log(`Loaded ${existingMetadata.length} existing records from R2`);
    }
  } catch (e) {
    console.log(`No existing metadata found in R2, starting fresh: ${e.message}`);
  }

  const existingUrls = new Set(existingMetadata.map((item) => item.image_url));

  // Scrape each year
  let allScraped = [];
  for (const year of yearsToScrape) {
    const records = await scrapeYear(year);
    console.log(`Scraped ${records.length} images from ${year}`);
    allScraped = allScraped.concat(records);
  }

  // Filter to only new images
  const newImages = allScraped.filter((record) => !existingUrls.has(record.image_url));
  console.log(`Found ${newImages.length} new images (${allScraped.length} total scraped)`);

  return { newImages, existingMetadata };
}
