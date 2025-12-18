# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Egon Zippel Polaroid Archive Search** - a web application for searching through ~8,700 daily polaroid sketches and observations from artist Egon Zippel (1989-2025). The project consists of a frontend search interface, Python data processing scripts, and connection analysis tools.

## Architecture

### Frontend Components
- **`index.html`** - Main search interface with cyber/modern artist studio theme
- **`style.css`** - Styling with CSS variables for theming
- **`search_logic.js`** - Lunr.js-based search functionality with:
  - Full-text search through OCR'd text
  - Visual description search using AI-generated captions  
  - Keyword-based search with intelligent tagging
  - Date filtering and fuzzy matching
  - Image URL extraction and caching via CORS proxy

### Data Processing Pipeline
- **`process_images.py`** - Scans raw image files, parses filenames for dates, creates metadata JSON
- **`populate_ai_data.py`** - Uses Gemini API to generate OCR, visual descriptions, and keywords for images

### Data Structure
The core data structure in `image_metadata.json`:
```json
{
  "filename": "2011-04-15.jpg",
  "year": "2011", "month": "04", "day": "15",
  "local_path": "raw_data/...",
  "display_page_url": "https://egonzippel.com/polaroids/2011/1/1234",
  "ai_analysis": {
    "ocr_text": "waiting for the train",
    "visual_description": "A sketch of a person waiting at a train platform", 
    "keywords": ["train", "waiting", "platform", "sketch"]
  }
}
```

## Development Commands

### Data Processing
```bash
# Process raw images and create metadata
python process_images.py

# Populate AI analysis data (requires GEMINI_API_KEY)
python populate_ai_data.py

# Run connection analysis
python connection_analyzer.py
```

### Web Development
- No build process required - static HTML/CSS/JS
- Serve locally with any HTTP server: `python -m http.server 8000`
- Main search loads data from remote JSON URL via fetch()

## Key Technical Details

### Search Implementation
- Uses **Lunr.js** for client-side full-text search indexing
- Implements smart fuzzy matching (6+ letter words get automatic fuzzy, shorter words exact match)
- Supports quoted phrase searches with manual exact matching
- Date parsing extracts years and month names from queries
- Image loading uses CORS proxy (`api.allorigins.win`) to extract actual image URLs from EgonZippel.com pages

### AI Data Processing
- **Gemini 2.5 Flash** for OCR, visual description, and keyword extraction
- Concurrent processing with ThreadPoolExecutor (configurable MAX_WORKERS)
- Robust error handling with retry logic for rate limits
- Incremental saves during processing to prevent data loss

### File Organization
- **`raw_data/`** - Source polaroid images (not in git)
- **`image_metadata.json`** - Core searchable data file
- **`.gitignore`** - Excludes raw_data/, connection_*, .conda/, *.env, .DS_Store

## Special Features

### Search Features
- **Exact phrase matching**: `"waiting for"` 
- **Fuzzy search**: `train~` or automatic for long words
- **Date filtering**: `2011`, `april`, `apr`
- **Combined searches**: `"morning sketch" 2015`
- Visual result grid with image previews and metadata

## Environment Variables
- **`GEMINI_API_KEY`** - Required for AI analysis in `populate_ai_data.py`

## Notes
- The application loads data from a remote JSON file for GitHub Pages compatibility
- Image files are referenced but actual display uses URLs extracted from EgonZippel.com
- The archive spans decades, requiring careful date parsing and chronological sorting
- Artist often signs as "Egon", "Egon Zippel", or "Egon NYC"