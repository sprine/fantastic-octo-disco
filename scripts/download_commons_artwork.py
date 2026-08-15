#!/usr/bin/env python3
"""
Download random high-resolution artwork images from Wikimedia Commons.

Usage:
    python download_commons_artwork.py --query "famous artwork across the world" --output-folder samples --count 100

How it works:
    1. Searches Wikimedia Commons (File namespace) for the given query, paging
       through search results to build a pool of candidate files.
    2. Fetches image metadata (dimensions, mime type, size) for each candidate.
    3. Filters out non-images and anything below a minimum resolution, to bias
       toward higher quality / higher resolution results.
    4. Randomly samples --count images from the filtered pool.
    5. Downloads the original (highest resolution) version of each into
       --output-folder, skipping files that already exist.

Only uses the Python standard library (urllib, json, argparse) so it runs
with no extra dependencies.
"""

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API_URL = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "ArtworkDownloader/1.0 (https://example.org; contact@example.org) Python-urllib"

# Minimum width/height (in pixels) for a candidate to be considered
# "high resolution enough" to keep.
MIN_DIMENSION = 1200
# Minimum file size in bytes, to filter out tiny/low-quality images.
MIN_FILE_SIZE = 150_000


def api_get(params, retries=3, backoff=2.0):
    """Call the Wikimedia Commons API with the given params, return parsed JSON."""
    params = dict(params)
    params.setdefault("format", "json")
    url = API_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if attempt == retries:
                raise
            wait = backoff * attempt
            print(f"  API request failed ({e}), retrying in {wait:.0f}s...", file=sys.stderr)
            time.sleep(wait)


def search_candidates(query, target_pool_size):
    """
    Page through Commons search results for `query` in the File namespace,
    collecting up to target_pool_size candidate file titles.
    """
    titles = []
    gsrcontinue = None
    page_limit = 50  # max per API call for generator=search

    while len(titles) < target_pool_size:
        params = {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"{query} filetype:bitmap",
            "gsrnamespace": 6,  # File namespace
            "gsrlimit": page_limit,
            "prop": "info",
        }
        if gsrcontinue:
            params["gsrcontinue"] = gsrcontinue

        data = api_get(params)
        pages = data.get("query", {}).get("pages", {})
        if not pages:
            break

        for page in pages.values():
            title = page.get("title")
            if title and title.startswith("File:"):
                titles.append(title)

        cont = data.get("continue")
        if not cont or "gsrcontinue" not in cont:
            break
        gsrcontinue = cont["gsrcontinue"]

        print(f"  Collected {len(titles)} candidate titles so far...")
        time.sleep(0.2)  # be polite to the API

    return titles


def fetch_imageinfo(titles):
    """
    Fetch imageinfo (url, dimensions, size, mime) for a list of titles,
    batching in groups of 50 (the API's max for titles param).
    Returns a dict: title -> imageinfo dict.
    """
    results = {}
    batch_size = 50

    for i in range(0, len(titles), batch_size):
        batch = titles[i:i + batch_size]
        params = {
            "action": "query",
            "titles": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
        }
        data = api_get(params)
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            title = page.get("title")
            infos = page.get("imageinfo")
            if title and infos:
                results[title] = infos[0]
        time.sleep(0.2)

    return results


def is_high_quality(info):
    mime = info.get("mime", "")
    if not mime.startswith("image/"):
        return False
    width = info.get("width", 0)
    height = info.get("height", 0)
    size = info.get("size", 0)
    if width < MIN_DIMENSION and height < MIN_DIMENSION:
        return False
    if size < MIN_FILE_SIZE:
        return False
    return True


def sanitize_filename(title):
    name = title[len("File:"):] if title.startswith("File:") else title
    name = urllib.parse.unquote(name)
    name = re.sub(r'[\\/*?:"<>|]', "_", name)
    return name


def download_file(url, dest_path, retries=3, backoff=2.0):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp, open(dest_path, "wb") as f:
                f.write(resp.read())
            return True
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if attempt == retries:
                print(f"  FAILED to download {url}: {e}", file=sys.stderr)
                return False
            wait = backoff * attempt
            print(f"  Download failed ({e}), retrying in {wait:.0f}s...", file=sys.stderr)
            time.sleep(wait)
    return False


def main():
    parser = argparse.ArgumentParser(
        description="Download random high-resolution artwork images from Wikimedia Commons."
    )
    parser.add_argument("--query", required=True, help="Search query, e.g. 'famous artwork across the world'")
    parser.add_argument("--output-folder", required=True, help="Folder to save downloaded images into")
    parser.add_argument("--count", type=int, default=100, help="Number of images to download (default: 100)")
    parser.add_argument(
        "--pool-multiplier",
        type=int,
        default=5,
        help="Search for roughly count * pool-multiplier candidates before filtering/sampling (default: 5)",
    )
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducible sampling")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    os.makedirs(args.output_folder, exist_ok=True)

    target_pool_size = max(args.count * args.pool_multiplier, args.count)

    print(f"Searching Commons for '{args.query}' (pool target: {target_pool_size})...")
    titles = search_candidates(args.query, target_pool_size)
    if not titles:
        print("No search results found. Try a different query.", file=sys.stderr)
        sys.exit(1)
    print(f"Found {len(titles)} candidate files. Fetching metadata...")

    infomap = fetch_imageinfo(titles)

    high_quality = [(title, info) for title, info in infomap.items() if is_high_quality(info)]
    print(f"{len(high_quality)} of {len(infomap)} candidates pass the quality filter "
          f"(min dimension {MIN_DIMENSION}px, min size {MIN_FILE_SIZE} bytes).")

    if not high_quality:
        print("No candidates passed the quality filter. Try lowering thresholds or a broader query.", file=sys.stderr)
        sys.exit(1)

    if len(high_quality) < args.count:
        print(f"WARNING: only {len(high_quality)} high-quality candidates available, "
              f"fewer than requested count of {args.count}. Downloading all of them.")
        chosen = high_quality
    else:
        chosen = random.sample(high_quality, args.count)

    print(f"Downloading {len(chosen)} images to '{args.output_folder}'...")
    downloaded = 0
    skipped = 0
    for idx, (title, info) in enumerate(chosen, 1):
        url = info.get("url")
        if not url:
            continue
        filename = sanitize_filename(title)
        dest_path = os.path.join(args.output_folder, filename)

        if os.path.exists(dest_path):
            print(f"[{idx}/{len(chosen)}] Skipping (already exists): {filename}")
            skipped += 1
            continue

        width = info.get("width")
        height = info.get("height")
        print(f"[{idx}/{len(chosen)}] Downloading {filename} ({width}x{height})...")
        if download_file(url, dest_path):
            downloaded += 1

    print(f"\nDone. Downloaded {downloaded} images, skipped {skipped} already-existing files, "
          f"out of {len(chosen)} attempted.")
    print(f"Saved to: {os.path.abspath(args.output_folder)}")


if __name__ == "__main__":
    main()
