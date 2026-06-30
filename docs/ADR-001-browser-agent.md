# ADR-001 - Browser Agent

## Status

Accepted

## Context

The QA agent needs to verify browser-based workflows and capture screenshots as evidence.

## Decision

The project uses Stagehand (Playwright-based) for browser automation.

Reasons:

- Simple integration with TypeScript
- Screenshot support
- Easy future extension for AI-driven browser actions

## Consequences

Advantages:

- Browser evidence can be collected automatically.
- Easy to extend with login automation later.

Limitations:

- Authentication is not implemented yet.
- Protected pages redirect to login.