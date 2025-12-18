# Egon Zippel Polaroid Archive Search

A searchable interface for Egon Zippel's collection of ~8,700 daily polaroid sketches and observations from 1989-2025.

## Live Demo
🔗 **[View the search interface](https://yourusername.github.io/egon-polaroid-search/)**

## Features
- **Full-text search** through OCR'd text from polaroids
- **Visual description search** using AI-generated captions
- **Keyword-based search** with intelligent tagging
- **Date filtering** by year and month
- **Phrase search** with exact matching
- **Fuzzy matching** for typos and variations
- **Advanced search operators** for precise queries

## Files
- `index.html` - Main search interface
- `style.css` - Styling and animations
- `search_logic.js` - Search functionality using Lunr.js
- `image_metadata.json` - Searchable data for all polaroids

## Quick Setup for GitHub Pages

1. **Fork or download this repository**
2. **Add your `image_metadata.json` file** to the repository
3. **Enable GitHub Pages**:
   - Go to repository Settings > Pages
   - Source: Deploy from a branch
   - Branch: main
   - Save
4. **Access your site** at `https://yourusername.github.io/repository-name/`

## Data Structure

The search works with JSON data in this format:
```json
{
  "filename": "2011-04-15.jpg",
  "year": "2011",
  "month": "04", 
  "day": "15",
  "display_page_url": "https://egonzippel.com/polaroids/2011/1/1234",
  "local_path": "path/to/image.jpg",
  "ai_analysis": {
    "ocr_text": "waiting for the train",
    "visual_description": "A sketch of a person waiting at a train platform",
    "keywords": ["train", "waiting", "platform", "sketch"]
  }
}
```

## Search Tips
- Use quotes for exact phrases: `"waiting for"`
- Include years or months: `2011`, `april`
- Add `~` for fuzzy matching: `train~`
- Combine terms: `"morning sketch" 2015`

## Integration
This interface can be integrated into any website using:
- The HTML structure from `index.html`
- The CSS from `style.css` 
- The JavaScript from `search_logic.js`
- A hosted version of `image_metadata.json` 