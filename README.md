# Edition Signal

Edition Signal helps editorial teams publish a reproducible shortlist based on changes in Wikipedia readership. A curator freezes a slate of two to six canonical English Wikipedia articles, an inclusive 14-day UTC window and a capacity of one to four stories. Anyone can submit an observation. GenLayer validators independently retrieve the corresponding Wikimedia Analytics series and agree on all 14 daily counts before they enter the edition.

[Open the planning desk](https://chongqianli7.github.io/edition-signal/) · [Stable Studionet contract](https://explorer-studio.genlayer.com/address/0xaA18F59e6734966Cb2F1494fe2BEc791ced53Fa1)

## Workflow

1. Create a temporary test wallet, choose an unused edition key and freeze a slate.
2. Measure each article. A verified series records its daily counts, exact source URL and submitting wallet. A confirmed HTTP 404 records that no series was returned. Missing series can be retried while the slate is open.
3. The curator publishes after every row is resolved and at least one qualifies. The contract compares the second seven days against the first. A qualifying story needs at least 100 baseline views. It ranks by relative lift rounded down to basis points, then recent views descending and canonical title ascending. The contract selects at most one story per desk within the edition capacity.
4. Read the finalized shortlist as a visitor. Inspect both weeks, eligibility decisions, evidence links and receipts. Download the edition JSON for the editorial meeting.

Published editions are immutable. Incomplete payloads, duplicate dates, invalid data and server failures do not resolve a pending row. Exact equality compares normalized daily counts. Validator disagreement cannot commit an observation. Signed write operations use temporary in-memory SDK accounts on Stable Studionet 61999. Reloading clears those wallets. Start a new slate if its curator is lost or its frozen input needs changing.

## Scope

Readership is an editorial input. Counts do not establish uniqueness, merit, causation or immunity from coordinated traffic. The service uses English Wikipedia canonical article titles within a bounded ASCII subset and does not resolve aliases or redirects. The contract records what the source returned during consensus. Historical Wikimedia responses can be revised after measurement; the immutable on-chain daily snapshot governs the published ranking, and verification reports later source drift without overwriting that snapshot. HTTP 404 can also reflect data unavailability. The browser suggests historical windows with a two-day buffer. The contract will accept a dated slate before full data is available, but measurement then requires the source observations described above.

## Develop and verify

Use Node.js 22, npm and Python 3.

```sh
npm ci
npm test
npm run dev
npm run build
```

`public/deployment.json` is the active deployment on Stable Studionet (61999). To deploy intentionally, use `node scripts/deploy.mjs <unused-output-path>`. The script leaves existing deployment records intact. The demo script signs real testnet transactions and requires an unused edition key.

## Published edition and evidence

The [Field Notes edition](https://chongqianli7.github.io/edition-signal/#edition=field-notes-v2) reuses the original finalized edition’s candidate titles, desks, UTC dates and slot limit. New validators independently measured Wikimedia on v2. The original v1 counts and ranking remain on v1.

| Version | Contract | Deployment | Evidence |
| --- | --- | --- | --- |
| v2, active | [0xaA18F59e6734966Cb2F1494fe2BEc791ced53Fa1](https://explorer-studio.genlayer.com/address/0xaA18F59e6734966Cb2F1494fe2BEc791ced53Fa1) | [FINALIZED / SUCCESS](https://explorer-studio.genlayer.com/tx/0xcd94f2b647e863e2dad6ef0e6602ddd7613920c824f1eafc7feea9599c580fdf) | [Receipts](public/evidence.json) · [Final state and rejection readbacks](public/acceptance.json) |
| v1, historical | [0x86CAC55be471ce989a0852a729617306C6D2829d](https://explorer-studio.genlayer.com/address/0x86CAC55be471ce989a0852a729617306C6D2829d) | [Deployment record](public/history/deployment-v1.json) | [Original receipts](public/history/evidence-v1.json) |

The three v2 negative cases finalized with GenVM rollback result code 1 and explicit reasons: `CURATOR_REQUIRED`, `OBSERVATIONS_PENDING` and `ALREADY_MEASURED`. The receipt execution field is `ERROR` for these expected business rejections. The verifier checks their rollback class and payload separately. The v1 receipts retain the earlier Python `AttributeError` failures. The [v2 rehearsal ledger](public/history/rehearsal-v2.json) preserves the separate frozen rehearsal and its two rejection receipts.

Run `npm run verify` for an independent read-only check of finalized receipts, the stored ranking snapshot, selection order and any subsequent Wikimedia source drift. The unit tests cover source failures that cannot be reliably triggered on public infrastructure, including divergent validator responses and HTTP 503. Run `npx playwright install chromium` and `npm run test:ui` to verify the published edition, JSON export and responsive layout in Chrome.
