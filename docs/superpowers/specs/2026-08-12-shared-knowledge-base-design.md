# Shared Knowledge Base Design

## Goal

Allow every authenticated user to query documents owned by configured administrators while keeping ordinary users' uploads and question history private.

## Access policy

- A user can read and retrieve their own documents.
- A user can read and retrieve ready documents whose owner username appears in `ADMIN_USERNAMES`.
- Only the document owner can delete, reparse, or otherwise manage a document.
- RAG history and conversation memory remain scoped to the current user.
- Published videos and approved SOPs remain globally readable by authenticated users.

## Architecture

Add a small `knowledgeAccess` policy module that parses configured administrator usernames and builds the SQL scope used by document and chunk queries. Keep the current schema: administrator ownership dynamically represents public knowledge, so existing administrator documents become available immediately without a migration.

The document list and detail endpoints return accessible documents and annotate whether each document is owned by the current user. The frontend labels administrator documents as public and hides management controls for them. All RAG entry points use the same accessible chunk loader, including keyword-only fallback and the multi-tool document-list tool.

## Cache and security

Chunk caches are keyed by requesting user. Any document index change clears all chunk caches so changes to administrator-owned public documents are visible immediately. Read queries may include administrator documents; delete and reparse queries retain their owner-only condition.

## Verification

- Unit tests cover administrator parsing, public/private access decisions, and generated query scope.
- Existing authentication, migration, and filtering tests remain green.
- Production frontend build succeeds.
- A database read verifies that the new user can resolve the administrator-owned document count through the same scope.
