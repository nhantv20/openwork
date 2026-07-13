# Brand Profile: TestBrand

- kind: docx
- verification: unverified

## Structure

The template's ordered top-level skeleton. Region order **must** be respected on generation.

0. **cover** (`section.cover`) · required - body content before first TOC/Heading-1; cover anchors discovered
1. **toc** (`section.toc`) · required - block-level w:sdt docPartGallery 'Table of Contents', TOC-styled paragraph, w:instrText 'TOC', or multilingual contents heading
2. **body** (`section.body`) · required · repeatable · freeform - everything after the TOC (or after the cover) up to the final body sectPr

## Roles

Each role lists its concrete style and its usage (scope · placement · required).
`structural` roles belong to the ordered skeleton and must appear in their slot;
`freeform` roles are used on demand inside the freeform body region.

- `paragraph`: Normal (robust) - scope=body · freeform · optional
- `heading.1`: Heading 1 (robust) - scope=body · freeform · optional
- `heading.2`: Heading 2 (robust) - scope=body · freeform · optional
- `heading.3`: Heading 3 (robust) - scope=body · freeform · optional
- `cover.title`: Title (best_effort) - scope=cover · structural · required · order=0
- `cover.subtitle`: BrandDocs Cover Subtitle (best_effort) - scope=cover · structural · required · order=0
- `toc`: TOC Heading (best_effort) - scope=toc · structural · required · order=1
- `callout.info`: BrandDocs Callout (best_effort) - scope=body · freeform · optional
- `caption`: Caption (robust) - scope=body · freeform · optional
- `quote`: Quote (robust) - scope=body · freeform · optional
- `table.default`: BrandDocs Table (robust) - scope=body · freeform · optional
- `list.bullet.1`: BrandDocs Bullet L1 (robust) - scope=body · freeform · optional
- `list.bullet.2`: BrandDocs Bullet L2 (robust) - scope=body · freeform · optional
- `list.number.1`: BrandDocs Number L1 (robust) - scope=body · freeform · optional

## Brand palette roles

Semantic color tokens captured from the template. Reference THESE names
(or a theme slot like `accent1`) as run color tokens; never a raw hex.

- `danger` -> `accent4` (#E0742B)
- `primary` -> `accent1` (#2B7CD3)
- `surface` -> `lt2` (#EAF1FF)
- `text` -> `dk1` (#16213F)

## Authoring hints

- Pick blocks by MEANING using the role table above; the engine resolves
  every role to the template's own artifacts. Never name a style, font,
  or hex anywhere in the input: the profile is the only source.
- Respect the ordered skeleton (Structure section, when present): cover
  content first, derived indexes where the template keeps them, then the
  freeform body in the template's own order.
- After `comprehend`, reusable fragments (components/sections) may be
  available in `profile.json` under `comprehension.fragments`: prefer
  them over re-deriving recurring layouts.
