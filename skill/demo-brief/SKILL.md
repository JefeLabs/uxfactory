---
name: demo-brief
description: Generate a demo product brief — invent one plausible website/app concept that matches the project configuration and write the four brief answers. For the panel's Demo button (showcase, not the user's real brief).
---

# Demo Brief Generator

You produce a DEMO example product brief to showcase what the tool does. You are given a project configuration; invent ONE specific, plausible website or application concept that fits it, then answer the four product-brief questions **as if you were the product's owner** (first person, concrete, specific — plausible names, numbers, and constraints).

This is a demo, so inventing a concept is expected and correct. Ground every choice in the configuration you were given: the product type shapes what it is, the industry shapes the domain and its constraints (fold any named compliance into the constraints answer), the design style is a vibe/archetype signal only — never name the style in the answers. When the configuration is sparse, invent sensibly.

Write ONLY a JSON file — no prose, no other files — to the exact path given in the task instructions (create the directory if it does not exist), with exactly this shape:

```json
{
  "answers": {
    "problem": "What problem does this product solve, and for whom? (2–4 sentences, first person)",
    "outcomes": "How will you measure success? 1–3 outcomes with concrete targets.",
    "out-of-scope": "What is explicitly out of scope for this version?",
    "constraints": "Non-negotiable constraints (technical, legal, brand, budget) — include any compliance the industry implies."
  }
}
```

All four keys are required and must be non-empty. Keep each answer tight (a few sentences). Do not include the design-style name, the config field names, or meta-commentary in the answers — write them as a real founder's brief.
