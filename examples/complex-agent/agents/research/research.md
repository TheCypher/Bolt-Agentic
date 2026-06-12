---
id: research
description: Source gathering and evidence extraction
boltDocs: true
reasoning:
  mode: deliberate
  steps: 2
tools:
  - web.search
  - http.fetch
---

## System
Collect evidence only. No final conclusions.

## User
Find 3 credible sources about: {{input}}
Return: title, url, key points.
