import requests
from bs4 import BeautifulSoup
import csv
import time
import datetime
import sys

def scrape_polaroids():
    base_url = "https://egonzippel.com/polaroids"
    current_year = 2026 # Based on prompt date
    start_year = 1989
    
    # Range is inclusive of current_year
    years = range(start_year, current_year + 1)
    
    all_data = []
    
    # Headers for CSV
    headers = ["year", "date_title_raw", "image_url", "thumbnail_url", "source_page"]
    
    print(f"Starting scrape for years {start_year} to {current_year}...")
    
    for year in years:
        url = f"{base_url}/{year}"
        print(f"Scraping {url}...")
        
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status() # Raise HTTPError for bad responses (4xx, 5xx) 
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find all image containers
            # <div class="imageItemContainer">
            containers = soup.find_all("div", class_="imageItemContainer")
            
            if not containers:
                print(f"  No image containers found for year {year}. (Could be empty or layout changed)")
                continue
                
            print(f"  Found {len(containers)} images for {year}.")
            
            for container in containers:
                try:
                    # Extract Link and Image URL
                    # <a href="..." ... class="thumb" ...>
                    link_tag = container.find("a", class_="thumb")
                    
                    full_image_url = ""
                    thumbnail_url = ""
                    
                    if link_tag and link_tag.get("href"):
                        # Handle relative URLs if necessary, though site seems to use protocol-relative //
                        href = link_tag.get("href")
                        if href.startswith("//"):
                            full_image_url = "https:" + href
                        elif href.startswith("/"):
                            full_image_url = "https://egonzippel.com" + href
                        else:
                            full_image_url = href
                    
                    # Extract Thumbnail URL from inner img
                    img_tag = link_tag.find("img") if link_tag else None
                    if img_tag and img_tag.get("src"):
                        src = img_tag.get("src")
                        if src.startswith("//"):
                            thumbnail_url = "https:" + src
                        elif src.startswith("/"):
                            thumbnail_url = "https://egonzippel.com" + src
                        else:
                            thumbnail_url = src

                    # Extract Date/Title
                    # <div class="imageInfo"><span class="imageFrDimension">...</span>
                    info_div = container.find("div", class_="imageInfo")
                    date_title = ""
                    if info_div:
                        span = info_div.find("span", class_="imageFrDimension")
                        if span:
                            date_title = span.get_text(strip=True)
                    
                    # Store data
                    all_data.append({
                        "year": year,
                        "date_title_raw": date_title,
                        "image_url": full_image_url,
                        "thumbnail_url": thumbnail_url,
                        "source_page": url
                    })
                    
                except Exception as e:
                    print(f"  Error processing an item in {year}: {e}")
                    continue

            # Be polite to the server
            time.sleep(1) 
            
        except requests.exceptions.RequestException as e:
            print(f"  Network error scraping {year}: {e}")
        except Exception as e:
            print(f"  Unexpected error scraping {year}: {e}")
            
    # Save to CSV
    output_file = "polaroids_data.csv"
    try:
        with open(output_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(all_data)
        print(f"\nScraping complete. Collected {len(all_data)} items.")
        print(f"Data saved to {output_file}")
    except IOError as e:
        print(f"Error writing to file {output_file}: {e}")

if __name__ == "__main__":
    scrape_polaroids()
