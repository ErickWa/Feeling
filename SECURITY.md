# Security

This repository runs [feelingthemachine.com](https://feelingthemachine.com), which holds sealed records of research participants. Reports of anything that could expose a participant, or let someone act in a participant's name, are very welcome.

## Reporting

Please report privately, not in a public issue:

- through GitHub's [private vulnerability reporting](../../security/advisories/new) for this repository, or
- by email to hello@feelingthemachine.com.

You will get an answer within a week, and a note of what was done once it is fixed. There is no bug bounty; there is credit in the fix's commit if you would like it.

## Scope

In scope: the site and its API (`site/`, `functions/`, `lib/`), the browser sealing (`site/seal.js`), the vault scripts in `scripts/`, and the CI workflow that deploys them.

Please do not test against real participants' data, send bulk email through the sign-in form, or run load or denial-of-service tests against production. A local copy (see the README's "Running it") reproduces everything except Cloudflare itself.

## What the design already assumes

The server is meant to be unable to read a participant's name or email even if it is fully compromised: both are sealed in the browser to an offline key. The known limit is the one every web page has: whoever can change the deployed `site/seal.js` could change what the browser does. That is why the deploy runs only from `master` through CI, and why the files served are byte for byte the files here.
