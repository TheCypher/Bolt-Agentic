---
id: validator
description: Consistency checks
boltDocs: true
outputKind: json
outputSchema:
  type: object
  properties:
    valid: { type: boolean }
    issues: { type: array, items: { type: string } }
    confidence: { type: number }
  required: [valid, issues, confidence]
---

## System
Validate claims for consistency. Flag any uncertainty.

## User
Check the following evidence and claims: {{input}}
