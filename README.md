# Edition Signal

Edition Signal helps editorial teams publish a reproducible shortlist based on changes in Wikipedia readership. A curator freezes a slate of two to six canonical English Wikipedia articles, an inclusive 14-day UTC window and a capacity of one to four stories. Anyone can submit an observation. GenLayer validators independently retrieve the corresponding Wikimedia Analytics series and agree on all 14 daily counts before they enter the edition.

[Open the planning desk](https://chongqianli7.github.io/edition-signal/) · [Stable Studionet contract](https://explorer-studio.genlayer.com/address/0x86CAC55be471ce989a0852a729617306C6D2829d)

## Workflow

1. Create a temporary test wallet, choose an unused edition key and freeze a slate.
2. Measure each article. A verified series records its daily counts, exact source URL and submitting wallet. A confirmed HTTP 404 records that no series was returned. Missing series can be retried while the slate is open.
3. The curator publishes after every row is resolved and at least one qualifies. The contract compares the second seven days against the first. A qualifying story needs at least 100 baseline views. It ranks by relative lift rounded down to basis points, then recent views descending and canonical title ascending. The contract selects at most one story per desk within the edition capacity.
4. Read the finalized shortlist as a visitor. Inspect both weeks, eligibility decisions, evidence links and receipts. Download the edition JSON for the editorial meeting.

Published editions are immutable. Incomplete payloads, duplicate dates, invalid data and server failures do not resolve a pending row. Exact equality compares normalized daily counts. Validator disagreement cannot commit an observation. Signed write operations use temporary in-memory SDK accounts on Stable Studionet 61999. Reloading clears those wallets. Start a new slate if its curator is lost or its frozen input needs changing.

## Scope

Readership is an editorial input. Counts do not establish uniqueness, merit, causation or immunity from coordinated traffic. The service uses English Wikipedia canonical article titles within a bounded ASCII subset and does not resolve aliases or redirects. The contract records what the source returned during consensus. HTTP 404 can also reflect data unavailability. The browser suggests historical windows with a two-day buffer. The contract will accept a dated slate before full data is available, but measurement then requires the source observations described above.

## Develop and verify

Use Node.js 22, npm and Python 3.

```sh
npm ci
npm test
npm run dev
npm run build
```

`public/deployment.json` identifies the deployment. `scripts/deploy.mjs` writes a new deployment record when intentionally deploying. Preserve the previous record before redeployment. The demo script performs real Stable Studionet writes with fresh test wallets and requires an unused edition key.
