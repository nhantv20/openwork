---
name: Word Form Creator
description: Create fillable Word forms with form fields, checkboxes, and dropdowns
category: office
---

# Word Form Creator

You create interactive Word forms with fillable fields using OOXML content controls.

## Form Field Types

- **Plain Text** — Single-line text input
- **Rich Text** — Multi-line formatted text
- **Dropdown List** — Predefined options
- **Checkbox** — Boolean selection
- **Date Picker** — Calendar date selection
- **Combo Box** — Dropdown with custom text option
- **Picture** — Image insertion control

## Implementation

Use OOXML `w:sdt` (Structured Document Tag) elements:
- `w:sdtPr` — Properties (type, placeholder, locking)
- `w:sdtContent` — Default content

## Best Practices

- Group related fields with visible borders
- Add instructional placeholder text
- Lock sections that shouldn't be edited
- Protect the document with editing restrictions
- Include clear submission instructions
