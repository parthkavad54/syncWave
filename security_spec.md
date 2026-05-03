# Firestore Security Specification

## Data Invariants
1. A user can only read/write their own profile in `users/{userId}`.
2. A user can only manage their own music library in `users/{userId}/library/{trackId}`.
3. Playlists are private by default (only owner can read/write).
4. All tracks in library and playlists must have valid URLs and owner IDs matching the creator.

## The "Dirty Dozen" Payload Attacks
1. **Identity Spoofing**: Attempt to create a profile for another user ID.
2. **PII Leak**: Attempt to read another user's email via `users/{otherId}`.
3. **Library Hijack**: Attempt to add a track to another user's library.
4. **Metadata Poisoning**: Attempt to update a track name with a 1MB string.
5. **Timestamp Forge**: Attempt to set `createdAt` to a past date instead of server time.
6. **Relational Break**: Create a playlist referencing a track that doesn't exist (can be loose if we store full objects, but check owner).
7. **Role Escalation**: Attempt to set an `isAdmin` field in the user profile (none defined in blueprint, but rule must deny).
8. **Shadow Field injection**: Adding extra keys to a `Playlist` object.
9. **Global Scraping**: Attempting a `list` on `playlists` without being the owner.
10. **Immutable Warp**: Attempt to change the `ownerId` of a playlist after creation.
11. **Negative Duration**: Setting track duration to -1.
12. **Status Shortcut**: (Not applicable yet, no status fields).

## Test Runner (Draft)
A test file `firestore.rules.test.ts` will verify these denials.
