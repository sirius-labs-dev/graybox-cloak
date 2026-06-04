# GrayBox × Cloak — Dashboard

Institutional dashboard for managing GrayBox stealth address payments.
Built with Next.js 16, Tailwind CSS, and Solana Wallet Adapter.

**Port:** 3001 (runs alongside the API gateway on 3000)

## What it does

- Connect a Solana wallet (Phantom, Backpack, etc.)
- Generate one-time stealth receiving addresses via the API gateway
- Monitor incoming deposit status (pending → approved → released)
- Trigger private release through Cloak shielded pool
- Generate compliance viewing keys for audit disclosure

## Run locally

```bash
cd apps/dashboard
npm install
npm run dev     # → http://localhost:3001
```

The dashboard talks to the API gateway. Start the gateway first:

```bash
cd apps/api-gateway
cp .env.example .env
npm install && npm run dev   # → http://localhost:3000
```

## Stack

| Layer | Package |
|-------|---------|
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS v4 |
| Wallet | `@solana/wallet-adapter-react` |
| RPC | `@solana/web3.js` |

## Status

Early-stage — core wallet connection and deposit management flows are
implemented. AML oracle UI and bulk treasury management are in progress.

> **Note:** This dashboard is a devnet prototype. Do not connect a mainnet
> wallet holding real funds until a security audit is complete.
