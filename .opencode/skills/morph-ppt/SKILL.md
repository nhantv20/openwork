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
