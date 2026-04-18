# ForgeRoom — Offline Collaboration Workspace

Pure frontend Vue 3 + TypeScript SPA for small-team collaboration in offline/LAN environments.
No backend, no cloud services, no signaling servers.

## Project Type

**web**

ForgeRoom is a frontend-only web SPA.

## Current Status

ForgeRoom is production-ready for a frontend-only deployment path.

Production scope qualifiers:
- Browser scope: validated on Chromium-based browsers and Firefox in the Dockerized test path; validate Safari and older browser versions before release.
- Scale envelope: designed for small-team collaboration with enforced caps (20 active members, 2,000 elements, 50 images, 5,000 retained chat messages, 48 snapshots).
- Availability boundary: local/LAN-first operation only (no backend, no cloud sync, no server-side failover).
- Operational expectation: treat this as a frontend-only production path with environment-specific validation using the sections below.

See **Browser Requirements**, **Limitations**, and **Testing (Docker-Only)** for concrete boundary details.

- Startup is Docker-first and deterministic.
- Tests run in Docker with enforced coverage thresholds.
- R1-R20 requirement-to-test traceability is documented in [`docs/requirements-to-test.md`](../docs/requirements-to-test.md).

## Prerequisites

- Docker (with Docker Compose support)

## Startup

```bash
cd repo
docker compose up --build
# Strict-compatibility alias (equivalent command)
docker-compose up --build
```

## Access Method

Open **http://localhost:5173** in your browser.

Expected result:
- Home page renders with links for profile setup and rooms.
- No backend service is required.

## System Verification

After startup, verify the system with this end-to-end user flow:

1. Open `http://localhost:5173`.
2. Click **Select Profile**.
3. Create a new profile with a passphrase of at least 8 characters.
4. Unlock that profile and confirm redirect to `/rooms`.
5. Create a room and confirm redirect to `/workspace/:roomId`.
6. Add a sticky note on the canvas and confirm it appears.
7. Send a chat message and confirm it appears in chat history.
8. Open the comment drawer for an element and add a comment.
9. Lock the session and confirm redirect to `/profile`.
10. Unlock again and confirm workspace access is restored.

## Demo Credentials

Profiles are local browser records, not server accounts.
Use these demo identities for validation across role personas:

| Role | Profile Name | Passphrase |
|---|---|---|
| Host | alice-host | Password123! |
| Reviewer | bob-reviewer | Password456! |
| Participant | charlie-participant | Password789! |
| Guest | diana-guest | Password000! |

Notes:
- These are demo values for local testing only.
- All profile data is stored in IndexedDB on the local browser.
- Clearing site data removes profiles and session state.

## Testing (Docker-Only)

```bash
bash repo/run_tests.sh               # unit/integration suite, then Playwright e2e suite
bash repo/run_tests.sh --coverage    # unit/integration with V8 coverage, then Playwright e2e suite
bash repo/run_tests.sh --e2e         # Playwright browser journey suite only
bash repo/run_tests.sh --all         # coverage suite + Playwright e2e suite (alias for --coverage)
```

Coverage thresholds:
- 90% lines
- 90% statements
- 90% functions
- 80% branches

### Coverage and Observability

Unit/integration coverage artifacts:

```bash
bash repo/run_tests.sh --coverage
```

- Coverage reporter: V8 text output in terminal logs.
- Coverage thresholds are enforced and fail the run when below limits.
- Thresholds: 90% lines, 90% statements, 90% functions, 80% branches.

E2E execution artifacts:

```bash
bash repo/run_tests.sh --e2e
```

- Playwright reporter: list.
- Browser project: Chromium.
- Per-test timeout: 30 seconds.
- Per-expect timeout: 5 seconds.
- Retries: 0.

Pass criteria:

- Unit/integration: all tests pass and coverage thresholds are met.
- E2E: all browser tests pass for route guards and workflow journeys.
- Full suite: both coverage and E2E commands pass without lowering thresholds.

### Test Traceability (R1-R20)

- Requirement-to-test coverage is tracked for all requirements in [`docs/requirements-to-test.md`](../docs/requirements-to-test.md).
- Unit/integration tests validate frontend domain logic (stores, engines, services, validators, serializers, pages/components).
- Browser e2e tests validate route accessibility and auth-guard behavior from a real browser context.
- Test files include `REQ: R<n>` anchors where applicable to keep requirement mapping discoverable in-source.

### Test Coverage Model (Frontend-Only Project)

This repository has no backend HTTP API surface.

Coverage quality is evaluated using frontend criteria:

- Unit/integration depth across stores, engines, services, validators, serializers, and UI modules.
- Browser E2E workflow behavior and route-guard behavior.
- Core domain logic validation in frontend modules.

Backend HTTP endpoint coverage rules are not applicable to this repository.

## Project Structure

```
repo/
├── README.md
├── docker-compose.yml
├── run_tests.sh
└── frontend/
    ├── playwright.config.ts
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── e2e_tests/
    ├── src/
    └── unit_tests/
```

## Routes

| Path | Purpose | Guard |
|---|---|---|
| `/` | Landing page | Public |
| `/profile` | Profile selection / creation / unlock | Public |
| `/rooms` | Room list | Requires active session |
| `/rooms/create` | Create room | Requires active session |
| `/rooms/join` | Join via pairing code | Requires active session |
| `/workspace/:roomId` | Main collaboration workspace | Requires active session |
| `/workspace/:roomId/settings` | Workspace settings | Requires active session |
| `/workspace/:roomId/backup` | Backup import/export | Requires active session |

## Auth Model (Local-Only)

- No server-side login exists.
- Passphrases use PBKDF2-HMAC-SHA-256 derivation (100,000 iterations).
- Raw passphrases are never stored.
- Session policy: 30-minute inactivity lock + 8-hour forced sign-out.
- Roles (Host, Reviewer, Participant, Guest) are UI personas only, not a security boundary.

Security boundary note:

- Authentication is local-only and intended for local workspace continuity.
- Profile passphrases do not provide server-grade identity or cross-device trust.
- Authorization is a UI policy layer, not a hardened security perimeter.

## Environment Variables

No custom environment variables are required.

## Browser Requirements

- Web Crypto API
- IndexedDB
- LocalStorage
- BroadcastChannel
- Canvas API
- WebRTC DataChannels

## Limitations

- No backend or cloud sync.
- Collaboration is LAN-first via WebRTC and local persistence.
- Pairing flow is manual copy/paste text exchange.
- Forgot passphrase cannot be recovered; create a new profile.

## Troubleshooting

### Browser Data Cleared

If profiles or rooms disappear after a browser reset, site storage was cleared.
ForgeRoom stores profile/session/workspace data in IndexedDB + LocalStorage on this browser.

- Avoid clearing site data for `http://localhost:5173` unless you want a full reset.
- Export backups before browser cleanups (`Workspace` -> `Backup` -> `Download Backup`).
- If data was cleared, recreate profile(s) and re-import backup files.

### Multi-Tab Conflicts

If conflict toasts appear when the same room is open in multiple tabs, this is expected conflict signaling.

- Prefer one active editing tab per room.
- If conflict appears, keep the desired tab and reload the other tab.

### Session Lock and Sign-Out

If redirected to `/profile`, session timers likely fired.

- Inactivity lock: 30 minutes.
- Forced sign-out: 8 hours.
- Unlock with passphrase to resume, or sign in again after forced sign-out.

### Browser API Support

If canvas/collaboration features fail, verify your browser supports required APIs listed in **Browser Requirements**.

- Ensure JavaScript is enabled.
- Disable extensions that block IndexedDB/WebRTC/BroadcastChannel.
- Try a clean/incognito window to isolate extension interference.
