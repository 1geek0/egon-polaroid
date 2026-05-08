document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchResultsContainer = document.getElementById('searchResults');
    const statusMessage = document.getElementById('statusMessage');
    const resultsCount = document.getElementById('resultsCount');

    const DATA_URL = 'https://pub-2bf02060093645f29ead1fe093065db8.r2.dev/image_metadata_search.json';

    let allImageData = [];
    let lunrIndex;

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
            const response = await fetch(DATA_URL);
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

    function createImageElement(item) {
        const link = document.createElement('a');
        link.href = item.source_page || item.display_page_url || '#';
        link.target = '_blank';
        link.title = `View details for ${item.filename} on EgonZippel.com`;
        link.style.display = 'block';
        link.style.textDecoration = 'none';

        const imgSrc = item.thumbnail_url || item.image_url;

        if (imgSrc) {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.alt = item.filename;
            img.loading = 'lazy';
            img.style.cssText = `
                width: 100%;
                height: auto;
                display: block;
                object-fit: contain;
                border-radius: 8px;
                border: 2px solid #333;
                transition: all 0.3s ease;
            `;

            img.addEventListener('mouseenter', () => {
                img.style.borderColor = '#f58989';
                img.style.transform = 'scale(1.02)';
                img.style.boxShadow = '0 5px 15px rgba(245, 137, 137, 0.3)';
            });

            img.addEventListener('mouseleave', () => {
                img.style.borderColor = '#333';
                img.style.transform = 'scale(1)';
                img.style.boxShadow = 'none';
            });

            link.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.style.cssText = `
                width: 100%;
                aspect-ratio: 4 / 3;
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                border: 2px solid #333;
                border-radius: 8px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                color: #888;
                font-family: Inter, sans-serif;
                transition: all 0.3s ease;
            `;
            placeholder.innerHTML = `
                <div style="font-size: 0.9em; font-weight: 500; margin-bottom: 8px; text-align: center; padding: 0 10px;">
                    ${item.filename}
                </div>
                <div style="font-size: 0.7em; opacity: 0.7; text-align: center;">
                    View on EgonZippel.com &rarr;
                </div>
            `;
            link.appendChild(placeholder);
        }

        return link;
    }

    function displayResults(resultsToDisplay, isInitialDisplay = false) {
        searchResultsContainer.innerHTML = '';
        const sortOrder = document.getElementById('sortOrder').value; // 'asc' or 'desc'

        // Sort results chronologically
        const sortedResults = [...resultsToDisplay].sort((a, b) => {
            let comparison = 0;
            
            // Validate and parse dates (default to 0 if missing/invalid)
            const yearA = parseInt(a.year) || 0;
            const yearB = parseInt(b.year) || 0;
            const monthA = parseInt(a.month) || 0;
            const monthB = parseInt(b.month) || 0;
            const dayA = parseInt(a.day) || 0;
            const dayB = parseInt(b.day) || 0;
            const idxA = a.chronological_index_in_year || 0;
            const idxB = b.chronological_index_in_year || 0;

            // First sort by year
            if (yearA !== yearB) {
                comparison = yearA - yearB;
            }
            // Then by month
            else if (monthA !== monthB) {
                comparison = monthA - monthB;
            }
            // Then by day
            else if (dayA !== dayB) {
                comparison = dayA - dayB;
            }
            // Finally by chronological index within the same day
            else {
                comparison = idxA - idxB;
            }

            return sortOrder === 'desc' ? -comparison : comparison;
        });

        if (isInitialDisplay) {
            const rangeText = sortOrder === 'desc' ? 'newest' : 'first';
            resultsCount.textContent = `Displaying ${rangeText} ${sortedResults.length} of ${allImageData.length} images. Refine with search.`;
        } else {
            resultsCount.textContent = `${sortedResults.length} image(s) found.`;
        }

        if (sortedResults.length === 0 && !isInitialDisplay) {
            searchResultsContainer.innerHTML = '<p>No matching images found.</p>';
            return;
        }
        if (sortedResults.length === 0 && isInitialDisplay) {
            resultsCount.textContent = `Enter search terms to find images among ${allImageData.length} items.`;
            return;
        }

        sortedResults.forEach(item => {
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
                const ocrText = item.ai_analysis.ocr_text || '';
                if (ocrText && ocrText !== 'N/A') {
                    const textDiv = document.createElement('div');
                    textDiv.className = 'transcribed-text';
                    textDiv.style.cssText = `
                        margin-top: 8px;
                        font-size: 0.85em;
                        line-height: 1.4;
                        color: #ccc;
                        cursor: pointer;
                        transition: color 0.2s ease;
                    `;

                    const isLong = ocrText.length > 100;
                    let isExpanded = true;

                    function updateDisplay() {
                        if (isLong && !isExpanded) {
                            textDiv.innerHTML = `
                                ${ocrText.substring(0, 100)}...
                                <span style="display: block; margin-top: 4px; font-size: 0.8em; color: #888;">⋯⋯⋯</span>
                            `;
                        } else {
                            textDiv.innerHTML = ocrText;
                        }
                    }

                    if (isLong) {
                        textDiv.addEventListener('click', (e) => {
                            e.preventDefault();
                            isExpanded = !isExpanded;
                            updateDisplay();
                        });

                        textDiv.addEventListener('mouseenter', () => {
                            if (!isExpanded) {
                                textDiv.style.color = '#f58989';
                            }
                        });

                        textDiv.addEventListener('mouseleave', () => {
                            textDiv.style.color = '#ccc';
                        });
                    }

                    updateDisplay();
                    resultItemDiv.appendChild(textDiv);
                }


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

        const sortOrder = document.getElementById('sortOrder').value;

        if (!query) {
            // Display subset based on sort order (default 50 items)
            let subset;
            if (sortOrder === 'desc') {
                // If sorting newest first, start with the most recent items (end of the array)
                subset = allImageData.slice(-50);
            } else {
                // If sorting oldest first, start with the first items
                subset = allImageData.slice(0, 50);
            }
            displayResults(subset, true);
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
                } else if (term.length >= 8) {
                    // Auto-fuzzy only for clearly long terms. The previous 6-char threshold
                    // caused false positives like "claude" matching "cloud" (edit distance 1).
                    textQueryTermsForLunr.push(term + '~1');
                } else {
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

    document.getElementById('sortOrder').addEventListener('change', performSearch);

    loadData();
}); 