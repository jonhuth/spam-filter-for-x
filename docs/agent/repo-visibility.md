# Repo Visibility Decision: Public vs Private

## Context

During the fleet review (WORK-676), a discrepancy was noted between `projects/registry.yaml` (which listed `repo_visibility: private`) and GitHub (`jonhuth/spam-filter-for-x` which is `visibility: public`).

This document records the evaluation and decision regarding whether the repository should remain public or be transitioned to private.

## Evaluation & Tradeoffs

### Arguments for Private:
1. **Commercial Asset Protection**: The iOS Safari extension is designed as a paid upfront ($4.99) product. Making source code private protects proprietary implementations and UI scripts.
2. **Fleet Portfolio Consistency**: Standard personal portfolio policy (`dotfiles/projects/registry.yaml`) generally defaults projects to private repos.
3. **Backend Details**: The repository tracks Docker compose deployment manifests and backend scoring prompts.

### Arguments for Public:
1. **Critical App Store Dependency**:
   - Apple requires public Privacy Policy and Support URLs for App Review (Guideline 5.1.1) and consumer listings.
   - The production App Store metadata (`docs/agent/app-store-listing.md`) currently publishes:
     - **Privacy Policy**: `https://github.com/jonhuth/spam-filter-for-x/blob/master/docs/privacy.md`
     - **Support**: `https://github.com/jonhuth/spam-filter-for-x/issues`
   - Switching the repository to private immediately breaks both links with HTTP 404 errors, causing App Store review rejection or blocking App Store release.
2. **Verified Privacy & Client-Only Trust**:
   - The primary value proposition of Spam Filter for X is "100% on-device, zero tracking, zero remote logging".
   - An open repository allows users and security-conscious reviewers to inspect the client-side code directly, building user trust.
3. **Open Source Alignment**:
   - The repository root `README.md` explicitly specifies an `MIT` license.
   - Chrome users can load unpacked directly from source for local R&D.
4. **Backend Security**:
   - The backend `x-account-backend` is not publicly reachable; it binds exclusively to the private Tailscale mesh (`nas:3004`).
   - `.env` files and API keys are strictly gitignored and not committed.

## Decision

**Keep `jonhuth/spam-filter-for-x` PUBLIC.**

1. **Retain GitHub Public Visibility**:
   - Retain public visibility to keep App Store Privacy Policy (`docs/privacy.md`) and Support (`issues`) fully operational.
   - Retain MIT license for the WebExtension sources.

2. **Reconcile Registry**:
   - Update `projects/registry.yaml` in dotfiles to set `repo_visibility: public` so that registry audits (`registry-sync`) match reality.

3. **Prerequisite if Private is ever chosen later**:
   - The repository must NOT be made private until public replacement URLs for Privacy Policy (e.g. hosted at `https://jhuth.dev/privacy/spam-filter-for-x`) and Support are live and updated in App Store Connect.
