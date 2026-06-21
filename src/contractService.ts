import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const TIMEOUT_MS = 240_000;

export type Verdict = "BUYER_FAVORED" | "SPLIT" | "SELLER_FAVORED" | "";

export interface CaseView {
  buyer: string;
  seller: string;
  escrow: string;
  listing: string;
  buyerEvidence: string;
  sellerEvidence: string;
  status: number; // 0 OPEN, 1 READY, 2 RULED, 3 SETTLED
  buyerShare: number; // 0..100 (the measure)
  verdict: Verdict;
  rationale: string;
}

export interface CaseRow extends CaseView {
  id: number;
}

function readClient() {
  return createClient({ chain: studionet, account: createAccount() });
}
function writeClient(account: Hex) {
  return createClient({ chain: studionet, account });
}

async function waitAccepted(client: any, hash: Hex) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Transaction timed out")), TIMEOUT_MS);
  });
  try {
    await Promise.race([
      client.waitForTransactionReceipt({
        hash: hash as never,
        status: TransactionStatus.ACCEPTED,
        interval: 5000,
        retries: 64,
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pick(obj: any, key: string, idx: number): any {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) return obj[idx];
  if (typeof obj === "object" && key in obj) return obj[key];
  return undefined;
}

export async function createDispute(
  account: Hex,
  f: { seller: string; listing: string; buyerEvidence: string; escrowWei: bigint }
): Promise<number> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "create_dispute",
    args: [f.seller.trim(), f.listing.trim(), f.buyerEvidence.trim()],
    value: f.escrowWei,
  })) as Hex;
  await waitAccepted(wc, h);
  const c = await getCounts();
  const id = c.next - 1;
  if (id < 0) throw new Error("Could not resolve the opened case id");
  return id;
}

export async function submitEvidence(account: Hex, caseId: number, sellerEvidence: string): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "submit_evidence",
    args: [caseId, sellerEvidence.trim()],
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function adjudicateSplit(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "adjudicate_split",
    args: [caseId],
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function release(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "release",
    args: [caseId],
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function getCase(caseId: number): Promise<CaseView> {
  const r: any = await readClient().readContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "get_case",
    args: [caseId],
  });
  return {
    buyer: String(pick(r, "buyer", 0) ?? ""),
    seller: String(pick(r, "seller", 1) ?? ""),
    escrow: String(pick(r, "escrow", 2) ?? "0"),
    listing: String(pick(r, "listing_terms", 3) ?? ""),
    buyerEvidence: String(pick(r, "buyer_evidence", 4) ?? ""),
    sellerEvidence: String(pick(r, "seller_evidence", 5) ?? ""),
    status: Number(pick(r, "status", 6) ?? 0),
    buyerShare: Number(pick(r, "buyer_share", 7) ?? 0),
    verdict: String(pick(r, "verdict", 8) ?? "") as Verdict,
    rationale: String(pick(r, "rationale", 9) ?? ""),
  };
}

export async function getCounts(): Promise<{ next: number; ruled: number; settled: number }> {
  const r: any = await readClient().readContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "get_counts",
    args: [],
  });
  const parts = String(r).split("||").map((x) => Number(x) || 0);
  return { next: parts[0] || 0, ruled: parts[1] || 0, settled: parts[2] || 0 };
}

export async function getPoolBalance(): Promise<string> {
  const r: any = await readClient().readContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "get_pool_balance",
    args: [],
  });
  return String(r ?? "0");
}

export async function listAll(maxRows = 50): Promise<CaseRow[]> {
  const { next } = await getCounts();
  if (next === 0) return [];
  const ids: number[] = [];
  for (let i = next - 1; i >= 0 && i >= next - maxRows; i--) ids.push(i);
  const rows = await Promise.all(
    ids.map(async (id) => {
      try {
        const c = await getCase(id);
        return { id, ...c };
      } catch {
        return null;
      }
    })
  );
  return rows.filter((r): r is CaseRow => r !== null);
}
