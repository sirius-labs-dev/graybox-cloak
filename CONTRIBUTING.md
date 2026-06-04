# Contributing to GrayBox × Cloak

Thanks for your interest. GrayBox × Cloak is an early-stage research-and-engineering
project; PRs and issues are welcome — code, docs, threat-model critiques,
and small fixes alike.

## Ground rules

- **Do not push real keypairs, mnemonics, API keys, or `.env` files.**
  `.gitignore` covers the obvious files; if you create new secret material
  while developing, add the path before committing.
- **The on-chain programs are not audited.** Do not propose changes that depend
  on assumptions about mainnet hardening that we have not yet earned.
- Be considerate of compute and rent costs in any program-side change.

## Local setup

```sh
node --version    # >= 22

cd apps/api-gateway
cp .env.example .env   # fill in values
npm install
npm run dev            # → http://localhost:3000
npm test               # 8 passing
```

For end-to-end integration examples, see [`examples/`](examples/) and
[`docs/cloak-integration.md`](docs/cloak-integration.md).

## Coding style

- **TypeScript**: 2-space indent, double quotes, strict mode. The
  `tsconfig.json` is the source of truth.
- **Comments**: only when the *why* is non-obvious. Identifier names should
  carry the *what*.

## Pull request checklist

- [ ] `npm --prefix apps/api-gateway test` passes (8 tests)
- [ ] If you changed the stealth derivation algorithm, the canonical vector test
      (`apps/api-gateway/tests/vector.test.ts`) still passes byte-for-byte
- [ ] If you added or changed an API endpoint, update `docs/cloak-integration.md`
      and `docs/graybox-protocol.md` accordingly
- [ ] Documentation in `docs/` and `README.md` updated if behavior changed

## Reporting bugs

For functional bugs and feature requests, open a GitHub issue with:
- what you ran
- what you expected
- what you got
- environment (`node --version`, `npm --version`)

For security issues, follow [SECURITY.md](./SECURITY.md) — please do not open
public issues for vulnerabilities.

## Languages

The codebase is English. Issues, PRs, and design notes in either English or
Turkish are welcome — reviewers are bilingual.
