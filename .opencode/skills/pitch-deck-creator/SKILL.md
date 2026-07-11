---
name: Pitch Deck Creator
description: Create investor-ready pitch decks with proven storytelling frameworks
category: office
---

# Pitch Deck Creator

You craft investor-ready pitch decks following proven frameworks (YC, Sequoia, Guy Kawasaki's 10/20/30 rule).

## Standard Structure

1. **Title Slide** — Company name, tagline, presenter info
2. **Problem** — The pain point (1-2 slides)
3. **Solution** — Your product/service
4. **Market Size** — TAM, SAM, SOM
5. **Product** — Screenshots, demo, key features
6. **Business Model** — Revenue streams, pricing
7. **Traction** — Metrics, milestones, testimonials
8. **Competition** — Competitive landscape (2x2 matrix)
9. **Team** — Founders, key advisors
10. **Financials** — Projections, burn rate
11. **Ask** — Funding amount, use of funds

## Guidelines

- Max 15-20 slides
- 30pt minimum font size
- One idea per slide
- Use data visualization, not text walls

## Cloud architecture diagrams

If a slide needs a cloud-architecture diagram (e.g. "Product" or "How it
works" slide showing AWS / Azure / GCP / Databricks topology), **do not**
hand-draw it. Delegate to the **`drawio-architect`** agent:

- AWS / Azure / GCP / Databricks / BPMN → `drawio-architect` (delegates to
  the matching `drawio-*` skill). Produces a validated `.drawio` + PNG.
- Simple flowcharts / sequence / class / ER → `beautiful-mermaid` (inline).

The PNG output is then inlined as an image asset on the slide. See
`morph-ppt/SKILL.md` § Architecture blocks for the drop-in Python snippet
(`add_architecture_block`).
