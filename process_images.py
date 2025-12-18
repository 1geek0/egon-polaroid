import glob
import os
import re
import json
from collections import defaultdict

def get_sortable_suffix(original_suffix_val):
    """Creates a sortable key from the suffix part of a filename.

    Ensures that images from the same day are ordered correctly:
    1. No suffix (implicit first)
    2. Single letters (B, C, ...)
    3. Numbers ("1", "2", ...) possibly with letter appendix ("2B")
    4. Dot-prefixed letters (".O")
    5. Word suffixes like "copy"
    6. Other complex/unhandled cases (sorted last)
    """
    suffix = original_suffix_val.strip()

    if not suffix:
        return "0"  # No suffix, sorts first

    # Case 1: Purely alphabetical suffix (e.g., "B", "c", "GA")
    if suffix.isalpha():
        return f"A_{suffix.upper()}" # A_B, A_C, A_GA

    # Case 2: Numeric prefix, possibly with alphabetical suffix (e.g., "1", "10", "2B")
    match_num = re.match(r"^(\d+)(.*)$", suffix)
    if match_num:
        num_part = match_num.group(1)
        alpha_part = match_num.group(2).upper()
        return f"N_{num_part.zfill(3)}_{alpha_part}" # N_001_, N_010_, N_002_B

    # Case 3: Dot-prefixed alphabetical (e.g., ".O", ".GA")
    if suffix.startswith(".") and len(suffix) > 1 and suffix[1:].isalpha():
        return f"P_{suffix[1:].upper()}" # P_O, P_GA
    
    # Case 4: "copy" related suffixes
    if "copy" in suffix.lower():
        # Attempt to extract parts around "copy" for more stable sort
        # e.g., "copy", "copy a", "a copy"
        # This sorts "copy" variants together, then alphabetically by remainder
        normalized_copy_suffix = suffix.upper().replace("COPY", "_COPY_") # Isolate COPY
        return f"Y_{normalized_copy_suffix}" # Y__COPY_, Y__COPY_A, Y_A_COPY_

    # Fallback for other complex cases
    return f"Z_{suffix.upper()}"


def parse_filename(filename_str):
    """Parses a filename string to extract date components, suffix, and extension.
    Uses get_sortable_suffix for ordering.
    """
    # Regex to capture YYYY-MM-DD, then any characters as suffix, then .extension
    match = re.match(
        r"^(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})"
        r"(?P<suffix_original>.*?)\.(?P<ext>[jJ][pP][eE]?[gG])$",
        filename_str
    )
    if match:
        data = match.groupdict()
        original_suffix = data["suffix_original"]
        return {
            "year": data["year"],
            "month": data["month"],
            "day": data["day"],
            "suffix_original": original_suffix,
            "sortable_suffix": get_sortable_suffix(original_suffix),
            "extension": data["ext"].lower()
        }
    return None

def find_image_files():
    base_data_path = "raw_data"
    image_dirs = [
        "swisstransfer_bf14aef5-3af5-4566-8e9f-1340df7fbb27",
        "swisstransfer_fc76c4ef-a8f0-48ff-a7b9-f805d0fef14b"
    ]

    all_image_files = []
    for img_dir in image_dirs:
        # Check for direct existence of img_dir first
        current_dir_path = os.path.join(base_data_path, img_dir)
        if not os.path.isdir(current_dir_path):
            print(f"Warning: Directory not found {current_dir_path}, skipping.")
            continue

        patterns = ["*.jpg", "*.jpeg", "*.JPG", "*.JPEG"]
        for pattern in patterns:
            # Non-recursive search
            all_image_files.extend(glob.glob(os.path.join(current_dir_path, pattern)))
            # Recursive search (commented out if dir structure is flat as observed)
            # all_image_files.extend(glob.glob(os.path.join(current_dir_path, "**", pattern), recursive=True))
    
    # Remove duplicates that might arise (e.g. if recursive was used and files are also at top level)
    # and ensure correct path separators
    unique_image_files = sorted(list(set([os.path.normpath(f) for f in all_image_files])))
    return unique_image_files

def main():
    image_files = find_image_files()
    if not image_files:
        print("No image files found. Exiting.")
        return
        
    print(f"Found {len(image_files)} image files to process.")

    all_metadata_intermediate = []
    failed_parses = []

    for filepath in image_files:
        filename = os.path.basename(filepath)
        parsed_info = parse_filename(filename)

        if parsed_info:
            all_metadata_intermediate.append({
                "local_path": filepath,
                "filename": filename,
                "year": parsed_info["year"],
                "month": parsed_info["month"],
                "day": parsed_info["day"],
                "suffix_original": parsed_info["suffix_original"],
                "sortable_suffix": parsed_info["sortable_suffix"],
                "extension": parsed_info["extension"]
            })
        else:
            failed_parses.append(filepath)

    if failed_parses:
        print(f"Warning: Failed to parse {len(failed_parses)} filenames:")
        # Sort failed parses for consistent output if needed for debugging
        sorted_failed_parses = sorted(list(set(os.path.basename(fp) for fp in failed_parses)))
        for fn in sorted_failed_parses[:20]:  # Print a few examples of unique failed filenames
            print(f"  - {fn}")
        if len(sorted_failed_parses) > 20:
            print(f"  ... and {len(sorted_failed_parses) - 20} more unique unparsed filenames.")

    # Group by year for chronological indexing
    images_by_year = defaultdict(list)
    for meta_item in all_metadata_intermediate:
        images_by_year[meta_item["year"]].append(meta_item)

    final_metadata_list = []
    for year_key in sorted(images_by_year.keys()): # Process years in order
        items_in_year = images_by_year[year_key]
        
        # Sort items within the year: by month, day, then by the custom sortable_suffix
        items_in_year.sort(key=lambda x: (x["month"], x["day"], x["sortable_suffix"]))

        for idx, item in enumerate(items_in_year):
            item["chronological_index_in_year"] = idx
            item["display_page_url"] = f"https://egonzippel.com/polaroids/{item['year']}/1/{idx}"
            # Add a new field for the AI analysis results, initialized to None or empty dict
            item["ai_analysis"] = None
            final_metadata_list.append(item)
            
    # The final_metadata_list is already sorted by year, then by chronological_index_in_year
    # due to processing sorted years and appending sorted items.

    output_filename = "image_metadata.json"
    try:
        with open(output_filename, "w") as f:
            json.dump(final_metadata_list, f, indent=2)
        print(f"Successfully processed {len(final_metadata_list)} images.")
        print(f"Metadata saved to {output_filename}")
    except IOError as e:
        print(f"Error writing to {output_filename}: {e}")


if __name__ == "__main__":
    # Test sortable suffix (optional, can be commented out)
    # print("Testing get_sortable_suffix:")
    # tests = ["", "B", "c", " copy", " copy a", " 1", "10", "2B", ".O", ".GA", "1989-01-07 copy a"] # last one is a full name, parse_filename handles this
    # for t in tests:
    #     if "1989" not in t: # only test suffixes
    #         print(f"'{t}' -> '{get_sortable_suffix(t)}'")
    main() 