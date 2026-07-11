---
name: Morph PPT
description: Create presentations with smooth Morph transition effects between slides
category: office
---

# Morph PPT

You specialize in creating PowerPoint presentations with Morph transitions — smooth animations that move and transform objects between consecutive slides.

## Technique

Morph works when identical objects appear on two consecutive slides with different positions, sizes, or rotations. PowerPoint interpolates the difference.

## Implementation

Use python-pptx with OOXML manipulation:

1. Duplicate base slide content across consecutive slides
2. Change position, size, rotation, or opacity of objects
3. Set `transition` to `morph` via XML manipulation
4. Ensure object IDs match across slides for Morph to detect them

## Best Practices

- Morph works best with 1-3 objects per transition
- Use for: zooming into diagrams, moving elements across slides, revealing content
- Avoid morphing text-heavy slides

## Architecture blocks

When the deck needs a cloud-architecture diagram, do **not** hand-draw it in
PowerPoint. Delegate to the **`drawio-architect`** agent (which uses
`drawio-aws` / `drawio-azure` / `drawio-gcp` / `drawio-databricks` skills) to
produce a validated `.drawio` + PNG, then inline the PNG as a slide image.

### Workflow

1. **Ask the user** which cloud + which architecture. If they say "AWS 3-tier
   web app", route to `drawio-aws`. If "Azure hub-spoke landing zone", route
   to `drawio-azure`. See `office-assistant.md` for the full routing table.
2. **Tell the agent to write the PNG to the project's `diagrams/<domain>/`
   directory** so the path is stable across re-builds.
3. **Insert the PNG as an "architecture block"** — a full-bleed image
   centered on the slide, max 80% of slide area, with a 1-line caption
   underneath in 18pt sans-serif.

### Snippet (drop into your build script)

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN

def add_architecture_block(slide, png_path: str, caption: str = ""):
    """Add a cloud-architecture diagram as a centered, capped image."""
    # Cap at 80% of slide width, preserve aspect ratio
    slide_w = Inches(13.333)  # 16:9 default
    slide_h = Inches(7.5)
    max_w = slide_w * 0.8
    max_h = slide_h * 0.7
    # python-pptx auto-sizes; use width, then re-cap height
    pic = slide.shapes.add_picture(png_path, 0, 0, width=max_w)
    # Re-center
    pic.left = int((slide_w - pic.width) / 2)
    pic.top = int((slide_h - pic.height) / 2)
    # Caption
    if caption:
        tx = slide.shapes.add_textbox(Inches(0.5), pic.top + pic.height + Inches(0.2),
                                       slide_w - Inches(1.0), Inches(0.4))
        tf = tx.text_frame
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        run = p.add_run()
        run.text = caption
        run.font.size = Pt(18)
```

### When to morph an architecture block

- Across two consecutive slides, use **identical** PNG path + identical image
  object ID so Morph sees the "same" object and animates the change.
- Common pattern: slide N shows full architecture; slide N+1 shows a zoomed
  crop of one region. Achieve the crop by overlaying a colored rectangle on
  top of the PNG (not by re-cropping the PNG itself — that breaks Morph).
