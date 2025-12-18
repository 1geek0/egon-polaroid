import os
import json
import base64
import time
from openai import OpenAI
import dotenv
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed

dotenv.load_dotenv()

# Configuration
METADATA_FILE = "image_metadata.json"
API_KEY = os.environ.get("GEMINI_API_KEY")
BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
MODEL_NAME = "gemini-2.5-flash"
MAX_WORKERS = 10  # Number of parallel API calls. Adjust based on API limits and performance.
SAVE_INTERVAL_ITEMS = 10 # Save after every N processed items in a parallel batch run
API_RETRY_DELAY = 60 # Seconds to wait if a rate limit or availability error is hit
PER_REQUEST_DELAY = 1 # Seconds to wait between individual requests within a worker to be polite to API

# New combined prompt
COMBINED_PROMPT = '''Analyze the attached image, which is a sketch. Provide the following information in a valid JSON object format:
1. "ocr_text": Extract all text, including handwritten and sketched text. If no text is present, this should be an empty string. The artist often signs as "Egon", "Egon Zippel", or "Egon NYC" write similar text as this signature.
2. "visual_description": A concise visual description of the sketch, focusing on the main subjects, style, and any prominent visual elements. Do not give general descriptions like "sketch", "drawing", "painting", etc. 10,000 such images are going to be processed this way.
3. "keywords": A list of 3-7 relevant keywords or short phrases that categorize or describe the main themes, objects, or concepts in the sketch. These should be strings in a list.

Example JSON output format:
{
  "ocr_text": "Some extracted text here...",
  "visual_description": "A sketch depicting a distorted face with an abstract background.",
  "keywords": ["portrait", "abstract", "face", "monochrome sketch"]
}

If the image cannot be processed or is unclear, return a JSON object with empty strings for "ocr_text" and "visual_description", and an empty list for "keywords".'''

# --- Helper Functions ---
def encode_image_to_base64(image_path):
    """Encodes an image file to a base64 string."""
    try:
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
    except FileNotFoundError:
        # This error will be handled by the calling function which prints context
        return None
    except Exception as e:
        print(f"Error encoding image {image_path}: {e}")
        return None

def get_image_mime_type(image_path):
    """Determines a basic MIME type from file extension."""
    ext = os.path.splitext(image_path)[1].lower()
    if ext == ".jpg" or ext == ".jpeg":
        return "image/jpeg"
    elif ext == ".png":
        return "image/png"
    else:
        print(f"Warning: Unknown extension {ext} for {image_path}. Defaulting to image/jpeg.")
        return "image/jpeg"

def get_gemini_analysis(client, base64_image_data, mime_type, image_path_for_log="image"):
    """Sends a request to the Gemini API for combined analysis and returns parsed JSON."""
    if not base64_image_data:
        return None
    try:
        time.sleep(PER_REQUEST_DELAY) # Polite delay before each request
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": COMBINED_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{base64_image_data}"},
                        },
                    ],
                }
            ],
            response_format={"type": "json_object"}, 
            temperature=0.2, 
            max_tokens=4096
        )
        
        if response.choices and response.choices[0].message and response.choices[0].message.content:
            raw_content = response.choices[0].message.content.strip()
            if raw_content.startswith("```json") and raw_content.endswith("```"):
                json_str = raw_content[len("```json"):-(len("```"))].strip()
            elif raw_content.startswith("```") and raw_content.endswith("```"):
                 json_str = raw_content[len("```"):-(len("```"))].strip()
            else:
                json_str = raw_content
            
            try:
                parsed_json = json.loads(json_str)
                if all(key in parsed_json for key in ["ocr_text", "visual_description", "keywords"]):
                    return parsed_json
                else:
                    tqdm.write(f"Warning: Parsed JSON for {image_path_for_log} is missing required keys. Content: {json_str}")
                    if response.choices[0].finish_reason == 'length':
                        tqdm.write(f"  Potentially truncated due to max_tokens. Finish reason: {response.choices[0].finish_reason}")
                    return {"error": "missing_keys", "raw_content": raw_content} 
            except json.JSONDecodeError as je:
                tqdm.write(f"JSON Decode Error for {image_path_for_log}: {je}. Raw content: '{raw_content}'")
                if response.choices and response.choices[0].finish_reason == 'length':
                     tqdm.write(f"  Potentially truncated due to max_tokens. Finish reason: {response.choices[0].finish_reason}")
                return {"error": "json_decode_error", "raw_content": raw_content} 
        elif response.choices and response.choices[0].finish_reason == 'length':
            tqdm.write(f"Warning: No content returned for {image_path_for_log}, but finish_reason was 'length'. Potentially an issue with prompt or model response capacity.")
            return {"error": "no_content_finish_length"}
        else:
            tqdm.write(f"Warning: Received an unexpected response structure for {image_path_for_log}. Full response: {response}")
            return {"error": "unexpected_structure"}
            
    except Exception as e:
        tqdm.write(f"API Error for {image_path_for_log}: {e}")
        if "rate limit" in str(e).lower() or "unavailable" in str(e).lower() or "quota" in str(e).lower() or "503" in str(e).lower():
            tqdm.write(f"Rate limit/Quota/Availability error for {image_path_for_log}. Waiting for {API_RETRY_DELAY}s...")
            time.sleep(API_RETRY_DELAY) 
            # Signal to retry this specific image by returning a specific error object or None
            return {"error": "api_retry_needed", "details": str(e)} 
        return {"error": "general_api_error", "details": str(e)}


def process_image_item(item_tuple):
    item_index, item_data, client_instance = item_tuple # client_instance passed to reuse
    image_path = item_data.get("local_path")

    if not image_path:
        tqdm.write(f"Skipping item at original index {item_index} due to missing 'local_path'. Filename: {item_data.get('filename', 'Unknown')}")
        return item_index, None # Return index and None for analysis if path is missing

    base64_image = encode_image_to_base64(image_path)
    if not base64_image:
        tqdm.write(f"Skipping AI analysis for {os.path.basename(image_path)} (Original index {item_index}) due to encoding error.")
        # Mark as encoding error, so it's not retried indefinitely if the file is truly problematic
        return item_index, {"error": "encoding_failed", "timestamp": time.time()}
    
    mime_type = get_image_mime_type(image_path)
    analysis_result = get_gemini_analysis(client_instance, base64_image, mime_type, image_path)
    
    return item_index, analysis_result


# --- Main Processing ---
def main():
    if not API_KEY:
        print("Error: GEMINI_API_KEY environment variable not set.")
        return

    try:
        with open(METADATA_FILE, 'r') as f:
            all_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Metadata file '{METADATA_FILE}' not found. Please run process_images.py first.")
        return
    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON from '{METADATA_FILE}'. File might be corrupted.")
        return

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL) # Create one client instance
    
    print(f"Loaded {len(all_data)} image records from {METADATA_FILE}.")
    
    # Create a list of tuples: (original_index, item_data)
    items_to_process_with_indices = [
        (idx, item) for idx, item in enumerate(all_data) if item.get("ai_analysis") is None
    ]
    
    total_needing_analysis = len(items_to_process_with_indices)
    if total_needing_analysis == 0:
        print("No images require AI analysis. All items seem to be processed.")
        return
        
    print(f"{total_needing_analysis} images need AI analysis.")

    processed_count_in_run = 0
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Pass client instance to each worker task
        futures = [executor.submit(process_image_item, (original_idx, item_data, client)) 
                   for original_idx, item_data in items_to_process_with_indices]
        
        for future in tqdm(as_completed(futures), total=total_needing_analysis, desc="Processing images"):
            original_idx, analysis_result = future.result()
            
            if analysis_result:
                # Check if the result is an error dictionary that signals a retry for this specific item
                if isinstance(analysis_result, dict) and analysis_result.get("error") == "api_retry_needed":
                    tqdm.write(f"Retrying image {all_data[original_idx].get('filename', 'Unknown')} (idx {original_idx}) later due to API error: {analysis_result.get('details')}")
                    # Do not mark as processed, it will be picked up in a future run if ai_analysis remains None
                else:
                    all_data[original_idx]["ai_analysis"] = analysis_result
                    processed_count_in_run += 1
                    if not (isinstance(analysis_result, dict) and analysis_result.get("error")):
                        ocr_snippet = analysis_result.get('ocr_text', 'N/A')[:30].replace("\n", " ")
                        keywords_str = ", ".join(analysis_result.get('keywords', []))
                        tqdm.write(f"  Processed {all_data[original_idx].get('filename', 'idx '+str(original_idx))}. OCR: '{ocr_snippet}...', KW: [{keywords_str[:30]}...]")
                    else:
                        tqdm.write(f"  Failed analysis for {all_data[original_idx].get('filename', 'idx '+str(original_idx))}. Error: {analysis_result.get('error')}")

            # Save progress periodically
            if processed_count_in_run > 0 and processed_count_in_run % SAVE_INTERVAL_ITEMS == 0:
                try:
                    with open(METADATA_FILE, 'w') as f_out:
                        json.dump(all_data, f_out, indent=2)
                    tqdm.write(f"  --- Progress saved to {METADATA_FILE} ({processed_count_in_run} updates made in this run) ---")
                except IOError as e:
                    tqdm.write(f"  Error saving intermediate progress to {METADATA_FILE}: {e}")
    
    # Final save for any remaining changes
    try:
        with open(METADATA_FILE, 'w') as f_out:
            json.dump(all_data, f_out, indent=2)
        print(f"--- Final metadata saved to {METADATA_FILE} ---")
    except IOError as e:
        print(f"Error saving final metadata to {METADATA_FILE}: {e}")

    end_time = time.time()
    print(f"Finished AI analysis data population attempt.")
    print(f"Total updates successfully made in this run: {processed_count_in_run}")
    print(f"Total time taken: {end_time - start_time:.2f} seconds for this run.")

if __name__ == "__main__":
    main() 