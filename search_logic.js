document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchResultsContainer = document.getElementById('searchResults');
    const statusMessage = document.getElementById('statusMessage');
    const resultsCount = document.getElementById('resultsCount');

    let allImageData = [];
    let lunrIndex;
    let imageUrlCache = new Map(); // Cache for extracted image URLs

    function initializeLunrIndex(data) {
        lunrIndex = lunr(function () {
            this.ref('id'); // Use a unique ID from your data, array index can work if data is static
            this.field('filename', { boost: 5 });
            this.field('ocr_text', { boost: 10 });
            this.field('visual_description', { boost: 2 });
            this.field('keywords_string', { boost: 15 }); // Keywords will be joined into a string for indexing
            // Note: Lunr.js applies its own stemming and stop word filtering by default.

            data.forEach((doc, idx) => {
                this.add({
                    id: idx, // Using array index as the ID for simplicity
                    filename: doc.filename || '',
                    ocr_text: doc.ai_analysis?.ocr_text || '',
                    visual_description: doc.ai_analysis?.visual_description || '',
                    keywords_string: (doc.ai_analysis?.keywords || []).join(' ')
                });
            });
        });
        console.log("Lunr.js index created.");
    }

    async function loadData() {
        statusMessage.textContent = 'Loading image data...';
        try {
            const response = await fetch('https://gist.githubusercontent.com/1geek0/8e8ca14f1b1455111a338cf124dbf123/raw/d76241eb67f99e1231e1f0c6098a3cfd9759f3bb/image_metadata.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            allImageData = await response.json();
            // Add an 'id' to each item for easier mapping from Lunr results if not using array index directly
            // allImageData.forEach((item, idx) => item.id = idx); 
            // The current lunr setup uses array index as ref, so this isn't strictly needed here

            initializeLunrIndex(allImageData);
            statusMessage.textContent = `Data loaded. ${allImageData.length} images available. Ready to search.`;
            console.log("Image data loaded:", allImageData.length);
            if (allImageData.length > 0) {
                // Don't display any results initially, just show the count message
                resultsCount.textContent = `Enter search terms to find images among ${allImageData.length} items.`;
            }
        } catch (error) {
            console.error("Failed to load image_metadata.json:", error);
            statusMessage.textContent = `Error loading image data: ${error.message}.`;
            searchResultsContainer.innerHTML = '<p style="color: red;">Could not load image data. Search is unavailable.</p>';
        }
    }

    async function extractImageUrlFromPage(pageUrl) {
        // Check cache first
        if (imageUrlCache.has(pageUrl)) {
            return imageUrlCache.get(pageUrl);
        }

        try {
            // Use a CORS proxy to fetch the page content
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(pageUrl)}`;
            const response = await fetch(proxyUrl);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const htmlContent = data.contents;

            // Parse the HTML to extract the image URL
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            const imgElement = doc.getElementById('icLightBoxActiveImage');

            if (imgElement && imgElement.src) {
                const imageUrl = imgElement.src;
                imageUrlCache.set(pageUrl, imageUrl);
                return imageUrl;
            } else {
                console.warn(`No icLightBoxActiveImage found for ${pageUrl}`);
                imageUrlCache.set(pageUrl, null);
                return null;
            }
        } catch (error) {
            console.error(`Failed to extract image URL from ${pageUrl}:`, error);
            imageUrlCache.set(pageUrl, null);
            return null;
        }
    }

    function createImageElement(item) {
        const link = document.createElement('a');
        link.href = item.display_page_url;
        link.target = '_blank';
        link.title = `View details for ${item.filename} on EgonZippel.com`;
        link.style.display = 'block';
        link.style.textDecoration = 'none';

        // Create a styled placeholder that looks better
        const placeholder = document.createElement('div');
        placeholder.style.cssText = `
            width: 200px;
            height: 150px;
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            border: 2px solid #333;
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #888;
            font-family: Inter, sans-serif;
            position: relative;
            overflow: hidden;
            transition: all 0.3s ease;
        `;

        placeholder.innerHTML = `
            <div style="font-size: 0.9em; font-weight: 500; margin-bottom: 8px; text-align: center; padding: 0 10px;">
                ${item.filename}
            </div>
            <div style="font-size: 0.7em; opacity: 0.7; text-align: center;">
                Loading preview...
            </div>
        `;

        // Add hover effect
        placeholder.addEventListener('mouseenter', () => {
            placeholder.style.borderColor = '#0ff';
            placeholder.style.transform = 'scale(1.02)';
            placeholder.style.boxShadow = '0 5px 15px rgba(0, 255, 255, 0.3)';
        });

        placeholder.addEventListener('mouseleave', () => {
            placeholder.style.borderColor = '#333';
            placeholder.style.transform = 'scale(1)';
            placeholder.style.boxShadow = 'none';
        });

        // Start with placeholder, then try to load the actual image
        link.appendChild(placeholder);

        // Asynchronously extract and load the real image
        extractImageUrlFromPage(item.display_page_url).then(imageUrl => {
            if (imageUrl) {
                // Create the actual image element
                const img = document.createElement('img');
                img.src = imageUrl;
                img.style.cssText = `
                    width: 200px;
                    height: 150px;
                    object-fit: cover;
                    border-radius: 8px;
                    border: 2px solid #333;
                    transition: all 0.3s ease;
                `;

                img.onload = function () {
                    // Replace placeholder with actual image
                    if (link.contains(placeholder)) {
                        link.removeChild(placeholder);
                        link.appendChild(img);
                    }
                };

                img.onerror = function () {
                    // Keep placeholder but update message
                    const loadingDiv = placeholder.querySelector('div:last-child');
                    if (loadingDiv) {
                        loadingDiv.textContent = 'View on EgonZippel.com →';
                    }
                };

                // Add hover effects to the image
                img.addEventListener('mouseenter', () => {
                    img.style.borderColor = '#0ff';
                    img.style.transform = 'scale(1.02)';
                    img.style.boxShadow = '0 5px 15px rgba(0, 255, 255, 0.3)';
                });

                img.addEventListener('mouseleave', () => {
                    img.style.borderColor = '#333';
                    img.style.transform = 'scale(1)';
                    img.style.boxShadow = 'none';
                });
            } else {
                // Update placeholder to show it's ready to click
                const loadingDiv = placeholder.querySelector('div:last-child');
                if (loadingDiv) {
                    loadingDiv.textContent = 'View on EgonZippel.com →';
                }
            }
        });

        return link;
    }

    function displayResults(resultsToDisplay, isInitialDisplay = false) {
        searchResultsContainer.innerHTML = '';
        if (isInitialDisplay) {
            resultsCount.textContent = `Displaying first ${resultsToDisplay.length} of ${allImageData.length} images. Refine with search.`;
        } else {
            resultsCount.textContent = `${resultsToDisplay.length} image(s) found.`;
        }

        if (resultsToDisplay.length === 0 && !isInitialDisplay) {
            searchResultsContainer.innerHTML = '<p>No matching images found.</p>';
            return;
        }
        if (resultsToDisplay.length === 0 && isInitialDisplay) {
            resultsCount.textContent = `Enter search terms to find images among ${allImageData.length} items.`;
            return;
        }

        resultsToDisplay.forEach(item => {
            const resultItemDiv = document.createElement('div');
            resultItemDiv.className = 'result-item';

            // Use new image element creation function
            const imageLink = createImageElement(item);
            resultItemDiv.appendChild(imageLink);

            const itemTitle = document.createElement('p');
            itemTitle.textContent = item.filename;
            itemTitle.style.fontSize = '0.9em';
            itemTitle.style.marginTop = '5px';
            resultItemDiv.appendChild(itemTitle);

            if (item.ai_analysis) {
                const ocrDiv = document.createElement('div');
                ocrDiv.className = 'ocr-text';
                const ocrText = item.ai_analysis.ocr_text || 'N/A';
                ocrDiv.innerHTML = `<strong>OCR:</strong> ${ocrText.substring(0, 100)}${ocrText.length > 100 ? '...' : ''}`;
                resultItemDiv.appendChild(ocrDiv);

                const keywordsDiv = document.createElement('div');
                keywordsDiv.className = 'keywords';
                const keywordsText = item.ai_analysis.keywords ? item.ai_analysis.keywords.join(', ') : 'N/A';
                keywordsDiv.innerHTML = `<strong>Keywords:</strong> ${keywordsText}`;
                resultItemDiv.appendChild(keywordsDiv);
            }
            // Display Lunr score if available (for debugging/refinement)
            if (item.score !== undefined) {
                const scoreDiv = document.createElement('div');
                scoreDiv.style.fontSize = '0.7em';
                scoreDiv.style.color = '#888';
                scoreDiv.textContent = `Score: ${item.score.toFixed(2)}`;
                resultItemDiv.appendChild(scoreDiv);
            }
            searchResultsContainer.appendChild(resultItemDiv);
        });
    }

    function performSearch() {
        const query = searchInput.value.trim(); // No toLowerCase here, Lunr handles it

        if (!lunrIndex) {
            statusMessage.textContent = "Search index not ready. Please wait for data to load.";
            return;
        }
        if (allImageData.length === 0) {
            statusMessage.textContent = "Image data not loaded. Cannot search.";
            return;
        }

        if (!query) {
            // Display first 50 if query is empty
            displayResults(allImageData.slice(0, 50), true);
            return;
        }

        statusMessage.textContent = 'Searching...';

        // Rudimentary date parsing from query (remains separate from Lunr text search)
        let queryYear = null;
        let queryMonth = null;
        let textQueryTermsForLunr = [];
        const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const fullMonthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

        // Handle quoted phrases for exact matching
        const quotedPhrases = [];
        let processedQuery = query;

        // Extract quoted phrases
        const quoteMatches = query.match(/"([^"]+)"/g);
        if (quoteMatches) {
            quoteMatches.forEach(match => {
                const phrase = match.slice(1, -1); // Remove quotes
                quotedPhrases.push(phrase);
                processedQuery = processedQuery.replace(match, ''); // Remove from main query
            });
        }

        // Process remaining terms (non-quoted)
        processedQuery.split(/\s+/).filter(term => term.length > 0).forEach(term => {
            let isDateTerm = false;
            if (/^\d{4}$/.test(term)) { queryYear = term; isDateTerm = true; }
            const lowerTerm = term.toLowerCase();
            const monthIdx = monthNames.indexOf(lowerTerm.substring(0, 3));
            if (monthIdx !== -1) { queryMonth = (monthIdx + 1).toString().padStart(2, '0'); isDateTerm = true; }
            const fullMonthIdx = fullMonthNames.indexOf(lowerTerm);
            if (fullMonthIdx !== -1) { queryMonth = (fullMonthIdx + 1).toString().padStart(2, '0'); isDateTerm = true; }
            if (!isDateTerm) {
                // Use exact matching by default, only add fuzziness for longer terms or when term ends with ~
                if (term.endsWith('~')) {
                    // User explicitly requested fuzzy matching
                    const cleanTerm = term.slice(0, -1);
                    if (cleanTerm.length > 1) {
                        textQueryTermsForLunr.push(cleanTerm + '~1');
                    }
                } else if (term.length >= 6) {
                    // Only apply fuzzy matching to longer terms where typos are more likely
                    textQueryTermsForLunr.push(term + '~1');
                } else {
                    // Use exact matching for shorter terms to avoid false positives like "table" matching "cable"
                    textQueryTermsForLunr.push(term);
                }
            }
        });

        // Add quoted phrases as exact phrase searches
        quotedPhrases.forEach(phrase => {
            textQueryTermsForLunr.push(`"${phrase}"`);
        });

        let lunrQueryString = textQueryTermsForLunr.join(' ');
        let searchResults = [];

        // If we have quoted phrases, do a manual exact phrase search first
        if (quotedPhrases.length > 0) {
            // Manual phrase search through all items
            allImageData.forEach((item, idx) => {
                let matchScore = 0;
                let matchedPhrases = 0;

                quotedPhrases.forEach(phrase => {
                    const searchPhrase = phrase.toLowerCase();
                    const ocrText = (item.ai_analysis?.ocr_text || '').toLowerCase();
                    const visualDesc = (item.ai_analysis?.visual_description || '').toLowerCase();
                    const keywords = (item.ai_analysis?.keywords || []).join(' ').toLowerCase();

                    // Check if phrase exists in any field
                    if (ocrText.includes(searchPhrase)) {
                        matchScore += 10; // Higher weight for OCR text matches
                        matchedPhrases++;
                    }
                    if (visualDesc.includes(searchPhrase)) {
                        matchScore += 2;
                        matchedPhrases++;
                    }
                    if (keywords.includes(searchPhrase)) {
                        matchScore += 5;
                        matchedPhrases++;
                    }
                });

                // Only include if all phrases matched
                if (matchedPhrases === quotedPhrases.length && matchScore > 0) {
                    searchResults.push({ ref: idx.toString(), score: matchScore });
                }
            });

            // If we also have non-phrase terms, combine with Lunr results
            if (textQueryTermsForLunr.length > quotedPhrases.length) {
                const lunrResults = lunrIndex.search(textQueryTermsForLunr.filter(term => !term.startsWith('"')).join(' '));

                // Merge results, keeping the highest score for each item
                const resultMap = new Map();
                searchResults.forEach(r => resultMap.set(r.ref, r.score));
                lunrResults.forEach(r => {
                    if (resultMap.has(r.ref)) {
                        resultMap.set(r.ref, resultMap.get(r.ref) + r.score);
                    }
                });

                searchResults = Array.from(resultMap.entries()).map(([ref, score]) => ({ ref, score }));
            }
        } else if (lunrQueryString) {
            // No quoted phrases, use regular Lunr search
            searchResults = lunrIndex.search(lunrQueryString);
        } else if (queryYear || queryMonth) {
            // If only date terms, consider all documents for date filtering
            searchResults = allImageData.map((_, idx) => ({ ref: idx.toString(), score: 0 }));
        }

        // Sort by score
        searchResults.sort((a, b) => b.score - a.score);

        let filteredResults = searchResults.map(result => {
            const item = allImageData[parseInt(result.ref)];
            return { ...item, score: result.score };
        });

        // Apply date filtering
        if (queryYear) {
            filteredResults = filteredResults.filter(item => item.year === queryYear);
        }
        if (queryMonth) {
            filteredResults = filteredResults.filter(item => item.month === queryMonth);
        }

        statusMessage.textContent = '';
        displayResults(filteredResults);
    }

    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            performSearch();
        }
    });

    loadData();
}); 