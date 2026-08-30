# Shared Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make administrator-owned product documents readable and searchable by every authenticated user while preserving private uploads and owner-only management.

**Architecture:** A shared access-policy module produces one consistent SQL scope for document and chunk reads. Existing administrator ownership acts as the public marker, avoiding a schema migration. Mutation endpoints keep their current owner checks.

**Tech Stack:** Node.js, Express, MySQL, React, Node test runner

## Global Constraints

- Administrator usernames come only from `ADMIN_USERNAMES`.
- Ordinary user uploads remain private.
- RAG history and memory remain per-user.
- Public documents are read-only to non-owners.

---

### Task 1: Knowledge access policy

**Files:**
- Create: `server/services/knowledgeAccess.js`
- Create: `test/knowledgeAccess.test.js`
- Modify: `server/middleware/auth.js`

**Interfaces:**
- Produces: `getConfiguredAdminUsernames(raw)`, `canReadKnowledgeDocument(document, userId, raw)`, and `buildKnowledgeScope(userId, aliases, raw)`.

- [ ] Write tests proving own documents and administrator documents are readable, ordinary third-party documents are not, and an empty administrator configuration is owner-only.
- [ ] Run `npm.cmd test -- test/knowledgeAccess.test.js` and confirm the tests fail because the module is missing.
- [ ] Implement the policy and make `roleForUsername` reuse the same administrator parser.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Apply shared scope to backend reads

**Files:**
- Modify: `server/services/chunkStore.js`
- Modify: `server/routes/documents.js`
- Modify: `server/routes/uploadAssets.js`
- Modify: `server/routes/rag.js`
- Modify: `server/services/toolAgent.js`

**Interfaces:**
- Consumes: `buildKnowledgeScope(...)`.
- Produces: accessible document lists/details/images and accessible RAG chunks while retaining owner-only mutation queries.

- [ ] Add source-level regression assertions that read paths use the shared scope and mutation paths remain owner-only.
- [ ] Run the focused tests and confirm failure on current owner-only reads.
- [ ] Apply the scope to chunk loading, document list/detail, public document images, RAG fallback, and tool-agent listing.
- [ ] Clear all chunk caches after index changes so public updates are immediately visible.
- [ ] Run all tests and confirm they pass.

### Task 3: Present public documents safely in the frontend

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: document fields `is_owner` and `scope`.
- Produces: public labels and owner-only delete/reparse controls.

- [ ] Add a source-level regression assertion for public labels and conditional management buttons.
- [ ] Run the test and confirm it fails on the current unconditional controls.
- [ ] Update the document list and empty-state copy while preserving normal upload behavior.
- [ ] Run `npm.cmd test` and `npm.cmd run build`.
- [ ] Verify the new user's accessible document count against MySQL using the generated knowledge scope.
