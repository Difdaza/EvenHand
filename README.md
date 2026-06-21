# Even Hand

Fair escrow arbitration on [GenLayer](https://genlayer.com). A buyer escrows the disputed funds, both sides submit their evidence, and LLM-validator consensus decides how to split the escrow.

## How it works

1. A buyer **opens a dispute**, escrowing the contested amount in GEN and attaching the listing terms and their evidence.
2. The named seller **submits evidence**. Only that seller can answer.
3. **Adjudication** runs on GenLayer: each validator reads the listing against both sides and returns `buyer_share`, the percentage of the escrow owed to the buyer. Validators agree within 15 points.
4. **Release** splits the escrow by `buyer_share` and charges a 5% fee on the losing party's portion only. A balanced split carries no fee.

## Architecture

```
backend/even-hand.py   GenLayer Intelligent Contract (Python, runs on the GenVM)
frontend/              React + Vite + TypeScript dashboard (genlayer-js)
```

The dashboard reads case state through genlayer-js and signs writes with the connected wallet. Static, no backend.

## Live deployment

- **Network**: GenLayer Studionet (chain id 61999)
- **Contract**: `0xDC4e61b6d017E3175B3D83626E5c74D6b81a1E2a`

## Run locally

```bash
cd frontend
npm install
npm run dev
npm run build    # outputs frontend/dist
```

## Deploy the contract

Requires the [GenLayer CLI](https://docs.genlayer.com/) (`npx genlayer`). Set the address in `frontend/src/chain.ts` afterwards.

```bash
npx genlayer deploy --contract backend/even-hand.py
```

## Contract methods (`EvenHand`)

| Method | Type | Description |
|--------|------|-------------|
| `create_dispute` | write, payable | Open a dispute and escrow the contested funds |
| `submit_evidence` | write | Seller adds their side; case becomes ready |
| `adjudicate_split` | write | LLM consensus on `buyer_share` and the verdict |
| `release` | write | Split the escrow and charge the loser fee |
| `get_case` | view | Read a dispute by id |
| `get_pool_balance` | view | Accumulated fee pool |
| `get_counts` | view | `next_id \|\| ruled \|\| settled` |

## License

MIT
