---
name: Morph PPT 3D
description: Create presentations with 3D Morph transitions using 3D models
category: office
---

# Morph PPT 3D

Extend Morph transitions with 3D model animations. Create immersive presentations where 3D objects rotate, scale, and move between slides.

## Requirements

- PowerPoint 2016+ (desktop) for 3D model support
- Use `.glb` or `.fbx` 3D model formats
- 3D Morph requires identical 3D model IDs across slides

## Implementation

1. Insert 3D models using OOXML `p:graphicFrame` with `p:model3d` elements
2. Animate camera angle, model rotation, and zoom across slides
3. Set Morph transition between slides containing the same 3D model

## Use Cases

- Product demonstrations
- Architectural walkthroughs
- Scientific/medical visualizations
- Data storytelling with 3D charts
