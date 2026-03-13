# Image Captioning Benchmark

Status: active
Mission: Evaluate how accurately vision-language models caption natural images across diverse categories.
Done when: Published benchmark with caption quality scores for 5+ models, correlation metrics against human ratings on 200+ images, and a recommended evaluation protocol.

## Context

Automated image captioning is widely used but poorly benchmarked for fine-grained accuracy. This project measures how well different VLMs describe image content — factual accuracy, detail coverage, and hallucination rates — and compares model outputs against human-written reference captions.

The goal is to answer: which models produce the most accurate and detailed captions, and what evaluation protocol best captures caption quality?

## Log

### 2026-03-01

Project created. Initial data audit completed — found 500 images with 3 human-written reference captions each in `data/captions.csv`. Images span 10 categories (animals, architecture, food, landscapes, people, sports, vehicles, art, indoor scenes, street photography). Each category has 50 images.

Sources: `data/captions.csv`, `data/categories.json`

## Open questions

- Which automated metric (BLEU, METEOR, CIDEr, CLIPScore) best correlates with human quality judgments for single-image captioning?
- How should we handle subjective captions where multiple valid descriptions exist? Human agreement on caption quality may be low for ambiguous images.
- Does caption quality vary systematically by image category? Models may excel at concrete objects (animals, vehicles) but struggle with abstract scenes (art, street photography).
