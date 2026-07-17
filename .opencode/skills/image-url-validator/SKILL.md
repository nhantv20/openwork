---
name: image-url-validator
description: Validate image URLs before including them in artifacts — checks for 404, timeouts, and errors
category: utility
---

# Image URL Validator

Before including image URLs in an artifact (news, dashboard, report), always validate them first to avoid broken images.

## Script

`.opencode/scripts/check-image-urls.mjs` — a Node.js script that checks URLs via HTTP HEAD (falls back to GET if 405).

## Usage

Pass a JSON array of URLs as argument or via stdin:

```bash
node .opencode/scripts/check-image-urls.mjs '["https://example.com/img1.jpg", "https://example.com/img2.png"]'
```

Or pipe from another command:

```bash
echo '["https://example.com/a.jpg"]' | node .opencode/scripts/check-image-urls.mjs
```

## Output

```json
{
  "valid": ["https://example.com/img1.jpg"],
  "invalid": [
    { "url": "https://example.com/img2.png", "status": 404 }
  ],
  "all": [
    { "url": "https://example.com/img1.jpg", "valid": true, "status": 200 },
    { "url": "https://example.com/img2.png", "valid": false, "status": 404 }
  ]
}
```

- `valid`: URLs that returned 2xx or 3xx
- `invalid`: URLs that returned 4xx, 5xx, or errored
- Use only `valid` URLs in the artifact
- For `invalid` URLs, fall back to a gradient placeholder or skip the image

## Workflow

1. Collect candidate image URLs from sources (OG images, article featured images, etc.)
2. Run them through the check script
3. Use only `valid` URLs in the artifact
4. For items where no valid URL exists, render a gradient+icon placeholder instead

## Timeout

8 seconds per URL, 5 concurrent connections. Adjustable at the top of the script.
